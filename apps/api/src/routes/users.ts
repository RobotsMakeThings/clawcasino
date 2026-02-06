import { Router } from 'express';
import { db } from '../db';

const router = Router();

// Helper to get current user
function getCurrentUser(req: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    const session = db.prepare('SELECT agent_id FROM user_sessions WHERE token = ? AND expires_at > ?')
      .get(token, new Date().toISOString()) as any;
    
    if (!session) return null;
    
    return db.prepare('SELECT * FROM agents WHERE id = ?').get(session.agent_id) as any;
  } catch {
    return null;
  }
}

// Auth middleware
function requireAuth(req: any, res: any, next: any) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as any).user = user;
  next();
}

// Get my profile
router.get('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  
  res.json({
    id: user.id,
    username: user.username,
    walletAddress: user.solana_address,
    balance: user.balance,
    apiKey: user.api_key,
    avatar: user.avatar,
    bio: user.bio,
    twitter: user.twitter,
    discord: user.discord,
    stats: {
      gamesPlayed: user.games_played,
      handsPlayed: user.hands_played,
      handsWon: user.hands_won,
      totalProfit: user.total_profit,
      biggestWin: user.biggest_pot_won,
      winRate: user.hands_played > 0 
        ? Math.round((user.hands_won / user.hands_played) * 1000) / 10 
        : 0
    },
    createdAt: user.created_at
  });
});

// Update profile
router.patch('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  const { username, avatar, bio, twitter, discord } = req.body;
  
  try {
    // Validate username if changing
    if (username && username !== user.username) {
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
      }
      
      const existing = db.prepare('SELECT * FROM agents WHERE username = ? AND id != ?')
        .get(username, user.id);
      
      if (existing) {
        return res.status(400).json({ error: 'Username taken' });
      }
    }

    // Update fields
    const updates: string[] = [];
    const values: any[] = [];

    if (username) { updates.push('username = ?'); values.push(username); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (twitter !== undefined) { updates.push('twitter = ?'); values.push(twitter); }
    if (discord !== undefined) { updates.push('discord = ?'); values.push(discord); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(user.id);
    
    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Get updated user
    const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(user.id);
    
    res.json({
      success: true,
      user: {
        id: updated.id,
        username: updated.username,
        walletAddress: updated.solana_address,
        avatar: updated.avatar,
        bio: updated.bio,
        twitter: updated.twitter,
        discord: updated.discord
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user by username (public profile)
router.get('/:username', (req, res) => {
  const { username } = req.params;
  
  try {
    const user = db.prepare('SELECT * FROM agents WHERE username = ?').get(username) as any;
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      twitter: user.twitter,
      discord: user.discord,
      stats: {
        gamesPlayed: user.games_played,
        handsPlayed: user.hands_played,
        handsWon: user.hands_won,
        totalProfit: user.total_profit,
        biggestWin: user.biggest_pot_won,
        winRate: user.hands_played > 0 
          ? Math.round((user.hands_won / user.hands_played) * 1000) / 10 
          : 0
      },
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Get my transactions
router.get('/me/transactions', requireAuth, (req, res) => {
  const user = (req as any).user;
  
  try {
    const transactions = db.prepare(`
      SELECT * FROM transactions 
      WHERE agent_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(user.id);

    res.json(transactions);
  } catch (error) {
    console.error('Transactions error:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// Get my recent hands
router.get('/me/hands', requireAuth, (req, res) => {
  const user = (req as any).user;
  
  try {
    const hands = db.prepare(`
      SELECT 
        h.*,
        t.name as table_name,
        CASE WHEN h.winner_id = ? THEN 'win' ELSE 'loss' END as result
      FROM hands h
      JOIN tables t ON h.table_id = t.id
      JOIN hand_actions ha ON h.id = ha.hand_id
      WHERE ha.agent_id = ?
      GROUP BY h.id
      ORDER BY h.finished_at DESC
      LIMIT 20
    `).all(user.id, user.id);

    res.json(hands);
  } catch (error) {
    console.error('Hands error:', error);
    res.status(500).json({ error: 'Failed to get hands' });
  }
});

export default router;
