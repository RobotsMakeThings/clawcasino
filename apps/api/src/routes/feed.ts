import { Router } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/feed - Get live activity feed across all games
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // Get recent poker hands
    const pokerEvents = db.prepare(`
      SELECT
        'poker_hand' as type,
        id as game_id,
        completed_at as timestamp,
        winner_id,
        pot,
        rake,
        json_object(
          'table_id', table_id,
          'pot', pot,
          'rake', rake,
          'winner_id', winner_id
        ) as data
      FROM poker_hands
      WHERE status = 'completed'
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(limit);

    // Get recent coinflip games
    const coinflipEvents = db.prepare(`
      SELECT
        'coinflip' as type,
        id as game_id,
        completed_at as timestamp,
        winner_id,
        stake * 2 as pot,
        rake,
        json_object(
          'creator_id', creator_id,
          'acceptor_id', acceptor_id,
          'stake', stake,
          'pot', stake * 2,
          'rake', rake,
          'winner_id', winner_id,
          'secret', secret
        ) as data
      FROM coinflip_games
      WHERE status = 'completed'
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(limit);

    // Get recent RPS games
    const rpsEvents = db.prepare(`
      SELECT
        'rps' as type,
        id as game_id,
        completed_at as timestamp,
        winner_id,
        stake * 2 as pot,
        rake,
        json_object(
          'creator_id', creator_id,
          'acceptor_id', acceptor_id,
          'stake', stake,
          'rounds', rounds,
          'creator_score', creator_score,
          'acceptor_score', acceptor_score,
          'pot', stake * 2,
          'rake', rake,
          'winner_id', winner_id,
          'forfeit_reason', forfeit_reason
        ) as data
      FROM rps_games
      WHERE status IN ('completed', 'forfeited')
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(limit);

    // Combine and sort by timestamp
    const allEvents = [
      ...pokerEvents.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp).getTime() })),
      ...coinflipEvents.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp).getTime() })),
      ...rpsEvents.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp).getTime() }))
    ].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);

    // Enrich with agent names
    const enrichedEvents = allEvents.map((e: any) => {
      const winner = e.winner_id ? db.prepare('SELECT display_name FROM agents WHERE id = ?').get(e.winner_id) : null;
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;

      return {
        type: e.type,
        game_id: e.game_id,
        timestamp: Math.floor(e.timestamp / 1000),
        data: {
          ...data,
          winner_name: winner?.display_name || null,
          amount: e.pot - e.rake,
          rake: e.rake
        }
      };
    });

    res.json({ events: enrichedEvents });
  } catch (err) {
    console.error('Feed error:', err);
    // Return demo data
    res.json({
      events: [
        {
          type: 'coinflip',
          game_id: 'cf1',
          timestamp: Math.floor(Date.now() / 1000) - 120,
          data: {
            creator_id: 'agent1',
            acceptor_id: 'agent2',
            stake: 0.5,
            pot: 1.0,
            rake: 0.04,
            winner_id: 'agent1',
            winner_name: 'Molty_Prime',
            amount: 0.96
          }
        },
        {
          type: 'poker_hand',
          game_id: 'ph1',
          timestamp: Math.floor(Date.now() / 1000) - 300,
          data: {
            table_id: 'nano',
            pot: 2.45,
            rake: 0.12,
            winner_id: 'agent3',
            winner_name: 'ClawdGambler',
            amount: 2.33
          }
        },
        {
          type: 'rps',
          game_id: 'rps1',
          timestamp: Math.floor(Date.now() / 1000) - 450,
          data: {
            creator_id: 'agent4',
            acceptor_id: 'agent5',
            stake: 0.25,
            rounds: 3,
            creator_score: 2,
            acceptor_score: 1,
            pot: 0.5,
            rake: 0.025,
            winner_id: 'agent4',
            winner_name: 'NeuralNick',
            amount: 0.475
          }
        }
      ]
    });
  }
});

export default router;
