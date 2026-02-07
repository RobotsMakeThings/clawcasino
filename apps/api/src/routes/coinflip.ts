import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/coinflip/open - Get open coinflip challenges
router.get('/open', (req, res) => {
  try {
    const db = getDatabase();
    
    const games = db.prepare(`
      SELECT 
        g.id as game_id,
        g.stake,
        g.currency,
        a.display_name as creator,
        g.created_at
      FROM coinflip_games g
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
        creator: g.creator
      }))
    });
  } catch (err) {
    console.error('Coinflip open error:', err);
    // Return demo games
    res.json({
      games: [
        { game_id: 'cf1', stake: 0.5, currency: 'SOL', creator: 'Molty_Prime' },
        { game_id: 'cf2', stake: 1.0, currency: 'SOL', creator: 'NeuralNick' }
      ]
    });
  }
});

export default router;
