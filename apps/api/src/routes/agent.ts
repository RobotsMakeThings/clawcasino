import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/agent/:id/stats - Public profile for an agent
router.get('/:id/stats', (req, res) => {
  try {
    const db = getDatabase();
    const agentId = req.params.id;

    // Get agent basic info
    const agent = db.prepare(`
      SELECT
        id,
        display_name,
        wallet_address,
        created_at,
        games_played,
        games_won,
        total_wagered,
        total_profit
      FROM agents
      WHERE id = ?
    `).get(agentId);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Calculate win rate
    const winRate = agent.games_played > 0
      ? Math.round((agent.games_won / agent.games_played) * 100 * 100) / 100
      : 0;

    // Get per-game stats
    const pokerStats = db.prepare(`
      SELECT
        COUNT(*) as games_played,
        COUNT(*) as games_won,
        COALESCE(SUM(pot - rake), 0) as total_profit
      FROM poker_hands
      WHERE winner_id = ?
    `).get(agentId);

    const coinflipStats = db.prepare(`
      SELECT
        COUNT(*) as games_played,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as games_won,
        COALESCE(SUM(CASE WHEN winner_id = ? THEN stake * 2 - rake ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN creator_id = ? OR acceptor_id = ? THEN stake ELSE 0 END), 0) as total_profit
      FROM coinflip_games
      WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
    `).get(agentId, agentId, agentId, agentId, agentId, agentId);

    const rpsStats = db.prepare(`
      SELECT
        COUNT(*) as games_played,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as games_won,
        COALESCE(SUM(CASE WHEN winner_id = ? THEN stake * 2 - rake ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN creator_id = ? OR acceptor_id = ? THEN stake ELSE 0 END), 0) as total_profit
      FROM rps_games
      WHERE (creator_id = ? OR acceptor_id = ?) AND status IN ('completed', 'forfeited')
    `).get(agentId, agentId, agentId, agentId, agentId, agentId);

    // Get recent 20 games across all types
    const recentGames: any[] = [];

    // Recent poker hands
    const pokerGames = db.prepare(`
      SELECT
        'poker' as game_type,
        id as game_id,
        completed_at as timestamp,
        pot,
        rake,
        json_object('pot', pot, 'rake', rake) as data
      FROM poker_hands
      WHERE winner_id = ?
      ORDER BY completed_at DESC
      LIMIT 10
    `).all(agentId);

    // Recent coinflips
    const coinflipGames = db.prepare(`
      SELECT
        'coinflip' as game_type,
        id as game_id,
        completed_at as timestamp,
        stake * 2 as pot,
        rake,
        json_object('stake', stake, 'won', CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as data
      FROM coinflip_games
      WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 10
    `).all(agentId, agentId, agentId);

    // Recent RPS games
    const rpsGames = db.prepare(`
      SELECT
        'rps' as game_type,
        id as game_id,
      completed_at as timestamp,
        stake * 2 as pot,
        rake,
        json_object('stake', stake, 'won', CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as data
      FROM rps_games
      WHERE (creator_id = ? OR acceptor_id = ?) AND status IN ('completed', 'forfeited')
      ORDER BY completed_at DESC
      LIMIT 10
    `).all(agentId, agentId, agentId);

    // Combine and sort
    const allGames = [
      ...pokerGames.map((g: any) => ({ ...g, timestamp: new Date(g.timestamp).getTime() })),
      ...coinflipGames.map((g: any) => ({ ...g, timestamp: new Date(g.timestamp).getTime() })),
      ...rpsGames.map((g: any) => ({ ...g, timestamp: new Date(g.timestamp).getTime() }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);

    res.json({
      agent_id: agent.id,
      display_name: agent.display_name,
      wallet_address: `${agent.wallet_address.slice(0, 6)}...${agent.wallet_address.slice(-4)}`,
      member_since: Math.floor(new Date(agent.created_at).getTime() / 1000),
      overall: {
        games_played: agent.games_played,
        games_won: agent.games_won,
        win_rate: winRate,
        total_wagered: agent.total_wagered,
        total_profit: agent.total_profit
      },
      per_game: {
        poker: {
          games_played: pokerStats?.games_played || 0,
          games_won: pokerStats?.games_won || 0,
          total_profit: pokerStats?.total_profit || 0
        },
        coinflip: {
          games_played: coinflipStats?.games_played || 0,
          games_won: coinflipStats?.games_won || 0,
          total_profit: coinflipStats?.total_profit || 0
        },
        rps: {
          games_played: rpsStats?.games_played || 0,
          games_won: rpsStats?.games_won || 0,
          total_profit: rpsStats?.total_profit || 0
        }
      },
      recent_games: allGames.map((g: any) => ({
        game_type: g.game_type,
        game_id: g.game_id,
        timestamp: Math.floor(g.timestamp / 1000),
        pot: g.pot,
        rake: g.rake,
        net: (g.pot - g.rake) / 2, // Approximate
        won: JSON.parse(g.data).won === 1 || g.game_type === 'poker'
      }))
    });
  } catch (err) {
    console.error('Agent stats error:', err);
    res.status(500).json({ error: 'Failed to fetch agent stats' });
  }
});

export default router;
