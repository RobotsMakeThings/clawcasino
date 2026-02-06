import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { db } from '../db';
import { runBackgroundJobs } from '../cron';

const router = Router();

// Main admin dashboard
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 24 * 60 * 60;
    const weekAgo = now - 7 * 24 * 60 * 60;
    const monthAgo = now - 30 * 24 * 60 * 60;

    // Total agents
    const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as any;

    // Agents online (active sessions)
    const agentsOnline = db.prepare(`
      SELECT COUNT(DISTINCT id) as count FROM agents 
      WHERE last_active_at > ?
    `).get(now - 300).get() as any; // 5 min

    // Active tables with players
    const activeTables = db.prepare(`
      SELECT COUNT(DISTINCT table_id) as count FROM poker_players
    `).get() as any;

    // Rake stats
    const rakeToday = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM rake_log WHERE created_at > ?
    `).get(dayAgo) as any;

    const rakeWeek = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM rake_log WHERE created_at > ?
    `).get(weekAgo) as any;

    const rakeMonth = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM rake_log WHERE created_at > ?
    `).get(monthAgo) as any;

    const rakeAllTime = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM rake_log
    `).get() as any;

    // Game counts today
    const gamesToday = db.prepare(`
      SELECT 
        game_type,
        COUNT(*) as count
      FROM rake_log WHERE created_at > ?
      GROUP BY game_type
    `).all(dayAgo) as any[];

    // Top tables by rake today
    const topTables = db.prepare(`
      SELECT 
        pt.name,
        pt.currency,
        SUM(ph.rake) as total_rake,
        COUNT(ph.id) as hands_played
      FROM poker_hands ph
      JOIN poker_tables pt ON ph.table_id = pt.id
      WHERE ph.finished_at > ?
      GROUP BY ph.table_id
      ORDER BY total_rake DESC
      LIMIT 5
    `).all(dayAgo) as any[];

    // Top agents by volume today
    const topAgents = db.prepare(`
      SELECT 
        a.display_name,
        a.wallet_address,
        COUNT(DISTINCT t.id) as games_played,
        SUM(CASE WHEN t.type LIKE '%win%' THEN t.amount ELSE 0 END) as winnings
      FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      WHERE t.created_at > ? AND t.type IN ('coinflip_win', 'coinflip_loss', 'rps_win', 'rps_loss')
      GROUP BY t.agent_id
      ORDER BY games_played DESC
      LIMIT 5
    `).all(dayAgo) as any[];

    // Hourly rake chart (last 24 hours)
    const hourlyRake = db.prepare(`
      SELECT 
        strftime('%H', datetime(created_at, 'unixepoch')) as hour,
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM rake_log WHERE created_at > ?
      GROUP BY hour
      ORDER BY hour
    `).all(dayAgo) as any[];

    res.json({
      overview: {
        totalAgents: totalAgents.count,
        agentsOnline: agentsOnline?.count || 0,
        activeTables: activeTables.count,
        gamesToday: gamesToday.reduce((sum, g) => sum + g.count, 0)
      },
      rake: {
        today: { sol: rakeToday?.sol || 0, usdc: rakeToday?.usdc || 0 },
        thisWeek: { sol: rakeWeek?.sol || 0, usdc: rakeWeek?.usdc || 0 },
        thisMonth: { sol: rakeMonth?.sol || 0, usdc: rakeMonth?.usdc || 0 },
        allTime: { sol: rakeAllTime?.sol || 0, usdc: rakeAllTime?.usdc || 0 }
      },
      topTables: topTables.map(t => ({
        name: t.name,
        currency: t.currency,
        totalRake: t.total_rake,
        handsPlayed: t.hands_played
      })),
      topAgents: topAgents.map(a => ({
        name: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
        gamesPlayed: a.games_played,
        winnings: a.winnings
      })),
      hourlyRake: hourlyRake.map(h => ({
        hour: parseInt(h.hour),
        sol: h.sol || 0,
        usdc: h.usdc || 0
      }))
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// All agents
router.get('/agents', requireAdmin, (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT id, wallet_address, display_name, balance_sol, balance_usdc, 
             games_played, total_profit, created_at
      FROM agents
      ORDER BY created_at DESC
    `).all();

    res.json({ agents });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load agents' });
  }
});

// Recent transactions
router.get('/transactions', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    const transactions = db.prepare(`
      SELECT t.*, a.display_name, a.wallet_address
      FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// Rake by game type
router.get('/rake/by-game', requireAdmin, (req, res) => {
  try {
    const rakeByGame = db.prepare(`
      SELECT 
        game_type,
        SUM(amount) as total_rake,
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol_rake,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc_rake,
        COUNT(*) as game_count
      FROM rake_log
      GROUP BY game_type
    `).all();

    res.json({ rakeByGame });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load rake data' });
  }
});

// Math invariant audit
router.get('/audit', requireAdmin, (req, res) => {
  try {
    // total_money_deposited = sum(all_agent_balances) + sum(all_chips_on_tables) + sum(all_rake_collected) + sum(all_withdrawals)
    
    // 1. Sum all agent balances (SOL and USDC)
    const agentBalances = db.prepare(`
      SELECT SUM(balance_sol) as sol, SUM(balance_usdc) as usdc FROM agents
    `).get() as any;

    // 2. Sum all chips on tables
    const tableBalances = db.prepare(`
      SELECT SUM(chips) as chips FROM poker_players
    `).get() as any;

    // 3. Sum all rake collected
    const rake = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol_rake,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc_rake
      FROM rake_log
    `).get() as any;

    // 4. Sum all deposits (in)
    const deposits = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' AND amount > 0 THEN amount ELSE 0 END) as sol_deposits,
        SUM(CASE WHEN currency = 'USDC' AND amount > 0 THEN amount ELSE 0 END) as usdc_deposits
      FROM transactions
      WHERE type = 'deposit'
    `).get() as any;

    // 5. Sum all withdrawals (out)
    const withdrawals = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' AND amount > 0 THEN amount ELSE 0 END) as sol_withdrawals,
        SUM(CASE WHEN currency = 'USDC' AND amount > 0 THEN amount ELSE 0 END) as usdc_withdrawals
      FROM transactions
      WHERE type = 'withdrawal'
    `).get() as any;

    // Calculate expected balance
    const solExpected = (deposits.sol_deposits || 0) - (withdrawals.sol_withdrawals || 0);
    const usdcExpected = (deposits.usdc_deposits || 0) - (withdrawals.usdc_withdrawals || 0);

    // Calculate actual balance (held by system)
    const solActual = (agentBalances.sol || 0) + (tableBalances.chips || 0) + (rake.sol_rake || 0);
    const usdcActual = (agentBalances.usdc || 0) + (rake.usdc_rake || 0); // USDC not used for poker chips yet

    res.json({
      audit: {
        sol: {
          expected: solExpected,
          actual: solActual,
          difference: solActual - solExpected,
          balanced: Math.abs(solActual - solExpected) < 0.0001
        },
        usdc: {
          expected: usdcExpected,
          actual: usdcActual,
          difference: usdcActual - usdcExpected,
          balanced: Math.abs(usdcActual - usdcExpected) < 0.0001
        }
      },
      breakdown: {
        agentBalances: { sol: agentBalances.sol || 0, usdc: agentBalances.usdc || 0 },
        tableBalances: { chips: tableBalances.chips || 0 },
        rakeCollected: { sol: rake.sol_rake || 0, usdc: rake.usdc_rake || 0 },
        deposits: { sol: deposits.sol_deposits || 0, usdc: deposits.usdc_deposits || 0 },
        withdrawals: { sol: withdrawals.sol_withdrawals || 0, usdc: withdrawals.usdc_withdrawals || 0 }
      },
      passed: Math.abs(solActual - solExpected) < 0.0001 && Math.abs(usdcActual - usdcExpected) < 0.0001
    });
  } catch (error) {
    res.status(500).json({ error: 'Audit failed' });
  }
});

// Trigger background jobs
router.post('/cron/run', requireAdmin, (req, res) => {
  try {
    runBackgroundJobs();
    res.json({ success: true, message: 'Background jobs executed' });
  } catch (error) {
    res.status(500).json({ error: 'Cron failed' });
  }
});

export default router;
