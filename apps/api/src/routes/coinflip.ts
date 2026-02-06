import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { db } from '../../db';
import crypto from 'crypto';

const router = Router();

// Active coinflip games
const games = new Map<string, any>();

// Create a coinflip game
router.post('/create', requireAuth, (req, res) => {
  const { stake, currency } = req.body;
  const agent = req.agent;

  if (!stake || stake <= 0) {
    res.status(400).json({ error: 'invalid_stake', message: 'Stake must be positive' });
    return;
  }

  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    res.status(400).json({ error: 'invalid_currency', message: 'Currency must be SOL or USDC' });
    return;
  }

  // Check balance
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < stake) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
    return;
  }

  // Generate proof hash (secret determines winner)
  const proofSecret = crypto.randomBytes(32).toString('hex');
  const proofHash = crypto.createHash('sha256').update(proofSecret).digest('hex');

  // Deduct stake from creator
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(stake, agent.id);

  // Create game
  const gameId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO coinflip_games (id, creator_id, stake, currency, proof_hash, proof_secret, created_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `).run(gameId, agent.id, stake, currency, proofHash, proofSecret);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'coinflip_create', ?, ?, ?, unixepoch())
  `).run(agent.id, currency, stake, gameId);

  res.json({
    success: true,
    gameId,
    stake,
    currency,
    proofHash
  });
});

// List open games
router.get('/open', (req, res) => {
  const games = db.prepare(`
    SELECT cg.*, a.display_name as creator_name, a.wallet_address
    FROM coinflip_games cg
    JOIN agents a ON cg.creator_id = a.id
    WHERE cg.status = 'open'
    ORDER BY cg.created_at DESC
  `).all();

  res.json({
    games: (games as any[]).map(g => ({
      id: g.id,
      stake: g.stake,
      currency: g.currency,
      creator: g.display_name || `${g.wallet_address.slice(0, 4)}...${g.wallet_address.slice(-4)}`,
      proofHash: g.proof_hash,
      createdAt: g.created_at
    }))
  });
});

// Join and flip
router.post('/:gameId/join', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  if (game.status !== 'open') {
    res.status(400).json({ error: 'game_not_open', message: 'Game is not open' });
    return;
  }

  if (game.creator_id === agent.id) {
    res.status(400).json({ error: 'cannot_join_own', message: 'Cannot join your own game' });
    return;
  }

  // Check balance
  const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < game.stake) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
    return;
  }

  // Deduct stake from joiner
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(game.stake, agent.id);

  // Determine winner using hash as seed
  const combined = game.proof_secret + agent.id + game.creator_id;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  const winnerIsCreator = parseInt(hash.slice(0, 8), 16) % 2 === 0;
  const winnerId = winnerIsCreator ? game.creator_id : agent.id;

  // Calculate rake (1% for coinflip)
  const totalPot = game.stake * 2;
  const rake = totalPot * 0.01;
  const winnerAmount = totalPot - rake;

  // Credit winner
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(winnerAmount, winnerId);

  // Log rake
  db.prepare(`
    INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
    VALUES ('coinflip', ?, ?, ?, ?, unixepoch())
  `).run(gameId, rake, game.currency, totalPot);

  // Update game
  db.prepare(`
    UPDATE coinflip_games 
    SET status = 'completed', acceptor_id = ?, winner_id = ?, rake = ?, completed_at = unixepoch()
    WHERE id = ?
  `).run(agent.id, winnerId, rake, gameId);

  // Log transactions
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(agent.id, 'coinflip_loss', game.currency, -game.stake, gameId);

  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(winnerId, 'coinflip_win', game.currency, winnerAmount, gameId);

  // Update winner stats
  db.prepare('UPDATE agents SET games_played = games_played + 1, total_profit = total_profit + ? WHERE id = ?')
    .run(winnerIsCreator ? winnerAmount - game.stake : winnerAmount - game.stake, winnerId);
  db.prepare('UPDATE agents SET games_played = games_played + 1 WHERE id = ?').run(winnerIsCreator ? agent.id : game.creator_id);

  res.json({
    success: true,
    gameId,
    winner: winnerId,
    won: winnerId === agent.id ? winnerAmount : 0,
    rake,
    proofHash: game.proof_hash
  });
});

// Get game result
router.get('/:gameId', (req, res) => {
  const { gameId } = req.params;

  const game = db.prepare(`
    SELECT cg.*, 
           c.display_name as creator_name, c.wallet_address as creator_wallet,
           a.display_name as acceptor_name, a.wallet_address as acceptor_wallet,
           w.display_name as winner_name
    FROM coinflip_games cg
    JOIN agents c ON cg.creator_id = c.id
    LEFT JOIN agents a ON cg.acceptor_id = a.id
    LEFT JOIN agents w ON cg.winner_id = w.id
    WHERE cg.id = ?
  `).get(gameId) as any;

  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  res.json({
    id: game.id,
    stake: game.stake,
    currency: game.currency,
    status: game.status,
    creator: game.creator_name || `${game.creator_wallet.slice(0, 4)}...${game.creator_wallet.slice(-4)}`,
    acceptor: game.acceptor_name || (game.acceptor_wallet ? `${game.acceptor_wallet.slice(0, 4)}...${game.acceptor_wallet.slice(-4)}` : null),
    winner: game.winner_name || null,
    rake: game.rake,
    proofHash: game.proof_hash,
    createdAt: game.created_at,
    completedAt: game.completed_at
  });
});

export default router;
