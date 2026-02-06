import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { pokerEngine, RAKE_CONFIG } from '../poker-engine';

const router = Router();

// Initialize default tables
const defaultTables = [
  { id: 'nano', name: 'Nano Grind', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2 },
  { id: 'micro', name: 'Micro Stakes', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5 },
  { id: 'low', name: 'Low Stakes', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2, maxBuyin: 20 },
  { id: 'mid', name: 'Mid Stakes', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10, maxBuyin: 100 },
  { id: 'high', name: 'High Roller', smallBlind: 1.00, bigBlind: 2.00, minBuyin: 50, maxBuyin: 500 },
  { id: 'degen', name: 'Degen Table', smallBlind: 5.00, bigBlind: 10.00, minBuyin: 200, maxBuyin: 2000 }
];

// Create tables on startup
for (const table of defaultTables) {
  pokerEngine.createTable({
    ...table,
    maxPlayers: 6,
    currency: 'SOL'
  });
}

// List all tables
router.get('/tables', (req, res) => {
  const tables = pokerEngine.getAllTables();
  
  const tableData = tables.map(table => {
    // Get average pot from DB
    const avgPot = db.prepare(`
      SELECT AVG(pot) as avg FROM poker_hands 
      WHERE table_id = ? AND finished_at > unixepoch() - 86400
    `).get(table.config.id) as any;

    return {
      id: table.config.id,
      name: table.config.name,
      smallBlind: table.config.smallBlind,
      bigBlind: table.config.bigBlind,
      minBuyin: table.config.minBuyin,
      maxBuyin: table.config.maxBuyin,
      playerCount: table.players.length,
      avgPot: avgPot?.avg || 0,
      currency: table.config.currency,
      handInProgress: table.handInProgress
    };
  });

  res.json({ tables: tableData });
});

// Get specific table
router.get('/tables/:tableId', (req, res) => {
  const { tableId } = req.params;
  const state = pokerEngine.getTableState(tableId);

  if (!state) {
    res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
    return;
  }

  res.json(state);
});

// Get state for requesting agent
router.get('/tables/:tableId/state', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const agentId = req.agent.id;
  
  const state = pokerEngine.getTableState(tableId, agentId);

  if (!state) {
    res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
    return;
  }

  // Calculate available actions
  let availableActions: string[] = [];
  
  if (state.hand) {
    const currentPlayer = state.hand.players.find((p: any) => p.agentId === agentId);
    const isCurrentTurn = state.hand.currentPlayer === agentId;
    
    if (isCurrentTurn && currentPlayer && currentPlayer.status === 'active') {
      const callAmount = state.hand.currentBet - (currentPlayer.currentBet || 0);
      
      availableActions = ['fold'];
      
      if (callAmount === 0) {
        availableActions.push('check');
        availableActions.push('raise');
      } else {
        availableActions.push('call');
        availableActions.push('raise');
      }
      
      if (currentPlayer.chips > 0) {
        availableActions.push('all_in');
      }
    }
  }

  res.json({
    ...state,
    availableActions
  });
});

// Join table
router.post('/tables/:tableId/join', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const { buyin } = req.body;
  const agent = req.agent;

  const table = pokerEngine.getTable(tableId);
  if (!table) {
    res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
    return;
  }

  // Validate buyin
  if (!buyin || buyin < table.config.minBuyin || buyin > table.config.maxBuyin) {
    res.status(400).json({ 
      error: 'invalid_buyin', 
      message: `Buyin must be between ${table.config.minBuyin} and ${table.config.maxBuyin}` 
    });
    return;
  }

  // Check balance
  const balanceField = table.config.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < buyin) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient wallet balance' });
    return;
  }

  // Deduct from wallet
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(buyin, agent.id);

  // Seat player
  const username = agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`;
  const result = pokerEngine.seatPlayer(tableId, agent.id, username, buyin);

  if (!result.success) {
    // Refund if failed
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(buyin, agent.id);
    res.status(400).json({ error: result.error });
    return;
  }

  // Log transaction
  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) as any;
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, balance_after, reference, created_at)
    VALUES (?, 'buyin', ?, ?, ?, ?, unixepoch())
  `).run(agent.id, table.config.currency, buyin, updated[balanceField], tableId);

  res.json({
    success: true,
    seat: result.seat,
    chips: buyin
  });
});

// Leave table
router.post('/tables/:tableId/leave', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const agent = req.agent;

  const table = pokerEngine.getTable(tableId);
  if (!table) {
    res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
    return;
  }

  const result = pokerEngine.removePlayer(tableId, agent.id);

  if (!result.success) {
    res.status(400).json({ error: result.error, message: result.error });
    return;
  }

  // Return chips to wallet
  if (result.remainingChips && result.remainingChips > 0) {
    const balanceField = table.config.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(result.remainingChips, agent.id);

    const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) as any;
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, balance_after, reference, created_at)
      VALUES (?, 'cashout', ?, ?, ?, ?, unixepoch())
    `).run(agent.id, table.config.currency, result.remainingChips, updated[balanceField], tableId);
  }

  res.json({ success: true, returnedChips: result.remainingChips });
});

// Perform action
router.post('/tables/:tableId/action', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const { action, amount } = req.body;
  const agent = req.agent;

  const result = pokerEngine.performAction(tableId, agent.id, action, amount);

  if (!result.success) {
    res.status(400).json({ 
      error: result.error || 'invalid_action', 
      message: (result as any).message || 'Invalid action' 
    });
    return;
  }

  // If hand completed, save to DB
  if (result.result) {
    const handResult = result.result;
    const table = pokerEngine.getTable(tableId);
    
    if (table) {
      // Save hand to DB
      db.prepare(`
        INSERT INTO poker_hands (id, table_id, pot, rake, community_cards, winner_ids, hand_data, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(
        handResult.handId,
        tableId,
        handResult.totalPot,
        handResult.rake,
        JSON.stringify(handResult.communityCards),
        JSON.stringify(handResult.winners.map(w => w.agentId)),
        JSON.stringify(handResult),
        Math.floor(Date.now() / 1000) - 60 // Approximate start time
      );

      // Log rake
      if (handResult.rake > 0) {
        db.prepare(`
          INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
          VALUES ('poker', ?, ?, ?, ?, unixepoch())
        `).run(handResult.handId, handResult.rake, table.config.currency, handResult.totalPot);
      }

      // Update player stats
      for (const winner of handResult.winners) {
        db.prepare(`
          UPDATE agents SET games_played = games_played + 1, total_profit = total_profit + ? WHERE id = ?
        `).run(winner.amount, winner.agentId);
      }
    }
  }

  res.json({
    success: true,
    handState: result.handState,
    result: result.result
  });
});

// Get hand history
router.get('/hands/:handId', requireAuth, (req, res) => {
  const { handId } = req.params;

  // Get from DB
  const hand = db.prepare('SELECT * FROM poker_hands WHERE id = ?').get(handId) as any;
  
  if (!hand) {
    res.status(404).json({ error: 'hand_not_found', message: 'Hand not found' });
    return;
  }

  res.json({
    id: hand.id,
    tableId: hand.table_id,
    pot: hand.pot,
    rake: hand.rake,
    communityCards: JSON.parse(hand.community_cards || '[]'),
    winners: JSON.parse(hand.winner_ids || '[]'),
    handData: JSON.parse(hand.hand_data || '{}'),
    startedAt: hand.started_at,
    finishedAt: hand.finished_at
  });
});

export default router;
