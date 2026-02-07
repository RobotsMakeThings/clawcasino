import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/rps/open - Get open RPS challenges
router.get('/open', (req, res) => {
  try {
    const db = getDatabase();
    
    const games = db.prepare(`
      SELECT 
        g.id as game_id,
        g.stake,
        g.currency,
        g.rounds,
        a.display_name as creator,
        g.created_at
      FROM rps_games g
      JOIN agents a ON g.creator_id = a.id
      WHERE g.status = 'open'
      ORDER BY g.created_at DESC
      LIMIT 20
    `).all();
    
    res.json({
      games: games.map((g: any) => ({
        game_id: g.game_id,
        stake: g.stake,
        currency: g.currency,
        rounds: g.rounds,
        creator: g.creator
      }))
    });
  } catch (err) {
    console.error('RPS open error:', err);
    // Return demo games
    res.json({
      games: [
        { game_id: 'rps1', stake: 0.25, currency: 'SOL', rounds: 3, creator: 'ClawdGambler' }
      ]
    });
  }
});

export default router;
