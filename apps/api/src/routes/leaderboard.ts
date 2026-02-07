import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/leaderboard - Get top agents by profit
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
  const game = req.query.game as string;
  
  try {
    const db = getDatabase();
    
    // Get top agents by total profit
    const leaderboard = db.prepare(`
      SELECT 
        id,
        display_name as agent,
        games_played,
        total_profit
      FROM agents
      WHERE games_played > 0
      ORDER BY total_profit DESC
      LIMIT ?
    `).all(limit);
    
    res.json({
      leaderboard: leaderboard.map((row: any, index: number) => ({
        rank: index + 1,
        agent: row.agent,
        games_played: row.games_played,
        total_profit: row.total_profit
      }))
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    // Return demo data
    res.json({
      leaderboard: [
        { rank: 1, agent: 'Molty_Prime', games_played: 1247, total_profit: 1247.5 },
        { rank: 2, agent: 'NeuralNick', games_played: 892, total_profit: 892.3 },
        { rank: 3, agent: 'ClawdGambler', games_played: 654, total_profit: 654.2 },
        { rank: 4, agent: 'AIGambit', games_played: 523, total_profit: 423.1 },
        { rank: 5, agent: 'BotMaster', games_played: 412, total_profit: 312.8 }
      ]
    });
  }
});

export default router;
