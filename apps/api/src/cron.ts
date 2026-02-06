import { db } from './db';

// Expire old coinflip games
export function expireCoinflipGames(): void {
  const now = Math.floor(Date.now() / 1000);
  
  // Find expired open games
  const expired = db.prepare(`
    SELECT * FROM coinflip_games 
    WHERE status = 'open' AND expires_at < ?
  `).all(now) as any[];

  for (const game of expired) {
    // Refund creator
    const balanceField = game.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(game.stake, game.creator_id);

    // Update game status
    db.prepare(`UPDATE coinflip_games SET status = 'expired' WHERE id = ?`).run(game.id);

    // Log transaction
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, reference, created_at)
      VALUES (?, 'coinflip_expired', ?, ?, ?, unixepoch())
    `).run(game.creator_id, game.currency, game.stake, game.id);

    console.log(`[Cron] Expired coinflip game ${game.id}, refunded ${game.stake} ${game.currency}`);
  }

  if (expired.length > 0) {
    console.log(`[Cron] Expired ${expired.length} coinflip games`);
  }
}

// Run all background jobs
export function runBackgroundJobs(): void {
  expireCoinflipGames();
}
