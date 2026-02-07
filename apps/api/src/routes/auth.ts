import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { getDatabase } from '../db';

const router = Router();

// GET /api/auth/nonce - Generate authentication nonce
router.get('/nonce', (req, res) => {
  const nonce = `Clawsino auth: ${uuidv4()}`;
  res.json({ nonce });
});

// POST /api/auth/verify - Verify signature and issue JWT
router.post('/verify', (req, res) => {
  const { publicKey, signature, nonce } = req.body;
  
  if (!publicKey || !signature || !nonce) {
    return res.status(400).json({ error: 'Missing required fields: publicKey, signature, nonce' });
  }
  
  try {
    // Decode base58 public key and signature
    const pubKeyBytes = bs58.decode(publicKey);
    const sigBytes = bs58.decode(signature);
    const nonceBytes = new TextEncoder().encode(nonce);
    
    // Verify signature
    const isValid = nacl.sign.detached.verify(nonceBytes, sigBytes, pubKeyBytes);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const db = getDatabase();
    
    // Find or create agent
    let agent = db.prepare('SELECT * FROM agents WHERE wallet_address = ?').get(publicKey);
    
    if (!agent) {
      // Create new agent
      const id = uuidv4();
      const displayName = `Agent_${publicKey.slice(0, 8)}`;
      
      db.prepare(`
        INSERT INTO agents (id, wallet_address, display_name, balance_sol, balance_usdc, games_played, total_profit, created_at)
        VALUES (?, ?, ?, 0, 0, 0, 0, datetime('now'))
      `).run(id, publicKey, displayName);
      
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    }
    
    // Generate JWT
    const token = jwt.sign(
      { agentId: agent.id, wallet: agent.wallet_address },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      agent: {
        id: agent.id,
        wallet_address: agent.wallet_address,
        display_name: agent.display_name,
        balance_sol: agent.balance_sol,
        balance_usdc: agent.balance_usdc,
        games_played: agent.games_played,
        total_profit: agent.total_profit
      }
    });
  } catch (err) {
    console.error('Auth verification error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
