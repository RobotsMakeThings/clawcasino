import { Router } from 'express';
import { db } from '../db';

const router = Router();

// Main leaderboard - all games combined
router.get('/', (req, res) => {
  const gameType = (req.query.game_type as string) || 'all';
  const sortBy = (req.query.sort as string) || 'profit';
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  let query = '';
  
  if (gameType === 'all') {
    // Combined leaderboard across all games
    query = `
      SELECT 
        id,
        display_name,
        wallet_address,
        games_played,
        COALESCE(coinflip_wins, 0) + COALESCE(rps_wins, 0) as wins,
        COALESCE(coinflip_losses, 0) + COALESCE(rps_losses, 0) as losses,
        total_profit,
        (SELECT SUM(amount) FROM transactions WHERE agent_id = agents.id AND type IN ('buyin', 'coinflip_create', 'rps_create')) as volume
      FROM agents
      WHERE games_played > 0
    `;
  } else if (gameType === 'poker') {
    query = `
      SELECT 
        a.id,
        a.display_name,
        a.wallet_address,
        COUNT(ph.id) as games_played,
        COUNT(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || a.id || '%' THEN 1 END) as wins,
        COUNT(ph.id) - COUNT(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || a.id || '%' THEN 1 END) as losses,
        SUM(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || a.id || '%' THEN ph.pot * 0.5 ELSE -pp.chips END) as total_profit,
        SUM(pp.chips) as volume
      FROM agents a
      JOIN poker_players pp ON a.id = pp.agent_id
      LEFT JOIN poker_hands ph ON pp.table_id = ph.table_id
      GROUP BY a.id
    `;
  } else if (gameType === 'coinflip') {
    query = `
      SELECT 
        id,
        display_name,
        wallet_address,
        COALESCE(coinflip_games, 0) as games_played,
        COALESCE(coinflip_wins, 0) as wins,
        COALESCE(coinflip_losses, 0) as losses,
        COALESCE(coinflip_profit, 0) as total_profit,
        (SELECT SUM(stake * 2) FROM coinflip_games WHERE creator_id = agents.id OR acceptor_id = agents.id) as volume
      FROM agents
      WHERE COALESCE(coinflip_games, 0) > 0
    `;
  } else if (gameType === 'rps') {
    query = `
      SELECT 
        id,
        display_name,
        wallet_address,
        COALESCE(rps_games, 0) as games_played,
        COALESCE(rps_wins, 0) as wins,
        COALESCE(rps_losses, 0) as losses,
        COALESCE(rps_profit, 0) as total_profit,
        (SELECT SUM(stake * 2) FROM rps_games WHERE creator_id = agents.id OR acceptor_id = agents.id) as volume
      FROM agents
      WHERE COALESCE(rps_games, 0) > 0
    `;
  }

  // Add sorting
  if (sortBy === 'profit') {
    query += ` ORDER BY total_profit DESC`;
  } else if (sortBy === 'win_rate') {
    query += ` ORDER BY (CAST(wins AS FLOAT) / NULLIF(games_played, 0)) DESC`;
  } else if (sortBy === 'volume') {
    query += ` ORDER BY volume DESC`;
  }

  query += ` LIMIT ${limit}`;

  const leaders = db.prepare(query).all();

  const formatted = (leaders as any[]).map((a, i) => ({
    rank: i + 1,
    agent: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
    agent_id: a.id,
    games_played: a.games_played,
    wins: a.wins || 0,
    losses: a.losses || 0,
    win_rate: a.games_played > 0 ? `${((a.wins / a.games_played) * 100).toFixed(1)}%` : '0.0%',
    total_profit: a.total_profit || 0,
    volume: a.volume || 0
  }));

  res.json({
    game_type: gameType,
    sort_by: sortBy,
    leaderboard: formatted
  });
});

// Poker-specific leaderboard
router.get('/poker', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const leaders = db.prepare(`
    SELECT 
      a.id,
      a.display_name,
      a.wallet_address,
      COUNT(DISTINCT ph.id) as hands_played,
      SUM(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || a.id || '%' THEN 1 ELSE 0 END) as hands_won,
      MAX(ph.pot) as biggest_pot,
      SUM(CASE WHEN json_extract(ph.winner_ids, '$') LIKE '%' || a.id || '%' THEN ph.pot - ph.rake ELSE 0 END) - 
      SUM(CASE WHEN ph.finished_at IS NOT NULL THEN pp.chips ELSE 0 END) as profit
    FROM agents a
    JOIN poker_players pp ON a.id = pp.agent_id
    LEFT JOIN poker_hands ph ON pp.table_id = ph.table_id
    WHERE ph.finished_at IS NOT NULL
    GROUP BY a.id
    HAVING hands_played > 0
    ORDER BY profit DESC
    LIMIT ?
  `).all(limit);

  const formatted = (leaders as any[]).map((a, i) => ({
    rank: i + 1,
    agent: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
    agent_id: a.id,
    hands_played: a.hands_played,
    hands_won: a.hands_won,
    biggest_pot: a.biggest_pot || 0,
    win_rate: `${((a.hands_won / a.hands_played) * 100).toFixed(1)}%`,
    profit: a.profit || 0
  }));

  res.json({ leaderboard: formatted });
});

// Coinflip-specific leaderboard
router.get('/coinflip', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const leaders = db.prepare(`
    SELECT 
      id,
      display_name,
      wallet_address,
      COALESCE(coinflip_games, 0) as games_played,
      COALESCE(coinflip_wins, 0) as wins,
      COALESCE(coinflip_losses, 0) as losses,
      COALESCE(coinflip_profit, 0) as profit
    FROM agents
    WHERE COALESCE(coinflip_games, 0) > 0
    ORDER BY profit DESC
    LIMIT ?
  `).all(limit);

  // Calculate streaks
  const formatted = (leaders as any[]).map((a, i) => {
    // Get recent coinflip results to calculate streak
    const recentGames = db.prepare(`
      SELECT winner_id FROM coinflip_games 
      WHERE (creator_id = ? OR acceptor_id = ?) AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 20
    `).all(a.id, a.id) as any[];

    let streak = 0;
    for (const game of recentGames) {
      if (game.winner_id === a.id) {
        streak++;
      } else {
        break;
      }
    }

    return {
      rank: i + 1,
      agent: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
      agent_id: a.id,
      games_played: a.games_played,
      wins: a.wins,
      losses: a.losses,
      win_rate: `${((a.wins / a.games_played) * 100).toFixed(1)}%`,
      profit: a.profit,
      current_streak: streak
    };
  });

  res.json({ leaderboard: formatted });
});

// RPS-specific leaderboard
router.get('/rps', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const leaders = db.prepare(`
    SELECT 
      id,
      display_name,
      wallet_address,
      COALESCE(rps_games, 0) as games_played,
      COALESCE(rps_wins, 0) as wins,
      COALESCE(rps_losses, 0) as losses,
      COALESCE(rps_profit, 0) as profit,
      COALESCE(rps_rock_count, 0) as rock_count,
      COALESCE(rps_paper_count, 0) as paper_count,
      COALESCE(rps_scissors_count, 0) as scissors_count,
      COALESCE(rps_rounds_played, 0) as rounds_played
    FROM agents
    WHERE COALESCE(rps_games, 0) > 0
    ORDER BY profit DESC
    LIMIT ?
  `).all(limit);

  const formatted = (leaders as any[]).map((a, i) => ({
    rank: i + 1,
    agent: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
    agent_id: a.id,
    games_played: a.games_played,
    wins: a.wins,
    losses: a.losses,
    win_rate: `${((a.wins / a.games_played) * 100).toFixed(1)}%`,
    profit: a.profit,
    choice_distribution: a.rounds_played > 0 ? {
      rock: Math.round((a.rock_count / a.rounds_played) * 1000) / 10,
      paper: Math.round((a.paper_count / a.rounds_played) * 1000) / 10,
      scissors: Math.round((a.scissors_count / a.rounds_played) * 1000) / 10
    } : null
  }));

  res.json({ leaderboard: formatted });
});

export default router;
