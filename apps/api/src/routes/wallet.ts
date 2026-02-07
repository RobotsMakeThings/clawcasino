import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getDatabase, adjustBalance } from '../db';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// GET /api/wallet - Get wallet balances
router.get('/', (req: AuthRequest, res) => {
  res.json({
    balance_sol: req.agent!.balance_sol,
    balance_usdc: req.agent!.balance_usdc
  });
});

// POST /api/wallet/deposit - Deposit funds (MVP: credit directly)
router.post('/deposit', (req: AuthRequest, res) => {
  const { amount, currency } = req.body;
  
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    return res.status(400).json({ error: 'Invalid currency. Use SOL or USDC' });
  }
  
  try {
    const db = getDatabase();
    
    // Credit the balance
    adjustBalance(req.agent!.id, amount, currency as 'SOL' | 'USDC', 'deposit');
    
    // Get updated balances
    const agent = db.prepare(`SELECT balance_sol, balance_usdc FROM agents WHERE id = ?`).get(req.agent!.id);
    
    res.json({
      balance_sol: agent.balance_sol,
      balance_usdc: agent.balance_usdc,
      transaction_id: uuidv4()
    });
  } catch (err) {
    console.error('Deposit error:', err);
    return res.status(500).json({ error: 'Deposit failed' });
  }
});

// POST /api/wallet/withdraw - Withdraw funds
router.post('/withdraw', (req: AuthRequest, res) => {
  const { amount, currency } = req.body;
  
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  if (!currency || !['SOL', 'USDC'].includes(currency)) {
    return res.status(400).json({ error: 'Invalid currency. Use SOL or USDC' });
  }
  
  const isSol = currency === 'SOL';
  const currentBalance = isSol ? req.agent!.balance_sol : req.agent!.balance_usdc;
  
  if (amount > currentBalance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  
  try {
    const db = getDatabase();
    
    // Debit the balance
    adjustBalance(req.agent!.id, -amount, currency as 'SOL' | 'USDC', 'withdrawal');
    
    // Get updated balances
    const agent = db.prepare(`SELECT balance_sol, balance_usdc FROM agents WHERE id = ?`).get(req.agent!.id);
    
    res.json({
      balance_sol: agent.balance_sol,
      balance_usdc: agent.balance_usdc,
      transaction_id: uuidv4()
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    return res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// GET /api/wallet/transactions - Get transaction history
router.get('/transactions', (req: AuthRequest, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  
  try {
    const db = getDatabase();
    
    const transactions = db.prepare(`
      SELECT id, type, amount, currency, description, created_at
      FROM transactions
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.agent!.id, limit, offset);
    
    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM transactions WHERE agent_id = ?
    `).get(req.agent!.id);
    
    res.json({
      transactions: transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        status: 'completed',
        timestamp: Math.floor(new Date(t.created_at).getTime() / 1000)
      })),
      pagination: {
        total: countRow.total,
        limit,
        offset,
        hasMore: offset + limit < countRow.total
      }
    });
  } catch (err) {
    console.error('Transaction history error:', err);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
