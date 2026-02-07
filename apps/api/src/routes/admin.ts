import { Router } from 'express';
import { getDatabase } from '../db';
import { getAllTables } from '../games/poker/table';

const router = Router();

// Admin middleware - check ADMIN_API_KEY
function requireAdmin(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
  }
  
  const token = authHeader.slice(7);
  
  if (token !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Forbidden - Invalid admin key' });
  }
  
  next();
}

// All admin routes require admin key
router.use(requireAdmin);

// GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard', (req, res) => {
  try {
    const db = getDatabase();
    const now = Date.now();
    
    // Time ranges
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTs = todayStart.getTime();
    
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekStartTs = weekStart.getTime();
    
    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);
    const monthStartTs = monthStart.getTime();
    
    // Revenue stats (rake)
    const revenueToday = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM rake_log 
      WHERE currency = 'SOL' AND created_at >= ?
    `).get(todayStartTs);
    
    const revenueWeek = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM rake_log 
      WHERE currency = 'SOL' AND created_at >= ?
    `).get(weekStartTs);
    
    const revenueMonth = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM rake_log 
      WHERE currency = 'SOL' AND created_at >= ?
    `).get(monthStartTs);
    
    const revenueAllTime = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM rake_log 
      WHERE currency = 'SOL'
    `).get();
    
    // Agent stats
    const totalAgents = db.prepare(`SELECT COUNT(*) as count FROM agents`).get();
    
    const activeToday = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE last_active >= ?
    `).get(todayStartTs);
    
    const newToday = db.prepare(`
      SELECT COUNT(*) as count FROM agents WHERE created_at >= ?
    `).get(todayStartTs);
    
    // Game stats for today
    const pokerToday = db.prepare(`
      SELECT COUNT(*) as count FROM poker_hands 
      WHERE completed_at >= ?
    `).get(todayStartTs);
    
    const coinflipToday = db.prepare(`
      SELECT COUNT(*) as count FROM coinflip_games 
      WHERE status = 'completed' AND completed_at >= ?
    `).get(todayStartTs);
    
    const rpsToday = db.prepare(`
      SELECT COUNT(*) as count FROM rps_games 
      WHERE status IN ('completed', 'forfeited') AND completed_at >= ?
    `).get(todayStartTs);
    
    res.json({
      revenue: {
        today_sol: revenueToday?.total || 0,
        week_sol: revenueWeek?.total || 0,
        month_sol: revenueMonth?.total || 0,
        all_time_sol: revenueAllTime?.total || 0
      },
      agents: {
        total: totalAgents?.count || 0,
        active_today: activeToday?.count || 0,
        new_today: newToday?.count || 0
      },
      games: {
        poker_hands_today: pokerToday?.count || 0,
        coinflips_today: coinflipToday?.count || 0,
        rps_today: rpsToday?.count || 0
      }
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/admin/audit - Full money invariant audit
router.get('/audit', (req, res) => {
  try {
    const db = getDatabase();
    
    // Total deposits
    const depositsResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE type = 'deposit' AND currency = 'SOL'
    `).get();
    const totalDeposited = depositsResult?.total || 0;
    
    // Total balances (all agents)
    const balancesResult = db.prepare(`
      SELECT COALESCE(SUM(balance_sol), 0) as total FROM agents
    `).get();
    const totalInBalances = balancesResult?.total || 0;
    
    // Total chips on poker tables
    const tables = getAllTables();
    let totalOnTables = 0;
    for (const table of tables) {
      for (const player of table.seats.values()) {
        totalOnTables += player.chips + player.betThisRound;
      }
    }
    
    // Total escrowed in open coinflip games
    const coinflipEscrow = db.prepare(`
      SELECT COALESCE(SUM(stake), 0) as total 
      FROM coinflip_games 
      WHERE status IN ('open', 'completed') AND currency = 'SOL'
    `).get();
    const totalInCoinflipEscrow = coinflipEscrow?.total || 0;
    
    // Total escrowed in active RPS games
    const rpsEscrow = db.prepare(`
      SELECT COALESCE(SUM(stake), 0) as total 
      FROM rps_games 
      WHERE status IN ('open', 'committing', 'revealing') AND currency = 'SOL'
    `).get();
    const totalInRPSEscrow = rpsEscrow?.total || 0;
    
    // Total rake
    const rakeResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM rake_log 
      WHERE currency = 'SOL'
    `).get();
    const totalRake = rakeResult?.total || 0;
    
    // Total withdrawals
    const withdrawalsResult = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE type = 'withdrawal' AND currency = 'SOL'
    `).get();
    const totalWithdrawn = withdrawalsResult?.total || 0;
    
    // Calculate expected total
    const expectedTotal = totalInBalances + totalOnTables + totalInCoinflipEscrow + totalInRPSEscrow + totalRake + totalWithdrawn;
    
    // Check if balanced (allow small floating point difference)
    const balanced = Math.abs(totalDeposited - expectedTotal) < 0.0001;
    
    res.json({
      audit: {
        total_deposited: totalDeposited,
        total_in_balances: totalInBalances,
        total_on_tables: totalOnTables,
        total_in_coinflip_escrow: totalInCoinflipEscrow,
        total_in_rps_escrow: totalInRPSEscrow,
        total_rake: totalRake,
        total_withdrawn: totalWithdrawn,
        expected_total: expectedTotal,
        balanced,
        variance: totalDeposited - expectedTotal
      },
      pass: balanced
    });
  } catch (err) {
    console.error('Admin audit error:', err);
    res.status(500).json({ error: 'Failed to run audit' });
  }
});

// GET /api/admin/rake/daily - Last 30 days of rake by game type
router.get('/rake/daily', (req, res) => {
  try {
    const db = getDatabase();
    
    // Get last 30 days of rake data
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const rakeData = db.prepare(`
      SELECT 
        date(created_at / 1000, 'unixepoch') as day,
        game_type,
        COALESCE(SUM(amount), 0) as total_rake,
        COUNT(*) as game_count
      FROM rake_log
      WHERE created_at >= ? AND currency = 'SOL'
      GROUP BY day, game_type
      ORDER BY day DESC, game_type
    `).all(thirtyDaysAgo);
    
    // Format into daily breakdown
    const dailyBreakdown: Record<string, any> = {};
    
    for (const row of rakeData) {
      if (!dailyBreakdown[row.day]) {
        dailyBreakdown[row.day] = {
          date: row.day,
          poker: 0,
          coinflip: 0,
          rps: 0,
          total: 0,
          games: 0
        };
      }
      
      dailyBreakdown[row.day][row.game_type] = row.total_rake;
      dailyBreakdown[row.day].total += row.total_rake;
      dailyBreakdown[row.day].games += row.game_count;
    }
    
    // Convert to array and sort by date
    const result = Object.values(dailyBreakdown).sort((a: any, b: any) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    res.json({
      days: result,
      summary: {
        total_rake_30d: result.reduce((sum: number, day: any) => sum + day.total, 0),
        total_games_30d: result.reduce((sum: number, day: any) => sum + day.games, 0),
        avg_daily_rake: result.length > 0 
          ? result.reduce((sum: number, day: any) => sum + day.total, 0) / result.length 
          : 0
      }
    });
  } catch (err) {
    console.error('Admin rake daily error:', err);
    res.status(500).json({ error: 'Failed to fetch rake data' });
  }
});

export default router;
