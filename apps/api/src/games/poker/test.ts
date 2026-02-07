import { Card, createDeck, shuffleDeck, cardToString, stringToCard, createShuffledDeck, verifyShuffle } from './engine';
import { evaluate, findBestHand, compareHands, cardsFromStrings, HAND_RANKS } from './evaluator';

// Test 1: AA vs KK → AA wins
function testAcesVsKings(): boolean {
  console.log('\nTest 1: AA vs KK on rainbow board');
  
  const aa = cardsFromStrings(['Ah', 'Ad']);
  const kk = cardsFromStrings(['Kh', 'Kd']);
  const board = cardsFromStrings(['2c', '3s', '7h', 'Tc', 'Js']);  // Rainbow board
  
  const hand1 = findBestHand(aa, board);
  const hand2 = findBestHand(kk, board);
  
  console.log(`  AA: ${hand1.name} (rank ${hand1.rank})`);
  console.log(`  KK: ${hand2.name} (rank ${hand2.rank})`);
  
  const result = compareHands(hand1, hand2);
  const passed = result > 0;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - AA ${result > 0 ? 'wins' : result < 0 ? 'loses' : 'ties'}`);
  return passed;
}

// Test 2: Flush vs straight → flush wins
function testFlushVsStraight(): boolean {
  console.log('\nTest 2: Flush vs Straight');
  
  // Flush: 9 high flush
  const flushHand = cardsFromStrings(['2h', '3h']);
  // Straight: 8 high straight
  const straightHand = cardsFromStrings(['4c', '5d']);
  
  const board = cardsFromStrings(['6h', '7h', '8h', '9c', 'Ts']);
  
  const hand1 = findBestHand(flushHand, board);
  const hand2 = findBestHand(straightHand, board);
  
  console.log(`  Flush hand: ${hand1.name} (rank ${hand1.rank})`);
  console.log(`  Straight hand: ${hand2.name} (rank ${hand2.rank})`);
  
  const result = compareHands(hand1, hand2);
  const passed = result > 0;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - Flush ${result > 0 ? 'wins' : result < 0 ? 'loses' : 'ties'}`);
  return passed;
}

// Test 3: Split pot: same straight
function testSplitPot(): boolean {
  console.log('\nTest 3: Split pot (same straight)');
  
  const hand1 = cardsFromStrings(['8h', '9d']);
  const hand2 = cardsFromStrings(['8c', '9c']);
  const board = cardsFromStrings(['Th', 'Jc', 'Qs', '2d', '3h']);
  
  const eval1 = findBestHand(hand1, board);
  const eval2 = findBestHand(hand2, board);
  
  console.log(`  Hand 1: ${eval1.name} (tiebreakers: ${eval1.tiebreakers.join(', ')})`);
  console.log(`  Hand 2: ${eval2.name} (tiebreakers: ${eval2.tiebreakers.join(', ')})`);
  
  const result = compareHands(eval1, eval2);
  const passed = result === 0;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - ${result === 0 ? 'Split pot' : result > 0 ? 'Hand 1 wins' : 'Hand 2 wins'}`);
  return passed;
}

// Test 4: Wheel loses to 6-high straight
function testWheelVsSixHigh(): boolean {
  console.log('\nTest 4: Wheel (A-2-3-4-5) vs 6-high straight');
  
  // Wheel: A-2-3-4-5
  const wheelHand = cardsFromStrings(['Ah', '2d']);
  const wheelBoard = cardsFromStrings(['3c', '4s', '5h', '9d', 'Tc']);
  const wheelEval = findBestHand(wheelHand, wheelBoard);
  
  // 6-high straight: 2-3-4-5-6
  const sixHighHand = cardsFromStrings(['2h', '3d']);
  const sixHighBoard = cardsFromStrings(['4c', '5s', '6h', '9c', 'Td']);
  const sixHighEval = findBestHand(sixHighHand, sixHighBoard);
  
  console.log(`  Wheel: ${wheelEval.name} (high card: ${wheelEval.tiebreakers[0]})`);
  console.log(`  6-high: ${sixHighEval.name} (high card: ${sixHighEval.tiebreakers[0]})`);
  
  const result = compareHands(wheelEval, sixHighEval);
  const passed = result < 0;  // Wheel should lose
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - Wheel ${result < 0 ? 'loses to' : result > 0 ? 'beats' : 'ties'} 6-high straight`);
  return passed;
}

// Test 5: AK vs AQ on A-high board → AK wins (kicker)
function testKickerWins(): boolean {
  console.log('\nTest 5: AK vs AQ on A-high board (kicker battle)');
  
  const ak = cardsFromStrings(['Ah', 'Kh']);
  const aq = cardsFromStrings(['Ad', 'Qd']);
  const board = cardsFromStrings(['Ac', 'Ts', '7d', '2c', '3h']);
  
  const hand1 = findBestHand(ak, board);
  const hand2 = findBestHand(aq, board);
  
  console.log(`  AK: ${hand1.name} (tiebreakers: ${hand1.tiebreakers.join(', ')})`);
  console.log(`  AQ: ${hand2.name} (tiebreakers: ${hand2.tiebreakers.join(', ')})`);
  
  const result = compareHands(hand1, hand2);
  const passed = result > 0;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - AK ${result > 0 ? 'wins' : result < 0 ? 'loses' : 'ties'} (better kicker)`);
  return passed;
}

// Test 6: Royal flush identified correctly
function testRoyalFlush(): boolean {
  console.log('\n Test 6: Royal Flush identification');
  
  const royalHand = cardsFromStrings(['Ah', 'Kh']);
  const royalBoard = cardsFromStrings(['Qh', 'Jh', 'Th', '2c', '3s']);
  const royalEval = findBestHand(royalHand, royalBoard);
  
  console.log(`  Hand: ${royalEval.name} (rank ${royalEval.rank})`);
  console.log(`  Best 5: ${royalEval.best5.map(cardToString).join(' ')}`);
  
  const passed = royalEval.rank === HAND_RANKS.ROYAL_FLUSH;
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'} - Royal flush correctly identified`);
  return passed;
}

// Test deck creation and shuffling
function testDeckOperations(): boolean {
  console.log('\nTest 7: Deck operations');
  
  // Create deck
  const deck = createDeck();
  console.log(`  Deck size: ${deck.length}`);
  
  // Check all cards present
  const allRanks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const allSuits = ['h', 'd', 'c', 's'];
  let allPresent = true;
  
  for (const rank of allRanks) {
    for (const suit of allSuits) {
      const found = deck.find(c => c.rank === rank && c.suit === suit);
      if (!found) {
        console.log(`  Missing: ${rank}${suit}`);
        allPresent = false;
      }
    }
  }
  
  console.log(`  All 52 cards present: ${allPresent ? '✅' : '❌'}`);
  
  // Shuffle
  const shuffled = shuffleDeck(deck);
  console.log(`  Shuffled deck size: ${shuffled.length}`);
  
  // Check shuffled is different (almost certainly)
  let isDifferent = false;
  for (let i = 0; i < 10; i++) {
    if (deck[i].rank !== shuffled[i].rank || deck[i].suit !== shuffled[i].suit) {
      isDifferent = true;
      break;
    }
  }
  console.log(`  Deck shuffled: ${isDifferent ? '✅' : '❌'}`);
  
  // Test provably fair shuffle
  const { deck: provablyDeck, seed, seedHash } = createShuffledDeck();
  console.log(`  Seed generated: ${seed.slice(0, 16)}...`);
  console.log(`  Seed hash: ${seedHash.slice(0, 16)}...`);
  
  const verified = verifyShuffle(provablyDeck, seed);
  console.log(`  Shuffle verification: ${verified ? '✅' : '❌'}`);
  
  // Test card string conversion
  const card = { rank: 14, suit: 'h' as const };
  const str = cardToString(card);
  console.log(`  Card to string: ${str} ${str === 'Ah' ? '✅' : '❌'}`);
  
  const parsed = stringToCard('Ts');
  console.log(`  String to card: Ts → rank ${parsed.rank}, suit ${parsed.suit} ${parsed.rank === 10 && parsed.suit === 's' ? '✅' : '❌'}`);
  
  return allPresent && isDifferent && verified;
}

// Run all tests
function runTests() {
  console.log('🃏 POKER ENGINE TESTS 🃏');
  console.log('========================');
  
  const results = [
    testAcesVsKings(),
    testFlushVsStraight(),
    testSplitPot(),
    testWheelVsSixHigh(),
    testKickerWins(),
    testRoyalFlush(),
    testDeckOperations()
  ];
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log('\n========================');
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log(passed === total ? '✅ All tests passed!' : '❌ Some tests failed');
  
  return passed === total;
}

// Run if called directly
if (require.main === module) {
  runTests();
}

export { runTests };
