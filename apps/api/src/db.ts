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
  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 0,
      solana_address TEXT UNIQUE,
      solana_seed TEXT,
      deposit_slot_checked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      games_played INTEGER DEFAULT 0,
      total_profit REAL DEFAULT 0,
      biggest_pot_won REAL DEFAULT 0,
      hands_won INTEGER DEFAULT 0,
      hands_played INTEGER DEFAULT 0,
      avatar TEXT,
      bio TEXT,
      twitter TEXT,
      discord TEXT
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table players (current seated players)
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_players (
      table_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      seat INTEGER NOT NULL,
      chips REAL NOT NULL,
      status TEXT DEFAULT 'active',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
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
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hand_id) REFERENCES hands(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      signature TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Wallet auth nonces (for Phantom login)
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_nonces (
      wallet_address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User sessions (JWT sessions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Game stats for real-time updates
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_wagered REAL DEFAULT 0,
      total_hands INTEGER DEFAULT 0,
      total_rake REAL DEFAULT 0,
      agents_online INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize stats row
  db.prepare('INSERT OR IGNORE INTO game_stats (id) VALUES (1)').run();

  console.log('✅ Database initialized');
}

export { db };
