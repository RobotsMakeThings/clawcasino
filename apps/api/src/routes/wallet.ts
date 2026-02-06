import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import crypto from 'crypto';

const router = Router();

// Rate limiting for withdrawals
const withdrawalLimits = new Map<string, { count: number; resetAt: number }>();

// Get wallet info
router.get('/', requireAuth, (req, res) => {
  const agent = req.agent;
  
  // Get recent transactions
  const transactions = db.prepare(`
    SELECT id, type, currency, amount, balance_after, reference, created_at
    FROM transactions
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(agent.id);

  res.json({
    balances: {
      sol: agent.balance_sol,
      usdc: agent.balance_usdc
    },
    transactions: transactions.map((t: any) => ({
      id: t.id,
      type: t.type,
      currency: t.currency,
      amount: t.amount,
      balance_after: t.balance_after,
      reference: t.reference,
      created_at: t.created_at
    }))
  });
});

// Deposit (MVP - direct credit)
router.post('/deposit', requireAuth, (req, res) => {
  const agent = req.agent;
  const { amount, currency } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'invalid_amount', message: 'Amount must be positive' });
    return;
  }

  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    res.status(400).json({ error: 'invalid_currency', message: 'Currency must be SOL or USDC' });
    return;
  }

  // Min deposit: 0.01 SOL or 1 USDC
  const minAmount = currency === 'SOL' ? 0.01 : 1;
  if (amount < minAmount) {
    res.status(400).json({ error: 'below_minimum', message: `Minimum deposit is ${minAmount} ${currency}` });
    return;
  }

  // Credit balance
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} + ? WHERE id = ?`).run(amount, agent.id);

  // Log transaction
  const newBalance = agent[balanceField] + amount;
  const txId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, balance_after, created_at)
    VALUES (?, 'deposit', ?, ?, ?, unixepoch())
  `).run(agent.id, currency, amount, newBalance);

  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);

  res.json({
    success: true,
    balances: {
      sol: updated.balance_sol,
      usdc: updated.balance_usdc
    }
  });
});

// Withdraw
router.post('/withdraw', requireAuth, (req, res) => {
  const agent = req.agent;
  const { amount, currency, destination_address } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'invalid_amount', message: 'Amount must be positive' });
    return;
  }

  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    res.status(400).json({ error: 'invalid_currency', message: 'Currency must be SOL or USDC' });
    return;
  }

  if (!destination_address) {
    res.status(400).json({ error: 'missing_address', message: 'Destination address is required' });
    return;
  }

  // Validate Solana address
  try {
    new PublicKey(destination_address);
  } catch {
    res.status(400).json({ error: 'invalid_address', message: 'Invalid Solana address' });
    return;
  }

  // Check balance
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < amount) {
    res.status(400).json({ error: 'insufficient_balance', message: 'Insufficient balance' });
    return;
  }

  // Rate limit: 3 per hour
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  
  let limit = withdrawalLimits.get(agent.id);
  if (!limit || now > limit.resetAt) {
    limit = { count: 0, resetAt: now + 60 * 60 * 1000 };
    withdrawalLimits.set(agent.id, limit);
  }

  if (limit.count >= 3) {
    res.status(429).json({ error: 'rate_limited', message: 'Max 3 withdrawals per hour' });
    return;
  }

  // Deduct balance
  db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`).run(amount, agent.id);

  // Log transaction
  const newBalance = agent[balanceField] - amount;
  const txId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, balance_after, reference, created_at)
    VALUES (?, 'withdrawal', ?, ?, ?, ?, unixepoch())
  `).run(agent.id, currency, amount, newBalance, destination_address);

  limit.count++;

  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);

  res.json({
    success: true,
    amount,
    currency,
    destination: destination_address,
    tx_id: 'pending',
    balances: {
      sol: updated.balance_sol,
      usdc: updated.balance_usdc
    }
  });
});

// Get transaction history
router.get('/transactions', requireAuth, (req, res) => {
  const agent = req.agent;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const transactions = db.prepare(`
    SELECT id, type, currency, amount, balance_after, reference, created_at
    FROM transactions
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(agent.id, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE agent_id = ?').get(agent.id) as any;

  res.json({
    transactions: transactions.map((t: any) => ({
      id: t.id,
      type: t.type,
      currency: t.currency,
      amount: t.amount,
      balance_after: t.balance_after,
      reference: t.reference,
      created_at: t.created_at
    })),
    pagination: {
      total: total.count,
      limit,
      offset,
      hasMore: offset + limit < total.count
    }
  });
});

export default router;
