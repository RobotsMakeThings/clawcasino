import { Card } from './cards';

export type HandRank = 
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush'
  | 'royal_flush';

export interface HandEvaluation {
  rank: HandRank;
  value: number;
  cards: Card[];
  description: string;
}

// Hand rankings from lowest to highest
const HAND_RANK_VALUES: Record<HandRank, number> = {
  high_card: 0,
  one_pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9
};

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 7) {
    throw new Error('Must provide exactly 7 cards (2 hole + 5 community)');
  }

  const allCombinations = getAll5CardCombinations(cards);
  let bestHand: HandEvaluation | null = null;

  for (const combo of allCombinations) {
    const evaluation = evaluate5CardHand(combo);
    if (!bestHand || compareHands(evaluation, bestHand) > 0) {
      bestHand = evaluation;
    }
  }

  return bestHand!;
}

function getAll5CardCombinations(cards: Card[]): Card[][] {
  const combinations: Card[][] = [];
  const n = cards.length;

  function backtrack(start: number, current: Card[]) {
    if (current.length === 5) {
      combinations.push([...current]);
      return;
    }

    for (let i = start; i < n; i++) {
      current.push(cards[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return combinations;
}

function evaluate5CardHand(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const isFlush = checkFlush(cards);
  const isStraight = checkStraight(sorted);

  // Royal Flush
  if (isFlush && isStraight && sorted[0].value === 14) {
    return {
      rank: 'royal_flush',
      value: HAND_RANK_VALUES.royal_flush * 1000000 + sorted[0].value,
      cards: sorted,
      description: 'Royal Flush'
    };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return {
      rank: 'straight_flush',
      value: HAND_RANK_VALUES.straight_flush * 1000000 + sorted[0].value,
      cards: sorted,
      description: `Straight Flush, ${sorted[0].rank} high`
    };
  }

  const groups = groupByRank(sorted);
  const counts = Object.values(groups).map(g => g.length).sort((a, b) => b - a);

  // Four of a Kind
  if (counts[0] === 4) {
    const quadsRank = Object.keys(groups).find(r => groups[r].length === 4)!;
    const kicker = sorted.find(c => c.rank !== quadsRank)!;
    return {
      rank: 'four_of_a_kind',
      value: HAND_RANK_VALUES.four_of_a_kind * 1000000 + groups[quadsRank][0].value * 100 + kicker.value,
      cards: sorted,
      description: `Four of a Kind, ${quadsRank}s`
    };
  }

  // Full House
  if (counts[0] === 3 && counts[1] >= 2) {
    const tripsRank = Object.keys(groups).find(r => groups[r].length === 3)!;
    const pairRank = Object.keys(groups).find(r => r !== tripsRank && groups[r].length >= 2)!;
    return {
      rank: 'full_house',
      value: HAND_RANK_VALUES.full_house * 1000000 + groups[tripsRank][0].value * 100 + groups[pairRank][0].value,
      cards: sorted,
      description: `Full House, ${tripsRank}s full of ${pairRank}s`
    };
  }

  // Flush
  if (isFlush) {
    const flushCards = getFlushCards(cards);
    return {
      rank: 'flush',
      value: HAND_RANK_VALUES.flush * 1000000 + calculateHighCardValue(flushCards),
      cards: sorted,
      description: `Flush, ${flushCards[0].rank} high`
    };
  }

  // Straight
  if (isStraight) {
    const straightHigh = getStraightHigh(sorted);
    return {
      rank: 'straight',
      value: HAND_RANK_VALUES.straight * 1000000 + straightHigh,
      cards: sorted,
      description: `Straight, ${getRankFromValue(straightHigh)} high`
    };
  }

  // Three of a Kind
  if (counts[0] === 3) {
    const tripsRank = Object.keys(groups).find(r => groups[r].length === 3)!;
    const kickers = sorted.filter(c => c.rank !== tripsRank).slice(0, 2);
    return {
      rank: 'three_of_a_kind',
      value: HAND_RANK_VALUES.three_of_a_kind * 1000000 + groups[tripsRank][0].value * 10000 + calculateHighCardValue(kickers),
      cards: sorted,
      description: `Three of a Kind, ${tripsRank}s`
    };
  }

  // Two Pair
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = Object.keys(groups).filter(r => groups[r].length === 2).sort((a, b) => groups[b][0].value - groups[a][0].value);
    const kicker = sorted.find(c => !pairs.includes(c.rank))!;
    return {
      rank: 'two_pair',
      value: HAND_RANK_VALUES.two_pair * 1000000 + groups[pairs[0]][0].value * 10000 + groups[pairs[1]][0].value * 100 + kicker.value,
      cards: sorted,
      description: `Two Pair, ${pairs[0]}s and ${pairs[1]}s`
    };
  }

  // One Pair
  if (counts[0] === 2) {
    const pairRank = Object.keys(groups).find(r => groups[r].length === 2)!;
    const kickers = sorted.filter(c => c.rank !== pairRank).slice(0, 3);
    return {
      rank: 'one_pair',
      value: HAND_RANK_VALUES.one_pair * 1000000 + groups[pairRank][0].value * 100000 + calculateHighCardValue(kickers),
      cards: sorted,
      description: `Pair of ${pairRank}s`
    };
  }

  // High Card
  return {
    rank: 'high_card',
    value: calculateHighCardValue(sorted.slice(0, 5)),
    cards: sorted,
    description: `High Card, ${sorted[0].rank}`
  };
}

function checkFlush(cards: Card[]): boolean {
  const suits: Record<string, number> = {};
  for (const card of cards) {
    suits[card.suit] = (suits[card.suit] || 0) + 1;
    if (suits[card.suit] >= 5) return true;
  }
  return false;
}

function getFlushCards(cards: Card[]): Card[] {
  const suits: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!suits[card.suit]) suits[card.suit] = [];
    suits[card.suit].push(card);
    if (suits[card.suit].length >= 5) {
      return suits[card.suit].sort((a, b) => b.value - a.value);
    }
  }
  return [];
}

function checkStraight(sorted: Card[]): boolean {
  const uniqueValues = [...new Set(sorted.map(c => c.value))];
  
  // Check for A-2-3-4-5 straight (wheel)
  if (uniqueValues.includes(14) && uniqueValues.includes(2) && uniqueValues.includes(3) && 
      uniqueValues.includes(4) && uniqueValues.includes(5)) {
    return true;
  }

  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
      return true;
    }
  }
  return false;
}

function getStraightHigh(sorted: Card[]): number {
  const uniqueValues = [...new Set(sorted.map(c => c.value))];
  
  // Check for wheel (A-2-3-4-5)
  if (uniqueValues.includes(14) && uniqueValues.includes(2) && uniqueValues.includes(3) && 
      uniqueValues.includes(4) && uniqueValues.includes(5)) {
    return 5;
  }

  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
      return uniqueValues[i];
    }
  }
  return 0;
}

function groupByRank(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!groups[card.rank]) groups[card.rank] = [];
    groups[card.rank].push(card);
  }
  return groups;
}

function calculateHighCardValue(cards: Card[]): number {
  let value = 0;
  for (let i = 0; i < cards.length; i++) {
    value += cards[i].value * Math.pow(100, cards.length - 1 - i);
  }
  return value;
}

function getRankFromValue(value: number): string {
  const rankMap: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
  };
  return rankMap[value] || value.toString();
}

export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  return a.value - b.value;
}

export function compareMultipleHands(hands: HandEvaluation[]): number {
  let bestIndex = 0;
  for (let i = 1; i < hands.length; i++) {
    if (compareHands(hands[i], hands[bestIndex]) > 0) {
      bestIndex = i;
    }
  }
  return bestIndex;
}