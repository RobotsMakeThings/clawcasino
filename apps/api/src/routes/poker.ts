import { Router } from 'express';
import { getDatabase } from '../db';
import { 
  getTable, 
  getAllTables, 
  seatPlayer, 
  removePlayer, 
  startHand,
  handleAction,
  getPublicState,
  getStateForAgent,
  loadTablesFromDB,
  PokerTableState
} from '../games/poker/table';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/poker/tables - Get all tables (no auth)
router.get('/tables', (req, res) => {
  try {
    const tables = getAllTables();
    const db = getDatabase();
    
    // Enrich with hand counts from DB
    const tablesWithStats = tables.map(t => {
      const handCount = db.prepare(`
        SELECT COUNT(*) as count FROM poker_hands WHERE table_id = ?
      `).get(t.id)?.count || 0;
      
      return {
        id: t.id,
        name: t.config.name,
        small_blind: t.config.smallBlind,
        big_blind: t.config.bigBlind,
        min_buyin: t.config.minBuyin,
        max_buyin: t.config.maxBuyin,
        currency: t.config.currency,
        player_count: t.seats.size,
        max_players: t.config.maxPlayers,
        status: t.handInProgress ? 'active' : 'waiting',
        hand_count: handCount
      };
    });
    
    res.json({ tables: tablesWithStats });
  } catch (err) {
    console.error('Poker tables error:', err);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

// GET /api/poker/tables/:id - Public table state (no auth - spectators)
router.get('/tables/:id', (req, res) => {
  try {
    const table = getPublicState(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Format for frontend - hole cards HIDDEN
    const formattedState = {
      id: table.id,
      name: table.config.name,
      small_blind: table.config.smallBlind,
      big_blind: table.config.bigBlind,
      currency: table.config.currency,
      community_cards: table.communityCards,
      pot: table.pot,
      side_pots: table.sidePots,
      current_bet: table.currentBet,
      phase: table.phase,
      hand_in_progress: table.handInProgress,
      hand_id: table.handId,
      seed_hash: table.seedHash,
      dealer_seat: table.dealerSeat,
      current_turn: table.currentTurnSeat >= 0 ? {
        seat: table.currentTurnSeat,
        agent_id: table.seats.find((s: any) => s.seatNumber === table.currentTurnSeat)?.agentId,
        display_name: table.seats.find((s: any) => s.seatNumber === table.currentTurnSeat)?.displayName,
        deadline: table.actionDeadline
      } : null,
      players: table.seats.map((s: any) => ({
        seat: s.seatNumber,
        agent_id: s.agentId,
        display_name: s.displayName,
        chips: s.chips,
        bet_this_round: s.betThisRound,
        total_bet_this_hand: s.totalBetThisHand,
        status: s.status,
        last_action: s.lastAction,
        card_count: s.cardCount  // Hidden - only count, not actual cards
      }))
    };
    
    res.json(formattedState);
  } catch (err) {
    console.error('Table state error:', err);
    res.status(500).json({ error: 'Failed to fetch table state' });
  }
});

// GET /api/poker/tables/:id/state - Player view with hole cards (auth)
router.get('/tables/:id/state', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
    const state = getStateForAgent(req.params.id, agentId);
    
    if (!state) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Add available_actions if it's their turn
    const isMyTurn = state.mySeat === state.currentTurnSeat && state.handInProgress;
    let availableActions = null;
    
    if (isMyTurn && state.availableActions) {
      const table = getTable(req.params.id);
      if (table) {
        const myPlayer = table.seats.get(state.mySeat);
        if (myPlayer) {
          const toCall = table.currentBet - myPlayer.betThisRound;
          const minRaise = table.currentBet + Math.max(table.config.bigBlind, table.lastRaiseSize);
          const maxRaise = myPlayer.chips + myPlayer.betThisRound;
          
          availableActions = {
            actions: state.availableActions,
            call_amount: toCall > 0 ? toCall : 0,
            min_raise: state.availableActions.includes('RAISE') ? minRaise : null,
            max_raise: state.availableActions.includes('RAISE') ? maxRaise : null
          };
        }
      }
    }
    
    res.json({
      ...state,
      available_actions: availableActions
    });
  } catch (err) {
    console.error('Player state error:', err);
    res.status(500).json({ error: 'Failed to fetch player state' });
  }
});

// POST /api/poker/tables/:id/join - Join a table (auth)
router.post('/tables/:id/join', requireAuth, (req: AuthRequest, res) => {
  try {
    const { buyin } = req.body;
    const agentId = req.agent!.id;
    const displayName = req.agent!.display_name;
    
    // Validate buyin
    if (!buyin || isNaN(buyin) || buyin <= 0) {
      return res.status(400).json({ error: 'Invalid buyin amount' });
    }
    
    const table = getTable(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Check buyin range
    if (buyin < table.config.minBuyin || buyin > table.config.maxBuyin) {
      return res.status(400).json({ 
        error: `Buy-in must be between ${table.config.minBuyin} and ${table.config.maxBuyin}` 
      });
    }
    
    // Check if already seated
    for (const player of table.seats.values()) {
      if (player.agentId === agentId) {
        return res.status(400).json({ error: 'Already seated at this table' });
      }
    }
    
    // Check seat availability
    if (table.seats.size >= table.config.maxPlayers) {
      return res.status(400).json({ error: 'Table is full' });
    }
    
    // Seat the player
    const result = seatPlayer(req.params.id, agentId, displayName, buyin);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    // Get updated state for player
    const tableState = getStateForAgent(req.params.id, agentId);
    
    res.json({ 
      success: true,
      seat: result.seatNumber,
      chips: buyin,
      table_state: tableState
    });
  } catch (err) {
    console.error('Join table error:', err);
    res.status(500).json({ error: 'Failed to join table' });
  }
});

// POST /api/poker/tables/:id/leave - Leave a table (auth)
router.post('/tables/:id/leave', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
    const table = getTable(req.params.id);
    
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Find player
    let player: any = null;
    for (const p of table.seats.values()) {
      if (p.agentId === agentId) {
        player = p;
        break;
      }
    }
    
    if (!player) {
      return res.status(400).json({ error: 'Not seated at this table' });
    }
    
    // Check if in active hand
    if (table.handInProgress && player.status !== 'folded' && player.status !== 'sitting_out') {
      return res.status(400).json({ error: 'hand_in_progress' });
    }
    
    const result = removePlayer(req.params.id, agentId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Leave table error:', err);
    res.status(500).json({ error: 'Failed to leave table' });
  }
});

// POST /api/poker/tables/:id/action - Perform action (auth)
router.post('/tables/:id/action', requireAuth, (req: AuthRequest, res) => {
  try {
    const { action, amount } = req.body;
    const agentId = req.agent!.id;
    
    // Validate action
    if (!action || !['FOLD', 'CHECK', 'CALL', 'RAISE', 'ALL_IN'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    const table = getTable(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    // Find player's seat
    let playerSeat = -1;
    for (const [seat, player] of table.seats) {
      if (player.agentId === agentId) {
        playerSeat = seat;
        break;
      }
    }
    
    if (playerSeat === -1) {
      return res.status(400).json({ error: 'Not seated at this table' });
    }
    
    // Check if it's their turn
    if (table.currentTurnSeat !== playerSeat) {
      return res.status(400).json({ error: 'Not your turn' });
    }
    
    // Process action
    const result = handleAction(req.params.id, agentId, action, amount);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    // Get updated state
    const tableState = getStateForAgent(req.params.id, agentId);
    
    res.json({ 
      success: true, 
      hand_complete: result.handComplete,
      table_state: tableState
    });
  } catch (err) {
    console.error('Action error:', err);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// GET /api/poker/hands/:handId - Completed hand details (no auth)
router.get('/hands/:handId', (req, res) => {
  try {
    const db = getDatabase();
    
    // Get hand from database
    const hand = db.prepare(`
      SELECT * FROM poker_hands WHERE id = ?
    `).get(req.params.handId);
    
    if (!hand) {
      return res.status(404).json({ error: 'Hand not found' });
    }
    
    // Get rake info
    const rake = db.prepare(`
      SELECT amount, currency FROM rake_log WHERE game_id = ?
    `).get(req.params.handId);
    
    // Get winners from hand record (if stored as JSON)
    let winners = [];
    try {
      if (hand.winners) {
        winners = JSON.parse(hand.winners);
      }
    } catch (e) {
      // Winners not stored as JSON
    }
    
    res.json({
      hand_id: hand.id,
      table_id: hand.table_id,
      phase: hand.phase,
      community_cards: JSON.parse(hand.community_cards || '[]'),
      pot: hand.pot,
      rake: rake?.amount || 0,
      currency: rake?.currency || 'SOL',
      winners: winners,
      completed_at: hand.completed_at,
      // All hole cards revealed at showdown
      player_hands: hand.player_hands ? JSON.parse(hand.player_hands) : []
    });
  } catch (err) {
    console.error('Hand history error:', err);
    res.status(500).json({ error: 'Failed to fetch hand history' });
  }
});

export default router;
