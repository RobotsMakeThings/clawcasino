import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'casino.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize database schema
export function initDatabase(): void {
  // Agents table - wallet-based identity
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      wallet_address TEXT UNIQUE NOT NULL,
      display_name TEXT,
      balance_sol REAL DEFAULT 0,
      balance_usdc REAL DEFAULT 0,
      
      -- Deposit wallet (hot wallet sweep pattern)
      deposit_address TEXT UNIQUE,
      deposit_private_key TEXT, -- encrypted
      
      -- Auth
      nonce TEXT,
      nonce_expires_at INTEGER,
      jwt_issued_at INTEGER,
      
      -- Stats
      games_played INTEGER DEFAULT 0,
      total_profit REAL DEFAULT 0,
      biggest_pot_won REAL DEFAULT 0,
      hands_won INTEGER DEFAULT 0,
      hands_played INTEGER DEFAULT 0,
      
      -- Timestamps
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      last_active_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // Tables table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      small_blind REAL NOT NULL,
      big_blind REAL NOT NULL,
      min_buyin REAL NOT NULL,
      max_buyin REAL NOT NULL,
      max_players INTEGER DEFAULT 6,
      status TEXT DEFAULT 'active',
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // Table players
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_players (
      table_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      seat INTEGER NOT NULL,
      chips REAL NOT NULL,
      status TEXT DEFAULT 'active',
      joined_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY (table_id, agent_id),
      FOREIGN KEY (table_id) REFERENCES tables(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Hands table
  db.exec(`
    CREATE TABLE IF NOT EXISTS hands (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL,
      hand_number INTEGER NOT NULL,
      pot REAL DEFAULT 0,
      rake REAL DEFAULT 0,
      community_cards TEXT,
      winner_id TEXT,
      started_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      finished_at INTEGER,
      FOREIGN KEY (table_id) REFERENCES tables(id),
      FOREIGN KEY (winner_id) REFERENCES agents(id)
    )
  `);

  // Hand actions
  db.exec(`
    CREATE TABLE IF NOT EXISTS hand_actions (
      id TEXT PRIMARY KEY,
      hand_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      amount REAL,
      phase TEXT NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (hand_id) REFERENCES hands(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Transactions (deposits, withdrawals, game transactions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'win', 'loss', 'rake'
      currency TEXT NOT NULL, -- 'SOL' or 'USDC'
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      
      -- For blockchain transactions
      tx_signature TEXT,
      from_address TEXT,
      to_address TEXT,
      
      -- Status tracking
      status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
      confirmations INTEGER DEFAULT 0,
      
      -- Metadata
      note TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      confirmed_at INTEGER,
      
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Create indexes for transactions
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);

  // Withdrawal rate limiting
  db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawal_limits (
      agent_id TEXT PRIMARY KEY,
      hour_count INTEGER DEFAULT 0,
      hour_reset_at INTEGER,
      day_count INTEGER DEFAULT 0,
      day_reset_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Game stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_wagered_sol REAL DEFAULT 0,
      total_wagered_usdc REAL DEFAULT 0,
      total_hands INTEGER DEFAULT 0,
      total_rake_sol REAL DEFAULT 0,
      total_rake_usdc REAL DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);
  db.prepare('INSERT OR IGNORE INTO game_stats (id) VALUES (1)').run();

  // House wallet
  db.exec(`
    CREATE TABLE IF NOT EXISTS house_wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      address TEXT,
      private_key TEXT, -- encrypted
      balance_sol REAL DEFAULT 0,
      balance_usdc REAL DEFAULT 0,
      total_rake_sol REAL DEFAULT 0,
      total_rake_usdc REAL DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // Deposit tracking (for sweep job)
  db.exec(`
    CREATE TABLE IF NOT EXISTS deposit_tracking (
      agent_id TEXT PRIMARY KEY,
      last_checked_slot INTEGER DEFAULT 0,
      last_sweep_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  console.log('✅ Database initialized');
}

export { db };
