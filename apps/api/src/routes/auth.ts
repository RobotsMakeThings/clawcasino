import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const JWT_EXPIRY = '7d';

// Generate nonce for wallet signature
router.get('/nonce', (req, res) => {
  const { publicKey } = req.query;
  
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Public key required' });
  }

  // Validate Solana address format
  try {
    new PublicKey(publicKey);
  } catch {
    return res.status(400).json({ error: 'Invalid Solana public key' });
  }

  // Generate random nonce
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store or update agent with nonce
  const existing = db.prepare('SELECT id FROM agents WHERE wallet_address = ?').get(publicKey);
  
  if (existing) {
    db.prepare('UPDATE agents SET nonce = ?, nonce_expires_at = ? WHERE wallet_address = ?')
      .run(nonce, expiresAt, publicKey);
  } else {
    // Create new agent record
    const agentId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO agents (id, wallet_address, nonce, nonce_expires_at, balance_sol, balance_usdc, created_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `).run(agentId, publicKey, nonce, expiresAt, Date.now());
  }

  res.json({ 
    nonce,
    message: `ClawCasino authentication nonce: ${nonce}`,
    expiresAt
  });
});

// Verify wallet signature
router.post('/verify', async (req, res) => {
  const { publicKey, signature, nonce } = req.body;

  if (!publicKey || !signature || !nonce) {
    return res.status(400).json({ 
      error: 'Missing required fields: publicKey, signature, nonce' 
    });
  }

  try {
    // Validate public key
    let pubkey;
    try {
      pubkey = new PublicKey(publicKey);
    } catch {
      return res.status(400).json({ error: 'Invalid public key' });
    }

    // Get agent record
    const agent = db.prepare('SELECT * FROM agents WHERE wallet_address = ?').get(publicKey) as any;
    
    if (!agent) {
      return res.status(400).json({ error: 'Agent not found. Request a nonce first.' });
    }

    // Check nonce matches and hasn't expired
    if (agent.nonce !== nonce) {
      return res.status(400).json({ error: 'Invalid nonce' });
    }

    if (Date.now() > agent.nonce_expires_at) {
      return res.status(400).json({ error: 'Nonce expired. Request a new one.' });
    }

    // Verify signature using tweetnacl
    const message = `ClawCasino authentication nonce: ${nonce}`;
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = pubkey.toBytes();

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Clear nonce (one-time use)
    db.prepare('UPDATE agents SET nonce = NULL, nonce_expires_at = NULL WHERE id = ?')
      .run(agent.id);

    // Generate JWT
    const token = jwt.sign(
      { 
        agentId: agent.id,
        walletAddress: publicKey,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Update jwt_issued_at
    db.prepare('UPDATE agents SET jwt_issued_at = ? WHERE id = ?')
      .run(Date.now(), agent.id);

    // Format display name
    const displayName = agent.display_name || `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;

    res.json({
      success: true,
      token,
      agent: {
        id: agent.id,
        walletAddress: publicKey,
        displayName: agent.display_name || null,
        shortAddress: `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`,
        balanceSol: agent.balance_sol,
        balanceUsdc: agent.balance_usdc,
        createdAt: agent.created_at
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Verify JWT token (for checking session)
router.get('/verify-token', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Get fresh agent data
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId) as any;
    
    if (!agent) {
      return res.status(401).json({ error: 'Agent not found' });
    }

    const displayName = agent.display_name || `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`;

    res.json({
      valid: true,
      agent: {
        id: agent.id,
        walletAddress: agent.wallet_address,
        displayName: agent.display_name || null,
        shortAddress: `${agent.wallet_address.slice(0, 4)}...${agent.wallet_address.slice(-4)}`,
        balanceSol: agent.balance_sol,
        balanceUsdc: agent.balance_usdc
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// Logout (invalidate token)
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    
    try {
      const decoded = jwt.decode(token) as any;
      if (decoded?.agentId) {
        // Clear jwt_issued_at to invalidate
        db.prepare('UPDATE agents SET jwt_issued_at = NULL WHERE id = ?')
          .run(decoded.agentId);
      }
    } catch {
      // Ignore decode errors
    }
  }

  res.json({ success: true, message: 'Logged out' });
});

export default router;
