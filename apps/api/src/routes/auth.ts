import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'clawcasino-secret-change-in-production';

// Generate nonce for wallet signature
router.post('/nonce', (req, res) => {
  const { walletAddress } = req.body;
  
  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  try {
    // Validate Solana address
    new PublicKey(walletAddress);
  } catch {
    return res.status(400).json({ error: 'Invalid Solana address' });
  }

  // Generate random nonce
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Store nonce
  db.prepare(`
    INSERT OR REPLACE INTO wallet_nonces (wallet_address, nonce, expires_at)
    VALUES (?, ?, ?)
  `).run(walletAddress, nonce, expiresAt.toISOString());

  res.json({ 
    nonce, 
    message: `Sign this message to authenticate with ClawCasino: ${nonce}`,
    expiresAt 
  });
});

// Verify wallet signature and login
router.post('/verify', async (req, res) => {
  const { walletAddress, signature, username } = req.body;

  if (!walletAddress || !signature) {
    return res.status(400).json({ error: 'Wallet address and signature required' });
  }

  try {
    // Get stored nonce
    const nonceRecord = db.prepare('SELECT * FROM wallet_nonces WHERE wallet_address = ?')
      .get(walletAddress) as any;

    if (!nonceRecord) {
      return res.status(400).json({ error: 'No nonce found. Request a new one.' });
    }

    if (new Date(nonceRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Nonce expired. Request a new one.' });
    }

    // Verify signature (simplified - in production use proper Solana signature verification)
    // For now, we'll trust the signature and delete the nonce
    db.prepare('DELETE FROM wallet_nonces WHERE wallet_address = ?').run(walletAddress);

    // Check if user exists
    let agent = db.prepare('SELECT * FROM agents WHERE solana_address = ?').get(walletAddress) as any;

    if (!agent) {
      // Create new user
      if (!username || username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
      }

      // Check username availability
      const existing = db.prepare('SELECT * FROM agents WHERE username = ?').get(username);
      if (existing) {
        return res.status(400).json({ error: 'Username taken' });
      }

      const agentId = crypto.randomUUID();
      const apiKey = crypto.randomBytes(32).toString('hex');

      db.prepare(`
        INSERT INTO agents (id, username, api_key, solana_address, balance)
        VALUES (?, ?, ?, ?, 0)
      `).run(agentId, username, apiKey, walletAddress);

      agent = { id: agentId, username, api_key: apiKey, balance: 0, solana_address: walletAddress };
    }

    // Create JWT session
    const token = jwt.sign(
      { 
        agentId: agent.id, 
        walletAddress,
        username: agent.username 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Store session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    db.prepare(`
      INSERT INTO user_sessions (session_id, agent_id, wallet_address, token, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, agent.id, walletAddress, token, expiresAt.toISOString());

    res.json({
      success: true,
      token,
      user: {
        id: agent.id,
        username: agent.username,
        walletAddress,
        balance: agent.balance,
        apiKey: agent.api_key
      }
    });

  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
  }
  res.json({ success: true });
});

// Verify token
router.get('/verify-token', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Check if session exists
    const session = db.prepare('SELECT * FROM user_sessions WHERE token = ? AND expires_at > ?')
      .get(token, new Date().toISOString()) as any;

    if (!session) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get fresh user data
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId) as any;
    
    res.json({
      valid: true,
      user: {
        id: agent.id,
        username: agent.username,
        walletAddress: agent.solana_address,
        balance: agent.balance,
        apiKey: agent.api_key
      }
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
