import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, adjustBalance } from '../../db';

// Rake percentage for coinflip: 4%
const COINFLIP_RAKE_PERCENT = 0.04;

export interface CoinflipGame {
  id: string;
  creator_id: string;
  creator_name: string;
  acceptor_id: string | null;
  acceptor_name: string | null;
  stake: number;
  currency: 'SOL' | 'USDC';
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  winner_id: string | null;
  proof_hash: string;
  secret: string | null;
  result_hash: string | null;
  expires_at: number;
  created_at: number;
  completed_at: number | null;
  rake: number;
}

export interface CreateResult {
  success: boolean;
  error?: string;
  game?: CoinflipGame;
}

export interface AcceptResult {
  success: boolean;
  error?: string;
  game?: CoinflipGame;
  winner_id?: string;
  winner_name?: string;
  verification?: {
    secret: string;
    creator_wallet: string;
    acceptor_wallet: string;
    result_hash: string;
    first_byte: number;
    creator_wins: boolean;
  };
}

export interface CancelResult {
  success: boolean;
  error?: string;
  refunded_amount?: number;
}

/**
 * Create a new coinflip challenge
 * Provably fair: generate secret and proof hash
 */
export function createCoinflip(
  creatorId: string,
  stake: number,
  currency: 'SOL' | 'USDC'
): CreateResult {
  const db = getDatabase();

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
    adjustBalance(creatorId, -stake, currency, 'coinflip_escrow', 'coinflip', undefined, 'Coinflip stake');
  } catch (err) {
    return { success: false, error: 'Failed to deduct stake' };
  }

  // Generate provably fair secret
  const secret = crypto.randomBytes(32).toString('hex');
  const proofHash = crypto.createHash('sha256').update(secret).digest('hex');

  // Create game
  const gameId = uuidv4();
  const now = Date.now();
  const expiresAt = now + 300000; // 5 minutes = 300 seconds

  db.prepare(`
    INSERT INTO coinflip_games (
      id, creator_id, stake, currency, status, proof_hash, secret,
      expires_at, created_at
    ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(gameId, creatorId, stake, currency, proofHash, secret, expiresAt, now);

  const game: CoinflipGame = {
    id: gameId,
    creator_id: creatorId,
    creator_name: creator.display_name,
    acceptor_id: null,
    acceptor_name: null,
    stake,
    currency,
    status: 'open',
    winner_id: null,
    proof_hash: proofHash,
    secret: null, // Don't reveal until completed
    result_hash: null,
    expires_at: expiresAt,
    created_at: now,
    completed_at: null,
    rake: 0
  };

  return { success: true, game };
}

/**
 * Accept a coinflip challenge
 * Determine winner using provably fair mechanism
 */
export function acceptCoinflip(
  gameId: string,
  acceptorId: string
): AcceptResult {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId);
  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  // Validate status
  if (game.status !== 'open') {
    return { success: false, error: 'Game is not open' };
  }

  // Check expiry
  if (Date.now() > game.expires_at) {
    // Auto-cancel expired game
    cancelCoinflip(gameId, game.creator_id);
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

  // Get creator info for wallet addresses
  const creator = db.prepare('SELECT * FROM agents WHERE id = ?').get(game.creator_id);
  if (!creator) {
    return { success: false, error: 'Creator not found' };
  }

  // Deduct stake from acceptor
  try {
    adjustBalance(acceptorId, -game.stake, game.currency, 'coinflip_escrow', 'coinflip', gameId, 'Coinflip stake');
  } catch (err) {
    return { success: false, error: 'Failed to deduct stake' };
  }

  // Determine winner using provably fair mechanism
  // resultHash = SHA256(secret + creatorWallet + acceptorWallet)
  // First byte even = creator wins, odd = acceptor wins
  const creatorWallet = creator.wallet_address;
  const acceptorWallet = acceptor.wallet_address;
  const resultInput = game.secret + creatorWallet + acceptorWallet;
  const resultHash = crypto.createHash('sha256').update(resultInput).digest('hex');
  const firstByte = parseInt(resultHash.slice(0, 2), 16);
  const creatorWins = firstByte % 2 === 0;
  const winnerId = creatorWins ? game.creator_id : acceptorId;
  const winnerName = creatorWins ? creator.display_name : acceptor.display_name;

  // Calculate rake and payout
  const totalPot = game.stake * 2;
  const rake = Math.round(totalPot * COINFLIP_RAKE_PERCENT * 100) / 100;
  const payout = totalPot - rake;

  // Award to winner
  adjustBalance(winnerId, payout, game.currency, 'coinflip_win', 'coinflip', gameId, 'Coinflip win');

  // Update stats for both players
  db.prepare('UPDATE agents SET games_played = games_played + 1 WHERE id IN (?, ?)')
    .run(game.creator_id, acceptorId);
  db.prepare('UPDATE agents SET total_profit = total_profit + ? WHERE id = ?')
    .run(payout - game.stake, winnerId);

  // Log rake
  if (rake > 0) {
    db.prepare(`
      INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run('coinflip', gameId, rake, game.currency, totalPot);
  }

  // Update game
  const now = Date.now();
  db.prepare(`
    UPDATE coinflip_games SET
      acceptor_id = ?,
      status = 'completed',
      winner_id = ?,
      result_hash = ?,
      rake = ?,
      completed_at = ?
    WHERE id = ?
  `).run(acceptorId, winnerId, resultHash, rake, now, gameId);

  const updatedGame: CoinflipGame = {
    id: gameId,
    creator_id: game.creator_id,
    creator_name: creator.display_name,
    acceptor_id: acceptorId,
    acceptor_name: acceptor.display_name,
    stake: game.stake,
    currency: game.currency,
    status: 'completed',
    winner_id: winnerId,
    proof_hash: game.proof_hash,
    secret: game.secret, // Reveal secret for verification
    result_hash: resultHash,
    expires_at: game.expires_at,
    created_at: game.created_at,
    completed_at: now,
    rake
  };

  return {
    success: true,
    game: updatedGame,
    winner_id: winnerId,
    winner_name: winnerName,
    verification: {
      secret: game.secret,
      creator_wallet: creatorWallet,
      acceptor_wallet: acceptorWallet,
      result_hash: resultHash,
      first_byte: firstByte,
      creator_wins: creatorWins
    }
  };
}

/**
 * Cancel a coinflip challenge (creator only)
 */
export function cancelCoinflip(
  gameId: string,
  agentId: string
): CancelResult {
  const db = getDatabase();

  // Get game
  const game = db.prepare('SELECT * FROM coinflip_games WHERE id = ?').get(gameId);
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
  adjustBalance(agentId, game.stake, game.currency, 'coinflip_refund', 'coinflip', gameId, 'Coinflip cancelled');

  // Update game
  db.prepare(`
    UPDATE coinflip_games SET status = 'cancelled', completed_at = ? WHERE id = ?
  `).run(Date.now(), gameId);

  return { success: true, refunded_amount: game.stake };
}

/**
 * Expire old games (call this periodically, e.g., every 30 seconds)
 */
export function expireOldGames(): number {
  const db = getDatabase();

  // Find expired open games
  const expiredGames = db.prepare(`
    SELECT * FROM coinflip_games WHERE status = 'open' AND expires_at < ?
  `).all(Date.now());

  let count = 0;
  for (const game of expiredGames) {
    // Refund creator
    adjustBalance(game.creator_id, game.stake, game.currency, 'coinflip_refund', 'coinflip', game.id, 'Coinflip expired');

    // Update game
    db.prepare(`
      UPDATE coinflip_games SET status = 'expired', completed_at = ? WHERE id = ?
    `).run(Date.now(), game.id);

    count++;
  }

  return count;
}

/**
 * Get open coinflip challenges
 */
export function getOpenCoinflips(): CoinflipGame[] {
  const db = getDatabase();

  const games = db.prepare(`
    SELECT g.*, c.display_name as creator_name
    FROM coinflip_games g
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
    status: 'open',
    winner_id: null,
    proof_hash: g.proof_hash,
    secret: null,
    result_hash: null,
    expires_at: g.expires_at,
    created_at: g.created_at,
    completed_at: null,
    rake: 0
  }));
}

/**
 * Get a specific coinflip game
 */
export function getCoinflip(gameId: string): CoinflipGame | null {
  const db = getDatabase();

  const game = db.prepare(`
    SELECT g.*, c.display_name as creator_name, a.display_name as acceptor_name
    FROM coinflip_games g
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
    status: game.status,
    winner_id: game.winner_id,
    proof_hash: game.proof_hash,
    secret: game.status === 'completed' ? game.secret : null, // Only reveal if completed
    result_hash: game.result_hash,
    expires_at: game.expires_at,
    created_at: game.created_at,
    completed_at: game.completed_at,
    rake: game.rake || 0
  };
}

/**
 * Get coinflip history for an agent
 */
export function getCoinflipHistory(agentId: string, limit: number = 50): CoinflipGame[] {
  const db = getDatabase();

  const games = db.prepare(`
    SELECT g.*,
      c.display_name as creator_name,
      a.display_name as acceptor_name
    FROM coinflip_games g
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
    status: g.status,
    winner_id: g.winner_id,
    proof_hash: g.proof_hash,
    secret: g.secret,
    result_hash: g.result_hash,
    expires_at: g.expires_at,
    created_at: g.created_at,
    completed_at: g.completed_at,
    rake: g.rake || 0
  }));
}

// Start expiry checker (run every 30 seconds)
export function startExpiryChecker(): NodeJS.Timeout {
  return setInterval(() => {
    const expired = expireOldGames();
    if (expired > 0) {
      console.log(`🧹 Expired ${expired} coinflip games`);
    }
  }, 30000);
}
