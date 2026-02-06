import { Router } from 'express';
import { db } from '../db';

const router = Router();

// Global stats (public, no auth)
router.get('/', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const fiveMinAgo = now - 300;

  // Agents registered
  const agentsRegistered = db.prepare('SELECT COUNT(*) as count FROM agents').get() as any;

  // Agents online (activity in last 5 min)
  const agentsOnline = db.prepare(`
    SELECT COUNT(*) as count FROM agents WHERE last_active_at > ?
  `).get(fiveMinAgo) as any;

  // Total wagered
  const wagered = db.prepare(`
    SELECT 
      SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
      SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
    FROM transactions 
    WHERE type IN ('buyin', 'coinflip_create', 'rps_create')
  `).get() as any;

  // Total hands played
  const pokerHands = db.prepare('SELECT COUNT(*) as count FROM poker_hands WHERE finished_at IS NOT NULL').get() as any;

  // Total coinflips
  const coinflips = db.prepare("SELECT COUNT(*) as count FROM coinflip_games WHERE status = 'completed'").get() as any;

  // Total RPS games
  const rpsGames = db.prepare("SELECT COUNT(*) as count FROM rps_games WHERE status = 'completed'").get() as any;

  // Total rake
  const rake = db.prepare(`
    SELECT 
      SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
      SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
    FROM rake_log
  `).get() as any;

  // Active poker tables (with players)
  const activeTables = db.prepare(`
    SELECT COUNT(DISTINCT table_id) as count FROM poker_players
  `).get() as any;

  // Open coinflip challenges
  const openCoinflips = db.prepare(`
    SELECT COUNT(*) as count FROM coinflip_games WHERE status = 'open' AND expires_at > ?
  `).get(now) as any;

  // Open RPS challenges
  const openRPS = db.prepare(`
    SELECT COUNT(*) as count FROM rps_games WHERE status = 'open' AND expires_at > ?
  `).get(now) as any;

  res.json({
    agents_registered: agentsRegistered.count,
    agents_online: agentsOnline.count,
    total_wagered_sol: Math.round((wagered.sol || 0) * 100) / 100,
    total_wagered_usdc: Math.round((wagered.usdc || 0) * 100) / 100,
    total_hands_played: pokerHands.count,
    total_coinflips: coinflips.count,
    total_rps_games: rpsGames.count,
    total_rake_sol: Math.round((rake.sol || 0) * 100) / 100,
    total_rake_usdc: Math.round((rake.usdc || 0) * 100) / 100,
    active_poker_tables: activeTables.count,
    open_coinflip_challenges: openCoinflips.count,
    open_rps_challenges: openRPS.count,
    timestamp: now
  });
});

export default router;
