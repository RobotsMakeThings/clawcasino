import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

// Auth middleware
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Get agent from DB
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId) as any;
    
    if (!agent) {
      return res.status(401).json({ error: 'Agent not found' });
    }

    req.agent = agent;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Get my profile
router.get('/me', requireAuth, (req, res) => {
  const agent = req.agent;
  
  const displayName = agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`;
  
  res.json({
    id: agent.id,
    walletAddress: agent.wallet_address,
    displayName: agent.display_name || null,
    shortAddress: `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
    balanceSol: agent.balance_sol,
    balanceUsdc: agent.balance_usdc,
    stats: {
      gamesPlayed: agent.games_played,
      handsPlayed: agent.hands_played,
      handsWon: agent.hands_won,
      totalProfit: agent.total_profit,
      biggestWin: agent.biggest_pot_won,
      winRate: agent.hands_played > 0 
        ? Math.round((agent.hands_won / agent.hands_played) * 1000) / 10 
        : 0
    },
    createdAt: agent.created_at,
    lastActiveAt: agent.last_active_at
  });
});

// Update profile (display name)
router.post('/profile', requireAuth, (req, res) => {
  const agent = req.agent;
  const { displayName } = req.body;
  
  if (displayName !== undefined) {
    // Validate display name
    if (displayName && (displayName.length < 2 || displayName.length > 20)) {
      return res.status(400).json({ error: 'Display name must be 2-20 characters' });
    }

    // Check if display name is taken (if not empty)
    if (displayName) {
      const existing = db.prepare('SELECT id FROM agents WHERE display_name = ? AND id != ?')
        .get(displayName, agent.id);
      
      if (existing) {
        return res.status(400).json({ error: 'Display name already taken' });
      }
    }

    db.prepare('UPDATE agents SET display_name = ? WHERE id = ?')
      .run(displayName || null, agent.id);
  }

  // Return updated profile
  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
  
  res.json({
    success: true,
    profile: {
      walletAddress: updated.wallet_address,
      displayName: updated.display_name || null,
      shortAddress: `${updated.wallet_address.slice(0, 4)}...${updated.wallet_address.slice(-4)}`
    }
  });
});

// Get agent by wallet address (public profile)
router.get('/:walletAddress', (req, res) => {
  const { walletAddress } = req.params;
  
  const agent = db.prepare('SELECT * FROM agents WHERE wallet_address = ?').get(walletAddress) as any;
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const displayName = agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`;

  res.json({
    walletAddress: agent.wallet_address,
    displayName: agent.display_name || null,
    shortAddress: `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
    stats: {
      gamesPlayed: agent.games_played,
      handsPlayed: agent.hands_played,
      handsWon: agent.hands_won,
      totalProfit: agent.total_profit,
      biggestWin: agent.biggest_pot_won,
      winRate: agent.hands_played > 0 
        ? Math.round((agent.hands_won / agent.hands_played) * 1000) / 10 
        : 0
    },
    createdAt: agent.created_at
  });
});

// Get my transactions
router.get('/me/transactions', requireAuth, (req, res) => {
  const agent = req.agent;
  
  const transactions = db.prepare(`
    SELECT * FROM transactions 
    WHERE agent_id = ? 
    ORDER BY created_at DESC 
    LIMIT 50
  `).all(agent.id);

  res.json(transactions);
});

// Update last active timestamp
router.post('/ping', requireAuth, (req, res) => {
  const agent = req.agent;
  
  db.prepare('UPDATE agents SET last_active_at = ? WHERE id = ?')
    .run(Date.now(), agent.id);

  res.json({ success: true });
});

export default router;
export { requireAuth };
