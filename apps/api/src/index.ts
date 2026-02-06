import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { initDatabase, db } from './db';
import { solanaService } from './solana';
import { PokerGame } from '@clawcasino/poker-engine';
import crypto from 'crypto';

// Import routes
import authRoutes from './routes/auth';
import statsRoutes from './routes/stats';
import userRoutes from './routes/users';
import agentRoutes from './routes/agents';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Security
app.use(helmet());
app.use(cors());
app.use(rateLimit({ windowMs: 60000, max: 100 }));
app.use(express.json());

// In-memory game storage
const tables = new Map<string, PokerGame>();
const agents = new Map<string, { 
  id: string; 
  username: string; 
  apiKey: string; 
  balance: number;
  solanaAddress?: string;
  solanaSeed?: string;
}>();

// Initialize default tables
function initDefaultTables() {
  const defaultTables = [
    { id: 'micro-grind', name: 'Micro Grind', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2 },
    { id: 'low-stakes', name: 'Low Stakes', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5 },
    { id: 'mid-stakes', name: 'Mid Stakes', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2, maxBuyin: 20 },
    { id: 'high-roller', name: 'High Roller', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10, maxBuyin: 100 },
    { id: 'degen-table', name: 'Degen Table', smallBlind: 1, bigBlind: 2, minBuyin: 50, maxBuyin: 500 }
  ];

  for (const tableConfig of defaultTables) {
    tables.set(tableConfig.id, new PokerGame(
      tableConfig.id,
      tableConfig.smallBlind,
      tableConfig.bigBlind,
      tableConfig.minBuyin,
      tableConfig.maxBuyin
    ));
    
    db.prepare('INSERT OR IGNORE INTO tables (id, name, small_blind, big_blind, min_buyin, max_buyin) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tableConfig.id, tableConfig.name, tableConfig.smallBlind, tableConfig.bigBlind, tableConfig.minBuyin, tableConfig.maxBuyin);
  }
  
  console.log('✅ Default tables initialized');
}

// Load existing agents
function loadAgents() {
  const rows = db.prepare('SELECT * FROM agents').all() as any[];
  for (const row of rows) {
    agents.set(row.id, {
      id: row.id,
      username: row.username,
      apiKey: row.api_key,
      balance: row.balance,
      solanaAddress: row.solana_address,
      solanaSeed: row.solana_seed
    });
  }
  console.log(`✅ Loaded ${agents.size} agents`);
}

// Auth middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  if (!apiKey) {
    return res.status(401).json({ error: 'unauthorized', message: 'API key required' });
  }
  
  const agent = Array.from(agents.values()).find(a => a.apiKey === apiKey);
  if (!agent) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
  }
  
  (req as any).agent = agent;
  next();
}

// Routes

// Register
app.post('/api/register', async (req, res) => {
  const { username } = req.body;
  
  if (!username || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'invalid_username', message: 'Username must be 3-30 characters' });
  }
  
  const existing = db.prepare('SELECT id FROM agents WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'username_taken', message: 'Username already taken' });
  }
  
  const agentId = `agent_${crypto.randomUUID()}`;
  const apiKey = `ak_${crypto.randomBytes(32).toString('hex')}`;
  
  // Generate Solana deposit address
  const { address, seed } = solanaService.generateDepositAddress(agentId);
  
  db.prepare('INSERT INTO agents (id, username, api_key, solana_address, solana_seed) VALUES (?, ?, ?, ?, ?)')
    .run(agentId, username, apiKey, address, seed);
  
  agents.set(agentId, { 
    id: agentId, 
    username, 
    apiKey, 
    balance: 0,
    solanaAddress: address,
    solanaSeed: seed
  });
  
  // Check Solana connection
  const solanaStatus = await solanaService.getConnectionStatus();
  
  res.status(201).json({
    agent_id: agentId,
    api_key: apiKey,
    deposit_address: address,
    network: process.env.SOLANA_NETWORK || 'devnet',
    solana_connected: solanaStatus.connected
  });
});

// Wallet
app.get('/api/wallet', requireAuth, async (req, res) => {
  const agent = (req as any).agent;
  const row = db.prepare('SELECT balance, solana_address, deposit_slot_checked FROM agents WHERE id = ?').get(agent.id) as any;
  
  // Check for pending deposits
  let pendingDeposits = 0;
  if (agent.solanaAddress) {
    const { deposits, currentSlot } = await solanaService.checkForDeposits(
      agent.solanaAddress,
      row?.deposit_slot_checked
    );
    
    if (deposits.length > 0) {
      pendingDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
      
      // Update last checked slot
      db.prepare('UPDATE agents SET deposit_slot_checked = ? WHERE id = ?')
        .run(currentSlot, agent.id);
      
      // Record pending deposits
      for (const deposit of deposits) {
        const txId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO transactions (id, agent_id, type, amount, balance_after, solana_signature, solana_address, status) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(txId, agent.id, 'deposit', deposit.amount, agent.balance + deposit.amount, 
               deposit.signature, agent.solanaAddress, 'pending');
      }
    }
  }
  
  res.json({ 
    balance: row?.balance || 0,
    solana_address: agent.solanaAddress,
    pending_deposits: pendingDeposits,
    pending_withdrawals: 0
  });
});

// Get deposit address
app.get('/api/wallet/deposit', requireAuth, (req, res) => {
  const agent = (req as any).agent;
  
  res.json({
    address: agent.solanaAddress,
    network: process.env.SOLANA_NETWORK || 'devnet',
    instructions: `Send SOL to ${agent.solanaAddress}. Deposits are credited after 1 confirmation.`,
    min_deposit: 0.001,
    confirmation_required: 1
  });
});

// Check and confirm deposits
app.post('/api/wallet/check-deposits', requireAuth, async (req, res) => {
  const agent = (req as any).agent;
  
  if (!agent.solanaAddress) {
    return res.status(400).json({ error: 'no_address', message: 'No deposit address found' });
  }
  
  const row = db.prepare('SELECT deposit_slot_checked FROM agents WHERE id = ?').get(agent.id) as any;
  const lastChecked = row?.deposit_slot_checked || 0;
  
  const { deposits, currentSlot } = await solanaService.checkForDeposits(agent.solanaAddress, lastChecked);
  
  let totalCredited = 0;
  
  for (const deposit of deposits) {
    // Credit the deposit
    const currentBalance = db.prepare('SELECT balance FROM agents WHERE id = ?').get(agent.id) as any;
    const newBalance = (currentBalance?.balance || 0) + deposit.amount;
    
    db.prepare('UPDATE agents SET balance = ? WHERE id = ?').run(newBalance, agent.id);
    
    // Record transaction
    db.prepare(`
      INSERT INTO transactions (id, agent_id, type, amount, balance_after, solana_signature, solana_address, status, confirmed_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      agent.id,
      'deposit',
      deposit.amount,
      newBalance,
      deposit.signature,
      agent.solanaAddress,
      'confirmed',
      new Date(deposit.timestamp).toISOString()
    );
    
    totalCredited += deposit.amount;
    
    // Update agent in memory
    const agentData = agents.get(agent.id);
    if (agentData) {
      agentData.balance = newBalance;
    }
  }
  
  // Update last checked slot
  db.prepare('UPDATE agents SET deposit_slot_checked = ? WHERE id = ?')
    .run(currentSlot, agent.id);
  
  res.json({
    success: true,
    deposits_found: deposits.length,
    total_credited: totalCredited,
    new_balance: (db.prepare('SELECT balance FROM agents WHERE id = ?').get(agent.id) as any)?.balance || 0,
    transactions: deposits.map(d => ({
      signature: d.signature,
      amount: d.amount,
      timestamp: d.timestamp
    }))
  });
});

// Request airdrop (devnet only)
app.post('/api/wallet/airdrop', requireAuth, async (req, res) => {
  const { amount = 1 } = req.body;
  const agent = (req as any).agent;
  
  if (!agent.solanaAddress) {
    return res.status(400).json({ error: 'no_address', message: 'No Solana address' });
  }
  
  if (process.env.SOLANA_NETWORK === 'mainnet-beta') {
    return res.status(403).json({ error: 'not_allowed', message: 'Airdrops not available on mainnet' });
  }
  
  const success = await solanaService.requestAirdrop(agent.solanaAddress, amount);
  
  if (success) {
    res.json({
      success: true,
      message: `Airdropped ${amount} SOL to your address`,
      address: agent.solanaAddress,
      note: 'Use /api/wallet/check-deposits to credit after confirmation'
    });
  } else {
    res.status(500).json({ error: 'airdrop_failed', message: 'Airdrop failed - try again later' });
  }
});

// Withdraw
app.post('/api/wallet/withdraw', requireAuth, async (req, res) => {
  const { amount, address } = req.body;
  const agent = (req as any).agent;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Amount must be positive' });
  }
  
  if (!address) {
    return res.status(400).json({ error: 'invalid_address', message: 'Withdrawal address required' });
  }
  
  if (agent.balance < amount) {
    return res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
  }
  
  // Process withdrawal on-chain
  const result = await solanaService.processWithdrawal(address, amount);
  
  if (!result.success) {
    return res.status(500).json({ 
      error: 'withdrawal_failed', 
      message: result.error || 'Withdrawal failed' 
    });
  }
  
  // Deduct from balance
  const newBalance = agent.balance - amount;
  db.prepare('UPDATE agents SET balance = ? WHERE id = ?').run(newBalance, agent.id);
  
  // Record transaction
  db.prepare(`
    INSERT INTO transactions (id, agent_id, type, amount, balance_after, solana_signature, solana_address, status, confirmed_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    agent.id,
    'withdrawal',
    -amount,
    newBalance,
    result.signature,
    address,
    'confirmed',
    new Date().toISOString()
  );
  
  // Update agent in memory
  agent.balance = newBalance;
  
  res.json({
    success: true,
    amount,
    to_address: address,
    signature: result.signature,
    new_balance: newBalance,
    explorer_url: `https://explorer.solana.com/tx/${result.signature}?cluster=${process.env.SOLANA_NETWORK || 'devnet'}`
  });
});

// Get transaction history
app.get('/api/wallet/transactions', requireAuth, (req, res) => {
  const agent = (req as any).agent;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  
  const transactions = db.prepare(`
    SELECT id, type, amount, solana_signature, status, created_at, confirmed_at
    FROM transactions
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agent.id, limit);
  
  res.json({
    transactions: transactions || [],
    count: (transactions || []).length
  });
});

// Tables (Lobby)
app.get('/api/tables', (req, res) => {
  const result: any[] = [];
  
  for (const [id, game] of tables) {
    const info = game.getTableInfo();
    result.push({
      id,
      name: id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      small_blind: info.smallBlind,
      big_blind: info.bigBlind,
      min_buyin: info.minBuyin,
      max_buyin: info.maxBuyin,
      player_count: info.playerCount,
      max_players: 6
    });
  }
  
  res.json({ tables: result });
});

app.get('/api/tables/:id', (req, res) => {
  const table = tables.get(req.params.id);
  if (!table) {
    return res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
  }
  
  const info = table.getTableInfo();
  const state = table.getState();
  
  res.json({
    id: req.params.id,
    ...info,
    players: state.players.map(p => ({
      seat: p.seat,
      username: p.username,
      chips: p.chips,
      status: p.status
    }))
  });
});

// Play
app.post('/api/tables/:id/join', requireAuth, async (req, res) => {
  const { buyin } = req.body;
  const table = tables.get(req.params.id);
  const agent = (req as any).agent;
  
  if (!table) {
    return res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
  }
  
  if (agent.balance < buyin) {
    return res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance for buyin' });
  }
  
  const result = table.joinTable(agent.id, agent.username, buyin);
  if (!result.success) {
    return res.status(400).json({ error: 'join_failed', message: result.error });
  }
  
  // Deduct from balance
  const newBalance = agent.balance - buyin;
  db.prepare('UPDATE agents SET balance = ? WHERE id = ?').run(newBalance, agent.id);
  db.prepare('INSERT INTO transactions (id, agent_id, type, amount, balance_after, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), agent.id, 'buyin', -buyin, newBalance, 'confirmed');
  
  agent.balance = newBalance;
  
  // Add to table_players
  db.prepare('INSERT OR REPLACE INTO table_players (table_id, agent_id, seat, chips) VALUES (?, ?, ?, ?)')
    .run(req.params.id, agent.id, result.player!.seat, buyin);
  
  res.json({ success: true, seat: result.player!.seat });
});

app.post('/api/tables/:id/leave', requireAuth, (req, res) => {
  const table = tables.get(req.params.id);
  const agent = (req as any).agent;
  
  if (!table) {
    return res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
  }
  
  const result = table.leaveTable(agent.id);
  if (!result.success) {
    return res.status(400).json({ error: 'leave_failed', message: result.error });
  }
  
  // Return chips to balance
  const cashout = result.cashoutAmount!;
  const newBalance = agent.balance + cashout;
  db.prepare('UPDATE agents SET balance = ? WHERE id = ?').run(newBalance, agent.id);
  db.prepare('INSERT INTO transactions (id, agent_id, type, amount, balance_after, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), agent.id, 'cashout', cashout, newBalance, 'confirmed');
  
  agent.balance = newBalance;
  
  // Remove from table_players
  db.prepare('DELETE FROM table_players WHERE table_id = ? AND agent_id = ?').run(req.params.id, agent.id);
  
  res.json({ success: true, cashed_out: cashout, balance: newBalance });
});

app.post('/api/tables/:id/action', requireAuth, (req, res) => {
  const { action, amount } = req.body;
  const table = tables.get(req.params.id);
  const agent = (req as any).agent;
  
  if (!table) {
    return res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
  }
  
  const result = table.performAction(agent.id, action, amount);
  if (!result.success) {
    return res.status(400).json({ error: 'action_failed', message: result.error });
  }
  
  res.json({ success: true, state: result.state });
});

app.get('/api/tables/:id/state', requireAuth, (req, res) => {
  const table = tables.get(req.params.id);
  const agent = (req as any).agent;
  
  if (!table) {
    return res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
  }
  
  const view = table.getPlayerView(agent.id);
  if (!view) {
    return res.status(403).json({ error: 'not_at_table', message: 'You are not seated at this table' });
  }
  
  res.json(view);
});

// History
app.get('/api/hands/:id', (req, res) => {
  const hand = db.prepare('SELECT * FROM hands WHERE id = ?').get(req.params.id);
  if (!hand) {
    return res.status(404).json({ error: 'hand_not_found', message: 'Hand not found' });
  }
  
  const actions = db.prepare('SELECT * FROM hand_actions WHERE hand_id = ? ORDER BY timestamp').all(req.params.id);
  
  res.json({ ...hand, actions });
});

// Agent stats
app.get('/api/agent/me', requireAuth, (req, res) => {
  const agent = (req as any).agent;
  const stats = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
  
  const winRate = stats.hands_played > 0 ? (stats.hands_won / stats.hands_played * 100).toFixed(1) : 0;
  
  res.json({
    ...stats,
    solana_address: agent.solanaAddress,
    win_rate: `${winRate}%`
  });
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const topAgents = db.prepare(`
    SELECT username, total_profit, games_played, biggest_pot_won 
    FROM agents 
    WHERE games_played > 0 
    ORDER BY total_profit DESC 
    LIMIT 50
  `).all();
  
  res.json({ leaderboard: topAgents });
});

// Feed
app.get('/api/feed', (req, res) => {
  const recentHands = db.prepare(`
    SELECT h.id, h.pot, h.rake, h.community_cards, h.started_at, 
           a.username as winner_name
    FROM hands h
    LEFT JOIN agents a ON h.winner_id = a.id
    ORDER BY h.started_at DESC
    LIMIT 50
  `).all();
  
  res.json({ hands: recentHands });
});

// Solana status
app.get('/api/solana/status', async (req, res) => {
  const status = await solanaService.getConnectionStatus();
  res.json({
    ...status,
    network: process.env.SOLANA_NETWORK || 'devnet',
    rpc_url: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  });
});

// Health
app.get('/health', async (req, res) => {
  const solanaStatus = await solanaService.getConnectionStatus();
  res.json({ 
    status: 'ok', 
    tables: tables.size, 
    agents: agents.size,
    solana: {
      connected: solanaStatus.connected,
      network: process.env.SOLANA_NETWORK || 'devnet',
      house_balance: solanaStatus.houseBalance
    }
  });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/agent', agentRoutes);

// WebSocket
wss.on('connection', (ws) => {
  console.log('WebSocket connected');
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'subscribe' && msg.table_id) {
      ws.send(JSON.stringify({ type: 'subscribed', table_id: msg.table_id }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket disconnected');
  });
});

// Initialize
initDatabase();
loadAgents();
initDefaultTables();

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`🦀 ClawCasino Poker API running on port ${PORT}`);
  console.log(`🃏 Tables: ${tables.size}`);
  console.log(`👥 Agents: ${agents.size}`);
  
  const solanaStatus = await solanaService.getConnectionStatus();
  console.log(`⛓️  Solana: ${solanaStatus.connected ? '✅ Connected' : '❌ Disconnected'}`);
  console.log(`🏦 House Balance: ${solanaStatus.houseBalance.toFixed(4)} SOL`);
});