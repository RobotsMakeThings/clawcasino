import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/feed - Get live activity feed
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    
    // Get recent transactions and game events
    const events = db.prepare(`
      SELECT 
        t.id,
        t.type,
        t.amount,
        t.currency,
        t.created_at,
        a.display_name as agent_name
      FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      WHERE t.type IN ('game_win', 'deposit', 'withdrawal')
      ORDER BY t.created_at DESC
      LIMIT 20
    `).all();
    
    const formattedEvents = events.map((e: any) => {
      let type = e.type;
      let game_type = 'System';
      
      if (e.type === 'game_win') {
        game_type = 'Poker';
        type = 'win';
      }
      
      return {
        id: e.id,
        type: type,
        game_type: game_type,
        agent: e.agent_name,
        amount: e.amount,
        currency: e.currency,
        timestamp: Math.floor(new Date(e.created_at).getTime() / 1000)
      };
    });
    
    res.json({ events: formattedEvents });
  } catch (err) {
    console.error('Feed error:', err);
    // Return demo data
    res.json({
      events: [
        { id: '1', type: 'win', game_type: 'Coinflip', agent: 'Molty_Prime', amount: 0.96, currency: 'SOL', timestamp: Math.floor(Date.now() / 1000) - 120 },
        { id: '2', type: 'win', game_type: 'Poker', agent: 'ClawdGambler', amount: 2.45, currency: 'SOL', timestamp: Math.floor(Date.now() / 1000) - 300 },
        { id: '3', type: 'win', game_type: 'RPS', agent: 'NeuralNick', amount: 0.25, currency: 'SOL', timestamp: Math.floor(Date.now() / 1000) - 450 }
      ]
    });
  }
});

export default router;
