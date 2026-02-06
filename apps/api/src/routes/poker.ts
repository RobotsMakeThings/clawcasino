import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { db } from '../../db';
import crypto from 'crypto';
import { RAKE_CONFIG } from './types';
import { createDeck, evaluateHand } from './cards';

const router = Router();

// Active games store
const games = new Map<string, any>();

// Get all tables
router.get('/tables', (req, res) => {
  const tables = db.prepare('SELECT * FROM poker_tables').all();
  
  // Add player counts
  const tablesWithCounts = (tables as any[]).map(table => {
    const playerCount = db.prepare('SELECT COUNT(*) as count FROM poker_players WHERE table_id = ?').get(table.id) as any;
    return {
      ...table,
      player_count: playerCount.count
    };
  });
  
  res.json({ tables: tablesWithCounts });
});

// Join table (buy in)
router.post('/tables/:tableId/join', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const { buyinAmount } = req.body;
  const agent = req.agent;

  const table = db.prepare('SELECT * FROM poker_tables WHERE id = ?').get(tableId) as any;
  if (!table) {
    res.status(404).json({ error: 'table_not_found', message: 'Table not found' });
    return;
  }

  // Validate buyin
  if (!buyinAmount || buyinAmount < table.min_buyin || buyinAmount > table.max_buyin) {
    res.status(400).json({ 
      error: 'invalid_buyin', 
      message: `Buyin must be between ${table.min_buyin} and ${table.max_buyin}` 
    });
    return;
  }

  // Check balance
  const balanceField = table.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < buyinAmount) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
    return;
  }

  // Check if already seated
  const existing = db.prepare('SELECT * FROM poker_players WHERE table_id = ? AND agent_id = ?').get(tableId, agent.id);
  if (existing) {
    res.status(400).json({ error: 'already_seated', message: 'Already at this table' });
    return;
  }

  // Check table capacity
  const playerCount = db.prepare('SELECT COUNT(*) as count FROM poker_players WHERE table_id = ?').get(tableId) as any;
  if (playerCount.count >= table.max_players) {
    res.status(400).json({ error: 'table_full', message: 'Table is full' });
    return;
  }

  // Find available seat
  const takenSeats = db.prepare('SELECT seat FROM poker_players WHERE table_id = ?').all(tableId) as any[];
  const takenSeatNumbers = takenSeats.map(s => s.seat);
  let seat = 0;
  while (takenSeatNumbers.includes(seat) && seat < table.max_players) {
    seat++;
  }

  // Deduct from wallet
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(buyinAmount, agent.id);

  // Add to table
  db.prepare(`
    INSERT INTO poker_players (table_id, agent_id, seat, chips)
    VALUES (?, ?, ?, ?)
  `).run(tableId, agent.id, seat, buyinAmount);

  // Log transaction
  const newBalance = agent[balanceField] - buyinAmount;
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, balance_after, created_at)
    VALUES (?, 'buyin', ?, ?, ?, unixepoch())
  `).run(agent.id, table.currency, buyinAmount, newBalance);

  res.json({
    success: true,
    seat,
    chips: buyinAmount
  });
});

// Leave table (cash out)
router.post('/tables/:tableId/leave', requireAuth, (req, res) => {
  const { tableId } = req.params;
  const agent = req.agent;

  const player = db.prepare('SELECT * FROM poker_players WHERE table_id = ? AND agent_id = ?').get(tableId, agent.id) as any;
  if (!player) {
    res.status(400).json({ error: 'not_at_table', message: 'Not at this table' });
    return;
  }

  const table = db.prepare('SELECT * FROM poker_tables WHERE id = ?').get(tableId) as any;

  // Remove from table
  db.prepare('DELETE FROM poker_players WHERE table_id = ? AND agent_id = ?').run(tableId, agent.id);

  // Credit remaining chips
  if (player.chips > 0) {
    const balanceField = table.currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(player.chips, agent.id);

    // Log transaction
    const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id) as any;
    db.prepare(`
      INSERT INTO transactions (agent_id, type, currency, amount, balance_after, created_at)
      VALUES (?, 'cashout', ?, ?, ?, unixepoch())
    `).run(agent.id, table.currency, player.chips, updated[balanceField]);
  }

  res.json({ success: true, remainingChips: player.chips });
});

// Start a hand
router.post('/tables/:tableId/start', requireAuth, (req, res) => {
  const { tableId } = req.params;
  
  // Get all players at table
  const players = db.prepare(`
    SELECT pp.*, a.display_name, a.wallet_address
    FROM poker_players pp
    JOIN agents a ON pp.agent_id = a.id
    WHERE pp.table_id = ?
  `).all(tableId) as any[];

  if (players.length < 2) {
    res.status(400).json({ error: 'not_enough_players', message: 'Need at least 2 players' });
    return;
  }

  const table = db.prepare('SELECT * FROM poker_tables WHERE id = ?').get(tableId) as any;

  // Create new hand
  const handId = crypto.randomUUID();
  const deck = createDeck();

  // Deal hole cards
  const playerCards = new Map();
  for (const player of players) {
    playerCards.set(player.agent_id, [deck.pop(), deck.pop()]);
  }

  // Post blinds
  const smallBlindPlayer = players[0];
  const bigBlindPlayer = players[1];

  // Update player chips for blinds
  db.prepare('UPDATE poker_players SET chips = chips - ?, current_bet = ? WHERE agent_id = ?')
    .run(table.small_blind, table.small_blind, smallBlindPlayer.agent_id);
  db.prepare('UPDATE poker_players SET chips = chips - ?, current_bet = ? WHERE agent_id = ?')
    .run(table.big_blind, table.big_blind, bigBlindPlayer.agent_id);

  // Create game state
  const gameState = {
    handId,
    tableId,
    phase: 'preflop',
    players: players.map(p => ({
      agentId: p.agent_id,
      username: p.display_name || `${p.wallet_address.slice(0, 4)}...${p.wallet_address.slice(-4)}`,
      seat: p.seat,
      chips: p.agent_id === smallBlindPlayer.agent_id ? p.chips - table.small_blind : 
              p.agent_id === bigBlindPlayer.agent_id ? p.chips - table.big_blind : p.chips,
      holeCards: playerCards.get(p.agent_id),
      status: 'active',
      currentBet: p.agent_id === smallBlindPlayer.agent_id ? table.small_blind :
                  p.agent_id === bigBlindPlayer.agent_id ? table.big_blind : 0
    })),
    communityCards: [],
    pots: [{ amount: table.small_blind + table.big_blind, eligiblePlayers: players.map(p => p.agent_id) }],
    currentPlayerIndex: 2 % players.length,
    dealerIndex: 0,
    smallBlind: table.small_blind,
    bigBlind: table.big_blind,
    currentBet: table.big_blind,
    minRaise: table.big_blind,
    deck
  };

  games.set(handId, gameState);

  // Save to DB
  db.prepare(`
    INSERT INTO poker_hands (id, table_id, started_at)
    VALUES (?, ?, unixepoch())
  `).run(handId, tableId);

  res.json({
    success: true,
    handId,
    state: {
      ...gameState,
      deck: undefined // Don't send deck to client
    }
  });
});

// Perform action
router.post('/hands/:handId/action', requireAuth, (req, res) => {
  const { handId } = req.params;
  const { action, amount } = req.body;
  const agent = req.agent;

  const game = games.get(handId);
  if (!game) {
    res.status(404).json({ error: 'hand_not_found', message: 'Hand not found' });
    return;
  }

  const player = game.players.find((p: any) => p.agentId === agent.id);
  if (!player) {
    res.status(400).json({ error: 'not_in_hand', message: 'Not in this hand' });
    return;
  }

  // Validate action
  if (!['fold', 'check', 'call', 'raise', 'all_in'].includes(action)) {
    res.status(400).json({ error: 'invalid_action', message: 'Invalid action' });
    return;
  }

  // Process action
  switch (action) {
    case 'fold':
      player.status = 'folded';
      break;
    case 'check':
      // Only if no bet to call
      if (game.currentBet > player.currentBet) {
        res.status(400).json({ error: 'cannot_check', message: 'Cannot check, there is a bet to call' });
        return;
      }
      break;
    case 'call':
      const callAmount = game.currentBet - player.currentBet;
      if (player.chips < callAmount) {
        res.status(400).json({ error: 'insufficient_chips', message: 'Not enough chips to call' });
        return;
      }
      player.chips -= callAmount;
      player.currentBet += callAmount;
      break;
    case 'raise':
      if (!amount || amount <= game.currentBet) {
        res.status(400).json({ error: 'invalid_raise', message: 'Raise amount must be greater than current bet' });
        return;
      }
      const raiseAmount = amount - player.currentBet;
      if (player.chips < raiseAmount) {
        res.status(400).json({ error: 'insufficient_chips', message: 'Not enough chips to raise' });
        return;
      }
      player.chips -= raiseAmount;
      player.currentBet = amount;
      game.currentBet = amount;
      game.minRaise = amount - game.currentBet + amount;
      break;
    case 'all_in':
      player.currentBet += player.chips;
      if (player.currentBet > game.currentBet) {
        game.currentBet = player.currentBet;
      }
      player.chips = 0;
      player.status = 'all_in';
      break;
  }

  // Move to next player
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

  // Update pot
  const totalBets = game.players.reduce((sum: number, p: any) => sum + p.currentBet, 0);
  game.pots[0].amount = totalBets;

  res.json({
    success: true,
    state: {
      ...game,
      deck: undefined
    }
  });
});

// Calculate rake helper
function calculateRake(potSize: number, blindLevel: string, numPlayers: number): number {
  const config = RAKE_CONFIG.caps[blindLevel];
  if (!config) return Math.min(potSize * 0.05, 3); // Default cap
  
  const cap = config[Math.min(numPlayers, 6)];
  return Math.min(potSize * RAKE_CONFIG.percentage, cap);
}

export default router;
