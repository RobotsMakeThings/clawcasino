import { db } from '../db';
import crypto from 'crypto';

interface AdjustBalanceOptions {
  type: string;
  description?: string;
  gameType?: string;
  gameId?: string;
}

interface AdjustBalanceResult {
  newBalance: number;
  transactionId: string;
}

/**
 * THIS IS THE ONLY FUNCTION THAT MODIFIES AGENT BALANCES
 * All balance changes must go through this function to ensure:
 * - Balance never goes negative
 * - Every transaction is logged
 * - Audit trail is complete
 * 
 * @param agentId - The agent ID
 * @param amount - Amount to add (positive) or deduct (negative)
 * @param currency - 'SOL' or 'USDC'
 * @param opts - Transaction details
 * @returns { newBalance, transactionId }
 */
export function adjustBalance(
  agentId: string,
  amount: number,
  currency: 'SOL' | 'USDC',
  opts: AdjustBalanceOptions
): AdjustBalanceResult {
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  
  // Get current balance
  const agent = db.prepare(`SELECT ${balanceField} as balance FROM agents WHERE id = ?`).get(agentId) as any;
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  const currentBalance = agent.balance || 0;
  const newBalance = currentBalance + amount;
  
  // Check if deducting would make balance negative
  if (amount < 0 && newBalance < 0) {
    throw new Error(`Insufficient balance: ${currentBalance} ${currency}, attempted to deduct ${Math.abs(amount)}`);
  }
  
  // Update balance
  db.prepare(`UPDATE agents SET ${balanceField} = ? WHERE id = ?`).run(newBalance, agentId);
  
  // Log transaction
  const transactionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO transactions (id, agent_id, type, currency, amount, balance_after, game_type, game_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    transactionId,
    agentId,
    opts.type,
    currency,
    amount,
    newBalance,
    opts.gameType || null,
    opts.gameId || null,
    opts.description || null
  );
  
  return { newBalance, transactionId };
}

/**
 * Get agent balance
 */
export function getBalance(agentId: string): { sol: number; usdc: number } {
  const agent = db.prepare('SELECT balance_sol, balance_usdc FROM agents WHERE id = ?').get(agentId) as any;
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  return {
    sol: agent.balance_sol || 0,
    usdc: agent.balance_usdc || 0
  };
}
