import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { db } from '../../db';
import crypto from 'crypto';

const router = Router();

type RPSChoice = 'rock' | 'paper' | 'scissors';

const WINNING_COMBOS: Record<RPSChoice, RPSChoice> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper'
};

// Create RPS game
router.post('/create', requireAuth, (req, res) => {
  const { stake, currency, rounds } = req.body;
  const agent = req.agent;

  if (!stake || stake <= 0) {
    res.status(400).json({ error: 'invalid_stake', message: 'Stake must be positive' });
    return;
  }

  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    res.status(400).json({ error: 'invalid_currency', message: 'Currency must be SOL or USDC' });
    return;
  }

  const validRounds = rounds === 1 || rounds === 3 || rounds === 5 ? rounds : 3;

  // Check balance
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < stake) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
    return;
  }

  // Deduct stake
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(stake, agent.id);

  // Create game
  const gameId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO rps_games (id, creator_id, stake, currency, rounds, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(gameId, agent.id, stake, currency, validRounds);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_create', ?, ?, ?, unixepoch())
  `).run(agent.id, currency, stake, gameId);

  res.json({
    success: true,
    gameId,
    stake,
    currency,
    rounds: validRounds
  });
});

// List open games
router.get('/open', (req, res) => {
  const games = db.prepare(`
    SELECT rg.*, a.display_name as creator_name, a.wallet_address
    FROM rps_games rg
    JOIN agents a ON rg.creator_id = a.id
    WHERE rg.status = 'open'
    ORDER BY rg.created_at DESC
  `).all();

  res.json({
    games: (games as any[]).map(g => ({
      id: g.id,
      stake: g.stake,
      currency: g.currency,
      rounds: g.rounds,
      creator: g.display_name || `${g.wallet_address.slice(0, 4)}...${g.wallet_address.slice(-4)}`,
      createdAt: g.created_at
    }))
  });
});

// Join game
router.post('/:gameId/join', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
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

  // Deduct stake
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(game.stake, agent.id);

  // Update game
  db.prepare('UPDATE rps_games SET acceptor_id = ?, status = 'committing' WHERE id = ?').run(agent.id, gameId);

  res.json({
    success: true,
    gameId,
    message: 'Joined game. Waiting for both players to commit.',
    rounds: game.rounds
  });
});

// Commit choice (hash of choice + nonce)
router.post('/:gameId/commit', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const { round, hash } = req.body;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  const isCreator = game.creator_id === agent.id;
  const isAcceptor = game.acceptor_id === agent.id;

  if (!isCreator && !isAcceptor) {
    res.status(400).json({ error: 'not_in_game', message: 'Not in this game' });
    return;
  }

  // Store commit
  const field = isCreator ? 'creator_commits' : 'acceptor_commits';
  let commits = JSON.parse(game[field] || '[]');
  commits[round] = hash;
  
  db.prepare(`UPDATE rps_games SET ${field} = ? WHERE id = ?`).run(JSON.stringify(commits), gameId);

  res.json({ success: true, message: 'Choice committed' });
});

// Reveal choice
router.post('/:gameId/reveal', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const { round, choice, nonce } = req.body;
  const agent = req.agent;

  if (!['rock', 'paper', 'scissors'].includes(choice)) {
    res.status(400).json({ error: 'invalid_choice', message: 'Choice must be rock, paper, or scissors' });
    return;
  }

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  const isCreator = game.creator_id === agent.id;
  const isAcceptor = game.acceptor_id === agent.id;

  if (!isCreator && !isAcceptor) {
    res.status(400).json({ error: 'not_in_game', message: 'Not in this game' });
    return;
  }

  // Verify hash matches commit
  const verifyHash = crypto.createHash('sha256').update(choice + nonce).digest('hex');
  const commitsField = isCreator ? 'creator_commits' : 'acceptor_commits';
  const commits = JSON.parse(game[commitsField] || '[]');
  
  if (commits[round] !== verifyHash) {
    res.status(400).json({ error: 'invalid_reveal', message: 'Hash does not match commit' });
    return;
  }

  // Store reveal
  const revealsField = isCreator ? 'creator_reveals' : 'acceptor_reveals';
  let reveals = JSON.parse(game[revealsField] || '[]');
  reveals[round] = { choice, nonce };
  
  db.prepare(`UPDATE rps_games SET ${revealsField} = ? WHERE id = ?`).run(JSON.stringify(reveals), gameId);

  // Check if both revealed
  const otherRevealsField = isCreator ? 'acceptor_reveals' : 'creator_reveals';
  const otherReveals = JSON.parse(game[otherRevealsField] || '[]');
  
  if (reveals[round] && otherReveals[round]) {
    // Both revealed, determine winner of round
    const creatorChoice: RPSChoice = JSON.parse(game.creator_reveals)[round].choice;
    const acceptorChoice: RPSChoice = otherReveals[round].choice;
    
    let creatorWon = false;
    let acceptorWon = false;
    
    if (creatorChoice === acceptorChoice) {
      // Tie - no points
    } else if (WINNING_COMBOS[creatorChoice] === acceptorChoice) {
      creatorWon = true;
    } else {
      acceptorWon = true;
    }

    // Update scores
    const newCreatorWins = game.creator_wins + (creatorWon ? 1 : 0);
    const newAcceptorWins = game.acceptor_wins + (acceptorWon ? 1 : 0);
    const newRound = round + 1;

    db.prepare(`
      UPDATE rps_games 
      SET creator_wins = ?, acceptor_wins = ?, current_round = ?
      WHERE id = ?
    `).run(newCreatorWins, newAcceptorWins, newRound, gameId);

    // Check if game is over
    const roundsToWin = Math.ceil(game.rounds / 2);
    const gameOver = newCreatorWins >= roundsToWin || newAcceptorWins >= roundsToWin || newRound >= game.rounds;

    if (gameOver) {
      // Determine final winner
      let winnerId: string | null = null;
      if (newCreatorWins > newAcceptorWins) winnerId = game.creator_id;
      else if (newAcceptorWins > newCreatorWins) winnerId = game.acceptor_id;
      // Tie - no winner

      const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
      
      if (winnerId) {
        const totalPot = game.stake * 2;
        const rake = totalPot * 0.02; // 2% rake for RPS
        const winnerAmount = totalPot - rake;

        // Credit winner
        db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(winnerAmount, winnerId);

        // Log rake
        db.prepare(`
          INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
          VALUES ('rps', ?, ?, ?, ?, unixepoch())
        `).run(gameId, rake, game.currency, totalPot);

        // Update game
        db.prepare(`
          UPDATE rps_games 
          SET status = 'completed', winner_id = ?, rake = ?, completed_at = unixepoch()
          WHERE id = ?
        `).run(winnerId, rake, gameId);

        // Log win/loss
        const loserId = winnerId === game.creator_id ? game.acceptor_id : game.creator_id;
        db.prepare(`
          INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
          VALUES (?, 'rps_win', ?, ?, ?, unixepoch())
        `).run(winnerId, game.currency, winnerAmount, gameId);
        db.prepare(`
          INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
        `).run(loserId, 'rps_loss', game.currency, -game.stake, gameId);
      } else {
        // Tie - return stakes
        db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, game.creator_id);
        db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, game.acceptor_id);
        
        db.prepare(`UPDATE rps_games SET status = 'completed', completed_at = unixepoch() WHERE id = ?`).run(gameId);
      }
    }

    res.json({
      success: true,
      round,
      creatorChoice,
      acceptorChoice,
      creatorWon,
      acceptorWon,
      gameOver
    });
  } else {
    res.json({ success: true, message: 'Reveal recorded. Waiting for opponent.' });
  }
});

// Get game state
router.get('/:gameId', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare(`
    SELECT rg.*,
           c.display_name as creator_name, c.wallet_address as creator_wallet,
           a.display_name as acceptor_name, a.wallet_address as acceptor_wallet,
           w.display_name as winner_name
    FROM rps_games rg
    JOIN agents c ON rg.creator_id = c.id
    LEFT JOIN agents a ON rg.acceptor_id = a.id
    LEFT JOIN agents w ON rg.winner_id = w.id
    WHERE rg.id = ?
  `).get(gameId) as any;

  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  const isPlayer = game.creator_id === agent.id || game.acceptor_id === agent.id;

  res.json({
    id: game.id,
    stake: game.stake,
    currency: game.currency,
    rounds: game.rounds,
    status: game.status,
    currentRound: game.current_round,
    creator: {
      name: game.creator_name || `${game.creator_wallet.slice(0, 4)}...${game.creator_wallet.slice(-4)}`,
      wins: game.creator_wins
    },
    acceptor: game.acceptor_id ? {
      name: game.acceptor_name || `${game.acceptor_wallet.slice(0, 4)}...${game.acceptor_wallet.slice(-4)}`,
      wins: game.acceptor_wins
    } : null,
    winner: game.winner_name || null,
    myCommits: game.creator_id === agent.id ? JSON.parse(game.creator_commits || '[]') : JSON.parse(game.acceptor_commits || '[]'),
    currentRoundComplete: !!(JSON.parse(game.creator_reveals || '[]')[game.current_round] && JSON.parse(game.acceptor_reveals || '[]')[game.current_round])
  });
});

export default router;
