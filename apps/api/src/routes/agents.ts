import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';

const router = Router();

// Get my profile
router.get('/me', requireAuth, (req, res) => {
  const agent = req.agent;
  
  res.json({
    id: agent.id,
    wallet_address: agent.wallet_address,
    display_name: agent.display_name,
    balance_sol: agent.balance_sol,
    balance_usdc: agent.balance_usdc,
    games_played: agent.games_played,
    total_profit: agent.total_profit,
    created_at: agent.created_at
  });
});

// Update profile (display name)
router.post('/profile', requireAuth, (req, res) => {
  const agent = req.agent;
  const { displayName } = req.body;

  if (!displayName) {
    res.status(400).json({ error: 'missing_name', message: 'displayName is required' });
    return;
  }

  // Validate: alphanumeric + underscores, max 20 chars
  if (!/^[a-zA-Z0-9_]{1,20}$/.test(displayName)) {
    res.status(400).json({ 
      error: 'invalid_name', 
      message: 'Display name must be 1-20 characters, alphanumeric and underscores only' 
    });
    return;
  }

  // Check if name is taken
  const existing = db.prepare('SELECT id FROM agents WHERE display_name = ? AND id != ?').get(displayName, agent.id);
  if (existing) {
    res.status(400).json({ error: 'name_taken', message: 'Display name already taken' });
    return;
  }

  db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(displayName, agent.id);

  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
  
  res.json({
    success: true,
    agent: {
      id: updated.id,
      wallet_address: updated.wallet_address,
      display_name: updated.display_name,
      balance_sol: updated.balance_sol,
      balance_usdc: updated.balance_usdc
    }
  });
});

export default router;
