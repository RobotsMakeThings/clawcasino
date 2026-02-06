import { db } from './db';

const COMMIT_TIMEOUT = 15;
const REVEAL_TIMEOUT = 15;

// Expire old coinflip games
export function expireCoinflipGames(): void {
  const now = Math.floor(Date.now() / 1000);
  
  const expired = db.prepare(`
    SELECT * FROM coinflip_games 
    WHERE status = 'open' AND expires_at < ?
  `).all(now) as any[];

  for (const game of expired) {
    const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, game.creator_id);
    db.prepare(`UPDATE coinflip_games SET status = 'expired' WHERE id = ?`).run(game.id);
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
      VALUES (?, 'coinflip_expired', ?, ?, ?, unixepoch())
    `).run(game.creator_id, game.currency, game.stake, game.id);

    console.log(`[Cron] Expired coinflip ${game.id}, refunded ${game.stake} ${game.currency}`);
  }

  if (expired.length > 0) {
    console.log(`[Cron] Expired ${expired.length} coinflip games`);
  }
}

// Expire old RPS games (open status)
export function expireRPSGames(): void {
  const now = Math.floor(Date.now() / 1000);
  
  const expired = db.prepare(`
    SELECT * FROM rps_games 
    WHERE status = 'open' AND expires_at < ?
  `).all(now) as any[];

  for (const game of expired) {
    const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, game.creator_id);
    db.prepare(`UPDATE rps_games SET status = 'expired' WHERE id = ?`).run(game.id);
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
      VALUES (?, 'rps_expired', ?, ?, ?, unixepoch())
    `).run(game.creator_id, game.currency, game.stake, game.id);

    console.log(`[Cron] Expired RPS ${game.id}, refunded ${game.stake} ${game.currency}`);
  }

  if (expired.length > 0) {
    console.log(`[Cron] Expired ${expired.length} RPS games`);
  }
}

// Handle RPS timeouts (commit and reveal phases)
export function handleRPSTimeouts(): void {
  const now = Math.floor(Date.now() / 1000);

  // Check committing phase timeouts
  const committingGames = db.prepare(`
    SELECT * FROM rps_games 
    WHERE status = 'committing' AND (unixepoch() - phase_started_at) > ?
  `).all(COMMIT_TIMEOUT) as any[];

  for (const game of committingGames) {
    const creatorCommits = JSON.parse(game.creator_commits || '[]');
    const acceptorCommits = JSON.parse(game.acceptor_commits || '[]');
    
    const creatorCommitted = !!creatorCommits[game.current_round];
    const acceptorCommitted = !!acceptorCommits[game.current_round];

    let forfeiterId: string | null = null;
    if (!creatorCommitted && !acceptorCommitted) {
      // Both failed to commit - creator forfeits (they created the game)
      forfeiterId = game.creator_id;
    } else if (!creatorCommitted) {
      forfeiterId = game.creator_id;
    } else if (!acceptorCommitted) {
      forfeiterId = game.acceptor_id;
    }

    if (forfeiterId) {
      forfeitRPSGame(game, forfeiterId, 'commit_timeout');
    }
  }

  // Check revealing phase timeouts
  const revealingGames = db.prepare(`
    SELECT * FROM rps_games 
    WHERE status = 'revealing' AND (unixepoch() - phase_started_at) > ?
  `).all(REVEAL_TIMEOUT) as any[];

  for (const game of revealingGames) {
    const creatorReveals = JSON.parse(game.creator_reveals || '[]');
    const acceptorReveals = JSON.parse(game.acceptor_reveals || '[]');
    
    const creatorRevealed = !!creatorReveals[game.current_round];
    const acceptorRevealed = !!acceptorReveals[game.current_round];

    let forfeiterId: string | null = null;
    if (!creatorRevealed && !acceptorRevealed) {
      forfeiterId = game.creator_id;
    } else if (!creatorRevealed) {
      forfeiterId = game.creator_id;
    } else if (!acceptorRevealed) {
      forfeiterId = game.acceptor_id;
    }

    if (forfeiterId) {
      forfeitRPSGame(game, forfeiterId, 'reveal_timeout');
    }
  }

  const totalTimeouts = committingGames.length + revealingGames.length;
  if (totalTimeouts > 0) {
    console.log(`[Cron] Processed ${totalTimeouts} RPS timeouts`);
  }
}

// Helper to forfeit an RPS game
function forfeitRPSGame(game: any, forfeiterId: string, reason: string): void {
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
  `).run(game.id, rake, game.currency, totalPot);

  // Update game
  db.prepare(`
    UPDATE rps_games 
    SET status = 'completed', winner_id = ?, forfeited_by = ?, forfeit_reason = ?, rake = ?, completed_at = unixepoch()
    WHERE id = ?
  `).run(winnerId, forfeiterId, reason, rake, game.id);

  // Log transactions
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_win_forfeit', ?, ?, ?, unixepoch())
  `).run(winnerId, game.currency, payout, game.id);

  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
    VALUES (?, 'rps_forfeit', ?, ?, ?, unixepoch())
  `).run(forfeiterId, game.currency, -game.stake, game.id);

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
  `).run(game.stake, forfeiterId);

  console.log(`[Cron] RPS ${game.id} forfeited by ${forfeiterId} (${reason})`);
}

// Run all background jobs
export function runBackgroundJobs(): void {
  expireCoinflipGames();
  expireRPSGames();
  handleRPSTimeouts();
}
