import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getDatabase } from './db';

// Track table subscriptions: tableId → Set of WebSocket clients
const tableSubscriptions = new Map<string, Set<WebSocket>>();

// Track authenticated connections: ws → agentId
const authenticatedConnections = new Map<WebSocket, string>();

// Track which tables a ws is subscribed to: ws → Set<tableId>
const wsSubscriptions = new Map<WebSocket, Set<string>>();

/**
 * Initialize WebSocket handlers for a new connection
 */
export function handleWebSocketConnection(ws: WebSocket): void {
  console.log('WebSocket connected');
  
  wsSubscriptions.set(ws, new Set());
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(ws, msg);
    } catch (err) {
      console.error('Invalid WebSocket message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    handleDisconnect(ws);
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    handleDisconnect(ws);
  });
  
  // Send welcome
  ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(ws: WebSocket, msg: any): void {
  switch (msg.type) {
    case 'auth':
      handleAuth(ws, msg.token);
      break;
      
    case 'subscribe':
      handleSubscribe(ws, msg.tableId);
      break;
      
    case 'unsubscribe':
      handleUnsubscribe(ws, msg.tableId);
      break;
      
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
      
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

/**
 * Handle authentication
 */
function handleAuth(ws: WebSocket, token: string): void {
  if (!token) {
    ws.send(JSON.stringify({ type: 'auth_failed', message: 'Token required' }));
    return;
  }
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
      agentId: string;
    };
    
    authenticatedConnections.set(ws, payload.agentId);
    ws.send(JSON.stringify({ type: 'auth_success', agentId: payload.agentId }));
    console.log(`WebSocket authenticated: ${payload.agentId}`);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'auth_failed', message: 'Invalid token' }));
  }
}

/**
 * Handle table subscription
 */
function handleSubscribe(ws: WebSocket, tableId: string): void {
  if (!tableId) {
    ws.send(JSON.stringify({ type: 'error', message: 'tableId required' }));
    return;
  }
  
  // Add to table's subscriber set
  if (!tableSubscriptions.has(tableId)) {
    tableSubscriptions.set(tableId, new Set());
  }
  tableSubscriptions.get(tableId)!.add(ws);
  
  // Track for this ws
  wsSubscriptions.get(ws)!.add(tableId);
  
  ws.send(JSON.stringify({ type: 'subscribed', tableId }));
  console.log(`WebSocket subscribed to table: ${tableId}`);
}

/**
 * Handle table unsubscription
 */
function handleUnsubscribe(ws: WebSocket, tableId: string): void {
  if (!tableId) return;
  
  // Remove from table's subscriber set
  const subscribers = tableSubscriptions.get(tableId);
  if (subscribers) {
    subscribers.delete(ws);
    if (subscribers.size === 0) {
      tableSubscriptions.delete(tableId);
    }
  }
  
  // Remove from ws tracking
  wsSubscriptions.get(ws)?.delete(tableId);
  
  ws.send(JSON.stringify({ type: 'unsubscribed', tableId }));
}

/**
 * Handle WebSocket disconnection
 */
function handleDisconnect(ws: WebSocket): void {
  console.log('WebSocket disconnected');
  
  // Remove from all table subscriptions
  const tables = wsSubscriptions.get(ws);
  if (tables) {
    for (const tableId of tables) {
      const subscribers = tableSubscriptions.get(tableId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          tableSubscriptions.delete(tableId);
        }
      }
    }
    wsSubscriptions.delete(ws);
  }
  
  // Remove from authenticated connections
  authenticatedConnections.delete(ws);
}

/**
 * Broadcast an event to all subscribers of a table
 */
export function broadcast(tableId: string, event: any): void {
  const subscribers = tableSubscriptions.get(tableId);
  if (!subscribers || subscribers.size === 0) return;
  
  const message = JSON.stringify(event);
  
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Send an event to a specific agent (private message)
 */
export function sendToAgent(agentId: string, event: any): void {
  const message = JSON.stringify(event);
  
  for (const [ws, wsAgentId] of authenticatedConnections) {
    if (wsAgentId === agentId && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Send hole cards privately to a player
 */
export function sendHoleCards(tableId: string, agentId: string, cards: string[]): void {
  sendToAgent(agentId, {
    type: 'hole_cards',
    tableId,
    cards
  });
}

/**
 * Broadcast player joined event
 */
export function broadcastPlayerJoined(tableId: string, agentId: string, displayName: string, seat: number, chips: number): void {
  broadcast(tableId, {
    type: 'player_joined',
    tableId,
    agent_id: agentId,
    display_name: displayName,
    seat,
    chips
  });
}

/**
 * Broadcast player left event
 */
export function broadcastPlayerLeft(tableId: string, agentId: string, seat: number, chipsReturned: number): void {
  broadcast(tableId, {
    type: 'player_left',
    tableId,
    agent_id: agentId,
    seat,
    chips_returned: chipsReturned
  });
}

/**
 * Broadcast hand started event
 */
export function broadcastHandStarted(
  tableId: string,
  handId: string,
  dealerSeat: number,
  smallBlindSeat: number,
  bigBlindSeat: number
): void {
  broadcast(tableId, {
    type: 'hand_started',
    tableId,
    hand_id: handId,
    dealer_seat: dealerSeat,
    small_blind_seat: smallBlindSeat,
    big_blind_seat: bigBlindSeat
  });
}

/**
 * Broadcast player action
 */
export function broadcastAction(
  tableId: string,
  agentId: string,
  displayName: string,
  seat: number,
  action: string,
  amount: number,
  pot: number,
  currentBet: number
): void {
  broadcast(tableId, {
    type: 'action',
    tableId,
    agent_id: agentId,
    display_name: displayName,
    seat,
    action,
    amount,
    pot,
    current_bet: currentBet
  });
}

/**
 * Broadcast flop
 */
export function broadcastFlop(tableId: string, cards: string[]): void {
  broadcast(tableId, {
    type: 'flop',
    tableId,
    cards
  });
}

/**
 * Broadcast turn
 */
export function broadcastTurn(tableId: string, card: string): void {
  broadcast(tableId, {
    type: 'turn',
    tableId,
    card
  });
}

/**
 * Broadcast river
 */
export function broadcastRiver(tableId: string, card: string): void {
  broadcast(tableId, {
    type: 'river',
    tableId,
    card
  });
}

/**
 * Broadcast showdown results
 */
export function broadcastShowdown(
  tableId: string,
  winners: Array<{
    agent_id: string;
    display_name: string;
    hand_name: string;
    cards: string[];
    payout: number;
  }>,
  losers: Array<{
    agent_id: string;
    display_name: string;
    hand_name: string;
    cards: string[];
  }>,
  communityCards: string[],
  pot: number,
  rake: number
): void {
  broadcast(tableId, {
    type: 'showdown',
    tableId,
    winners,
    losers,
    community_cards: communityCards,
    pot,
    rake
  });
}

/**
 * Broadcast hand complete
 */
export function broadcastHandComplete(tableId: string, handId: string, nextHandIn: number): void {
  broadcast(tableId, {
    type: 'hand_complete',
    tableId,
    hand_id: handId,
    next_hand_in: nextHandIn
  });
}

/**
 * Broadcast turn timer update (every 5 seconds)
 */
export function broadcastTurnTimer(tableId: string, agentId: string, displayName: string, secondsRemaining: number): void {
  broadcast(tableId, {
    type: 'turn_timer',
    tableId,
    agent_id: agentId,
    display_name: displayName,
    seconds_remaining: secondsRemaining
  });
}

// Track last timer broadcast to throttle to every 5 seconds
const lastTimerBroadcast = new Map<string, number>();

/**
 * Broadcast turn timer (throttled to every 5 seconds)
 */
export function maybeBroadcastTurnTimer(tableId: string, agentId: string, displayName: string, secondsRemaining: number): void {
  const now = Date.now();
  const lastBroadcast = lastTimerBroadcast.get(tableId) || 0;
  
  if (now - lastBroadcast >= 5000) {
    broadcastTurnTimer(tableId, agentId, displayName, secondsRemaining);
    lastTimerBroadcast.set(tableId, now);
  }
}
