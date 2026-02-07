import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  createRPS,
  acceptRPS,
  commitRPS,
  revealRPS,
  cancelRPS,
  getOpenRPS,
  getRPS,
  getRPSHistory,
  startRPSTimeoutChecker,
  startRPSExpiryChecker
} from '../games/rps/engine';
import {
  broadcastRPSCreated,
  broadcastRPSCommitted,
  broadcastRPSRevealed,
  broadcastRPSRoundComplete,
  broadcastRPSGameComplete,
  broadcastRPSCancelled,
  broadcastRPSForfeited
} from '../ws';

const router = Router();

// Start timeout and expiry checkers when routes are loaded
startRPSTimeoutChecker();
startRPSExpiryChecker();

// POST /api/rps/create - Create a new RPS challenge (auth required)
router.post('/create', requireAuth, (req: AuthRequest, res) => {
  try {
    const { stake, rounds, currency } = req.body;
    const creatorId = req.agent!.id;

    if (!stake || isNaN(stake) || stake <= 0) {
      return res.status(400).json({ error: 'Invalid stake amount' });
    }

    if (!rounds || ![1, 3, 5].includes(parseInt(rounds))) {
      return res.status(400).json({ error: 'Rounds must be 1, 3, or 5' });
    }

    if (!currency || !['SOL', 'USDC'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency. Use SOL or USDC' });
    }

    const result = createRPS(creatorId, stake, parseInt(rounds), currency);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast
    broadcastRPSCreated(result.game!);

    res.json({
      success: true,
      game: {
        id: result.game!.id,
        creator_id: result.game!.creator_id,
        creator_name: req.agent!.display_name,
        stake: result.game!.stake,
        currency: result.game!.currency,
        rounds: result.game!.rounds,
        status: result.game!.status,
        expires_at: result.game!.expires_at,
        created_at: result.game!.created_at
      }
    });
  } catch (err) {
    console.error('Create RPS error:', err);
    res.status(500).json({ error: 'Failed to create RPS' });
  }
});

// GET /api/rps/open - Get open challenges (no auth)
router.get('/open', (req, res) => {
  try {
    const games = getOpenRPS();

    res.json({
      games: games.map(g => ({
        game_id: g.id,
        stake: g.stake,
        currency: g.currency,
        rounds: g.rounds,
        creator: g.creator_name,
        expires_at: g.expires_at
      }))
    });
  } catch (err) {
    console.error('Get open RPS error:', err);
    res.status(500).json({ error: 'Failed to fetch RPS challenges' });
  }
});

// GET /api/rps/:id - Get specific game (no auth)
router.get('/:id', (req, res) => {
  try {
    const game = getRPS(req.params.id);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Filter round data - only reveal nonces if round is complete
    const filteredRounds = game.round_data.map(r => ({
      round: r.round,
      creator_hash: r.creator_hash,
      acceptor_hash: r.acceptor_hash,
      creator_choice: r.creator_choice,
      acceptor_choice: r.acceptor_choice,
      // Only reveal nonces if both have revealed
      creator_nonce: (r.creator_choice && r.acceptor_choice) ? r.creator_nonce : null,
      acceptor_nonce: (r.creator_choice && r.acceptor_choice) ? r.acceptor_nonce : null,
      winner: r.winner,
      phase_deadline: r.phase_deadline
    }));

    res.json({
      id: game.id,
      creator_id: game.creator_id,
      creator_name: game.creator_name,
      acceptor_id: game.acceptor_id,
      acceptor_name: game.acceptor_name,
      stake: game.stake,
      currency: game.currency,
      rounds: game.rounds,
      current_round: game.current_round,
      creator_score: game.creator_score,
      acceptor_score: game.acceptor_score,
      status: game.status,
      winner_id: game.winner_id,
      round_data: filteredRounds,
      expires_at: game.expires_at,
      created_at: game.created_at,
      completed_at: game.completed_at,
      rake: game.rake,
      forfeit_reason: game.forfeit_reason
    });
  } catch (err) {
    console.error('Get RPS error:', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// POST /api/rps/:id/accept - Accept a challenge (auth required)
router.post('/:id/accept', requireAuth, (req: AuthRequest, res) => {
  try {
    const acceptorId = req.agent!.id;

    const result = acceptRPS(req.params.id, acceptorId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast
    broadcastRPSCommitted(result.game!);

    res.json({
      success: true,
      game: result.game
    });
  } catch (err) {
    console.error('Accept RPS error:', err);
    res.status(500).json({ error: 'Failed to accept RPS' });
  }
});

// POST /api/rps/:id/commit - Commit a choice hash (auth required)
router.post('/:id/commit', requireAuth, (req: AuthRequest, res) => {
  try {
    const { hash } = req.body;
    const agentId = req.agent!.id;

    if (!hash) {
      return res.status(400).json({ error: 'Hash is required' });
    }

    const result = commitRPS(req.params.id, agentId, hash);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast
    broadcastRPSCommitted(result.game!);

    res.json({
      success: true,
      game: result.game,
      both_committed: result.both_committed
    });
  } catch (err) {
    console.error('Commit RPS error:', err);
    res.status(500).json({ error: 'Failed to commit' });
  }
});

// POST /api/rps/:id/reveal - Reveal choice (auth required)
router.post('/:id/reveal', requireAuth, (req: AuthRequest, res) => {
  try {
    const { choice, nonce } = req.body;
    const agentId = req.agent!.id;

    if (!choice || !nonce) {
      return res.status(400).json({ error: 'Choice and nonce are required' });
    }

    const result = revealRPS(req.params.id, agentId, choice, nonce);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast
    broadcastRPSRevealed(result.game!);

    if (result.round_complete) {
      broadcastRPSRoundComplete(result.game!, result.round_winner!);

      if (result.game_complete) {
        broadcastRPSGameComplete(result.game!, result.final_winner!);
      }
    }

    res.json({
      success: true,
      game: result.game,
      round_complete: result.round_complete,
      round_winner: result.round_winner,
      game_complete: result.game_complete,
      final_winner: result.final_winner
    });
  } catch (err) {
    console.error('Reveal RPS error:', err);
    res.status(500).json({ error: 'Failed to reveal' });
  }
});

// POST /api/rps/:id/cancel - Cancel a challenge (auth required, creator only)
router.post('/:id/cancel', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;

    const result = cancelRPS(req.params.id, agentId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Broadcast
    broadcastRPSCancelled(req.params.id, agentId);

    res.json({
      success: true,
      refunded_amount: result.refunded_amount
    });
  } catch (err) {
    console.error('Cancel RPS error:', err);
    res.status(500).json({ error: 'Failed to cancel RPS' });
  }
});

// GET /api/rps/history/my - Get your RPS history (auth required)
router.get('/history/my', requireAuth, (req: AuthRequest, res) => {
  try {
    const agentId = req.agent!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const games = getRPSHistory(agentId, limit);

    res.json({
      games: games.map(g => ({
        id: g.id,
        creator_id: g.creator_id,
        creator_name: g.creator_name,
        acceptor_id: g.acceptor_id,
        acceptor_name: g.acceptor_name,
        stake: g.stake,
        currency: g.currency,
        rounds: g.rounds,
        creator_score: g.creator_score,
        acceptor_score: g.acceptor_score,
        status: g.status,
        winner_id: g.winner_id,
        completed_at: g.completed_at,
        rake: g.rake,
        your_role: g.creator_id === agentId ? 'creator' : 'acceptor',
        you_won: g.winner_id === agentId
      }))
    });
  } catch (err) {
    console.error('Get RPS history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
