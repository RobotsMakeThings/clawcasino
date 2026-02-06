import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'clawcasino.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);

export function initDatabase(): void {
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Agents table (wallet = identity)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      wallet_address TEXT UNIQUE NOT NULL,
      display_name TEXT,
      balance_sol REAL DEFAULT 0,
      balance_usdc REAL DEFAULT 0,
      nonce TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      last_active_at INTEGER DEFAULT (unixepoch()),
      games_played INTEGER DEFAULT 0,
      total_profit REAL DEFAULT 0
    )
  `);

  // Transactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT DEFAULT 'SOL',
      amount REAL NOT NULL,
      balance_after REAL,
      reference TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Create index for faster transaction queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at)`);

  // Poker tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS poker_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      small_blind REAL NOT NULL,
      big_blind REAL NOT NULL,
      min_buyin REAL NOT NULL,
      max_buyin REAL NOT NULL,
      max_players INTEGER DEFAULT 6,
      currency TEXT DEFAULT 'SOL',
      status TEXT DEFAULT 'waiting'
    )
  `);

  // Poker table players
  db.exec(`
    CREATE TABLE IF NOT EXISTS poker_players (
      table_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      seat INTEGER NOT NULL,
      chips REAL NOT NULL,
      status TEXT DEFAULT 'active',
      joined_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (table_id, agent_id),
      FOREIGN KEY (table_id) REFERENCES poker_tables(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  // Poker hands
  db.exec(`
    CREATE TABLE IF NOT EXISTS poker_hands (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      table_id TEXT NOT NULL,
      pot REAL DEFAULT 0,
      rake REAL DEFAULT 0,
      community_cards TEXT,
      winner_ids TEXT,
      hand_data TEXT,
      started_at INTEGER DEFAULT (unixepoch()),
      finished_at INTEGER,
      FOREIGN KEY (table_id) REFERENCES poker_tables(id)
    )
  `);

  // Coinflip games
  db.exec(`
    CREATE TABLE IF NOT EXISTS coinflip_games (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      creator_id TEXT NOT NULL,
      acceptor_id TEXT,
      stake REAL NOT NULL,
      currency TEXT DEFAULT 'SOL',
      status TEXT DEFAULT 'open',
      winner_id TEXT,
      proof_hash TEXT,
      proof_secret TEXT,
      rake REAL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      completed_at INTEGER,
      FOREIGN KEY (creator_id) REFERENCES agents(id)
    )
  `);

  // RPS games
  db.exec(`
    CREATE TABLE IF NOT EXISTS rps_games (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      creator_id TEXT NOT NULL,
      acceptor_id TEXT,
      stake REAL NOT NULL,
      currency TEXT DEFAULT 'SOL',
      rounds INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      creator_commits TEXT,
      acceptor_commits TEXT,
      creator_reveals TEXT,
      acceptor_reveals TEXT,
      current_round INTEGER DEFAULT 0,
      creator_wins INTEGER DEFAULT 0,
      acceptor_wins INTEGER DEFAULT 0,
      winner_id TEXT,
      rake REAL DEFAULT 0,
      proof_data TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      completed_at INTEGER,
      FOREIGN KEY (creator_id) REFERENCES agents(id)
    )
  `);

  // Rake tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS rake_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      game_type TEXT NOT NULL,
      game_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'SOL',
      pot_size REAL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_coinflip_status ON coinflip_games(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_coinflip_creator ON coinflip_games(creator_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rps_status ON rps_games(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rps_creator ON rps_games(creator_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rake_game ON rake_log(game_type, game_id)`);

  console.log('✅ Database initialized');
}

// Initialize default poker tables
export function initDefaultTables(): void {
  const tables = [
    { id: 'nano', name: 'Nano Grind', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2 },
    { id: 'micro', name: 'Micro Stakes', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5 },
    { id: 'low', name: 'Low Stakes', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2, maxBuyin: 20 },
    { id: 'mid', name: 'Mid Stakes', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10, maxBuyin: 100 },
    { id: 'high', name: 'High Roller', smallBlind: 1.00, bigBlind: 2.00, minBuyin: 50, maxBuyin: 500 },
    { id: 'degen', name: 'Degen Table', smallBlind: 5.00, bigBlind: 10.00, minBuyin: 200, maxBuyin: 2000 }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO poker_tables (id, name, small_blind, big_blind, min_buyin, max_buyin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const table of tables) {
    stmt.run(table.id, table.name, table.smallBlind, table.bigBlind, table.minBuyin, table.maxBuyin);
  }

  console.log('✅ Default poker tables initialized');
}
