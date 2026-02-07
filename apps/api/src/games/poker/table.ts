import { Card, createDeck, shuffleDeck, cardToString, stringToCard } from './engine';
import { findBestHand, cardsFromStrings, HAND_RANKS } from './evaluator';
import { 
  BettingStage, 
  Player as BettingPlayer, 
  Pot, 
  initBettingRound, 
  processAction, 
  getLegalActions,
  createSidePots,
  getTotalPot
} from './betting';
import { calculateRake, RAKE_CAPS, distributePot } from './rake';
import { getDatabase, adjustBalance } from '../../db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Table configuration
export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyin: number;
  maxBuyin: number;
  maxPlayers: number;
  currency: 'SOL' | 'USDC';
}

// Player in a seat
export interface SeatedPlayer {
  agentId: string;
  displayName: string;
  chips: number;
  holeCards: Card[];
  betThisRound: number;
  totalBetThisHand: number;
  status: 'active' | 'folded' | 'all_in' | 'sitting_out';
  lastAction: string;
  seatNumber: number;
}

// Main table state
export interface PokerTableState {
  id: string;
  config: TableConfig;
  seats: Map<number, SeatedPlayer>;
  dealerSeat: number;
  communityCards: Card[];
  pot: number;
  sidePots: Pot[];
  deck: Card[];
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  currentTurnSeat: number;
  currentBet: number;
  lastRaiseSize: number;
  handId: string;
  seed: string;
  seedHash: string;
  actionDeadline: number | null;
  handInProgress: boolean;
}

// Global table storage
const activeTables = new Map<string, PokerTableState>();

// Timer intervals for each table
const tableTimers = new Map<string, NodeJS.Timeout>();

// Load tables from database on startup
export function loadTablesFromDB(): void {
  const db = getDatabase();
  
  const tables = db.prepare(`
    SELECT * FROM poker_tables WHERE status = 'active'
  `).all();
  
  for (const row of tables) {
    const config: TableConfig = {
      id: row.id,
      name: row.name,
      smallBlind: row.small_blind,
      bigBlind: row.big_blind,
      minBuyin: row.min_buyin,
      maxBuyin: row.max_buyin,
      maxPlayers: row.max_players || 6,
      currency: row.currency || 'SOL'
    };
    
    const tableState: PokerTableState = {
      id: config.id,
      config,
      seats: new Map(),
      dealerSeat: 0,
      communityCards: [],
      pot: 0,
      sidePots: [],
      deck: [],
      phase: 'waiting',
      currentTurnSeat: -1,
      currentBet: 0,
      lastRaiseSize: config.bigBlind,
      handId: '',
      seed: '',
      seedHash: '',
      actionDeadline: null,
      handInProgress: false
    };
    
    activeTables.set(config.id, tableState);
    console.log(`✅ Loaded table: ${config.name} (${config.id})`);
  }
  
  console.log(`📊 Loaded ${activeTables.size} tables from database`);
}

// Get a table by ID
export function getTable(tableId: string): PokerTableState | undefined {
  return activeTables.get(tableId);
}

// Get all active tables
export function getAllTables(): PokerTableState[] {
  return Array.from(activeTables.values());
}

// Seat a player at the table
export function seatPlayer(
  tableId: string,
  agentId: string,
  displayName: string,
  buyin: number
): { success: boolean; error?: string; seatNumber?: number } {
  const table = activeTables.get(tableId);
  if (!table) {
    return { success: false, error: 'Table not found' };
  }
  
  if (buyin < table.config.minBuyin || buyin > table.config.maxBuyin) {
    return { success: false, error: `Buy-in must be between ${table.config.minBuyin} and ${table.config.maxBuyin}` };
  }
  
  // Check if player is already seated
  for (const [seat, player] of table.seats) {
    if (player.agentId === agentId) {
      return { success: false, error: 'Player already seated' };
    }
  }
  
  // Find empty seat
  let seatNumber = -1;
  for (let i = 0; i < table.config.maxPlayers; i++) {
    if (!table.seats.has(i)) {
      seatNumber = i;
      break;
    }
  }
  
  if (seatNumber === -1) {
    return { success: false, error: 'Table is full' };
  }
  
  // Deduct buyin from player balance
  try {
    adjustBalance(agentId, -buyin, table.config.currency, 'buyin', 'poker', tableId, `Buy-in to ${table.config.name}`);
  } catch (err) {
    return { success: false, error: 'Insufficient balance for buy-in' };
  }
  
  // Seat the player
  const player: SeatedPlayer = {
    agentId,
    displayName,
    chips: buyin,
    holeCards: [],
    betThisRound: 0,
    totalBetThisHand: 0,
    status: 'sitting_out',
    lastAction: '',
    seatNumber
  };
  
  table.seats.set(seatNumber, player);
  
  // Auto-start hand if enough players and not in progress
  if (!table.handInProgress && table.seats.size >= 2) {
    setTimeout(() => startHand(tableId), 3000);
  }
  
  return { success: true, seatNumber };
}

// Remove a player from the table
export function removePlayer(tableId: string, agentId: string): { success: boolean; error?: string } {
  const table = activeTables.get(tableId);
  if (!table) {
    return { success: false, error: 'Table not found' };
  }
  
  // Find player
  let seatNumber = -1;
  let player: SeatedPlayer | undefined;
  
  for (const [seat, p] of table.seats) {
    if (p.agentId === agentId) {
      seatNumber = seat;
      player = p;
      break;
    }
  }
  
  if (!player) {
    return { success: false, error: 'Player not seated' };
  }
  
  // Can't remove if in active hand and not folded
  if (table.handInProgress && player.status !== 'folded' && player.status !== 'sitting_out') {
    // Auto-fold first
    if (table.currentTurnSeat === seatNumber) {
      handleAction(tableId, agentId, 'FOLD');
    }
    // Return chips they have (they forfeit current bet)
    const remainingChips = player.chips;
    if (remainingChips > 0) {
      adjustBalance(agentId, remainingChips, table.config.currency, 'cashout', 'poker', tableId, `Cash out from ${table.config.name}`);
    }
  } else {
    // Return all chips
    const remainingChips = player.chips + player.betThisRound;
    if (remainingChips > 0) {
      adjustBalance(agentId, remainingChips, table.config.currency, 'cashout', 'poker', tableId, `Cash out from ${table.config.name}`);
    }
  }
  
  table.seats.delete(seatNumber);
  
  return { success: true };
}

// Start a new hand
export function startHand(tableId: string): { success: boolean; error?: string } {
  const table = activeTables.get(tableId);
  if (!table) {
    return { success: false, error: 'Table not found' };
  }
  
  if (table.handInProgress) {
    return { success: false, error: 'Hand already in progress' };
  }
  
  // Need at least 2 active players
  const activePlayers = Array.from(table.seats.values()).filter(p => p.status !== 'sitting_out');
  if (activePlayers.length < 2) {
    return { success: false, error: 'Need at least 2 players to start' };
  }
  
  // Reset table state
  table.handInProgress = true;
  table.phase = 'preflop';
  table.communityCards = [];
  table.pot = 0;
  table.sidePots = [];
  table.currentBet = table.config.bigBlind;
  table.lastRaiseSize = table.config.bigBlind;
  table.handId = uuidv4();
  
  // Reset all players
  for (const player of table.seats.values()) {
    player.holeCards = [];
    player.betThisRound = 0;
    player.totalBetThisHand = 0;
    player.status = 'sitting_out';
    player.lastAction = '';
  }
  
  // Set active players (have chips)
  for (const player of table.seats.values()) {
    if (player.chips > 0) {
      player.status = 'active';
    }
  }
  
  // Shuffle and deal
  const shuffled = shuffleDeck(createDeck());
  table.deck = shuffled;
  
  // Generate seed for provably fair
  table.seed = crypto.randomBytes(32).toString('hex');
  table.seedHash = crypto.createHash('sha256').update(table.seed).digest('hex');
  
  // Deal 2 cards to each active player
  let deckIndex = 0;
  for (const player of table.seats.values()) {
    if (player.status === 'active') {
      player.holeCards = [table.deck[deckIndex++], table.deck[deckIndex++]];
    }
  }
  
  // Rotate dealer
  const occupiedSeats = Array.from(table.seats.keys()).sort((a, b) => a - b);
  if (occupiedSeats.length === 0) {
    return { success: false, error: 'No occupied seats' };
  }
  
  // Find next dealer
  let dealerIndex = occupiedSeats.indexOf(table.dealerSeat);
  dealerIndex = (dealerIndex + 1) % occupiedSeats.length;
  table.dealerSeat = occupiedSeats[dealerIndex];
  
  // Post blinds
  const dealerIdx = occupiedSeats.indexOf(table.dealerSeat);
  const sbSeat = occupiedSeats[(dealerIdx + 1) % occupiedSeats.length];
  const bbSeat = occupiedSeats[(dealerIdx + 2) % occupiedSeats.length];
  
  const sbPlayer = table.seats.get(sbSeat)!;
  const bbPlayer = table.seats.get(bbSeat)!;
  
  // Small blind
  const sbAmount = Math.min(table.config.smallBlind, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.betThisRound = sbAmount;
  sbPlayer.totalBetThisHand = sbAmount;
  if (sbPlayer.chips === 0) sbPlayer.status = 'all_in';
  table.pot += sbAmount;
  
  // Big blind
  const bbAmount = Math.min(table.config.bigBlind, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.betThisRound = bbAmount;
  bbPlayer.totalBetThisHand = bbAmount;
  if (bbPlayer.chips === 0) bbPlayer.status = 'all_in';
  table.pot += bbAmount;
  
  // First to act is UTG (after BB)
  const bbIdx = occupiedSeats.indexOf(bbSeat);
  let utgIdx = (bbIdx + 1) % occupiedSeats.length;
  while (table.seats.get(occupiedSeats[utgIdx])?.status !== 'active') {
    utgIdx = (utgIdx + 1) % occupiedSeats.length;
  }
  table.currentTurnSeat = occupiedSeats[utgIdx];
  
  // Start action timer
  startActionTimer(tableId);
  
  console.log(`🎴 Hand ${table.handId.slice(0, 8)} started at ${table.config.name}`);
  
  return { success: true };
}

// Handle a player action
export function handleAction(
  tableId: string,
  agentId: string,
  action: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALL_IN',
  amount?: number
): { success: boolean; error?: string; handComplete?: boolean } {
  const table = activeTables.get(tableId);
  if (!table) {
    return { success: false, error: 'Table not found' };
  }
  
  if (!table.handInProgress) {
    return { success: false, error: 'No hand in progress' };
  }
  
  // Find player
  let player: SeatedPlayer | undefined;
  let seatNumber = -1;
  
  for (const [seat, p] of table.seats) {
    if (p.agentId === agentId) {
      player = p;
      seatNumber = seat;
      break;
    }
  }
  
  if (!player) {
    return { success: false, error: 'Player not seated' };
  }
  
  // Check it's their turn
  if (seatNumber !== table.currentTurnSeat) {
    return { success: false, error: 'Not your turn' };
  }
  
  // Process action
  const toCall = table.currentBet - player.betThisRound;
  
  switch (action) {
    case 'FOLD':
      player.status = 'folded';
      player.lastAction = 'FOLD';
      break;
      
    case 'CHECK':
      if (toCall !== 0) {
        return { success: false, error: 'Cannot check, there is a bet to call' };
      }
      player.lastAction = 'CHECK';
      break;
      
    case 'CALL':
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.betThisRound += callAmount;
      player.totalBetThisHand += callAmount;
      table.pot += callAmount;
      if (player.chips === 0) player.status = 'all_in';
      player.lastAction = `CALL ${callAmount}`;
      break;
      
    case 'RAISE':
      if (!amount || amount < table.currentBet + Math.max(table.config.bigBlind, table.lastRaiseSize)) {
        return { success: false, error: 'Raise amount too small' };
      }
      const raiseTotal = amount - player.betThisRound;
      if (raiseTotal > player.chips) {
        return { success: false, error: 'Not enough chips' };
      }
      player.chips -= raiseTotal;
      player.betThisRound = amount;
      player.totalBetThisHand += raiseTotal;
      table.pot += raiseTotal;
      table.lastRaiseSize = amount - table.currentBet;
      table.currentBet = amount;
      if (player.chips === 0) player.status = 'all_in';
      player.lastAction = `RAISE ${amount}`;
      break;
      
    case 'ALL_IN':
      const allInAmount = player.chips;
      const newTotalBet = player.betThisRound + allInAmount;
      player.chips = 0;
      player.betThisRound = newTotalBet;
      player.totalBetThisHand += allInAmount;
      table.pot += allInAmount;
      if (newTotalBet > table.currentBet) {
        table.lastRaiseSize = newTotalBet - table.currentBet;
        table.currentBet = newTotalBet;
      }
      player.status = 'all_in';
      player.lastAction = `ALL_IN ${newTotalBet}`;
      break;
  }
  
  // Check if only one player remains
  const activePlayers = Array.from(table.seats.values()).filter(p => p.status === 'active');
  const nonFoldedPlayers = Array.from(table.seats.values()).filter(p => p.status !== 'folded');
  
  if (nonFoldedPlayers.length === 1) {
    // Award pot to last player
    const winner = nonFoldedPlayers[0];
    winner.chips += table.pot;
    endHand(tableId);
    return { success: true, handComplete: true };
  }
  
  // Move to next player
  advanceTurn(table);
  
  // Check if betting round is complete
  if (isBettingRoundComplete(table)) {
    advancePhase(tableId);
  } else {
    startActionTimer(tableId);
  }
  
  return { success: true };
}

// Check if betting round is complete
function isBettingRoundComplete(table: PokerTableState): boolean {
  const activePlayers = Array.from(table.seats.values()).filter(
    p => p.status === 'active' && p.betThisRound < table.currentBet
  );
  return activePlayers.length === 0;
}

// Advance to next player's turn
function advanceTurn(table: PokerTableState): void {
  const occupiedSeats = Array.from(table.seats.keys()).sort((a, b) => a - b);
  const currentIdx = occupiedSeats.indexOf(table.currentTurnSeat);
  
  let nextIdx = (currentIdx + 1) % occupiedSeats.length;
  let attempts = 0;
  
  while (attempts < occupiedSeats.length) {
    const nextSeat = occupiedSeats[nextIdx];
    const player = table.seats.get(nextSeat);
    
    if (player && player.status === 'active') {
      table.currentTurnSeat = nextSeat;
      return;
    }
    
    nextIdx = (nextIdx + 1) % occupiedSeats.length;
    attempts++;
  }
}

// Advance to next phase (flop, turn, river, showdown)
function advancePhase(tableId: string): void {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  // Collect bets into side pots
  createSidePotsForTable(table);
  
  // Reset for next round
  for (const player of table.seats.values()) {
    player.betThisRound = 0;
    player.lastAction = '';
  }
  table.currentBet = 0;
  table.lastRaiseSize = table.config.bigBlind;
  
  // Move to next phase
  switch (table.phase) {
    case 'preflop':
      table.phase = 'flop';
      // Deal flop
      table.communityCards = [table.deck[0], table.deck[1], table.deck[2]];
      break;
      
    case 'flop':
      table.phase = 'turn';
      table.communityCards.push(table.deck[3]);
      break;
      
    case 'turn':
      table.phase = 'river';
      table.communityCards.push(table.deck[4]);
      break;
      
    case 'river':
      table.phase = 'showdown';
      resolveHand(tableId);
      return;
  }
  
  // Set first player to act (small blind or first active after dealer)
  const occupiedSeats = Array.from(table.seats.keys()).sort((a, b) => a - b);
  const dealerIdx = occupiedSeats.indexOf(table.dealerSeat);
  let firstToActIdx = (dealerIdx + 1) % occupiedSeats.length;
  
  while (table.seats.get(occupiedSeats[firstToActIdx])?.status !== 'active') {
    firstToActIdx = (firstToActIdx + 1) % occupiedSeats.length;
  }
  
  table.currentTurnSeat = occupiedSeats[firstToActIdx];
  startActionTimer(tableId);
}

// Create side pots from current bets
function createSidePotsForTable(table: PokerTableState): void {
  const nonFoldedPlayers = Array.from(table.seats.values()).filter(p => p.status !== 'folded');
  
  if (nonFoldedPlayers.length === 0) return;
  
  const sortedByBet = [...nonFoldedPlayers].sort((a, b) => a.totalBetThisHand - b.totalBetThisHand);
  
  let processedAmount = 0;
  const pots: Pot[] = [];
  let potId = 0;
  
  for (const player of sortedByBet) {
    const contribution = player.totalBetThisHand - processedAmount;
    if (contribution <= 0) continue;
    
    const eligiblePlayers = nonFoldedPlayers
      .filter(p => p.totalBetThisHand >= player.totalBetThisHand)
      .map(p => p.agentId);
    
    const potAmount = contribution * eligiblePlayers.length;
    
    pots.push({
      id: potId++,
      amount: potAmount,
      eligiblePlayers
    });
    
    processedAmount = player.totalBetThisHand;
  }
  
  table.sidePots = pots;
  table.pot = pots.reduce((sum, p) => sum + p.amount, 0);
}

// Resolve hand at showdown
function resolveHand(tableId: string): void {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  const nonFoldedPlayers = Array.from(table.seats.values()).filter(p => p.status !== 'folded');
  
  // Evaluate all hands
  const handEvaluations = nonFoldedPlayers.map(player => ({
    player,
    eval: findBestHand(player.holeCards, table.communityCards)
  }));
  
  // Award each pot
  const potWinners: { potId: number; winnerId: string }[] = [];
  
  for (const pot of table.sidePots) {
    const eligibleHands = handEvaluations.filter(h => pot.eligiblePlayers.includes(h.player.agentId));
    
    if (eligibleHands.length === 0) continue;
    
    // Find best hand
    let bestHand = eligibleHands[0];
    for (const hand of eligibleHands.slice(1)) {
      const cmp = compareHandEvaluations(hand.eval, bestHand.eval);
      if (cmp > 0) {
        bestHand = hand;
      }
    }
    
    potWinners.push({ potId: pot.id, winnerId: bestHand.player.agentId });
    
    // Calculate rake for this pot
    const sawFlop = table.communityCards.length >= 3;
    const blindLevel = `${table.config.smallBlind}/${table.config.bigBlind}`;
    const rakeResult = calculateRake(pot.amount, blindLevel, nonFoldedPlayers.length, sawFlop, table.handId, table.config.currency);
    
    // Award pot minus rake
    const winAmount = pot.amount - rakeResult.rake;
    bestHand.player.chips += winAmount;
    
    // Log rake
    const db = getDatabase();
    db.prepare(`
      INSERT INTO rake_log (game_type, game_id, amount, currency, pot_size, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run('poker', table.handId, rakeResult.rake, table.config.currency, pot.amount);
    
    // Update player stats
    db.prepare(`
      UPDATE agents SET games_played = games_played + 1, total_profit = total_profit + ?
      WHERE id = ?
    `).run(winAmount - bestHand.player.totalBetThisHand, bestHand.player.agentId);
  }
  
  // Log hand
  const db = getDatabase();
  db.prepare(`
    INSERT INTO poker_hands (id, table_id, phase, community_cards, pot, rake, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(table.handId, table.id, table.phase, JSON.stringify(table.communityCards), table.pot, 0);
  
  endHand(tableId);
}

// Compare two hand evaluations (return 1 if a > b, -1 if a < b, 0 if tie)
function compareHandEvaluations(a: any, b: any): number {
  if (a.rank !== b.rank) {
    return a.rank > b.rank ? 1 : -1;
  }
  
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const ta = a.tiebreakers[i] || 0;
    const tb = b.tiebreakers[i] || 0;
    if (ta !== tb) {
      return ta > tb ? 1 : -1;
    }
  }
  
  return 0;
}

// End hand and reset
function endHand(tableId: string): void {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  // Stop timer
  if (tableTimers.has(tableId)) {
    clearInterval(tableTimers.get(tableId)!);
    tableTimers.delete(tableId);
  }
  
  table.handInProgress = false;
  table.phase = 'waiting';
  table.communityCards = [];
  table.pot = 0;
  table.sidePots = [];
  table.currentTurnSeat = -1;
  table.actionDeadline = null;
  
  // Reset players
  for (const player of table.seats.values()) {
    player.holeCards = [];
    player.betThisRound = 0;
    player.totalBetThisHand = 0;
    player.status = player.chips > 0 ? 'sitting_out' : 'sitting_out';
    player.lastAction = '';
  }
  
  // Auto-start next hand after 3 seconds if enough players
  setTimeout(() => {
    const activePlayers = Array.from(table!.seats.values()).filter(p => p.chips > 0);
    if (activePlayers.length >= 2) {
      startHand(tableId);
    }
  }, 3000);
}

// Start action timer
function startActionTimer(tableId: string): void {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  // Set deadline (30 seconds)
  table.actionDeadline = Date.now() + 30000;
  
  // Clear existing timer
  if (tableTimers.has(tableId)) {
    clearInterval(tableTimers.get(tableId)!);
  }
  
  // Start new timer
  const timer = setInterval(() => {
    const t = activeTables.get(tableId);
    if (!t || !t.handInProgress) {
      clearInterval(timer);
      return;
    }
    
    if (t.actionDeadline && Date.now() > t.actionDeadline) {
      // Time expired - auto-fold
      const player = t.seats.get(t.currentTurnSeat);
      if (player) {
        const toCall = t.currentBet - player.betThisRound;
        if (toCall === 0) {
          // Can check
          handleAction(tableId, player.agentId, 'CHECK');
        } else {
          // Must fold
          handleAction(tableId, player.agentId, 'FOLD');
        }
      }
    }
  }, 1000);
  
  tableTimers.set(tableId, timer);
}

// Get public state (hides hole cards)
export function getPublicState(tableId: string): any {
  const table = activeTables.get(tableId);
  if (!table) return null;
  
  // Sort seats by seat number for consistent ordering
  const sortedSeats = Array.from(table.seats.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([seat, player]) => ({
      seatNumber: seat,
      agentId: player.agentId,
      displayName: player.displayName,
      chips: player.chips,
      betThisRound: player.betThisRound,
      totalBetThisHand: player.totalBetThisHand,
      status: player.status,
      lastAction: player.lastAction,
      cardCount: player.holeCards.length  // Only show count, not cards
    }));
  
  return {
    id: table.id,
    config: table.config,
    seats: sortedSeats,
    dealerSeat: table.dealerSeat,
    communityCards: table.communityCards,
    pot: table.pot,
    sidePots: table.sidePots,
    phase: table.phase,
    currentTurnSeat: table.currentTurnSeat,
    currentBet: table.currentBet,
    handId: table.handId,
    seedHash: table.seedHash,
    handInProgress: table.handInProgress,
    actionDeadline: table.actionDeadline
  };
}

// Get state for specific agent (shows their hole cards)
export function getStateForAgent(tableId: string, agentId: string): any {
  const table = activeTables.get(tableId);
  if (!table) return null;

  const publicState = getPublicState(tableId);
  if (!publicState) return null;

  // Find this agent's seat
  let mySeat = -1;
  for (const [seat, player] of table.seats) {
    if (player.agentId === agentId) {
      mySeat = seat;
      break;
    }
  }

  if (mySeat === -1) {
    return publicState; // Observer view
  }

  const myPlayer = table.seats.get(mySeat)!;

  return {
    ...publicState,
    mySeat,
    myHoleCards: myPlayer.holeCards.map(cardToString),
    availableActions:
      mySeat === table.currentTurnSeat && table.handInProgress
        ? getAvailableActions(table, myPlayer)
        : [],
    // Include formatted current_turn for convenience
    current_turn:
      table.currentTurnSeat >= 0
        ? {
            seat: table.currentTurnSeat,
            agent_id: table.seats.get(table.currentTurnSeat)?.agentId,
            display_name: table.seats.get(table.currentTurnSeat)?.displayName,
            deadline: table.actionDeadline,
          }
        : null,
  };
}

// Get available actions for a player
function getAvailableActions(table: PokerTableState, player: SeatedPlayer): string[] {
  if (player.status !== 'active') return [];
  
  const toCall = table.currentBet - player.betThisRound;
  const actions: string[] = ['FOLD'];
  
  if (toCall === 0) {
    actions.push('CHECK');
  }
  
  if (toCall > 0 && player.chips > 0) {
    actions.push('CALL');
  }
  
  const minRaise = table.currentBet + Math.max(table.config.bigBlind, table.lastRaiseSize);
  if (player.chips > toCall && player.chips + player.betThisRound >= minRaise) {
    actions.push('RAISE');
  }
  
  if (player.chips > 0) {
    actions.push('ALL_IN');
  }
  
  return actions;
}

// Initialize tables on module load
loadTablesFromDB();
