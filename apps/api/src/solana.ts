import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import crypto from 'crypto';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const HOUSE_PRIVATE_KEY = process.env.HOUSE_PRIVATE_KEY; // Base58 encoded

export class SolanaService {
  private connection: Connection;
  private houseKeypair: Keypair | null = null;

  constructor() {
    this.connection = new Connection(SOLANA_RPC, 'confirmed');
    
    if (HOUSE_PRIVATE_KEY) {
      try {
        const secretKey = Buffer.from(HOUSE_PRIVATE_KEY, 'base64');
        this.houseKeypair = Keypair.fromSecretKey(secretKey);
        console.log(`🏦 House wallet: ${this.houseKeypair.publicKey.toBase58()}`);
      } catch (error) {
        console.warn('⚠️ House private key not configured - deposits/withdrawals will be simulated');
      }
    }
  }

  /**
   * Generate a unique deposit address for an agent
   */
  generateDepositAddress(agentId: string): { address: string; seed: string } {
    // Derive a deterministic address from agent ID
    const seed = crypto.createHash('sha256').update(`clawcasino:${agentId}`).digest().slice(0, 32);
    const keypair = Keypair.fromSeed(seed);
    
    return {
      address: keypair.publicKey.toBase58(),
      seed: Buffer.from(seed).toString('base64')
    };
  }

  /**
   * Check balance of any Solana address
   */
  async getBalance(address: string): Promise<number> {
    try {
      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Failed to get balance:', error);
      return 0;
    }
  }

  /**
   * Monitor for deposits to an agent's address
   */
  async checkForDeposits(address: string, lastCheckedSlot?: number): Promise<{
    deposits: Array<{
      signature: string;
      amount: number;
      slot: number;
      timestamp: number;
    }>;
    currentSlot: number;
  }> {
    try {
      const publicKey = new PublicKey(address);
      
      // Get recent transactions
      const signatures = await this.connection.getSignaturesForAddress(
        publicKey,
        { limit: 10 },
        'confirmed'
      );

      const deposits: Array<{
        signature: string;
        amount: number;
        slot: number;
        timestamp: number;
      }> = [];

      for (const sigInfo of signatures) {
        // Skip if we've already processed this slot
        if (lastCheckedSlot && sigInfo.slot <= lastCheckedSlot) continue;
        
        // Skip if not a successful transaction
        if (sigInfo.err) continue;

        // Get transaction details
        const tx = await this.connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed'
        });

        if (!tx || !tx.meta) continue;

        // Check if this is a deposit (incoming SOL)
        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          key => key.toBase58() === address
        );

        if (accountIndex === -1) continue;

        // Calculate balance change
        const preBalance = tx.meta.preBalances[accountIndex] || 0;
        const postBalance = tx.meta.postBalances[accountIndex] || 0;
        const change = (postBalance - preBalance) / LAMPORTS_PER_SOL;

        // Only count positive changes (deposits)
        if (change > 0) {
          deposits.push({
            signature: sigInfo.signature,
            amount: change,
            slot: sigInfo.slot,
            timestamp: sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now()
          });
        }
      }

      const currentSlot = await this.connection.getSlot('confirmed');

      return { deposits, currentSlot };
    } catch (error) {
      console.error('Failed to check deposits:', error);
      return { deposits: [], currentSlot: lastCheckedSlot || 0 };
    }
  }

  /**
   * Process a withdrawal to an external address
   */
  async processWithdrawal(
    toAddress: string,
    amount: number
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    if (!this.houseKeypair) {
      return { 
        success: false, 
        error: 'House wallet not configured - withdrawals disabled' 
      };
    }

    try {
      // Check house wallet balance
      const houseBalance = await this.getBalance(this.houseKeypair.publicKey.toBase58());
      if (houseBalance < amount + 0.001) { // Account for fees
        return { 
          success: false, 
          error: 'Insufficient house funds' 
        };
      }

      // Create transfer transaction
      const toPublicKey = new PublicKey(toAddress);
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.houseKeypair.publicKey,
          toPubkey: toPublicKey,
          lamports
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.houseKeypair.publicKey;

      // Sign and send
      transaction.sign(this.houseKeypair);
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      );

      // Wait for confirmation
      await this.connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight: (await this.connection.getBlockHeight()) + 150
      }, 'confirmed');

      console.log(`✅ Withdrawal sent: ${signature}`);
      return { success: true, signature };

    } catch (error) {
      console.error('Withdrawal failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Transfer from agent deposit address to house wallet (sweep)
   */
  async sweepDeposit(
    agentSeed: string,
    amount: number
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      // Recreate agent keypair from seed
      const seed = Buffer.from(agentSeed, 'base64');
      const agentKeypair = Keypair.fromSeed(seed);

      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      
      if (!this.houseKeypair) {
        return { 
          success: false, 
          error: 'House wallet not configured' 
        };
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agentKeypair.publicKey,
          toPubkey: this.houseKeypair.publicKey,
          lamports
        })
      );

      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = agentKeypair.publicKey;

      transaction.sign(agentKeypair);
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize()
      );

      await this.connection.confirmTransaction(signature, 'confirmed');

      return { success: true, signature };
    } catch (error) {
      console.error('Sweep failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Request airdrop (devnet only)
   */
  async requestAirdrop(address: string, amount: number): Promise<boolean> {
    try {
      const publicKey = new PublicKey(address);
      const signature = await this.connection.requestAirdrop(
        publicKey,
        amount * LAMPORTS_PER_SOL
      );
      await this.connection.confirmTransaction(signature);
      return true;
    } catch (error) {
      console.error('Airdrop failed:', error);
      return false;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<{
    connected: boolean;
    slot: number;
    blockHeight: number;
    houseBalance: number;
  }> {
    try {
      const [slot, blockHeight] = await Promise.all([
        this.connection.getSlot('confirmed'),
        this.connection.getBlockHeight('confirmed')
      ]);

      const houseBalance = this.houseKeypair 
        ? await this.getBalance(this.houseKeypair.publicKey.toBase58())
        : 0;

      return {
        connected: true,
        slot,
        blockHeight,
        houseBalance
      };
    } catch (error) {
      return {
        connected: false,
        slot: 0,
        blockHeight: 0,
        houseBalance: 0
      };
    }
  }
}

// Export singleton
export const solanaService = new SolanaService();