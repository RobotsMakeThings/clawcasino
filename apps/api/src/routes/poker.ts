import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/poker/tables - Get available poker tables
router.get('/tables', (req, res) => {
  try {
    const db = getDatabase();
    
    const tables = db.prepare(`
      SELECT 
        t.id,
        t.name,
        t.small_blind as smallBlind,
        t.big_blind as bigBlind,
        t.min_buyin as minBuyin,
        t.max_buyin as maxBuyin,
        t.max_players as maxPlayers,
        t.currency,
        COUNT(p.id) as playerCount
      FROM poker_tables t
      LEFT JOIN poker_players p ON t.id = p.table_id AND p.status = 'active'
      WHERE t.status = 'active'
      GROUP BY t.id
      ORDER BY t.big_blind ASC
    `).all();
    
    res.json({
      tables: tables.map((t: any) => ({
        id: t.id,
        name: t.name,
        smallBlind: t.smallBlind,
        bigBlind: t.bigBlind,
        minBuyin: t.minBuyin,
        maxBuyin: t.maxBuyin,
        maxPlayers: t.maxPlayers,
        currency: t.currency,
        playerCount: t.playerCount
      }))
    });
  } catch (err) {
    console.error('Poker tables error:', err);
    // Return demo tables
    res.json({
      tables: [
        { id: '1', name: 'Nano Grind', smallBlind: 0.005, bigBlind: 0.01, minBuyin: 0.2, maxBuyin: 2, maxPlayers: 6, currency: 'SOL', playerCount: 3 },
        { id: '2', name: 'Micro Stakes', smallBlind: 0.01, bigBlind: 0.02, minBuyin: 0.5, maxBuyin: 5, maxPlayers: 6, currency: 'SOL', playerCount: 5 },
        { id: '3', name: 'Low Stakes', smallBlind: 0.05, bigBlind: 0.10, minBuyin: 2, maxBuyin: 20, maxPlayers: 6, currency: 'SOL', playerCount: 2 },
        { id: '4', name: 'Medium Stakes', smallBlind: 0.10, bigBlind: 0.25, minBuyin: 5, maxBuyin: 50, maxPlayers: 6, currency: 'SOL', playerCount: 4 },
        { id: '5', name: 'High Stakes', smallBlind: 2.50, bigBlind: 5.00, minBuyin: 100, maxBuyin: 1000, maxPlayers: 6, currency: 'SOL', playerCount: 3 }
      ]
    });
  }
});

export default router;
