import { Router } from 'express';
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import crypto from 'crypto';
import { db } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

// USDC mint addresses
const USDC_MINT = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
};

const NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const USDC_MINT_ADDRESS = USDC_MINT[NETWORK as keyof typeof USDC_MINT];

// Solana connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  'confirmed'
);

// House wallet
let houseKeypair: Keypair | null = null;
try {
  const housePrivateKey = process.env.HOUSE_WALLET_PRIVATE_KEY;
  if (housePrivateKey) {
    const decoded = Buffer.from(housePrivateKey, 'base64');
    houseKeypair = Keypair.fromSecretKey(decoded);
    console.log(`🏦 House wallet: ${houseKeypair.publicKey.toBase58()}`);
  }
} catch (err) {
  console.warn('⚠️ House wallet not configured');
}

// Auth middleware
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId);
    
    if (!agent) {
      return res.status(401).json({ error: 'Agent not found' });
    }

    req.agent = agent;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Get or create deposit address for agent
async function getOrCreateDepositAddress(agentId: string): Promise<{ address: string; keypair: Keypair }> {
  const agent = db.prepare('SELECT deposit_address, deposit_private_key FROM agents WHERE id = ?').get(agentId) as any;
  
  if (agent?.deposit_address && agent?.deposit_private_key) {
    // Decrypt and return existing
    const secretKey = Buffer.from(agent.deposit_private_key, 'base64');
    return { address: agent.deposit_address, keypair: Keypair.fromSecretKey(secretKey) };
  }

  // Generate new keypair
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  
  // Encrypt private key (simple base64 for now - use proper encryption in production)
  const encryptedKey = Buffer.from(keypair.secretKey).toString('base64');
  
  // Store in DB
  db.prepare('UPDATE agents SET deposit_address = ?, deposit_private_key = ? WHERE id = ?')
    .run(address, encryptedKey, agentId);
  
  // Initialize deposit tracking
  db.prepare('INSERT OR IGNORE INTO deposit_tracking (agent_id) VALUES (?)').run(agentId);
  
  return { address, keypair };
}

// Get wallet info
router.get('/', requireAuth, async (req, res) => {
  const agent = req.agent;
  
  // Get deposit address
  const { address } = await getOrCreateDepositAddress(agent.id);
  
  // Get recent transactions
  const transactions = db.prepare(`
    SELECT * FROM transactions 
    WHERE agent_id = ? 
    ORDER BY created_at DESC 
    LIMIT 10
  `).all(agent.id);

  res.json({
    balances: {
      sol: agent.balance_sol,
      usdc: agent.balance_usdc
    },
    depositAddress: address,
    recentTransactions: transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      currency: tx.currency,
      amount: tx.amount,
      status: tx.status,
      txSignature: tx.tx_signature,
      createdAt: tx.created_at
    }))
  });
});

// Get deposit address
router.get('/deposit-address', requireAuth, async (req, res) => {
  const agent = req.agent;
  const { address } = await getOrCreateDepositAddress(agent.id);
  
  res.json({
    address,
    qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${address}`,
    network: NETWORK,
    supportedCurrencies: ['SOL', 'USDC'],
    minDeposit: {
      sol: 0.001,
      usdc: 1
    }
  });
});

// Check for deposits and sweep (called by background job)
async function sweepDeposits() {
  if (!houseKeypair) {
    console.warn('House wallet not configured, skipping sweep');
    return;
  }

  const agents = db.prepare(`
    SELECT a.id, a.deposit_address, a.deposit_private_key, a.balance_sol, a.balance_usdc,
           d.last_checked_slot
    FROM agents a
    LEFT JOIN deposit_tracking d ON a.id = d.agent_id
    WHERE a.deposit_address IS NOT NULL
  `).all() as any[];

  for (const agent of agents) {
    try {
      if (!agent.deposit_private_key) continue;

      const keypair = Keypair.fromSecretKey(Buffer.from(agent.deposit_private_key, 'base64'));
      const publicKey = keypair.publicKey;

      // Check SOL balance
      const solBalance = await connection.getBalance(publicKey);
      const solBalanceFloat = solBalance / LAMPORTS_PER_SOL;

      if (solBalanceFloat > 0.001) { // Min 0.001 SOL to sweep
        console.log(`Sweeping ${solBalanceFloat} SOL from ${agent.deposit_address}`);

        // Create sweep transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: houseKeypair.publicKey,
            lamports: solBalance - 5000 // Reserve 5000 lamports for fees
          })
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        transaction.sign(keypair);

        const signature = await connection.sendRawTransaction(transaction.serialize());
        await connection.confirmTransaction(signature, 'confirmed');

        // Credit agent's balance
        const amount = (solBalance - 5000) / LAMPORTS_PER_SOL;
        db.prepare('UPDATE agents SET balance_sol = balance_sol + ? WHERE id = ?')
          .run(amount, agent.id);

        // Log transaction
        const txId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO transactions (id, agent_id, type, currency, amount, tx_signature, status, confirmed_at)
          VALUES (?, ?, 'deposit', 'SOL', ?, ?, 'confirmed', ?)
        `).run(txId, agent.id, amount, signature, Date.now());

        console.log(`✅ Swept ${amount} SOL from ${agent.deposit_address}, tx: ${signature}`);
      }

      // Check USDC balance
      try {
        const usdcMint = new PublicKey(USDC_MINT_ADDRESS);
        const tokenAccount = await getAssociatedTokenAddress(usdcMint, publicKey);
        const accountInfo = await getAccount(connection, tokenAccount);
        const usdcBalance = Number(accountInfo.amount) / 1_000_000; // USDC has 6 decimals

        if (usdcBalance >= 1) { // Min 1 USDC to sweep
          console.log(`Sweeping ${usdcBalance} USDC from ${agent.deposit_address}`);

          // Create USDC transfer
          const transaction = new Transaction().add(
            createTransferInstruction(
              tokenAccount,
              await getAssociatedTokenAddress(usdcMint, houseKeypair.publicKey),
              publicKey,
              BigInt(Math.floor(usdcBalance * 1_000_000))
            )
          );

          const { blockhash } = await connection.getLatestBlockhash();
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = publicKey;
          transaction.sign(keypair);

          const signature = await connection.sendRawTransaction(transaction.serialize());
          await connection.confirmTransaction(signature, 'confirmed');

          // Credit agent's balance
          db.prepare('UPDATE agents SET balance_usdc = balance_usdc + ? WHERE id = ?')
            .run(usdcBalance, agent.id);

          // Log transaction
          const txId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO transactions (id, agent_id, type, currency, amount, tx_signature, status, confirmed_at)
            VALUES (?, ?, 'deposit', 'USDC', ?, ?, 'confirmed', ?)
          `).run(txId, agent.id, usdcBalance, signature, Date.now());

          console.log(`✅ Swept ${usdcBalance} USDC from ${agent.deposit_address}, tx: ${signature}`);
        }
      } catch (err) {
        // Token account doesn't exist yet, ignore
      }

      // Update last checked
      const slot = await connection.getSlot();
      db.prepare(`
        INSERT OR REPLACE INTO deposit_tracking (agent_id, last_checked_slot, last_sweep_at)
        VALUES (?, ?, ?)
      `).run(agent.id, slot, Date.now());

    } catch (err) {
      console.error(`Failed to sweep deposits for ${agent.deposit_address}:`, err);
    }
  }
}

// Withdrawal
router.post('/withdraw', requireAuth, async (req, res) => {
  const agent = req.agent;
  const { currency, amount, destinationAddress } = req.body;

  // Validation
  if (!currency || !amount || !destinationAddress) {
    return res.status(400).json({ error: 'Missing required fields: currency, amount, destinationAddress' });
  }

  if (!['SOL', 'USDC'].includes(currency)) {
    return res.status(400).json({ error: 'Currency must be SOL or USDC' });
  }

  // Validate amount
  const minAmount = currency === 'SOL' ? 0.01 : 1;
  if (amount < minAmount) {
    return res.status(400).json({ error: `Minimum withdrawal is ${minAmount} ${currency}` });
  }

  // Validate Solana address
  let destPublicKey: PublicKey;
  try {
    destPublicKey = new PublicKey(destinationAddress);
  } catch {
    return res.status(400).json({ error: 'Invalid destination address' });
  }

  // Check balance
  const balanceField = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  if (agent[balanceField] < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Rate limiting
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  let limits = db.prepare('SELECT * FROM withdrawal_limits WHERE agent_id = ?').get(agent.id) as any;
  
  if (!limits) {
    db.prepare('INSERT INTO withdrawal_limits (agent_id, hour_reset_at, day_reset_at) VALUES (?, ?, ?)')
      .run(agent.id, now + 60 * 60 * 1000, now + 24 * 60 * 60 * 1000);
    limits = { hour_count: 0, day_count: 0 };
  }

  // Reset counters if needed
  if (limits.hour_reset_at < now) {
    db.prepare('UPDATE withdrawal_limits SET hour_count = 0, hour_reset_at = ? WHERE agent_id = ?')
      .run(now + 60 * 60 * 1000, agent.id);
    limits.hour_count = 0;
  }

  if (limits.day_reset_at < now) {
    db.prepare('UPDATE withdrawal_limits SET day_count = 0, day_reset_at = ? WHERE agent_id = ?')
      .run(now + 24 * 60 * 60 * 1000, agent.id);
    limits.day_count = 0;
  }

  // Check limits: 3 per hour, 10 per day
  if (limits.hour_count >= 3) {
    return res.status(429).json({ error: 'Withdrawal limit reached: max 3 per hour' });
  }

  if (limits.day_count >= 10) {
    return res.status(429).json({ error: 'Withdrawal limit reached: max 10 per day' });
  }

  if (!houseKeypair) {
    return res.status(500).json({ error: 'House wallet not configured' });
  }

  try {
    let signature: string;

    if (currency === 'SOL') {
      // SOL withdrawal
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: houseKeypair.publicKey,
          toPubkey: destPublicKey,
          lamports
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = houseKeypair.publicKey;
      transaction.sign(houseKeypair);

      signature = await connection.sendRawTransaction(transaction.serialize());
      await connection.confirmTransaction(signature, 'confirmed');

    } else {
      // USDC withdrawal
      const usdcMint = new PublicKey(USDC_MINT_ADDRESS);
      const sourceAccount = await getAssociatedTokenAddress(usdcMint, houseKeypair.publicKey);
      const destAccount = await getAssociatedTokenAddress(usdcMint, destPublicKey);

      const transaction = new Transaction().add(
        createTransferInstruction(
          sourceAccount,
          destAccount,
          houseKeypair.publicKey,
          BigInt(Math.floor(amount * 1_000_000))
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = houseKeypair.publicKey;
      transaction.sign(houseKeypair);

      signature = await connection.sendRawTransaction(transaction.serialize());
      await connection.confirmTransaction(signature, 'confirmed');
    }

    // Deduct from agent balance
    db.prepare(`UPDATE agents SET ${balanceField} = ${balanceField} - ? WHERE id = ?`)
      .run(amount, agent.id);

    // Update rate limits
    db.prepare(`
      UPDATE withdrawal_limits 
      SET hour_count = hour_count + 1, day_count = day_count + 1 
      WHERE agent_id = ?
    `).run(agent.id);

    // Log transaction
    const txId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO transactions (id, agent_id, type, currency, amount, to_address, tx_signature, status, confirmed_at)
      VALUES (?, ?, 'withdrawal', ?, ?, ?, ?, 'confirmed', ?)
    `).run(txId, agent.id, currency, amount, destinationAddress, signature, Date.now());

    res.json({
      success: true,
      txSignature: signature,
      amount,
      currency,
      destination: destinationAddress,
      remainingHourly: 3 - (limits.hour_count + 1),
      remainingDaily: 10 - (limits.day_count + 1)
    });

  } catch (err) {
    console.error('Withdrawal failed:', err);
    res.status(500).json({ error: 'Withdrawal failed', details: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Get transaction history
router.get('/transactions', requireAuth, (req, res) => {
  const agent = req.agent;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const transactions = db.prepare(`
    SELECT * FROM transactions 
    WHERE agent_id = ? 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(agent.id, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE agent_id = ?').get(agent.id) as any;

  res.json({
    transactions: transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      currency: tx.currency,
      amount: tx.amount,
      fee: tx.fee,
      status: tx.status,
      txSignature: tx.tx_signature,
      fromAddress: tx.from_address,
      toAddress: tx.to_address,
      note: tx.note,
      createdAt: tx.created_at,
      confirmedAt: tx.confirmed_at
    })),
    pagination: {
      total: total.count,
      limit,
      offset,
      hasMore: offset + limit < total.count
    }
  });
});

// Manual sweep endpoint (for testing)
router.post('/sweep', requireAuth, async (req, res) => {
  if (!houseKeypair) {
    return res.status(500).json({ error: 'House wallet not configured' });
  }

  await sweepDeposits();
  res.json({ success: true, message: 'Sweep completed' });
});

// Start background sweep job (every 30 seconds)
setInterval(() => {
  if (houseKeypair) {
    sweepDeposits().catch(console.error);
  }
}, 30000);

export default router;
export { sweepDeposits };
