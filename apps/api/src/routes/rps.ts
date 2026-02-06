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

const COMMIT_TIMEOUT = 15; // seconds
const REVEAL_TIMEOUT = 15; // seconds
const GAME_EXPIRY = 300; // 5 minutes for open games

// Helper to record choice pattern for an agent
function recordChoice(agentId: string, choice: RPSChoice): void {
  const fieldMap: Record<RPSChoice, string> = {
    rock: 'rps_rock_count',
    paper: 'rps_paper_count',
    scissors: 'rps_scissors_count'
  };
  
  db.prepare(`UPDATE agents SET ${fieldMap[choice]} = COALESCE(${fieldMap[choice]}, 0) + 1 WHERE id = ?`).run(agentId);
}

// Helper to get agent's choice pattern
function getPattern(agentId: string): { rock: number; paper: number; scissors: number; total: number } | null {
  const stats = db.prepare(`
    SELECT 
      COALESCE(rps_rock_count, 0) as rock,
      COALESCE(rps_paper_count, 0) as paper,
      COALESCE(rps_scissors_count, 0) as scissors,
      COALESCE(rps_rounds_played, 0) as total
    FROM agents WHERE id = ?
  `).get(agentId) as any;
  
  if (!stats || stats.total === 0) return null;
  
  return {
    rock: Math.round((stats.rock / stats.total) * 1000) / 10,
    paper: Math.round((stats.paper / stats.total) * 1000) / 10,
    scissors: Math.round((stats.scissors / stats.total) * 1000) / 10,
    total: stats.total
  };
}

// Create RPS game
router.post('/create', requireAuth, (req, res) => {
  const { stake, currency, rounds } = req.body;
  const agent = req.agent;

  if (!stake || stake <= 0) {
    res.status(400).json({ error: 'invalid_stake', message: 'Stake must be positive' });
    return;
  }

  const minStake = currency === 'SOL' ? 0.01 : 1;
  const maxStake = currency === 'SOL' ? 25 : 2500;
  
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

  if (![1, 3, 5].includes(rounds)) {
    res.status(400).json({ error: 'invalid_rounds', message: 'Rounds must be 1, 3, or 5' });
    return;
  }

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
  const expiresAt = Math.floor(Date.now() / 1000) + GAME_EXPIRY;
  
  db.prepare(`
    INSERT INTO rps_games (id, creator_id, stake, currency, rounds, status, current_round, created_at, expires_at, phase_started_at)
    VALUES (?, ?, ?, ?, ?, 'open', 0, unixepoch(), ?, unixepoch())
  `).run(gameId, agent.id, stake, currency, rounds, expiresAt);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_create', ?, ?, ?, unixepoch())
  `).run(agent.id, currency, stake, gameId);

  res.json({
    success: true,
    game_id: gameId,
    stake,
    rounds,
    currency,
    status: 'open',
    expires_at: expiresAt
  });
});

// List open games
router.get('/open', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  
  const games = db.prepare(`
    SELECT rg.*, a.display_name, a.wallet_address
    FROM rps_games rg
    JOIN agents a ON rg.creator_id = a.id
    WHERE rg.status = 'open' AND rg.expires_at > ?
    ORDER BY rg.created_at DESC
  `).all(now);

  res.json({
    games: (games as any[]).map(g => ({
      game_id: g.id,
      creator: g.display_name || `${g.wallet_address.slice(0, 4)}...${g.wallet_address.slice(-4)}`,
      stake: g.stake,
      currency: g.currency,
      rounds: g.rounds,
      created_at: g.created_at,
      expires_at: g.expires_at
    }))
  });
});

// Get game state
router.get('/:gameId', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;
  const now = Math.floor(Date.now() / 1000);

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

  const isCreator = game.creator_id === agent.id;
  const isAcceptor = game.acceptor_id === agent.id;
  const isPlayer = isCreator || isAcceptor;

  // Parse commits and reveals
  const creatorCommits = JSON.parse(game.creator_commits || '[]');
  const acceptorCommits = JSON.parse(game.acceptor_commits || '[]');
  const creatorReveals = JSON.parse(game.creator_reveals || '[]');
  const acceptorReveals = JSON.parse(game.acceptor_reveals || '[]');

  const currentRound = game.current_round;
  const creatorCommitted = !!creatorCommits[currentRound];
  const acceptorCommitted = !!acceptorCommits[currentRound];
  const creatorRevealed = !!creatorReveals[currentRound];
  const acceptorRevealed = !!acceptorReveals[currentRound];

  // Calculate time remaining
  let timeRemaining = null;
  if (game.status === 'committing' || game.status === 'revealing') {
    const elapsed = now - game.phase_started_at;
    const timeout = game.status === 'committing' ? COMMIT_TIMEOUT : REVEAL_TIMEOUT;
    timeRemaining = Math.max(0, timeout - elapsed);
  }

  // Build round history for completed games
  const roundHistory = [];
  if (game.status === 'completed') {
    for (let i = 1; i <= game.rounds; i++) {
      if (creatorReveals[i] && acceptorReveals[i]) {
        const cChoice = creatorReveals[i].choice;
        const aChoice = acceptorReveals[i].choice;
        let winner = 'tie';
        if (cChoice !== aChoice) {
          winner = WINNING_COMBOS[cChoice] === aChoice ? 'creator' : 'acceptor';
        }
        roundHistory.push({
          round: i,
          creator_choice: cChoice,
          acceptor_choice: aChoice,
          winner
        });
      }
    }
  }

  const response: any = {
    id: game.id,
    stake: game.stake,
    currency: game.currency,
    rounds: game.rounds,
    status: game.status,
    current_round: currentRound,
    phase: game.status,
    score: {
      creator: game.creator_wins,
      acceptor: game.acceptor_wins
    },
    creator: {
      id: game.creator_id,
      name: game.creator_name || `${game.creator_wallet.slice(0, 4)}...${game.creator_wallet.slice(-4)}`
    },
    acceptor: game.acceptor_id ? {
      id: game.acceptor_id,
      name: game.acceptor_name || `${game.acceptor_wallet.slice(0, 4)}...${game.acceptor_wallet.slice(-4)}`
    } : null,
    winner: game.winner_id || null,
    committed: {
      creator: creatorCommitted,
      acceptor: acceptorCommitted
    },
    revealed: {
      creator: creatorRevealed,
      acceptor: acceptorRevealed
    },
    time_remaining: timeRemaining,
    expires_at: game.expires_at
  };

  // Include round history for completed games
  if (game.status === 'completed') {
    response.round_history = roundHistory;
    response.final_score = { creator: game.creator_wins, acceptor: game.acceptor_wins };
    response.rake = game.rake;
    if (game.forfeited_by) {
      response.forfeited_by = game.forfeited_by;
      response.forfeit_reason = game.forfeit_reason;
    }
  }

  // Include my commit/reveal status
  if (isPlayer) {
    const myCommits = isCreator ? creatorCommits : acceptorCommits;
    const myReveals = isCreator ? creatorReveals : acceptorReveals;
    response.my_commit = myCommits[currentRound] || null;
    response.my_reveal = myReveals[currentRound] || null;
  }

  res.json(response);
});

// Accept game
router.post('/:gameId/accept', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;
  const now = Math.floor(Date.now() / 1000);

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
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

  // Deduct stake
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(game.stake, agent.id);

  // Start round 1
  db.prepare(`
    UPDATE rps_games 
    SET acceptor_id = ?, status = 'committing', current_round = 1, phase_started_at = unixepoch()
    WHERE id = ?
  `).run(agent.id, gameId);

  res.json({
    success: true,
    game_id: gameId,
    message: 'Joined game. Round 1 - commit your choice!',
    current_round: 1,
    status: 'committing'
  });
});

// Commit choice
router.post('/:gameId/commit', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const { hash } = req.body;
  const agent = req.agent;

  if (!hash) {
    res.status(400).json({ error: 'missing_hash', message: 'Hash is required' });
    return;
  }

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
  if (!game) {
    res.status(404).json({ error: 'game_not_found', message: 'Game not found' });
    return;
  }

  if (game.status !== 'committing') {
    res.status(400).json({ error: 'not_commit_phase', message: 'Not in commit phase' });
    return;
  }

  const isCreator = game.creator_id === agent.id;
  const isAcceptor = game.acceptor_id === agent.id;

  if (!isCreator && !isAcceptor) {
    res.status(400).json({ error: 'not_in_game', message: 'Not in this game' });
    return;
  }

  // Check if already committed this round
  const commitsField = isCreator ? 'creator_commits' : 'acceptor_commits';
  const commits = JSON.parse(game[commitsField] || '[]');
  
  if (commits[game.current_round]) {
    res.status(400).json({ error: 'already_committed', message: 'Already committed for this round' });
    return;
  }

  // Store commit
  commits[game.current_round] = hash;
  db.prepare(`UPDATE rps_games SET ${commitsField} = ? WHERE id = ?`).run(JSON.stringify(commits), gameId);

  // Check if both committed
  const otherCommitsField = isCreator ? 'acceptor_commits' : 'creator_commits';
  const otherCommits = JSON.parse(game[otherCommitsField] || '[]');
  const otherCommitted = !!otherCommits[game.current_round];

  let whoCommitted = isCreator ? (otherCommitted ? 'both' : 'creator') : (otherCommitted ? 'both' : 'acceptor');

  // If both committed, transition to revealing
  if (otherCommitted) {
    db.prepare(`UPDATE rps_games SET status = 'revealing', phase_started_at = unixepoch() WHERE id = ?`).run(gameId);
  }

  res.json({
    success: true,
    round: game.current_round,
    who_committed: whoCommitted,
    status: otherCommitted ? 'revealing' : 'committing'
  });
});

// Reveal choice
router.post('/:gameId/reveal', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const { choice, nonce } = req.body;
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

  if (game.status !== 'revealing') {
    res.status(400).json({ error: 'not_reveal_phase', message: 'Not in reveal phase' });
    return;
  }

  const isCreator = game.creator_id === agent.id;
  const isAcceptor = game.acceptor_id === agent.id;

  if (!isCreator && !isAcceptor) {
    res.status(400).json({ error: 'not_in_game', message: 'Not in this game' });
    return;
  }

  // Verify hash matches commit (format: choice + ":" + nonce)
  const verifyHash = crypto.createHash('sha256').update(choice + ':' + nonce).digest('hex');
  const commitsField = isCreator ? 'creator_commits' : 'acceptor_commits';
  const commits = JSON.parse(game[commitsField] || '[]');
  
  if (commits[game.current_round] !== verifyHash) {
    // HASH MISMATCH - FORFEIT!
    return forfeitGame(gameId, agent.id, 'hash_mismatch', res);
  }

  // Store reveal
  const revealsField = isCreator ? 'creator_reveals' : 'acceptor_reveals';
  let reveals = JSON.parse(game[revealsField] || '[]');
  reveals[game.current_round] = { choice, nonce };
  
  db.prepare(`UPDATE rps_games SET ${revealsField} = ? WHERE id = ?`).run(JSON.stringify(reveals), gameId);

  // Check if both revealed
  const otherRevealsField = isCreator ? 'acceptor_reveals' : 'creator_reveals';
  const otherReveals = JSON.parse(game[otherRevealsField] || '[]');
  
  if (!otherReveals[game.current_round]) {
    return res.json({ success: true, message: 'Reveal recorded. Waiting for opponent.' });
  }

  // Both revealed - determine round winner
  const creatorChoice: RPSChoice = isCreator ? choice : otherReveals[game.current_round].choice;
  const acceptorChoice: RPSChoice = isCreator ? otherReveals[game.current_round].choice : choice;

  // Record patterns
  recordChoice(game.creator_id, creatorChoice);
  recordChoice(game.acceptor_id, acceptorChoice);

  let roundWinner: 'tie' | 'creator' | 'acceptor' = 'tie';
  let creatorWon = false;
  let acceptorWon = false;

  if (creatorChoice === acceptorChoice) {
    roundWinner = 'tie';
  } else if (WINNING_COMBOS[creatorChoice] === acceptorChoice) {
    roundWinner = 'creator';
    creatorWon = true;
  } else {
    roundWinner = 'acceptor';
    acceptorWon = true;
  }

  // Update scores
  const newCreatorWins = game.creator_wins + (creatorWon ? 1 : 0);
  const newAcceptorWins = game.acceptor_wins + (acceptorWon ? 1 : 0);

  // Check if game is over (majority wins)
  const roundsToWin = Math.ceil(game.rounds / 2);
  const gameOver = newCreatorWins >= roundsToWin || newAcceptorWins >= roundsToWin;

  if (gameOver) {
    // Game complete - determine winner
    const winnerId = newCreatorWins > newAcceptorWins ? game.creator_id : game.acceptor_id;
    const loserId = winnerId === game.creator_id ? game.acceptor_id : game.creator_id;

    const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    const totalPot = game.stake * 2;
    const rake = totalPot * 0.05; // 5% rake
    const payout = totalPot - rake;

    // Credit winner
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(payout, winnerId);

    // Log rake
    db.prepare(`
      INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
      VALUES ('rps', ?, ?, ?, ?, unixepoch())
    `).run(gameId, rake, game.currency, totalPot);

    // Update game
    db.prepare(`
      UPDATE rps_games 
      SET status = 'completed', winner_id = ?, creator_wins = ?, acceptor_wins = ?, rake = ?, completed_at = unixepoch()
      WHERE id = ?
    `).run(winnerId, newCreatorWins, newAcceptorWins, rake, gameId);

    // Log transactions
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
      VALUES (?, 'rps_win', ?, ?, ?, unixepoch())
    `).run(winnerId, game.currency, payout, gameId);

    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
      VALUES (?, 'rps_loss', ?, ?, ?, unixepoch())
    `).run(loserId, game.currency, -game.stake, gameId);

    // Update stats
    db.prepare(`
      UPDATE agents SET 
        games_played = games_played + 1,
        rps_games = COALESCE(rps_games, 0) + 1,
        rps_wins = COALESCE(rps_wins, 0) + 1,
        rps_profit = COALESCE(rps_profit, 0) + ?
      WHERE id = ?
    `).run(payout - game.stake, winnerId);

    db.prepare(`
      UPDATE agents SET 
        games_played = games_played + 1,
        rps_games = COALESCE(rps_games, 0) + 1,
        rps_losses = COALESCE(rps_losses, 0) + 1,
        rps_profit = COALESCE(rps_profit, 0) - ?
      WHERE id = ?
    `).run(game.stake, loserId);

    // Update rounds played
    db.prepare(`UPDATE agents SET rps_rounds_played = COALESCE(rps_rounds_played, 0) + ? WHERE id = ?`).run(game.current_round, game.creator_id);
    db.prepare(`UPDATE agents SET rps_rounds_played = COALESCE(rps_rounds_played, 0) + ? WHERE id = ?`).run(game.current_round, game.acceptor_id);

    return res.json({
      success: true,
      round: game.current_round,
      creator_choice: creatorChoice,
      acceptor_choice: acceptorChoice,
      round_winner: roundWinner,
      score: { creator: newCreatorWins, acceptor: newAcceptorWins },
      game_over: true,
      winner: winnerId,
      payout,
      rake
    });
  }

  // Game not over - advance to next round
  const nextRound = game.current_round + 1;
  db.prepare(`
    UPDATE rps_games 
    SET status = 'committing', current_round = ?, creator_wins = ?, acceptor_wins = ?, phase_started_at = unixepoch()
    WHERE id = ?
  `).run(nextRound, newCreatorWins, newAcceptorWins, gameId);

  res.json({
    success: true,
    round: game.current_round,
    creator_choice: creatorChoice,
    acceptor_choice: acceptorChoice,
    round_winner: roundWinner,
    score: { creator: newCreatorWins, acceptor: newAcceptorWins },
    game_over: false,
    next_round: nextRound
  });
});

// Forfeit helper
function forfeitGame(gameId: string, forfeiterId: string, reason: string, res: any): any {
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
  if (!game || game.status === 'completed') return;

  const winnerId = forfeiterId === game.creator_id ? game.acceptor_id : game.creator_id;
  const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  const totalPot = game.stake * 2;
  const rake = totalPot * 0.05;
  const payout = totalPot - rake;

  // Credit winner
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(payout, winnerId);

  // Log rake
  db.prepare(`
    INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
    VALUES ('rps', ?, ?, ?, ?, unixepoch())
  `).run(gameId, rake, game.currency, totalPot);

  // Update game
  db.prepare(`
    UPDATE rps_games 
    SET status = 'completed', winner_id = ?, forfeited_by = ?, forfeit_reason = ?, rake = ?, completed_at = unixepoch()
    WHERE id = ?
  `).run(winnerId, forfeiterId, reason, rake, gameId);

  // Log transaction for winner
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_win_forfeit', ?, ?, ?, unixepoch())
  `).run(winnerId, game.currency, payout, gameId);

  // Log forfeit
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_forfeit', ?, ?, ?, unixepoch())
  `).run(forfeiterId, game.currency, -game.stake, gameId);

  if (res) {
    return res.status(400).json({
      error: 'forfeit',
      message: `Hash mismatch - you forfeit! ${reason}`,
      winner: winnerId,
      forfeit_reason: reason
    });
  }
}

// Cancel game
router.post('/:gameId/cancel', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const agent = req.agent;

  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId) as any;
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
  db.prepare(`UPDATE rps_games SET status = 'cancelled' WHERE id = ?`).run(gameId);

  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_cancelled', ?, ?, ?, unixepoch())
  `).run(agent.id, game.currency, game.stake, gameId);

  res.json({ success: true, message: 'Game cancelled, stake refunded' });
});

// Personal stats
router.get('/stats', requireAuth, (req, res) => {
  const agent = req.agent;

  const stats = db.prepare(`
    SELECT 
      COALESCE(rps_games, 0) as games_played,
      COALESCE(rps_wins, 0) as wins,
      COALESCE(rps_losses, 0) as losses,
      COALESCE(rps_profit, 0) as profit,
      COALESCE(rps_rounds_played, 0) as rounds_played,
      COALESCE(rps_rock_count, 0) as rock_count,
      COALESCE(rps_paper_count, 0) as paper_count,
      COALESCE(rps_scissors_count, 0) as scissors_count
    FROM agents WHERE id = ?
  `).get(agent.id) as any;

  const winRate = stats.games_played > 0 ? (stats.wins / stats.games_played * 100).toFixed(1) : '0.0';
  
  const pattern = stats.rounds_played > 0 ? {
    rock: Math.round((stats.rock_count / stats.rounds_played) * 1000) / 10,
    paper: Math.round((stats.paper_count / stats.rounds_played) * 1000) / 10,
    scissors: Math.round((stats.scissors_count / stats.rounds_played) * 1000) / 10,
    total_rounds: stats.rounds_played
  } : null;

  res.json({
    games_played: stats.games_played,
    wins: stats.wins,
    losses: stats.losses,
    win_rate: `${winRate}%`,
    profit: stats.profit,
    pattern
  });
});

// Get agent pattern (public)
router.get('/agent/:agentId/patterns', (req, res) => {
  const { agentId } = req.params;

  const agent = db.prepare('SELECT display_name, wallet_address, rps_rock_count, rps_paper_count, rps_scissors_count, rps_rounds_played FROM agents WHERE id = ?').get(agentId) as any;
  
  if (!agent) {
    res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    return;
  }

  const total = agent.rps_rounds_played || 0;
  
  if (total === 0) {
    res.json({
      agent: agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
      pattern: null,
      message: 'No RPS rounds played yet'
    });
    return;
  }

  res.json({
    agent: agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
    pattern: {
      rock: Math.round((agent.rps_rock_count || 0) / total * 1000) / 10,
      paper: Math.round((agent.rps_paper_count || 0) / total * 1000) / 10,
      scissors: Math.round((agent.rps_scissors_count || 0) / total * 1000) / 10,
      total_rounds: total
    }
  });
});

// Export forfeit function for cron
export { forfeitGame };

export default router;
