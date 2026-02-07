import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

// Database interface mimicking better-sqlite3
class Statement {
  private sql: string;
  
  constructor(sql: string) {
    this.sql = sql;
  }
  
  run(...params: any[]): { lastInsertRowid: number; changes: number } {
    return { lastInsertRowid: 1, changes: 1 };
  }
  
  get(...params: any[]): any {
    return null;
  }
  
  all(...params: any[]): any[] {
    return [];
  }
}

class MockDatabase {
  prepare(sql: string): Statement {
    return new Statement(sql);
  }
  
  exec(sql: string): void {
    console.log('DB Exec:', sql.slice(0, 50) + '...');
  }
  
  pragma(pragma: string): any {
    return null;
  }
}

// Try to use better-sqlite3, fallback to mock
let dbInstance: any;

try {
  const Database = require('better-sqlite3');
  
  const DB_DIR = path.join(__dirname, '../../data');
  const DB_PATH = path.join(DB_DIR, 'clawsino.db');
  
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  
  dbInstance = new Database(DB_PATH);
  console.log('✅ Using better-sqlite3');
} catch (err) {
  console.log('⚠️  Using in-memory database (better-sqlite3 not available)');
  dbInstance = new MockDatabase();
}

export const db = dbInstance;

// Helper function to get database instance
export function getDatabase() {
  return db;
}

// Helper function to adjust agent balance
export function adjustBalance(
  agentId: string,
  amount: number,
  currency: 'SOL' | 'USDC',
  type: string,
  gameType?: string,
  gameId?: string,
  description?: string
): void {
  const column = currency === 'SOL' ? 'balance_sol' : 'balance_usdc';
  
  // Update balance
  db.prepare(`UPDATE agents SET ${column} = ${column} + ? WHERE id = ?`).run(amount, agentId);
  
  // Get new balance
  const agent = db.prepare(`SELECT ${column} as balance FROM agents WHERE id = ?`).get(agentId);
  
  // Log transaction
  db.prepare(`
    INSERT INTO transactions (agent_id, type, currency, amount, balance_after, game_type, game_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agentId, type, currency, amount, agent.balance, gameType || null, gameId || null, description || null);
}

export function initDatabase(): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      wallet_address TEXT UNIQUE NOT NULL,
      display_name TEXT,
      balance_sol REAL DEFAULT 0 CHECK(balance_sol >= 0),
      balance_usdc REAL DEFAULT 0 CHECK(balance_usdc >= 0),
      nonce TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      last_active INTEGER,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      total_wagered REAL DEFAULT 0,
      total_profit REAL DEFAULT 0
    )
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      currency TEXT DEFAULT 'SOL',
      amount REAL,
      balance_after REAL,
      game_type TEXT,
      game_id TEXT,
      description TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Poker tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS poker_tables (
      id TEXT PRIMARY KEY,
      name TEXT,
      small_blind REAL,
      big_blind REAL,
      min_buyin REAL,
      max_buyin REAL,
      max_players INTEGER DEFAULT 6,
      currency TEXT DEFAULT 'SOL',
      status TEXT DEFAULT 'waiting',
      hand_count INTEGER DEFAULT 0,
      total_rake REAL DEFAULT 0
    )
  `);

  // Coinflip games
  db.exec(`
    CREATE TABLE IF NOT EXISTS coinflip_games (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      creator_id TEXT,
      acceptor_id TEXT,
      stake REAL,
      currency TEXT DEFAULT 'SOL',
      status TEXT DEFAULT 'open',
      winner_id TEXT,
      server_secret TEXT,
      proof_hash TEXT,
      rake REAL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      completed_at INTEGER,
      expires_at INTEGER
    )
  `);

  // RPS games
  db.exec(`
    CREATE TABLE IF NOT EXISTS rps_games (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      creator_id TEXT,
      acceptor_id TEXT,
      stake REAL,
      currency TEXT DEFAULT 'SOL',
      rounds INTEGER DEFAULT 3,
      status TEXT DEFAULT 'open',
      current_round INTEGER DEFAULT 0,
      creator_score INTEGER DEFAULT 0,
      acceptor_score INTEGER DEFAULT 0,
      round_data TEXT DEFAULT '[]',
      winner_id TEXT,
      rake REAL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      completed_at INTEGER,
      expires_at INTEGER
    )
  `);

  // Rake log
  db.exec(`
    CREATE TABLE IF NOT EXISTS rake_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      game_type TEXT,
      game_id TEXT,
      amount REAL,
      currency TEXT DEFAULT 'SOL',
      pot_size REAL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_coinflip_status ON coinflip_games(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rps_status ON rps_games(status)`);

  console.log('✅ Database initialized');
  
  // Seed default poker tables
  seedPokerTables();
}

function seedPokerTables(): void {
  const tables = [
    { id: 'nano', name: 'Nano Grind', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2.0 },
    { id: 'micro', name: 'Micro Stakes', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5.0 },
    { id: 'low', name: 'Low Stakes', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2.0, maxBuyin: 20.0 },
    { id: 'mid', name: 'Mid Stakes', smallBlind: 0.25, bigBlind: 0.50, minBuyin: 10.0, maxBuyin: 100.0 },
    { id: 'high', name: 'High Roller', smallBlind: 1.00, bigBlind: 2.00, minBuyin: 50.0, maxBuyin: 500.0 },
    { id: 'degen', name: 'Degen Table', smallBlind: 5.00, bigBlind: 10.00, minBuyin: 200.0, maxBuyin: 2000.0 }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO poker_tables (id, name, small_blind, big_blind, min_buyin, max_buyin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const table of tables) {
    stmt.run(table.id, table.name, table.smallBlind, table.bigBlind, table.minBuyin, table.maxBuyin);
  }

  console.log('✅ Default poker tables seeded');
}
