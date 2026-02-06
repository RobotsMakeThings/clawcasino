import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// In-memory feed cache (last 100 events)
const feedCache: any[] = [];
const MAX_FEED_ITEMS = 100;

// Helper to add event to feed
export function addFeedEvent(event: any): void {
  feedCache.unshift({
    ...event,
    timestamp: Math.floor(Date.now() / 1000)
  });
  
  if (feedCache.length > MAX_FEED_ITEMS) {
    feedCache.pop();
  }
}

// Get live feed
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const gameType = req.query.game_type as string;
  
  let events = feedCache;
  
  if (gameType && gameType !== 'all') {
    events = events.filter(e => e.game_type === gameType);
  }
  
  res.json({
    events: events.slice(0, limit),
    total: feedCache.length
  });
});

// Get feed from database (for persistence across restarts)
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
  
  // Get recent completed games from all types
  const pokerHands = db.prepare(`
    SELECT 
      'poker_hand_complete' as type,
      'poker' as game_type,
      ph.id as game_id,
      ph.pot as amount,
      ph.rake,
      ph.finished_at as timestamp,
      json_extract(ph.winner_ids, '$') as winners,
      pt.name as table_name
    FROM poker_hands ph
    JOIN poker_tables pt ON ph.table_id = pt.id
    WHERE ph.finished_at IS NOT NULL
    ORDER BY ph.finished_at DESC
    LIMIT ?
  `).all(limit) as any[];

  const coinflips = db.prepare(`
    SELECT 
      'coinflip_result' as type,
      'coinflip' as game_type,
      cg.id as game_id,
      cg.stake * 2 - cg.rake as amount,
      cg.rake,
      cg.completed_at as timestamp,
      c.display_name as winner_name,
      c.wallet_address as winner_wallet,
      a.display_name as loser_name,
      a.wallet_address as loser_wallet
    FROM coinflip_games cg
    JOIN agents c ON cg.winner_id = c.id
    JOIN agents a ON (cg.creator_id = cg.winner_id ? cg.acceptor_id : cg.creator_id) = a.id
    WHERE cg.status = 'completed' AND cg.completed_at IS NOT NULL
    ORDER BY cg.completed_at DESC
    LIMIT ?
  `).all(limit) as any[];

  const rpsGames = db.prepare(`
    SELECT 
      'rps_result' as type,
      'rps' as game_type,
      rg.id as game_id,
      rg.stake * 2 - rg.rake as amount,
      rg.rake,
      rg.completed_at as timestamp,
      rg.creator_wins || '-' || rg.acceptor_wins as score,
      c.display_name as winner_name,
      c.wallet_address as winner_wallet,
      a.display_name as loser_name,
      a.wallet_address as loser_wallet
    FROM rps_games rg
    JOIN agents c ON rg.winner_id = c.id
    JOIN agents a ON (rg.creator_id = rg.winner_id ? rg.acceptor_id : rg.creator_id) = a.id
    WHERE rg.status = 'completed' AND rg.completed_at IS NOT NULL
    ORDER BY rg.completed_at DESC
    LIMIT ?
  `).all(limit) as any[];

  // Combine and sort
  const allEvents = [...pokerHands, ...coinflips, ...rpsGames]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  res.json({ events: allEvents });
});

export default router;
export { feedCache };
