import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { db } from '../../db';
import crypto from 'crypto';

const router = Router();

const EXPIRY_SECONDS = 300; // 5 minutes
const RAKE_PERCENTAGE = 0.04; // 4%

// Create a coinflip game
router.post('/create', requireAuth, (req, res) => {
  const { stake, currency } = req.body;
  const agent = req.agent;

  // Validation
  if (!stake || stake <= 0) {
    res.status(400).json({ error: 'invalid_stake', message: 'Stake must be positive' });
    return;
  }

  const minStake = currency === 'SOL' ? 0.01 : 1;
  const maxStake = currency === 'SOL' ? 50 : 5000;
  
  if (stake < minStake || stake > maxStake) {
    res.status(400).json({ 
      error: 'invalid_stake', 
      message: `Stake must be between ${minStake} and ${maxStake} ${currency}` 
    });
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

  // Generate secret and proof hash
  const secret = crypto.randomBytes(32).toString('hex');
  const proofHash = crypto.createHash('sha256').update(secret + agent.wallet_address + 'coinflip').digest('hex');

  // Deduct stake from creator
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(stake, agent.id);

  // Create game
  const gameId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;
  
  db.prepare(`
    INSERT INTO coinflip_games (id, creator_id, stake, currency, proof_hash, proof_secret, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', unixepoch(), ?)
  `).run(gameId, agent.id, stake, currency, proofHash, secret, expiresAt);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'coinflip_create', ?, ?, ?, unixepoch())
  `).run(agent.id, currency, stake, gameId);

  res.json({
    success: true,
    game_id: gameId,
    stake,
    currency,
    proof_hash: proofHash,
    expires_at: expiresAt
  });
});

// List open games
router.get('/open', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  
  const games = db.prepare(`
    SELECT cg.*, a.display_name, a.wallet_address
    FROM coinflip_games cg
    JOIN agents a ON cg.creator_id = a.id
    WHERE cg.status = 'open' AND cg.expires_at > ?
    ORDER BY cg.created_at DESC
  `).all(now);

  res.json({
    games: (games as any[]).map(g => ({
      game_id: g.id,
      creator: g.display_name || `${g.wallet_address.slice(0, 4)}...${g.wallet_address.slice(-4)}`,
      stake: g.stake,
      currency: g.currency,
      created_at: g.created_at,
      expires_at: g.expires_at
    }))
  });
});

// Get game details
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

  const response: any = {
    id: game.id,
    stake: game.stake,
    currency: game.currency,
    status: game.status,
    creator: game.creator_name || `${game.creator_wallet.slice(0, 4)}...${game.creator_wallet.slice(-4)}`,
    acceptor: game.acceptor_name || (game.acceptor_wallet ? `${game.acceptor_wallet.slice(0, 4)}...${game.acceptor_wallet.slice(-4)}` : null),
    winner: game.winner_name || null,
    rake: game.rake,
    proof_hash: game.proof_hash,
    created_at: game.created_at,
    completed_at: game.completed_at,
    expires_at: game.expires_at
  };

  // Include proof secret for verification if completed
  if (game.status === 'completed' && game.proof_secret) {
    response.proof_secret = game.proof_secret;
    response.verification_steps = {
      step1: `SHA256(${game.proof_secret} + ${game.creator_wallet} + "coinflip") = ${game.proof_hash}`,
      step2: `SHA256(${game.proof_secret} + ${game.creator_wallet} + ${game.acceptor_wallet || 'N/A'})`,
      step3: 'First byte even = creator wins, odd = acceptor wins'
    };
  }

  res.json(response);
});

// Accept and flip
router.post('/:gameId/accept', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;
  const now = Math.floor(Date.now() / 1000);

  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  if (game.status !== 'open') {
    res.status(400).json({ error: 'game_not_open', message: 'Game is not open' });
    return;
  }

  if (game.expires_at < now) {
    res.status(400).json({ error: 'game_expired', message: 'Game has expired' });
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

  // Get creator wallet
  const creator = db.prepare('SELECT wallet_address FROM agents WHERE id = ?').get(game.creator_id) as any;

  // Deduct stake from acceptor
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(game.stake, agent.id);

  // Determine winner using commit-reveal
  // result = SHA256(secret + creator_wallet + acceptor_wallet)
  // First byte even = creator wins, odd = acceptor wins
  const resultHash = crypto.createHash('sha256')
    .update(game.proof_secret + creator.wallet_address + agent.wallet_address)
    .digest('hex');
  
  const firstByte = parseInt(resultHash.slice(0, 2), 16);
  const creatorWins = firstByte % 2 === 0;
  const winnerId = creatorWins ? game.creator_id : agent.id;
  const loserId = creatorWins ? agent.id : game.creator_id;

  // Calculate rake and payout
  const totalPot = game.stake * 2;
  const rake = totalPot * RAKE_PERCENTAGE;
  const payout = totalPot - rake;

  // Credit winner
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(payout, winnerId);

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
    VALUES (?, 'coinflip_loss', ?, ?, ?, unixepoch())
  `).run(loserId, game.currency, -game.stake, gameId);

  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
  `).run(winnerId, 'coinflip_win', game.currency, payout, gameId);

  // Update stats
  db.prepare(`
    UPDATE agents SET 
      games_played = games_played + 1,
      coinflip_games = COALESCE(coinflip_games, 0) + 1,
      coinflip_wins = COALESCE(coinflip_wins, 0) + ?,
      coinflip_losses = COALESCE(coinflip_losses, 0) + ?,
      coinflip_profit = COALESCE(coinflip_profit, 0) + ?
    WHERE id = ?
  `).run(creatorWins ? 1 : 0, creatorWins ? 0 : 1, payout - game.stake, winnerId);

  db.prepare(`
    UPDATE agents SET 
      games_played = games_played + 1,
      coinflip_games = COALESCE(coinflip_games, 0) + 1,
      coinflip_wins = COALESCE(coinflip_wins, 0) + ?,
      coinflip_losses = COALESCE(coinflip_losses, 0) + ?,
      coinflip_profit = COALESCE(coinflip_profit, 0) + ?
    WHERE id = ?
  `).run(creatorWins ? 0 : 1, creatorWins ? 1 : 0, -game.stake, loserId);

  res.json({
    success: true,
    game_id: gameId,
    winner: winnerId,
    loser: loserId,
    payout,
    rake,
    proof_secret: game.proof_secret,
    proof_hash: game.proof_hash,
    verification_steps: {
      commitment: `SHA256(${game.proof_secret} + ${creator.wallet_address} + "coinflip") = ${game.proof_hash}`,
      result_calculation: `SHA256(${game.proof_secret} + ${creator.wallet_address} + ${agent.wallet_address})`,
      first_byte: `${firstByte} (${firstByte % 2 === 0 ? 'even' : 'odd'})`,
      winner: creatorWins ? 'creator' : 'acceptor'
    }
  });
});

// Cancel game
router.post('/:gameId/cancel', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  if (game.creator_id !== agent.id) {
    res.status(403).json({ error: 'not_creator', message: 'Only creator can cancel' });
    return;
  }

  if (game.status !== 'open') {
    res.status(400).json({ error: 'game_not_open', message: 'Game is not open' });
    return;
  }

  // Refund stake
  const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, agent.id);

  // Update game
  db.prepare(`UPDATE coinflip_games SET status = 'cancelled' WHERE id = ?`).run(gameId);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'coinflip_cancelled', ?, ?, ?, unixepoch())
  `).run(agent.id, game.currency, game.stake, gameId);

  res.json({ success: true, message: 'Game cancelled, stake refunded' });
});

// Rematch (double or nothing)
router.post('/:gameId/rematch', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  if (game.status !== 'completed') {
    res.status(400).json({ error: 'game_not_complete', message: 'Game must be completed' });
    return;
  }

  if (game.winner_id !== agent.id) {
    res.status(403).json({ error: 'not_winner', message: 'Only winner can propose rematch' });
    return;
  }

  const opponentId = game.creator_id === agent.id ? game.acceptor_id : game.creator_id;
  const newStake = game.stake * 2;

  // Create new game with double stake
  const secret = crypto.randomBytes(32).toString('hex');
  const proofHash = crypto.createHash('sha256').update(secret + agent.wallet_address + 'coinflip').digest('hex');

  // Deduct new stake from winner
  const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  const currentBalance = db.prepare(`SELECT ${balanceField} as balance FROM agents WHERE id = ?`).get(agent.id) as any;
  
  if (currentBalance.balance < newStake) {
    res.status(400).json({ error: 'insufficient_balance', message: `Need ${newStake} for rematch` });
    return;
  }

  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(newStake, agent.id);

  const newGameId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 60; // 60 seconds for rematch

  db.prepare(`
    INSERT INTO coinflip_games (id, creator_id, stake, currency, proof_hash, proof_secret, status, created_at, expires_at, rematch_of)
    VALUES (?, ?, ?, ?, ?, ?, 'open', unixepoch(), ?, ?)
  `).run(newGameId, agent.id, newStake, game.currency, proofHash, secret, expiresAt, gameId);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'coinflip_rematch', ?, ?, ?, unixepoch())
  `).run(agent.id, game.currency, newStake, newGameId);

  res.json({
    success: true,
    game_id: newGameId,
    stake: newStake,
    currency: game.currency,
    opponent_id: opponentId,
    expires_at: expiresAt,
    message: 'Rematch created. Opponent has 60 seconds to accept.'
  });
});

// Personal stats
router.get('/stats', requireAuth, (req, res) => {
  const agent = req.agent;

  const stats = db.prepare(`
    SELECT 
      COALESCE(coinflip_games, 0) as games_played,
      COALESCE(coinflip_wins, 0) as wins,
      COALESCE(coinflip_losses, 0) as losses,
      COALESCE(coinflip_profit, 0) as profit
    FROM agents WHERE id = ?
  `).get(agent.id);

  const winRate = stats.games_played > 0 ? (stats.wins / stats.games_played * 100).toFixed(1) : '0.0';

  res.json({
    games_played: stats.games_played,
    wins: stats.wins,
    losses: stats.losses,
    win_rate: `${winRate}%`,
    profit_sol: agent.balance_sol,
    profit_usdc: agent.balance_usdc,
    coinflip_profit: stats.profit
  });
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  const leaders = db.prepare(`
    SELECT 
      id,
      display_name,
      wallet_address,
      COALESCE(coinflip_games, 0) as games,
      COALESCE(coinflip_wins, 0) as wins,
      COALESCE(coinflip_profit, 0) as profit
    FROM agents
    WHERE coinflip_games > 0
    ORDER BY coinflip_profit DESC
    LIMIT 50
  `).all();

  res.json({
    leaderboard: (leaders as any[]).map((a, i) => ({
      rank: i + 1,
      agent: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
      games: a.games,
      wins: a.wins,
      profit: a.profit
    }))
  });
});

export default router;
