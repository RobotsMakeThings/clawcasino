import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  createCoinflip,
  acceptCoinflip,
  cancelCoinflip,
  getOpenCoinflips,
  getCoinflip,
  getCoinflipHistory,
  startExpiryChecker
} from '../games/coinflip/engine';
import {
  broadcastCoinflipCreated,
  broadcastCoinflipResult,
  broadcastCoinflipCancelled
} from '../ws';

const router = Router();

// Start the expiry checker when routes are loaded
startExpiryChecker();

// POST /api/coinflip/create - Create a new coinflip challenge (auth required)
router.post('/create', requireAuth, (req: AuthRequest, res) => {
  try {
    const { stake, currency } = req.body;
    const creatorId = req.agent!.id;

    if (!stake || isNaN(stake) || stake <= 0) {
      return res.status(400).json({ error: 'Invalid stake amount' });
    }

    if (!currency || !['SOL', 'USDC'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency. Use SOL or USDC' });
    }

    const result = createCoinflip(creatorId, stake, currency);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast to all subscribers
    broadcastCoinflipCreated(result.game!);

    res.json({
      success: true,
      game: {
        id: result.game!.id,
        creator_id: result.game!.creator_id,
        creator_name: req.agent!.display_name,
        stake: result.game!.stake,
        currency: result.game!.currency,
        status: result.game!.status,
        proof_hash: result.game!.proof_hash,
        expires_at: result.game!.expires_at,
        created_at: result.game!.created_at
      }
    });
  } catch (err) {
    console.error('Create coinflip error:', err);
    res.status(500).json({ error: 'Failed to create coinflip' });
  }
});

// GET /api/coinflip/open - Get open challenges (no auth)
router.get('/open', (req, res) => {
  try {
    const games = getOpenCoinflips();

    res.json({
      games: games.map(g => ({
        game_id: g.id,
        stake: g.stake,
        currency: g.currency,
        creator: g.creator_name,
        proof_hash: g.proof_hash,
        expires_at: g.expires_at
      }))
    });
  } catch (err) {
    console.error('Get open coinflips error:', err);
    res.status(500).json({ error: 'Failed to fetch coinflip challenges' });
  }
});

// GET /api/coinflip/:id - Get specific game (no auth - secret revealed only if completed)
router.get('/:id', (req, res) => {
  try {
    const game = getCoinflip(req.params.id);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    res.json({
      id: game.id,
      creator_id: game.creator_id,
      creator_name: game.creator_name,
      acceptor_id: game.acceptor_id,
      acceptor_name: game.acceptor_name,
      stake: game.stake,
      currency: game.currency,
      status: game.status,
      winner_id: game.winner_id,
      proof_hash: game.proof_hash,
      secret: game.secret, // Only included if game is completed
      result_hash: game.result_hash,
      expires_at: game.expires_at,
      created_at: game.created_at,
      completed_at: game.completed_at,
      rake: game.rake
    });
  } catch (err) {
    console.error('Get coinflip error:', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// POST /api/coinflip/:id/accept - Accept a challenge (auth required)
router.post('/:id/accept', requireAuth, (req: AuthRequest, res) => {
  try {
    const acceptorId = req.agent!.id;

    const result = acceptCoinflip(req.params.id, acceptorId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast result
    broadcastCoinflipResult(result.game!, result.winner_id!, result.winner_name!);

    res.json({
      success: true,
      game: result.game,
      winner: {
        id: result.winner_id,
        name: result.winner_name
      },
      verification: result.verification
    });
  } catch (err) {
    console.error('Accept coinflip error:', err);
    res.status(500).json({ error: 'Failed to accept coinflip' });
  }
});

// POST /api/coinflip/:id/cancel - Cancel a challenge (auth required, creator only)
router.post('/:id/cancel', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;

    const result = cancelCoinflip(req.params.id, agentId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast cancellation
    broadcastCoinflipCancelled(req.params.id, agentId);

    res.json({
      success: true,
      refunded_amount: result.refunded_amount
    });
  } catch (err) {
    console.error('Cancel coinflip error:', err);
    res.status(500).json({ error: 'Failed to cancel coinflip' });
  }
});

// GET /api/coinflip/history/my - Get your coinflip history (auth required)
router.get('/history/my', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const games = getCoinflipHistory(agentId, limit);

    res.json({
      games: games.map(g => ({
        id: g.id,
        creator_id: g.creator_id,
        creator_name: g.creator_name,
        acceptor_id: g.acceptor_id,
        acceptor_name: g.acceptor_name,
        stake: g.stake,
        currency: g.currency,
        status: g.status,
        winner_id: g.winner_id,
        proof_hash: g.proof_hash,
        secret: g.secret,
        result_hash: g.result_hash,
        completed_at: g.completed_at,
        rake: g.rake,
        your_role: g.creator_id === agentId ? 'creator' : 'acceptor',
        you_won: g.winner_id === agentId
      }))
    });
  } catch (err) {
    console.error('Get coinflip history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
