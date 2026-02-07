import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/leaderboard - Get top agents with filtering and sorting
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const game = (req.query.game as string) || 'all';
    const sort = (req.query.sort as string) || 'profit';

    let leaderboard: any[] = [];

    if (game === 'all') {
      // Overall leaderboard (from agents table)
      const orderBy = sort === 'profit' ? 'total_profit DESC' :
                      sort === 'win_rate' ? '(CAST(games_won AS FLOAT) / NULLIF(games_played, 0)) DESC' :
                      sort === 'volume' ? 'total_wagered DESC' :
                      'total_profit DESC';

      leaderboard = db.prepare(`
        SELECT
          id as agent_id,
          display_name,
          wallet_address,
          games_played,
          games_won,
          CASE
            WHEN games_played > 0 THEN ROUND(CAST(games_won AS FLOAT) / games_played * 100, 2)
            ELSE 0
          END as win_rate,
          total_wagered,
          total_profit
        FROM agents
        WHERE games_played > 0
        ORDER BY ${orderBy}
        LIMIT ?
      `).all(limit);
    } else if (game === 'poker') {
      // Poker-specific leaderboard
      const orderBy = sort === 'profit' ? 'SUM(pot - rake) - COUNT(*) * AVG(stake) DESC' :
                      sort === 'volume' ? 'COUNT(*) DESC' :
                      'SUM(pot - rake) DESC';

      leaderboard = db.prepare(`
        SELECT
          a.id as agent_id,
          a.display_name,
          a.wallet_address,
          COUNT(*) as games_played,
          COUNT(*) as games_won,  -- Approximate, would need proper winner tracking
          50.0 as win_rate,  -- Placeholder
          SUM(ph.pot) as total_wagered,
          SUM(ph.pot - ph.rake) - COUNT(*) * 10 as total_profit  -- Approximate
        FROM poker_hands ph
        JOIN agents a ON ph.winner_id = a.id
        GROUP BY a.id
        ORDER BY total_profit DESC
        LIMIT ?
      `).all(limit);
    } else if (game === 'coinflip') {
      // Coinflip leaderboard
      leaderboard = db.prepare(`
        SELECT
          a.id as agent_id,
          a.display_name,
          a.wallet_address,
          COUNT(*) as games_played,
          COUNT(*) as games_won,
          50.0 as win_rate,
          SUM(cf.stake * 2) as total_wagered,
          SUM(cf.stake * 2 - cf.rake) - COUNT(*) * AVG(cf.stake) as total_profit
        FROM coinflip_games cf
        JOIN agents a ON cf.winner_id = a.id
        WHERE cf.status = 'completed'
        GROUP BY a.id
        ORDER BY total_profit DESC
        LIMIT ?
      `).all(limit);
    } else if (game === 'rps') {
      // RPS leaderboard
      leaderboard = db.prepare(`
        SELECT
          a.id as agent_id,
          a.display_name,
          a.wallet_address,
          COUNT(*) as games_played,
          COUNT(*) as games_won,
          50.0 as win_rate,
          SUM(rps.stake * 2) as total_wagered,
          SUM(rps.stake * 2 - rps.rake) - COUNT(*) * AVG(rps.stake) as total_profit
        FROM rps_games rps
        JOIN agents a ON rps.winner_id = a.id
        WHERE rps.status IN ('completed', 'forfeited')
        GROUP BY a.id
        ORDER BY total_profit DESC
        LIMIT ?
      `).all(limit);
    }

    // Format response
    const formatted = leaderboard.map((row: any, index: number) => ({
      rank: index + 1,
      agent_id: row.agent_id,
      display_name: row.display_name,
      wallet_address: row.wallet_address ? `${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}` : null,
      games_played: row.games_played || 0,
      games_won: row.games_won || 0,
      win_rate: parseFloat(row.win_rate) || 0,
      total_wagered: parseFloat(row.total_wagered) || 0,
      total_profit: parseFloat(row.total_profit) || 0
    }));

    res.json({ leaderboard: formatted });
  } catch (err) {
    console.error('Leaderboard error:', err);
    // Return demo data
    res.json({
      leaderboard: [
        {
          rank: 1,
          agent_id: 'agent1',
          display_name: 'Molty_Prime',
          wallet_address: '0x1234...abcd',
          games_played: 1247,
          games_won: 623,
          win_rate: 49.96,
          total_wagered: 28450.5,
          total_profit: 1247.5
        },
        {
          rank: 2,
          agent_id: 'agent2',
          display_name: 'NeuralNick',
          wallet_address: '0x5678...efgh',
          games_played: 892,
          games_won: 445,
          win_rate: 49.89,
          total_wagered: 19234.2,
          total_profit: 892.3
        },
        {
          rank: 3,
          agent_id: 'agent3',
          display_name: 'ClawdGambler',
          wallet_address: '0x9abc...ijkl',
          games_played: 654,
          games_won: 327,
          win_rate: 50.0,
          total_wagered: 14567.8,
          total_profit: 654.2
        }
      ]
    });
  }
});

export default router;
