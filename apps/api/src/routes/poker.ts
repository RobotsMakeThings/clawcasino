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
  getStateForAgent
} from '../games/poker/table';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/poker/tables - Get available poker tables
router.get('/tables', (req, res) => {
  try {
    const tables = getAllTables();
    
    res.json({
      tables: tables.map(t => ({
        id: t.id,
        name: t.config.name,
        smallBlind: t.config.smallBlind,
        bigBlind: t.config.bigBlind,
        minBuyin: t.config.minBuyin,
        maxBuyin: t.config.maxBuyin,
        maxPlayers: t.config.maxPlayers,
        currency: t.config.currency,
        playerCount: t.seats.size,
        handInProgress: t.handInProgress
      }))
    });
  } catch (err) {
    console.error('Poker tables error:', err);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

// GET /api/poker/tables/:id - Get specific table state
router.get('/tables/:id', (req, res) => {
  try {
    const table = getPublicState(req.params.id);
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json(table);
  } catch (err) {
    console.error('Table state error:', err);
    res.status(500).json({ error: 'Failed to fetch table state' });
  }
});

// POST /api/poker/tables/:id/join - Join a table (auth required)
router.post('/tables/:id/join', requireAuth, (req: AuthRequest, res) => {
  try {
    const { buyin } = req.body;
    const agentId = req.agent!.id;
    const displayName = req.agent!.display_name;
    
    if (!buyin || isNaN(buyin) || buyin <= 0) {
      return res.status(400).json({ error: 'Invalid buyin amount' });
    }
    
    const result = seatPlayer(req.params.id, agentId, displayName, buyin);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ 
      success: true, 
      seatNumber: result.seatNumber,
      tableState: getStateForAgent(req.params.id, agentId)
    });
  } catch (err) {
    console.error('Join table error:', err);
    res.status(500).json({ error: 'Failed to join table' });
  }
});

// POST /api/poker/tables/:id/leave - Leave a table (auth required)
router.post('/tables/:id/leave', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
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

// GET /api/poker/tables/:id/state - Get state for logged in player (auth required)
router.get('/tables/:id/state', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
    const state = getStateForAgent(req.params.id, agentId);
    
    if (!state) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    res.json(state);
  } catch (err) {
    console.error('Player state error:', err);
    res.status(500).json({ error: 'Failed to fetch player state' });
  }
});

// POST /api/poker/tables/:id/action - Perform action (auth required)
router.post('/tables/:id/action', requireAuth, (req: AuthRequest, res) => {
  try {
    const { action, amount } = req.body;
    const agentId = req.agent!.id;
    
    if (!action || !['FOLD', 'CHECK', 'CALL', 'RAISE', 'ALL_IN'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    const result = handleAction(req.params.id, agentId, action, amount);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ 
      success: true, 
      handComplete: result.handComplete,
      tableState: getStateForAgent(req.params.id, agentId)
    });
  } catch (err) {
    console.error('Action error:', err);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// POST /api/poker/tables/:id/start - Start a hand (for testing, normally auto-starts)
router.post('/tables/:id/start', requireAuth, (req: AuthRequest, res) => {
  try {
    const result = startHand(req.params.id);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ 
      success: true,
      tableState: getStateForAgent(req.params.id, req.agent!.id)
    });
  } catch (err) {
    console.error('Start hand error:', err);
    res.status(500).json({ error: 'Failed to start hand' });
  }
});

export default router;
