import { Router } from 'express';
import { db } from '../db';

const router = Router();
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY) {
  console.warn('⚠️ ADMIN_API_KEY not set - admin routes will be disabled');
}

// Admin auth middleware
function requireAdmin(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authorization required' });
  }

  const token = authHeader.slice(7);
  
  if (token !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  next();
}

// Main dashboard
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Total agents
    const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get() as any;

    // Agents online (active in last 5 minutes)
    const fiveMinAgo = now - 5 * 60 * 1000;
    const agentsOnline = db.prepare(`
      SELECT COUNT(DISTINCT agent_id) as count 
      FROM user_sessions 
      WHERE expires_at > ?
    `).get(fiveMinAgo) as any;

    // Active tables (with players)
    const activeTables = db.prepare(`
      SELECT COUNT(DISTINCT table_id) as count 
      FROM table_players 
      WHERE status = 'active'
    `).get() as any;

    // Rake stats
    const rakeToday = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM transactions 
      WHERE type = 'rake' AND created_at > ?
    `).get(dayAgo) as any;

    const rakeWeek = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM transactions 
      WHERE type = 'rake' AND created_at > ?
    `).get(weekAgo) as any;

    const rakeMonth = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM transactions 
      WHERE type = 'rake' AND created_at > ?
    `).get(monthAgo) as any;

    const rakeAllTime = db.prepare(`
      SELECT 
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM transactions 
      WHERE type = 'rake'
    `).get() as any;

    // House wallet balances from game_stats
    const houseStats = db.prepare('SELECT * FROM game_stats WHERE id = 1').get() as any;

    // Hands today
    const handsToday = db.prepare(`
      SELECT COUNT(*) as count FROM hands WHERE started_at > ?
    `).get(dayAgo) as any;

    // Average pot size and rake per hand (today)
    const avgStats = db.prepare(`
      SELECT 
        AVG(pot) as avg_pot,
        AVG(rake) as avg_rake
      FROM hands 
      WHERE started_at > ?
    `).get(dayAgo) as any;

    // Top tables by rake (today)
    const topTables = db.prepare(`
      SELECT 
        t.name,
        t.currency,
        SUM(h.rake) as total_rake,
        COUNT(h.id) as hands_played
      FROM hands h
      JOIN tables t ON h.table_id = t.id
      WHERE h.started_at > ?
      GROUP BY h.table_id
      ORDER BY total_rake DESC
      LIMIT 10
    `).all(dayAgo) as any[];

    // Top agents by volume (today)
    const topAgents = db.prepare(`
      SELECT 
        a.display_name,
        a.wallet_address,
        COUNT(DISTINCT ha.hand_id) as hands_played,
        SUM(CASE WHEN ha.action IN ('raise', 'call', 'all_in') THEN ha.amount ELSE 0 END) as volume
      FROM hand_actions ha
      JOIN agents a ON ha.agent_id = a.id
      JOIN hands h ON ha.hand_id = h.id
      WHERE h.started_at > ?
      GROUP BY ha.agent_id
      ORDER BY volume DESC
      LIMIT 10
    `).all(dayAgo) as any[];

    // Hourly rake chart (last 24 hours)
    const hourlyRake = db.prepare(`
      SELECT 
        strftime('%H', datetime(created_at/1000, 'unixepoch')) as hour,
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc
      FROM transactions 
      WHERE type = 'rake' AND created_at > ?
      GROUP BY hour
      ORDER BY hour
    `).all(dayAgo) as any[];

    res.json({
      overview: {
        totalAgents: totalAgents.count,
        agentsOnline: agentsOnline.count,
        activeTables: activeTables.count,
        handsToday: handsToday.count
      },
      rake: {
        today: { sol: rakeToday.sol || 0, usdc: rakeToday.usdc || 0 },
        thisWeek: { sol: rakeWeek.sol || 0, usdc: rakeWeek.usdc || 0 },
        thisMonth: { sol: rakeMonth.sol || 0, usdc: rakeMonth.usdc || 0 },
        allTime: { sol: rakeAllTime.sol || 0, usdc: rakeAllTime.usdc || 0 }
      },
      houseWallet: {
        solBalance: houseStats?.total_rake_sol || 0,
        usdcBalance: houseStats?.total_rake_usdc || 0
      },
      averages: {
        avgPotSize: avgStats?.avg_pot || 0,
        avgRakePerHand: avgStats?.avg_rake || 0
      },
      topTables: topTables.map(t => ({
        name: t.name,
        currency: t.currency,
        totalRake: t.total_rake,
        handsPlayed: t.hands_played
      })),
      topAgents: topAgents.map(a => ({
        name: a.display_name || `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
        handsPlayed: a.hands_played,
        volume: a.volume
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

// Daily rake (last 30 days)
router.get('/rake/daily', requireAdmin, (req, res) => {
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    const dailyRake = db.prepare(`
      SELECT 
        date(datetime(created_at/1000, 'unixepoch')) as date,
        SUM(CASE WHEN currency = 'SOL' THEN amount ELSE 0 END) as sol,
        SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END) as usdc,
        COUNT(*) as transactions
      FROM transactions 
      WHERE type = 'rake' AND created_at > ?
      GROUP BY date
      ORDER BY date DESC
    `).all(thirtyDaysAgo) as any[];

    res.json({ dailyRake });
  } catch (error) {
    console.error('Daily rake error:', error);
    res.status(500).json({ error: 'Failed to load daily rake' });
  }
});

// Rake by table
router.get('/rake/by-table', requireAdmin, (req, res) => {
  try {
    const rakeByTable = db.prepare(`
      SELECT 
        t.id,
        t.name,
        t.currency,
        t.small_blind,
        t.big_blind,
        SUM(h.rake) as total_rake,
        SUM(h.pot) as total_pot,
        COUNT(h.id) as hands_played,
        AVG(h.rake) as avg_rake,
        AVG(h.pot) as avg_pot
      FROM hands h
      JOIN tables t ON h.table_id = t.id
      GROUP BY t.id
      ORDER BY total_rake DESC
    `).all() as any[];

    res.json({ tables: rakeByTable });
  } catch (error) {
    console.error('Rake by table error:', error);
    res.status(500).json({ error: 'Failed to load table rake' });
  }
});

// All agents
router.get('/agents', requireAdmin, (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT 
        id,
        wallet_address,
        display_name,
        balance_sol,
        balance_usdc,
        games_played,
        hands_played,
        hands_won,
        total_profit,
        biggest_pot_won,
        created_at,
        last_active_at
      FROM agents
      ORDER BY balance_sol + balance_usdc DESC
    `).all() as any[];

    res.json({ 
      agents: agents.map(a => ({
        id: a.id,
        walletAddress: a.wallet_address,
        displayName: a.display_name,
        shortAddress: `${a.wallet_address.slice(0, 4)}...${a.wallet_address.slice(-4)}`,
        balances: { sol: a.balance_sol, usdc: a.balance_usdc },
        stats: {
          gamesPlayed: a.games_played,
          handsPlayed: a.hands_played,
          handsWon: a.hands_won,
          totalProfit: a.total_profit,
          biggestWin: a.biggest_pot_won,
          winRate: a.hands_played > 0 ? (a.hands_won / a.hands_played * 100).toFixed(1) : 0
        },
        createdAt: a.created_at,
        lastActiveAt: a.last_active_at
      }))
    });
  } catch (error) {
    console.error('Agents list error:', error);
    res.status(500).json({ error: 'Failed to load agents' });
  }
});

// Recent withdrawals
router.get('/withdrawals', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    const withdrawals = db.prepare(`
      SELECT 
        t.*,
        a.display_name,
        a.wallet_address
      FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      WHERE t.type = 'withdrawal'
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    res.json({ 
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        agent: {
          displayName: w.display_name,
          shortAddress: `${w.wallet_address.slice(0, 4)}...${w.wallet_address.slice(-4)}`
        },
        currency: w.currency,
        amount: w.amount,
        destination: w.to_address,
        txSignature: w.tx_signature,
        status: w.status,
        createdAt: w.created_at
      }))
    });
  } catch (error) {
    console.error('Withdrawals error:', error);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

// Create new table
router.post('/tables/create', requireAdmin, (req, res) => {
  try {
    const { id, name, currency, smallBlind, bigBlind, minBuyin, maxBuyin } = req.body;

    if (!id || !name || !currency || !smallBlind || !bigBlind || !minBuyin || !maxBuyin) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['SOL', 'USDC'].includes(currency)) {
      return res.status(400).json({ error: 'Currency must be SOL or USDC' });
    }

    db.prepare(`
      INSERT INTO tables (id, name, small_blind, big_blind, min_buyin, max_buyin, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, smallBlind, bigBlind, minBuyin, maxBuyin, currency);

    res.json({ 
      success: true, 
      message: 'Table created',
      table: { id, name, currency, smallBlind, bigBlind, minBuyin, maxBuyin }
    });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Failed to create table' });
  }
});

// Close table
router.post('/tables/:id/close', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    // Mark table as closed
    db.prepare(`
      UPDATE tables SET status = 'closed' WHERE id = ?
    `).run(id);

    res.json({ success: true, message: 'Table closed' });
  } catch (error) {
    console.error('Close table error:', error);
    res.status(500).json({ error: 'Failed to close table' });
  }
});

// Recent transactions
router.get('/transactions', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const type = req.query.type as string;

    let query = `
      SELECT 
        t.*,
        a.display_name,
        a.wallet_address
      FROM transactions t
      JOIN agents a ON t.agent_id = a.id
    `;
    
    const params: any[] = [];
    
    if (type) {
      query += ' WHERE t.type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(limit);

    const transactions = db.prepare(query).all(...params) as any[];

    res.json({ transactions });
  } catch (error) {
    console.error('Transactions error:', error);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

export default router;
