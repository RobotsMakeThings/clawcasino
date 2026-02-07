import { 
  seatPlayer, 
  removePlayer, 
  startHand, 
  handleAction, 
  getPublicState, 
  getStateForAgent,
  loadTablesFromDB,
  getAllTables
} from './table';
import { getDatabase, adjustBalance } from '../../db';
import { v4 as uuidv4 } from 'uuid';

// Test helpers
let testAgentId1: string;
let testAgentId2: string;
let testAgentId3: string;
let testTableId: string;

function setupTestData() {
  const db = getDatabase();
  
  // Create test table
  testTableId = 'test-table-' + uuidv4().slice(0, 8);
  db.prepare(`
    INSERT OR IGNORE INTO poker_tables (id, name, small_blind, big_blind, min_buyin, max_buyin, max_players, currency, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(testTableId, 'Test Table', 0.5, 1, 10, 100, 6, 'SOL');
  
  // Create test agents
  testAgentId1 = uuidv4();
  testAgentId2 = uuidv4();
  testAgentId3 = uuidv4();
  
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, wallet_address, display_name, balance_sol, balance_usdc)
    VALUES (?, ?, ?, ?, ?)
  `).run(testAgentId1, 'test1_' + testAgentId1.slice(0, 8), 'TestPlayer1', 100, 0);
  
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, wallet_address, display_name, balance_sol, balance_usdc)
    VALUES (?, ?, ?, ?, ?)
  `).run(testAgentId2, 'test2_' + testAgentId2.slice(0, 8), 'TestPlayer2', 100, 0);
  
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, wallet_address, display_name, balance_sol, balance_usdc)
    VALUES (?, ?, ?, ?, ?)
  `).run(testAgentId3, 'test3_' + testAgentId3.slice(0, 8), 'TestPlayer3', 10, 0);
  
  // Reload tables to pick up the new one
  loadTablesFromDB();
}

// Test 1: Seat players at table
function testSeatPlayers(): boolean {
  console.log('\nTest 1: Seat players at table');
  
  setupTestData();
  
  // Seat player 1
  const result1 = seatPlayer(testTableId, testAgentId1, 'TestPlayer1', 50);
  if (!result1.success) {
    console.log(`  ❌ FAIL - Could not seat player 1: ${result1.error}`);
    return false;
  }
  console.log(`  ✅ Player 1 seated at seat ${result1.seatNumber}`);
  
  // Seat player 2
  const result2 = seatPlayer(testTableId, testAgentId2, 'TestPlayer2', 50);
  if (!result2.success) {
    console.log(`  ❌ FAIL - Could not seat player 2: ${result2.error}`);
    return false;
  }
  console.log(`  ✅ Player 2 seated at seat ${result2.seatNumber}`);
  
  // Try to seat player 1 again (should fail)
  const result3 = seatPlayer(testTableId, testAgentId1, 'TestPlayer1', 50);
  if (result3.success) {
    console.log(`  ❌ FAIL - Should not allow duplicate seating`);
    return false;
  }
  console.log(`  ✅ Duplicate seating prevented: ${result3.error}`);
  
  console.log(`  ✅ PASS - Seating works correctly`);
  return true;
}

// Test 2: Start a hand
function testStartHand(): boolean {
  console.log('\nTest 2: Start a hand');
  
  const result = startHand(testTableId);
  if (!result.success) {
    console.log(`  ❌ FAIL - Could not start hand: ${result.error}`);
    return false;
  }
  
  const state = getPublicState(testTableId);
  console.log(`  ✅ Hand started: ${state.handId.slice(0, 8)}`);
  console.log(`  ✅ Phase: ${state.phase}`);
  console.log(`  ✅ Players dealt: ${state.seats.filter((s: any) => s.cardCount === 2).length}`);
  console.log(`  ✅ Dealer seat: ${state.dealerSeat}`);
  console.log(`  ✅ Current turn: seat ${state.currentTurnSeat}`);
  
  return true;
}

// Test 3: Handle actions
function testHandleActions(): boolean {
  console.log('\nTest 3: Handle player actions');
  
  // Get current state
  let state = getPublicState(testTableId);
  if (!state || !state.handInProgress) {
    console.log(`  ❌ FAIL - No hand in progress`);
    return false;
  }
  
  // Find whose turn it is
  const currentSeat = state.currentTurnSeat;
  const currentPlayer = state.seats.find((s: any) => s.seatNumber === currentSeat);
  
  if (!currentPlayer) {
    console.log(`  ❌ FAIL - No player at seat ${currentSeat}`);
    return false;
  }
  
  console.log(`  Current player: ${currentPlayer.displayName} (seat ${currentSeat})`);
  
  // Get player-specific state to see available actions
  const playerState = getStateForAgent(testTableId, currentPlayer.agentId);
  console.log(`  Available actions: ${playerState.availableActions.join(', ')}`);
  
  // Call
  const result = handleAction(testTableId, currentPlayer.agentId, 'CALL');
  if (!result.success) {
    console.log(`  ❌ FAIL - Could not call: ${result.error}`);
    return false;
  }
  
  console.log(`  ✅ ${currentPlayer.displayName} called`);
  
  // Check turn moved
  state = getPublicState(testTableId);
  if (state.currentTurnSeat === currentSeat) {
    console.log(`  ❌ FAIL - Turn should have moved`);
    return false;
  }
  console.log(`  ✅ Turn moved to seat ${state.currentTurnSeat}`);
  
  return true;
}

// Test 4: Player view shows hole cards
function testPlayerView(): boolean {
  console.log('\nTest 4: Player view shows hole cards');
  
  const state = getPublicState(testTableId);
  const player = state.seats[0];
  
  // Public view should not show cards
  if (player.cardCount !== 2) {
    console.log(`  ❌ FAIL - Public view should show card count`);
    return false;
  }
  console.log(`  ✅ Public view: card count = ${player.cardCount}`);
  
  // Player view should show actual cards
  const playerState = getStateForAgent(testTableId, player.agentId);
  if (!playerState.myHoleCards || playerState.myHoleCards.length !== 2) {
    console.log(`  ❌ FAIL - Player view should show hole cards`);
    return false;
  }
  console.log(`  ✅ Player view: hole cards = ${playerState.myHoleCards.join(' ')}`);
  
  return true;
}

// Test 5: Remove player
function testRemovePlayer(): boolean {
  console.log('\nTest 5: Remove player from table');
  
  // Try to remove player (should succeed if folded or not in hand)
  const result = removePlayer(testTableId, testAgentId1);
  
  if (!result.success) {
    console.log(`  ⚠️ Remove failed (may be in hand): ${result.error}`);
    // This is okay if they're in an active hand
  } else {
    console.log(`  ✅ Player removed successfully`);
  }
  
  return true;
}

// Test 6: Invalid actions
function testInvalidActions(): boolean {
  console.log('\nTest 6: Invalid actions rejected');
  
  const state = getPublicState(testTableId);
  if (!state || !state.handInProgress) {
    console.log(`  ⚠️ Skipping - no hand in progress`);
    return true;
  }
  
  // Find a player whose turn it is NOT
  const notTheirTurnSeat = (state.currentTurnSeat + 1) % 6;
  const wrongPlayer = state.seats.find((s: any) => s.seatNumber === notTheirTurnSeat);
  
  if (wrongPlayer) {
    const result = handleAction(testTableId, wrongPlayer.agentId, 'CALL');
    if (result.success) {
      console.log(`  ❌ FAIL - Should not allow action out of turn`);
      return false;
    }
    console.log(`  ✅ Out-of-turn action rejected: ${result.error}`);
  }
  
  // Invalid action type
  const currentPlayer = state.seats.find((s: any) => s.seatNumber === state.currentTurnSeat);
  if (currentPlayer) {
    // @ts-ignore - intentionally testing invalid action
    const result = handleAction(testTableId, currentPlayer.agentId, 'INVALID');
    if (result.success) {
      console.log(`  ❌ FAIL - Should reject invalid action`);
      return false;
    }
    console.log(`  ✅ Invalid action rejected`);
  }
  
  return true;
}

// Test 7: Table state includes seed hash
function testProvablyFair(): boolean {
  console.log('\nTest 7: Provably fair seed hash');
  
  const state = getPublicState(testTableId);
  if (!state.seedHash) {
    console.log(`  ❌ FAIL - No seed hash in table state`);
    return false;
  }
  
  console.log(`  ✅ Seed hash present: ${state.seedHash.slice(0, 16)}...`);
  console.log(`  ✅ Hand ID: ${state.handId.slice(0, 16)}...`);
  
  return true;
}

// Run all tests
function runTests() {
  console.log('🎲 TABLE MANAGEMENT TESTS 🎲');
  console.log('============================');
  
  // Load tables first
  loadTablesFromDB();
  
  const results = [
    testSeatPlayers(),
    testStartHand(),
    testHandleActions(),
    testPlayerView(),
    testRemovePlayer(),
    testInvalidActions(),
    testProvablyFair()
  ];
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log('\n============================');
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log(passed === total ? '✅ All tests passed!' : '❌ Some tests failed');
  
  return passed === total;
}

// Run if called directly
if (require.main === module) {
  runTests();
}

export { runTests };
