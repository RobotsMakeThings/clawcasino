import { Router } from 'express';
import { db } from '../db';

const router = Router({ mergeParams: true });

// Get agent stats (public)
router.get('/stats', (req, res) => {
  const { id } = req.params;

  const agent = db.prepare(`
    SELECT 
      id, display_name, wallet_address, created_at, games_played, total_profit,
      coinflip_games, coinflip_wins, coinflip_losses, coinflip_profit,
      rps_games, rps_wins, rps_losses, rps_profit,
      rps_rounds_played, rps_rock_count, rps_paper_count, rps_scissors_count
    FROM agents WHERE id = ?
  `).get(id) as any;

  if (!agent) {
    res.status(404).json({ error: 'agent_not_found', message: 'Agent not found' });
    return;
  }

  // Poker stats
  const pokerStats = db.prepare(`
    SELECT 
      COUNT(DISTINCT ph.id) as hands_played,
      SUM(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || ? || '%' THEN 1 ELSE 0 END) as hands_won,
      MAX(ph.pot) as biggest_pot,
      AVG(ph.pot) as avg_pot,
      SUM(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || ? || '%' THEN ph.pot - ph.rake ELSE 0 END) as winnings,
      SUM(pp.chips) as total_buyins
    FROM poker_hands ph
    JOIN poker_players pp ON ph.table_id = pp.table_id
    WHERE pp.agent_id = ? AND ph.finished_at IS NOT NULL
  `).get(id, id, id) as any;

  // Recent games (last 20 across all types)
  const recentPoker = db.prepare(`
    SELECT 
      'poker' as game_type,
      ph.id as game_id,
      ph.pot as amount,
      ph.rake,
      CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || ? || '%' THEN 'win' ELSE 'loss' END as result,
      ph.finished_at as timestamp,
      pt.name as table_name
    FROM poker_hands ph
    JOIN poker_players pp ON ph.table_id = pp.table_id
    JOIN poker_tables pt ON ph.table_id = pt.id
    WHERE pp.agent_id = ? AND ph.finished_at IS NOT NULL
    ORDER BY ph.finished_at DESC
    LIMIT 10
  `).all(id, id);

  const recentCoinflips = db.prepare(`
    SELECT 
      'coinflip' as game_type,
      id as game_id,
      stake * 2 - rake as amount,
      rake,
      CASE WHEN winner_id = ? THEN 'win' ELSE 'loss' END as result,
      completed_at as timestamp
    FROM coinflip_games
    WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 10
  `).all(id, id, id);

  const recentRPS = db.prepare(`
    SELECT 
      'rps' as game_type,
      id as game_id,
      stake * 2 - rake as amount,
      rake,
      CASE WHEN winner_id = ? THEN 'win' ELSE 'loss' END as result,
      completed_at as timestamp,
      creator_wins || '-' || acceptor_wins as score
    FROM rps_games
    WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 10
  `).all(id, id, id);

  // Combine and sort recent games
  const allRecent = [...recentPoker, ...recentCoinflips, ...recentRPS]
    .sort((a: any, b: any) => b.timestamp - a.timestamp)
    .slice(0, 20);

  // Calculate longest coinflip streak
  const coinflipGames = db.prepare(`
    SELECT winner_id FROM coinflip_games 
    WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
    ORDER BY completed_at DESC
  `).all(id, id) as any[];

  let currentStreak = 0;
  let maxStreak = 0;
  for (const game of coinflipGames) {
    if (game.winner_id === id) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  res.json({
    agent: {
      id: agent.id,
      display_name: agent.display_name,
      wallet_address: `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
      created_at: agent.created_at
    },
    overview: {
      total_games: agent.games_played,
      total_profit: agent.total_profit
    },
    poker: {
      hands_played: pokerStats?.hands_played || 0,
      hands_won: pokerStats?.hands_won || 0,
      biggest_pot: pokerStats?.biggest_pot || 0,
      avg_pot: Math.round((pokerStats?.avg_pot || 0) * 100) / 100,
      win_rate: pokerStats?.hands_played > 0 
        ? `${((pokerStats.hands_won / pokerStats.hands_played) * 100).toFixed(1)}%` 
        : '0.0%',
      total_profit: (pokerStats?.winnings || 0) - (pokerStats?.total_buyins || 0)
    },
    coinflip: {
      games_played: agent.coinflip_games || 0,
      wins: agent.coinflip_wins || 0,
      losses: agent.coinflip_losses || 0,
      win_rate: agent.coinflip_games > 0 
        ? `${((agent.coinflip_wins / agent.coinflip_games) * 100).toFixed(1)}%` 
        : '0.0%',
      total_profit: agent.coinflip_profit || 0,
      longest_streak: maxStreak,
      current_streak: currentStreak
    },
    rps: {
      games_played: agent.rps_games || 0,
      wins: agent.rps_wins || 0,
      losses: agent.rps_losses || 0,
      win_rate: agent.rps_games > 0 
        ? `${((agent.rps_wins / agent.rps_games) * 100).toFixed(1)}%` 
        : '0.0%',
      choice_distribution: agent.rps_rounds_played > 0 ? {
        rock: Math.round(((agent.rps_rock_count || 0) / agent.rps_rounds_played) * 1000) / 10,
        paper: Math.round(((agent.rps_paper_count || 0) / agent.rps_rounds_played) * 1000) / 10,
        scissors: Math.round(((agent.rps_scissors_count || 0) / agent.rps_rounds_played) * 1000) / 10,
        total_rounds: agent.rps_rounds_played
      } : null,
      total_profit: agent.rps_profit || 0
    },
    recent_games: allRecent
  });
});

export default router;
