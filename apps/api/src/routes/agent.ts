import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase } from '../db';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// GET /api/agent/me - Get full agent profile
router.get('/me', (req: AuthRequest, res) => {
  res.json({
    id: req.agent!.id,
    wallet_address: req.agent!.wallet_address,
    display_name: req.agent!.display_name,
    balance_sol: req.agent!.balance_sol,
    balance_usdc: req.agent!.balance_usdc,
    games_played: req.agent!.games_played,
    total_profit: req.agent!.total_profit
  });
});

// POST /api/agent/profile - Update agent profile
router.post('/profile', (req: AuthRequest, res) => {
  const { displayName } = req.body;
  
  if (!displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'displayName is required' });
  }
  
  // Validate: 3-20 chars, alphanumeric + underscore
  const validPattern = /^[a-zA-Z0-9_]{3,20}$/;
  if (!validPattern.test(displayName)) {
    return res.status(400).json({ 
      error: 'Display name must be 3-20 characters and contain only letters, numbers, and underscores' 
    });
  }
  
  try {
    const db = getDatabase();
    
    // Check if name is taken by another agent
    const existing = db.prepare('SELECT id FROM agents WHERE display_name = ? AND id != ?').get(displayName, req.agent!.id);
    if (existing) {
      return res.status(409).json({ error: 'Display name is already taken' });
    }
    
    // Update profile
    db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(displayName, req.agent!.id);
    
    // Get updated agent
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.agent!.id);
    
    res.json({
      id: agent.id,
      wallet_address: agent.wallet_address,
      display_name: agent.display_name,
      balance_sol: agent.balance_sol,
      balance_usdc: agent.balance_usdc,
      games_played: agent.games_played,
      total_profit: agent.total_profit
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
