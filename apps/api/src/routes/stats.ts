import { Router } from 'express';
import { db } from '../db';

const router = Router();

// Helper to get current user from token
function getUserFromToken(req: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    const session = db.prepare('SELECT agent_id FROM user_sessions WHERE token = ? AND expires_at > ?')
      .get(token, new Date().toISOString()) as any;
    
    if (!session) return null;
    
    return db.prepare('SELECT * FROM agents WHERE id = ?').get(session.agent_id) as any;
  } catch {
    return null;
  }
}

// Get global stats (real data)
router.get('/global', (req, res) => {
  try {
    // Get stats from database
    const stats = db.prepare('SELECT * FROM game_stats WHERE id = 1').get() as any;
    
    // Count active agents (with sessions in last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const activeAgents = db.prepare(`
      SELECT COUNT(DISTINCT agent_id) as count 
      FROM user_sessions 
      WHERE expires_at > ?
    `).get(oneHourAgo) as any;

    // Count total agents
    const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as any;

    // Get hands played today
    const today = new Date().toISOString().split('T')[0];
    const handsToday = db.prepare(`
      SELECT COUNT(*) as count 
      FROM hands 
      WHERE date(started_at) = date(?)
    `).get(today) as any;

    res.json({
      agentsOnline: activeAgents?.count || 0,
      totalAgents: totalAgents?.count || 0,
      totalWagered: stats?.total_wagered || 0,
      handsPlayed: stats?.total_hands || 0,
      totalRake: stats?.total_rake || 0,
      handsToday: handsToday?.count || 0,
      lastUpdated: stats?.updated_at
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get live feed (recent actions)
router.get('/feed', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    
    const actions = db.prepare(`
      SELECT 
        ha.action,
        ha.amount,
        ha.phase,
        ha.timestamp,
        a.username as agent_name,
        h.table_id,
        t.name as table_name
      FROM hand_actions ha
      JOIN agents a ON ha.agent_id = a.id
      JOIN hands h ON ha.hand_id = h.id
      JOIN tables t ON h.table_id = t.id
      ORDER BY ha.timestamp DESC
      LIMIT ?
    `).all(limit) as any[];

    res.json(actions.map(a => ({
      agent: a.agent_name,
      action: a.action,
      amount: a.amount,
      game: a.table_name,
      timestamp: a.timestamp,
      phase: a.phase
    })));
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

// Get leaderboard (real data)
router.get('/leaderboard', (req, res) => {
  try {
    const topAgents = db.prepare(`
      SELECT 
        username,
        games_played as games,
        hands_played,
        hands_won,
        CASE 
          WHEN hands_played > 0 THEN ROUND((hands_won * 100.0) / hands_played, 1)
          ELSE 0 
        END as win_rate,
        total_profit as profit,
        biggest_pot_won
      FROM agents
      WHERE games_played > 0
      ORDER BY total_profit DESC
      LIMIT 10
    `).all() as any[];

    res.json(topAgents.map((a, i) => ({
      rank: i + 1,
      username: a.username,
      games: a.games,
      winRate: a.win_rate,
      profit: a.profit,
      biggestWin: a.biggest_pot_won
    })));
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

// Update stats (internal use)
router.post('/update', (req, res) => {
  const { wagered, hands, rake } = req.body;
  
  try {
    db.prepare(`
      UPDATE game_stats 
      SET 
        total_wagered = total_wagered + ?,
        total_hands = total_hands + ?,
        total_rake = total_rake + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(wagered || 0, hands || 0, rake || 0);

    res.json({ success: true });
  } catch (error) {
    console.error('Update stats error:', error);
    res.status(500).json({ error: 'Failed to update stats' });
  }
});

export default router;
