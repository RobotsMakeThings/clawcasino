import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, adjustBalance } from '../../db';

// Rake percentage for RPS: 5%
const RPS_RAKE_PERCENT = 0.05;

// Valid choices
const VALID_CHOICES = ['rock', 'paper', 'scissors'];

// Valid round counts
const VALID_ROUNDS = [1, 3, 5];

// Phase timeouts (milliseconds)
const COMMIT_TIMEOUT = 30000; // 30 seconds
const REVEAL_TIMEOUT = 30000; // 30 seconds

export interface RPSRound {
  round: number;
  creator_hash: string | null;
  acceptor_hash: string | null;
  creator_choice: string | null;
  creator_nonce: string | null;
  acceptor_choice: string | null;
  acceptor_nonce: string | null;
  winner: string | null; // 'creator', 'acceptor', 'tie', or null
  phase_deadline: number | null;
}

export interface RPSGame {
  id: string;
  creator_id: string;
  creator_name: string;
  acceptor_id: string | null;
  acceptor_name: string | null;
  stake: number;
  currency: 'SOL' | 'USDC';
  rounds: number;
  current_round: number;
  creator_score: number;
  acceptor_score: number;
  status: 'open' | 'committing' | 'revealing' | 'completed' | 'cancelled' | 'expired' | 'forfeited';
  winner_id: string | null;
  round_data: RPSRound[];
  expires_at: number;
  created_at: number;
  completed_at: number | null;
  rake: number;
  forfeit_reason: string | null;
}

export interface CreateResult {
  success: boolean;
  error?: string;
  game?: RPSGame;
}

export interface AcceptResult {
  success: boolean;
  error?: string;
  game?: RPSGame;
}

export interface CommitResult {
  success: boolean;
  error?: string;
  game?: RPSGame;
  both_committed?: boolean;
}

export interface RevealResult {
  success: boolean;
  error?: string;
  game?: RPSGame;
  round_complete?: boolean;
  round_winner?: string;
  game_complete?: boolean;
  final_winner?: string;
}

export interface ForfeitResult {
  success: boolean;
  error?: string;
  game?: RPSGame;
  winner_id?: string;
  reason?: string;
}

/**
 * Create a new RPS challenge
 */
export function createRPS(
  creatorId: string,
  stake: number,
  rounds: number,
  currency: 'SOL' | 'USDC'
): CreateResult {
  const db = getDatabase();

  // Validate rounds
  if (!VALID_ROUNDS.includes(rounds)) {
    return { success: false, error: 'Rounds must be 1, 3, or 5' };
  }

  // Validate stake
  if (!stake || stake <= 0) {
    return { success: false, error: 'Invalid stake amount' };
  }

  // Get creator info
  const creator = db.prepare('SELECT * FROM agents WHERE id = ?').get(creatorId);
  if (!creator) {
    return { success: false, error: 'Creator not found' };
  }

  // Check balance
  const balance = currency === 'SOL' ? creator.balance_sol : creator.balance_usdc;
  if (balance < stake) {
    return { success: false, error: 'Insufficient balance' };
  }

  // Deduct stake from creator
  try {
    adjustBalance(creatorId, -stake, currency, 'rps_escrow', 'rps', undefined, 'RPS stake');
  } catch (err) {
    return { success: false, error: 'Failed to deduct stake' };
  }

  // Create game
  const gameId = uuidv4();
  const now = Date.now();
  const expiresAt = now + 300000; // 5 minutes = 300 seconds

  const roundData: RPSRound[] = [];
  for (let i = 1; i <= rounds; i++) {
    roundData.push({
      round: i,
      creator_hash: null,
      acceptor_hash: null,
      creator_choice: null,
      creator_nonce: null,
      acceptor_choice: null,
      acceptor_nonce: null,
      winner: null,
      phase_deadline: null
    });
  }

  db.prepare(`
    INSERT INTO rps_games (
      id, creator_id, stake, currency, rounds, current_round,
      creator_score, acceptor_score, status, round_data,
      expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'open', ?, ?, ?)
  `).run(gameId, creatorId, stake, currency, rounds, JSON.stringify(roundData), expiresAt, now);

  const game: RPSGame = {
    id: gameId,
    creator_id: creatorId,
    creator_name: creator.display_name,
    acceptor_id: null,
    acceptor_name: null,
    stake,
    currency,
    rounds,
    current_round: 0,
    creator_score: 0,
    acceptor_score: 0,
    status: 'open',
    winner_id: null,
    round_data: roundData,
    expires_at: expiresAt,
    created_at: now,
    completed_at: null,
    rake: 0,
    forfeit_reason: null
  };

  return { success: true, game };
}

/**
 * Accept an RPS challenge
 */
export function acceptRPS(gameId: string, acceptorId: string): AcceptResult {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate status
  if (game.status !== 'open') {
    return { success: false, error: 'Game is not open' };
  }

  // Check expiry
  if (Date.now() > game.expires_at) {
    cancelRPS(gameId, game.creator_id);
    return { success: false, error: 'Game has expired' };
  }

  // Validate not self
  if (game.creator_id === acceptorId) {
    return { success: false, error: 'Cannot accept your own challenge' };
  }

  // Get acceptor info
  const acceptor = db.prepare('SELECT * FROM agents WHERE id = ?').get(acceptorId);
  if (!acceptor) {
    return { success: false, error: 'Acceptor not found' };
  }

  // Check acceptor balance
  const balance = game.currency === 'SOL' ? acceptor.balance_sol : acceptor.balance_usdc;
  if (balance < game.stake) {
    return { success: false, error: 'Insufficient balance' };
  }

  // Deduct stake from acceptor
  try {
    adjustBalance(acceptorId, -game.stake, game.currency, 'rps_escrow', 'rps', gameId, 'RPS stake');
  } catch (err) {
    return { success: false, error: 'Failed to deduct stake' };
  }

  // Get creator info
  const creator = db.prepare('SELECT * FROM agents WHERE id = ?').get(game.creator_id);

  // Update game
  const now = Date.now();
  const roundData: RPSRound[] = JSON.parse(game.round_data);
  roundData[0].phase_deadline = now + COMMIT_TIMEOUT;

  db.prepare(`
    UPDATE rps_games SET
      acceptor_id = ?,
      status = 'committing',
      current_round = 1,
      round_data = ?
    WHERE id = ?
  `).run(acceptorId, JSON.stringify(roundData), gameId);

  const updatedGame: RPSGame = {
    id: gameId,
    creator_id: game.creator_id,
    creator_name: creator?.display_name || '',
    acceptor_id: acceptorId,
    acceptor_name: acceptor.display_name,
    stake: game.stake,
    currency: game.currency,
    rounds: game.rounds,
    current_round: 1,
    creator_score: 0,
    acceptor_score: 0,
    status: 'committing',
    winner_id: null,
    round_data: roundData,
    expires_at: game.expires_at,
    created_at: game.created_at,
    completed_at: null,
    rake: 0,
    forfeit_reason: null
  };

  return { success: true, game: updatedGame };
}

/**
 * Commit a choice (submit hash)
 */
export function commitRPS(gameId: string, agentId: string, hash: string): CommitResult {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate status
  if (game.status !== 'committing') {
    return { success: false, error: 'Not in committing phase' };
  }

  // Validate agent is part of game
  const isCreator = game.creator_id === agentId;
  const isAcceptor = game.acceptor_id === agentId;
  if (!isCreator && !isAcceptor) {
    return { success: false, error: 'Not a participant' };
  }

  const roundData: RPSRound[] = JSON.parse(game.round_data);
  const currentRound = roundData[game.current_round - 1];

  // Check if already committed
  if (isCreator && currentRound.creator_hash) {
    return { success: false, error: 'Already committed' };
  }
  if (isAcceptor && currentRound.acceptor_hash) {
    return { success: false, error: 'Already committed' };
  }

  // Store hash
  if (isCreator) {
    currentRound.creator_hash = hash;
  } else {
    currentRound.acceptor_hash = hash;
  }

  // Check if both committed
  const bothCommitted = currentRound.creator_hash && currentRound.acceptor_hash;

  if (bothCommitted) {
    // Move to revealing phase
    currentRound.phase_deadline = Date.now() + REVEAL_TIMEOUT;
    db.prepare(`
      UPDATE rps_games SET status = 'revealing', round_data = ? WHERE id = ?
    `).run(JSON.stringify(roundData), gameId);
  } else {
    db.prepare(`
      UPDATE rps_games SET round_data = ? WHERE id = ?
    `).run(JSON.stringify(roundData), gameId);
  }

  // Get updated game
  const updatedGame = getRPS(gameId);

  return { success: true, game: updatedGame!, both_committed: bothCommitted };
}

/**
 * Reveal a choice (submit choice + nonce)
 */
export function revealRPS(
  gameId: string,
  agentId: string,
  choice: string,
  nonce: string
): RevealResult {
  const db = getDatabase();

  // Validate choice
  if (!VALID_CHOICES.includes(choice)) {
    return { success: false, error: 'Invalid choice. Must be rock, paper, or scissors' };
  }

  // Get game
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate status
  if (game.status !== 'revealing') {
    return { success: false, error: 'Not in revealing phase' };
  }

  // Validate agent is part of game
  const isCreator = game.creator_id === agentId;
  const isAcceptor = game.acceptor_id === agentId;
  if (!isCreator && !isAcceptor) {
    return { success: false, error: 'Not a participant' };
  }

  const roundData: RPSRound[] = JSON.parse(game.round_data);
  const currentRound = roundData[game.current_round - 1];

  // Check if already revealed
  if (isCreator && currentRound.creator_choice) {
    return { success: false, error: 'Already revealed' };
  }
  if (isAcceptor && currentRound.acceptor_choice) {
    return { success: false, error: 'Already revealed' };
  }

  // Verify hash
  const computedHash = crypto.createHash('sha256').update(`${choice}:${nonce}`).digest('hex');
  const storedHash = isCreator ? currentRound.creator_hash : currentRound.acceptor_hash;

  if (computedHash !== storedHash) {
    // HASH MISMATCH = FORFEIT
    const otherPlayerId = isCreator ? game.acceptor_id : game.creator_id;
    forfeitRPS(gameId, agentId, 'hash_mismatch');
    return {
      success: false,
      error: 'Hash mismatch - you forfeit the game',
      game: getRPS(gameId)!
    };
  }

  // Store reveal
  if (isCreator) {
    currentRound.creator_choice = choice;
    currentRound.creator_nonce = nonce;
  } else {
    currentRound.acceptor_choice = choice;
    currentRound.acceptor_nonce = nonce;
  }

  // Check if both revealed
  const bothRevealed = currentRound.creator_choice && currentRound.acceptor_choice;

  if (!bothRevealed) {
    db.prepare(`
      UPDATE rps_games SET round_data = ? WHERE id = ?
    `).run(JSON.stringify(roundData), gameId);

    return { success: true, game: getRPS(gameId)!, round_complete: false };
  }

  // Both revealed - determine winner
  const winner = determineWinner(
    currentRound.creator_choice!,
    currentRound.acceptor_choice!
  );

  currentRound.winner = winner;

  // Update scores
  let creatorScore = game.creator_score;
  let acceptorScore = game.acceptor_score;

  if (winner === 'creator') {
    creatorScore++;
  } else if (winner === 'acceptor') {
    acceptorScore++;
  }
  // Tie = no score change, replay round

  // Check if game is over (majority of rounds won)
  const majority = Math.ceil(game.rounds / 2);
  const gameOver = creatorScore >= majority || acceptorScore >= majority;

  if (gameOver) {
    // Game complete
    const finalWinner = creatorScore > acceptorScore ? game.creator_id : game.acceptor_id;
    const winnerName = creatorScore > acceptorScore ? game.creator_name : game.acceptor_name;

    // Calculate rake and payout
    const totalPot = game.stake * 2;
    const rake = Math.round(totalPot * RPS_RAKE_PERCENT * 100) / 100;
    const payout = totalPot - rake;

    // Award to winner
    adjustBalance(finalWinner, payout, game.currency, 'rps_win', 'rps', gameId, 'RPS win');

    // Update stats
    db.prepare('UPDATE agents SET games_played = games_played + 1 WHERE id IN (?, ?)')
      .run(game.creator_id, game.acceptor_id);
    db.prepare('UPDATE agents SET total_profit = total_profit + ? WHERE id = ?')
      .run(payout - game.stake, finalWinner);

    // Log rake
    if (rake > 0) {
      db.prepare(`
        INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('rps', gameId, rake, game.currency, totalPot);
    }

    // Update game
    const now = Date.now();
    db.prepare(`
      UPDATE rps_games SET
        status = 'completed',
        winner_id = ?,
        creator_score = ?,
        acceptor_score = ?,
        round_data = ?,
        rake = ?,
        completed_at = ?
      WHERE id = ?
    `).run(finalWinner, creatorScore, acceptorScore, JSON.stringify(roundData), rake, now, gameId);

    const updatedGame = getRPS(gameId)!;

    return {
      success: true,
      game: updatedGame,
      round_complete: true,
      round_winner: winner,
      game_complete: true,
      final_winner: finalWinner
    };
  } else {
    // Game continues
    if (winner === 'tie') {
      // Replay this round - reset for same round
      currentRound.creator_hash = null;
      currentRound.acceptor_hash = null;
      currentRound.creator_choice = null;
      currentRound.creator_nonce = null;
      currentRound.acceptor_choice = null;
      currentRound.acceptor_nonce = null;
      currentRound.winner = null;
      currentRound.phase_deadline = Date.now() + COMMIT_TIMEOUT;

      db.prepare(`
        UPDATE rps_games SET
          creator_score = ?,
          acceptor_score = ?,
          round_data = ?,
          status = 'committing'
        WHERE id = ?
      `).run(creatorScore, acceptorScore, JSON.stringify(roundData), gameId);
    } else {
      // Move to next round
      const nextRound = roundData[game.current_round];
      if (nextRound) {
        nextRound.phase_deadline = Date.now() + COMMIT_TIMEOUT;
      }

      db.prepare(`
        UPDATE rps_games SET
          creator_score = ?,
          acceptor_score = ?,
          current_round = ?,
          round_data = ?,
          status = 'committing'
        WHERE id = ?
      `).run(creatorScore, acceptorScore, game.current_round + 1, JSON.stringify(roundData), gameId);
    }

    return {
      success: true,
      game: getRPS(gameId)!,
      round_complete: true,
      round_winner: winner,
      game_complete: false
    };
  }
}

/**
 * Determine winner of a round
 */
function determineWinner(creatorChoice: string, acceptorChoice: string): string {
  if (creatorChoice === acceptorChoice) {
    return 'tie';
  }

  // Rock beats scissors, scissors beats paper, paper beats rock
  const beats: Record<string, string> = {
    rock: 'scissors',
    scissors: 'paper',
    paper: 'rock'
  };

  if (beats[creatorChoice] === acceptorChoice) {
    return 'creator';
  }

  return 'acceptor';
}

/**
 * Forfeit an RPS game
 */
export function forfeitRPS(gameId: string, forfeiterId: string, reason: string): ForfeitResult {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate game is active
  if (!['committing', 'revealing'].includes(game.status)) {
    return { success: false, error: 'Game is not active' };
  }

  // Validate forfeiter is a participant
  const isCreator = game.creator_id === forfeiterId;
  const isAcceptor = game.acceptor_id === forfeiterId;
  if (!isCreator && !isAcceptor) {
    return { success: false, error: 'Not a participant' };
  }

  // Winner is the other player
  const winnerId = isCreator ? game.acceptor_id : game.creator_id;

  // Calculate rake and payout
  const totalPot = game.stake * 2;
  const rake = Math.round(totalPot * RPS_RAKE_PERCENT * 100) / 100;
  const payout = totalPot - rake;

  // Award to winner
  adjustBalance(winnerId, payout, game.currency, 'rps_win', 'rps', gameId, 'RPS forfeit win');

  // Update stats
  db.prepare('UPDATE agents SET games_played = games_played + 1 WHERE id IN (?, ?)')
    .run(game.creator_id, game.acceptor_id);
  db.prepare('UPDATE agents SET total_profit = total_profit + ? WHERE id = ?')
    .run(payout - game.stake, winnerId);

  // Log rake
  if (rake > 0) {
    db.prepare(`
      INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run('rps', gameId, rake, game.currency, totalPot);
  }

  // Update game
  const now = Date.now();
  db.prepare(`
    UPDATE rps_games SET
      status = 'forfeited',
      winner_id = ?,
      forfeit_reason = ?,
      rake = ?,
      completed_at = ?
    WHERE id = ?
  `).run(winnerId, reason, rake, now, gameId);

  const updatedGame = getRPS(gameId);

  return {
    success: true,
    game: updatedGame!,
    winner_id: winnerId,
    reason
  };
}

/**
 * Cancel an RPS game (creator only, before acceptance)
 */
export function cancelRPS(gameId: string, agentId: string): { success: boolean; error?: string; refunded_amount?: number } {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM rps_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate creator
  if (game.creator_id !== agentId) {
    return { success: false, error: 'Only creator can cancel' };
  }

  // Validate status
  if (game.status !== 'open') {
    return { success: false, error: 'Game is not open' };
  }

  // Refund creator
  adjustBalance(agentId, game.stake, game.currency, 'rps_refund', 'rps', gameId, 'RPS cancelled');

  // Update game
  db.prepare(`
    UPDATE rps_games SET status = 'cancelled', completed_at = ? WHERE id = ?
  `).run(Date.now(), gameId);

  return { success: true, refunded_amount: game.stake };
}

/**
 * Expire old games (call this periodically)
 */
export function expireOldRPSGames(): number {
  const db = getDatabase();

  // Find expired open games
  const expiredGames = db.prepare(`
    SELECT * FROM rps_games WHERE status = 'open' AND expires_at < ?
  `).all(Date.now());

  let count = 0;
  for (const game of expiredGames) {
    // Refund creator
    adjustBalance(game.creator_id, game.stake, game.currency, 'rps_refund', 'rps', game.id, 'RPS expired');

    // Update game
    db.prepare(`
      UPDATE rps_games SET status = 'expired', completed_at = ? WHERE id = ?
    `).run(Date.now(), game.id);

    count++;
  }

  return count;
}

/**
 * Check for timeouts and forfeit non-responders
 * Call this every 5 seconds
 */
export function checkRPSTimeouts(): { expired: number; forfeited: number } {
  const db = getDatabase();
  const now = Date.now();

  let expired = 0;
  let forfeited = 0;

  // Get active games
  const activeGames = db.prepare(`
    SELECT * FROM rps_games WHERE status IN ('committing', 'revealing')
  `).all();

  for (const game of activeGames) {
    const roundData: RPSRound[] = JSON.parse(game.round_data);
    const currentRound = roundData[game.current_round - 1];

    if (!currentRound || !currentRound.phase_deadline) continue;

    // Check if deadline passed
    if (now > currentRound.phase_deadline) {
      // Determine who didn't act
      const isCommitting = game.status === 'committing';

      let creatorActed = isCommitting
        ? !!currentRound.creator_hash
        : !!currentRound.creator_choice;

      let acceptorActed = isCommitting
        ? !!currentRound.acceptor_hash
        : !!currentRound.acceptor_choice;

      if (!creatorActed && !acceptorActed) {
        // Both timed out - cancel game with refund
        adjustBalance(game.creator_id, game.stake, game.currency, 'rps_refund', 'rps', game.id, 'RPS timeout');
        adjustBalance(game.acceptor_id, game.stake, game.currency, 'rps_refund', 'rps', game.id, 'RPS timeout');

        db.prepare(`
          UPDATE rps_games SET status = 'expired', completed_at = ? WHERE id = ?
        `).run(now, game.id);

        expired++;
      } else if (!creatorActed) {
        // Creator didn't act - forfeit
        forfeitRPS(game.id, game.creator_id, 'timeout');
        forfeited++;
      } else if (!acceptorActed) {
        // Acceptor didn't act - forfeit
        forfeitRPS(game.id, game.acceptor_id, 'timeout');
        forfeited++;
      }
    }
  }

  return { expired, forfeited };
}

/**
 * Get an RPS game by ID
 */
export function getRPS(gameId: string): RPSGame | null {
  const db = getDatabase();

  const game = db.prepare(`
    SELECT g.*,
      c.display_name as creator_name,
      a.display_name as acceptor_name
    FROM rps_games g
    JOIN agents c ON g.creator_id = c.id
    LEFT JOIN agents a ON g.acceptor_id = a.id
    WHERE g.id = ?
  `).get(gameId);

  if (!game) return null;

  return {
    id: game.id,
    creator_id: game.creator_id,
    creator_name: game.creator_name,
    acceptor_id: game.acceptor_id,
    acceptor_name: game.acceptor_name,
    stake: game.stake,
    currency: game.currency,
    rounds: game.rounds,
    current_round: game.current_round,
    creator_score: game.creator_score,
    acceptor_score: game.acceptor_score,
    status: game.status,
    winner_id: game.winner_id,
    round_data: JSON.parse(game.round_data),
    expires_at: game.expires_at,
    created_at: game.created_at,
    completed_at: game.completed_at,
    rake: game.rake || 0,
    forfeit_reason: game.forfeit_reason
  };
}

/**
 * Get open RPS challenges
 */
export function getOpenRPS(): RPSGame[] {
  const db = getDatabase();

  const games = db.prepare(`
    SELECT g.*, c.display_name as creator_name
    FROM rps_games g
    JOIN agents c ON g.creator_id = c.id
    WHERE g.status = 'open' AND g.expires_at > ?
    ORDER BY g.created_at DESC
    LIMIT 50
  `).all(Date.now());

  return games.map((g: any) => ({
    id: g.id,
    creator_id: g.creator_id,
    creator_name: g.creator_name,
    acceptor_id: null,
    acceptor_name: null,
    stake: g.stake,
    currency: g.currency,
    rounds: g.rounds,
    current_round: 0,
    creator_score: 0,
    acceptor_score: 0,
    status: 'open',
    winner_id: null,
    round_data: JSON.parse(g.round_data),
    expires_at: g.expires_at,
    created_at: g.created_at,
    completed_at: null,
    rake: 0,
    forfeit_reason: null
  }));
}

/**
 * Get RPS history for an agent
 */
export function getRPSHistory(agentId: string, limit: number = 50): RPSGame[] {
  const db = getDatabase();

  const games = db.prepare(`
    SELECT g.*,
      c.display_name as creator_name,
      a.display_name as acceptor_name
    FROM rps_games g
    JOIN agents c ON g.creator_id = c.id
    LEFT JOIN agents a ON g.acceptor_id = a.id
    WHERE (g.creator_id = ? OR g.acceptor_id = ?) AND g.status != 'open'
    ORDER BY g.completed_at DESC
    LIMIT ?
  `).all(agentId, agentId, limit);

  return games.map((g: any) => ({
    id: g.id,
    creator_id: g.creator_id,
    creator_name: g.creator_name,
    acceptor_id: g.acceptor_id,
    acceptor_name: g.acceptor_name,
    stake: g.stake,
    currency: g.currency,
    rounds: g.rounds,
    current_round: g.current_round,
    creator_score: g.creator_score,
    acceptor_score: g.acceptor_score,
    status: g.status,
    winner_id: g.winner_id,
    round_data: JSON.parse(g.round_data),
    expires_at: g.expires_at,
    created_at: g.created_at,
    completed_at: g.completed_at,
    rake: g.rake || 0,
    forfeit_reason: g.forfeit_reason
  }));
}

// Start timeout checker (run every 5 seconds)
export function startRPSTimeoutChecker(): NodeJS.Timeout {
  return setInterval(() => {
    const result = checkRPSTimeouts();
    if (result.expired > 0 || result.forfeited > 0) {
      console.log(`🧹 RPS timeouts: ${result.expired} expired, ${result.forfeited} forfeited`);
    }
  }, 5000);
}

// Start expiry checker (run every 30 seconds)
export function startRPSExpiryChecker(): NodeJS.Timeout {
  return setInterval(() => {
    const expired = expireOldRPSGames();
    if (expired > 0) {
      console.log(`🧹 Expired ${expired} RPS games`);
    }
  }, 30000);
}
