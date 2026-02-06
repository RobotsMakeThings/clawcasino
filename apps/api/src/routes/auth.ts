import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'clawcasino-jwt-secret-change-me';

// Generate nonce
router.get('/nonce', (req, res) => {
  const nonce = uuidv4();
  res.json({ nonce });
});

// Verify signature and authenticate
router.post('/verify', (req, res) => {
  const { publicKey, signature, nonce } = req.body;

  if (!publicKey || !signature || !nonce) {
    res.status(400).json({ 
      error: 'missing_fields', 
      message: 'publicKey, signature, and nonce are required' 
    });
    return;
  }

  try {
    // Validate public key format
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(publicKey);
    } catch {
      res.status(400).json({ error: 'invalid_key', message: 'Invalid Solana public key' });
      return;
    }

    // Verify signature
    const message = new TextEncoder().encode(nonce);
    const signatureBytes = Buffer.from(signature, 'base64');
    const publicKeyBytes = pubkey.toBytes();

    const isValid = nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);

    if (!isValid) {
      res.status(401).json({ error: 'invalid_signature', message: 'Signature verification failed' });
      return;
    }

    // Find or create agent
    let agent = db.prepare('SELECT * FROM agents WHERE wallet_address = ?').get(publicKey) as any;

    if (!agent) {
      // Create new agent
      const result = db.prepare(`
        INSERT INTO agents (wallet_address, created_at)
        VALUES (?, unixepoch())
      `).run(publicKey);

      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.lastInsertRowid);
    }

    // Generate JWT (24 hour expiry)
    const token = jwt.sign(
      { agentId: agent.id, walletAddress: publicKey },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      agent: {
        id: agent.id,
        wallet_address: agent.wallet_address,
        display_name: agent.display_name,
        balance_sol: agent.balance_sol,
        balance_usdc: agent.balance_usdc
      }
    });
  } catch (error) {
    console.error('Auth verify error:', error);
    res.status(500).json({ error: 'verification_failed', message: 'Authentication failed' });
  }
});

export default router;
