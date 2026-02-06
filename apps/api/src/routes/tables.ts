import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { PokerGame, Currency, calculateRake } from '@clawcasino/poker-engine';
import { db } from '../db';
import crypto from 'crypto';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

// Table configurations
const DEFAULT_TABLES = [
  // SOL tables
  { id: 'sol-nano', name: 'Nano Grind', currency: 'SOL', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2 },
  { id: 'sol-micro', name: 'Micro Stakes', currency: 'SOL', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5 },
  { id: 'sol-low', name: 'Low Stakes', currency: 'SOL', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2, maxBuyin: 20 },
  { id: 'sol-mid', name: 'Mid Stakes', currency: 'SOL', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10, maxBuyin: 100 },
  { id: 'sol-high', name: 'High Roller', currency: 'SOL', smallBlind: 1.00, bigBlind: 2.00, minBuyin: 50, maxBuyin: 500 },
  { id: 'sol-degen', name: 'Degen Table', currency: 'SOL', smallBlind: 5.00, bigBlind: 10.00, minBuyin: 200, maxBuyin: 2000 },
  // USDC tables
  { id: 'usdc-micro', name: 'USDC Micro', currency: 'USDC', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10, maxBuyin: 100 },
  { id: 'usdc-low', name: 'USDC Low', currency: 'USDC', smallBlind: 0.50, bigBlind: 1.00, minBuyin: 20, maxBuyin: 200 },
  { id: 'usdc-mid', name: 'USDC Mid', currency: 'USDC', smallBlind: 1.00, bigBlind: 2.00, minBuyin: 50, maxBuyin: 500 },
  { id: 'usdc-high', name: 'USDC High', currency: 'USDC', smallBlind: 2.50, bigBlind: 5.00, minBuyin: 100, maxBuyin: 1000 },
  { id: 'usdc-nosebleed', name: 'USDC Nosebleed', currency: 'USDC', smallBlind: 5.00, bigBlind: 10.00, minBuyin: 200, maxBuyin: 2000 },
];

// Active tables store
const tables = new Map<string, PokerGame>();

// Initialize tables
export function initTables(): void {
  // Load from DB or create defaults
  const existingTables = db.prepare('SELECT * FROM tables').all() as any[];
  
  if (existingTables.length === 0) {
    // Create default tables
    for (const config of DEFAULT_TABLES) {
      db.prepare(`
        INSERT INTO tables (id, name, small_blind, big_blind, min_buyin, max_buyin, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(config.id, config.name, config.smallBlind, config.bigBlind, config.minBuyin, config.maxBuyin, config.currency);
      
      tables.set(config.id, new PokerGame(
        config.id,
        config.smallBlind,
        config.bigBlind,
        config.minBuyin,
        config.maxBuyin,
        config.currency as Currency
      ));
    }
    console.log(`✅ Created ${DEFAULT_TABLES.length} default tables`);
  } else {
    // Load existing tables
    for (const row of existingTables) {
      tables.set(row.id, new PokerGame(
        row.id,
        row.small_blind,
        row.big_blind,
        row.min_buyin,
        row.max_buyin,
        row.currency as Currency
      ));
    }
    console.log(`✅ Loaded ${existingTables.length} tables`);
  }
}

// Auth middleware
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId);
    
    if (!agent) {
      return res.status(401).json({ error: 'Agent not found' });
    }

    req.agent = agent;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// List all tables
router.get('/', (req, res) => {
  const tableList = Array.from(tables.entries()).map(([id, game]) => {
    const players = game.getPlayers();
    const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(id) as any;
    
    return {
      id,
      name: config.name,
      currency: config.currency,
      smallBlind: config.small_blind,
      bigBlind: config.big_blind,
      minBuyin: config.min_buyin,
      maxBuyin: config.max_buyin,
      players: players.length,
      maxPlayers: 6,
      status: game.getPhase(),
      averageStack: players.length > 0 
        ? players.reduce((sum, p) => sum + p.chips, 0) / players.length 
        : 0
    };
  });

  res.json({ tables: tableList });
});

// Get table details
router.get('/:tableId', (req, res) => {
  const { tableId } = req.params;
  const game = tables.get(tableId);
  
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;
  const state = game.getState();

  res.json({
    ...state,
    name: config.name,
    currency: config.currency,
    minBuyin: config.min_buyin,
    maxBuyin: config.max_buyin
  });
});

// Join table (buy in)
router.post('/:tableId/join', requireAuth, async (req, res) => {
  const { tableId } = req.params;
  const { buyinAmount, seat } = req.body;
  const agent = req.agent;

  const game = tables.get(tableId);
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;
  
  // Validate buyin amount
  if (!buyinAmount || buyinAmount < config.min_buyin || buyinAmount > config.max_buyin) {
    return res.status(400).json({ 
      error: `Buyin must be between ${config.min_buyin} and ${config.max_buyin} ${config.currency}` 
    });
  }

  // Check balance
  const balanceField = config.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < buyinAmount) {
    return res.status(400).json({ 
      error: `Insufficient ${config.currency} balance. You have ${agent[balanceField]} ${config.currency}` 
    });
  }

  // Deduct from wallet balance
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`)
    .run(buyinAmount, agent.id);

  // Join table
  const result = game.joinTable(agent.id, agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`, buyinAmount, seat);

  if (!result.success) {
    // Refund if join failed
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`)
      .run(buyinAmount, agent.id);
    return res.status(400).json({ error: result.error });
  }

  // Log transaction
  const txId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (id, agent_id, type, currency, amount, note, status, created_at)
    VALUES (?, ?, 'buyin', ?, ?, ?, 'confirmed', ?)
  `).run(txId, agent.id, config.currency, buyinAmount, `Buyin to ${config.name}`, Date.now());

  // Update last active
  db.prepare('UPDATE agents SET last_active_at = ? WHERE id = ?').run(Date.now(), agent.id);

  res.json({
    success: true,
    seat: result.player!.seat,
    chips: result.player!.chips,
    tableState: game.getState(agent.id)
  });
});

// Leave table (cash out)
router.post('/:tableId/leave', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const agent = req.agent;

  const game = tables.get(tableId);
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;
  const result = game.leaveTable(agent.id);

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  // If we got remainingChips, credit them back to wallet
  if (result.remainingChips && result.remainingChips > 0) {
    const balanceField = config.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`)
      .run(result.remainingChips, agent.id);

    // Log transaction
    const txId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO transactions (id, agent_id, type, currency, amount, note, status, created_at)
      VALUES (?, ?, 'cashout', ?, ?, ?, 'confirmed', ?)
    `).run(txId, agent.id, config.currency, result.remainingChips, `Cashout from ${config.name}`, Date.now());
  }

  res.json({
    success: true,
    remainingChips: result.remainingChips || 0,
    message: result.message || 'Left table successfully'
  });
});

// Rebuy (add chips)
router.post('/:tableId/rebuy', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const { amount } = req.body;
  const agent = req.agent;

  const game = tables.get(tableId);
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;

  // Check balance
  const balanceField = config.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Try to add chips
  const result = game.addChips(agent.id, amount);

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  // Deduct from wallet
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`)
    .run(amount, agent.id);

  // Log transaction
  const txId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (id, agent_id, type, currency, amount, note, status, created_at)
    VALUES (?, ?, 'rebuy', ?, ?, ?, 'confirmed', ?)
  `).run(txId, agent.id, config.currency, amount, `Rebuy at ${config.name}`, Date.now());

  res.json({
    success: true,
    newBalance: result.newBalance
  });
});

// Start hand (dealer only)
router.post('/:tableId/start', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const game = tables.get(tableId);
  
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const result = game.startHand();
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, state: result.state });
});

// Perform action
router.post('/:tableId/action', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const { action, amount } = req.body;
  const agent = req.agent;

  const game = tables.get(tableId);
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const result = game.performAction(agent.id, action, amount);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  // Check if hand finished and process rake
  if (result.state?.phase === 'finished') {
    processHandEnd(tableId, game);
  }

  res.json({ success: true, state: result.state });
});

// Rake wallet address from env
const RAKE_WALLET_ADDRESS = process.env.RAKE_WALLET_ADDRESS || 'GnZpJXdYp3ZgW6BdY2EWogUZ9kU3RWd4bGqGn12ESbRy';

// Process hand end - calculate and collect rake
function processHandEnd(tableId: string, game: PokerGame): void {
  const handResults = game.getHandResults();
  if (!handResults) return;

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;
  const players = game.getPlayers();

  // Log hand
  const handId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO hands (id, table_id, hand_number, pot, rake, winner_id, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    handId,
    tableId,
    game.getState().handNumber,
    handResults.totalPot,
    handResults.rake,
    handResults.winners[0]?.playerId || null,
    Date.now() - 60000, // Approximate
    Date.now()
  );

  // If there was rake, credit to house and update stats
  if (handResults.rake > 0) {
    // Update house rake totals
    const rakeField = config.currency === 'SOL' ? 'total_rake_sol' : 'total_rake_usdc';
    db.prepare(`UPDATE game_stats SET ${rakeField} = ${rakeField} + ? WHERE id = 1`)
      .run(handResults.rake);

    // Log rake collection with destination wallet
    const rakeTxId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO transactions (id, agent_id, type, currency, amount, to_address, note, status, created_at)
      VALUES (?, 'HOUSE', 'rake', ?, ?, ?, ?, 'confirmed', ?)
    `).run(rakeTxId, config.currency, handResults.rake, RAKE_WALLET_ADDRESS, `Rake from ${config.name} hand`, Date.now());
  }

  // Update winner stats
  for (const winner of handResults.winners) {
    const player = players.find(p => p.id === winner.playerId);
    if (player) {
      db.prepare(`
        UPDATE agents SET 
          hands_won = hands_won + 1,
          hands_played = hands_played + 1,
          biggest_pot_won = MAX(biggest_pot_won, ?),
          total_profit = total_profit + ?
        WHERE id = ?
      `).run(winner.amount, winner.amount, winner.playerId);
    }
  }

  // Update other players' hands played
  for (const player of players) {
    if (!handResults.winners.find(w => w.playerId === player.id)) {
      db.prepare('UPDATE agents SET hands_played = hands_played + 1 WHERE id = ?')
        .run(player.id);
    }
  }

  // Update total wagered
  const wageredField = config.currency === 'SOL' ? 'total_wagered_sol' : 'total_wagered_usdc';
  db.prepare(`UPDATE game_stats SET ${wageredField} = ${wageredField} + ?, total_hands = total_hands + 1 WHERE id = 1`)
    .run(handResults.totalPot);
}

// Get my state at table
router.get('/:tableId/state', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const agent = req.agent;

  const game = tables.get(tableId);
  if (!game) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const config = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId) as any;
  const player = game.getPlayer(agent.id);

  res.json({
    tableState: game.getState(agent.id),
    myPlayer: player ? {
      chips: player.chips,
      status: player.status,
      holeCards: player.holeCards,
      seat: player.seat
    } : null,
    currency: config.currency
  });
});

// Get hand history
router.get('/:tableId/history', (req, res) => {
  const { tableId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const hands = db.prepare(`
    SELECT h.*, a.display_name as winner_name
    FROM hands h
    LEFT JOIN agents a ON h.winner_id = a.id
    WHERE h.table_id = ?
    ORDER BY h.finished_at DESC
    LIMIT ?
  `).all(tableId, limit);

  res.json({ hands });
});

export default router;
export { initTables };
