import { Card, HandRank, RANK_VALUES } from './types';

export interface HandEvaluation {
  rank: HandRank;
  value: number;
  description: string;
  kickers: number[];
}

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate');
  }

  // Check for each hand rank from best to worst
  const royalFlush = checkRoyalFlush(cards);
  if (royalFlush) return royalFlush;

  const straightFlush = checkStraightFlush(cards);
  if (straightFlush) return straightFlush;

  const fourOfAKind = checkFourOfAKind(cards);
  if (fourOfAKind) return fourOfAKind;

  const fullHouse = checkFullHouse(cards);
  if (fullHouse) return fullHouse;

  const flush = checkFlush(cards);
  if (flush) return flush;

  const straight = checkStraight(cards);
  if (straight) return straight;

  const threeOfAKind = checkThreeOfAKind(cards);
  if (threeOfAKind) return threeOfAKind;

  const twoPair = checkTwoPair(cards);
  if (twoPair) return twoPair;

  const onePair = checkOnePair(cards);
  if (onePair) return onePair;

  return checkHighCard(cards);
}

function checkRoyalFlush(cards: Card[]): HandEvaluation | null {
  const bySuit = groupBySuit(cards);
  
  for (const suit in bySuit) {
    const suited = bySuit[suit];
    if (suited.length >= 5) {
      const values = suited.map(c => c.value).sort((a, b) => b - a);
      if (values.includes(14) && values.includes(13) && values.includes(12) && values.includes(11) && values.includes(10)) {
        return {
          rank: 'royal_flush',
          value: 10000000,
          description: 'Royal Flush',
          kickers: [14]
        };
      }
    }
  }
  return null;
}

function checkStraightFlush(cards: Card[]): HandEvaluation | null {
  const bySuit = groupBySuit(cards);
  
  for (const suit in bySuit) {
    const suited = bySuit[suit];
    if (suited.length >= 5) {
      const straightHigh = findStraightHigh(suited);
      if (straightHigh > 0) {
        return {
          rank: 'straight_flush',
          value: 9000000 + straightHigh * 15,
          description: `Straight Flush, ${rankName(straightHigh)} high`,
          kickers: [straightHigh]
        };
      }
    }
  }
  return null;
}

function checkFourOfAKind(cards: Card[]): HandEvaluation | null {
  const byValue = groupByValue(cards);
  
  for (const value in byValue) {
    if (byValue[value].length === 4) {
      const quadValue = parseInt(value);
      const kicker = getHighestKicker(cards, [quadValue]);
      return {
        rank: 'four_of_a_kind',
        value: 8000000 + quadValue * 15 + kicker,
        description: `Four of a Kind, ${rankName(quadValue)}s`,
        kickers: [quadValue, kicker]
      };
    }
  }
  return null;
}

function checkFullHouse(cards: Card[]): HandEvaluation | null {
  const byValue = groupByValue(cards);
  let tripsValue = 0;
  let pairValue = 0;
  
  for (const value in byValue) {
    if (byValue[value].length >= 3 && parseInt(value) > tripsValue) {
      tripsValue = parseInt(value);
    }
  }
  
  if (tripsValue > 0) {
    for (const value in byValue) {
      const v = parseInt(value);
      if (v !== tripsValue && byValue[value].length >= 2 && v > pairValue) {
        pairValue = v;
      }
    }
    
    if (pairValue > 0) {
      return {
        rank: 'full_house',
        value: 7000000 + tripsValue * 15 + pairValue,
        description: `Full House, ${rankName(tripsValue)}s full of ${rankName(pairValue)}s`,
        kickers: [tripsValue, pairValue]
      };
    }
  }
  return null;
}

function checkFlush(cards: Card[]): HandEvaluation | null {
  const bySuit = groupBySuit(cards);
  
  for (const suit in bySuit) {
    if (bySuit[suit].length >= 5) {
      const sorted = bySuit[suit].sort((a, b) => b.value - a.value);
      const kickers = sorted.slice(0, 5).map(c => c.value);
      return {
        rank: 'flush',
        value: 6000000 + kickers[0] * 50625 + kickers[1] * 3375 + kickers[2] * 225 + kickers[3] * 15 + kickers[4],
        description: `Flush, ${rankName(kickers[0])} high`,
        kickers
      };
    }
  }
  return null;
}

function checkStraight(cards: Card[]): HandEvaluation | null {
  const straightHigh = findStraightHigh(cards);
  if (straightHigh > 0) {
    return {
      rank: 'straight',
      value: 5000000 + straightHigh * 15,
      description: `Straight, ${rankName(straightHigh)} high`,
      kickers: [straightHigh]
    };
  }
  return null;
}

function checkThreeOfAKind(cards: Card[]): HandEvaluation | null {
  const byValue = groupByValue(cards);
  
  for (const value in byValue) {
    if (byValue[value].length === 3) {
      const tripsValue = parseInt(value);
      const kickers = getTopKickers(cards, [tripsValue], 2);
      return {
        rank: 'three_of_a_kind',
        value: 4000000 + tripsValue * 50625 + kickers[0] * 3375 + kickers[1] * 225 + kickers[2],
        description: `Three of a Kind, ${rankName(tripsValue)}s`,
        kickers: [tripsValue, ...kickers]
      };
    }
  }
  return null;
}

function checkTwoPair(cards: Card[]): HandEvaluation | null {
  const byValue = groupByValue(cards);
  const pairs: number[] = [];
  
  for (const value in byValue) {
    if (byValue[value].length >= 2) {
      pairs.push(parseInt(value));
    }
  }
  
  if (pairs.length >= 2) {
    pairs.sort((a, b) => b - a);
    const [highPair, lowPair] = pairs;
    const kicker = getHighestKicker(cards, [highPair, lowPair]);
    return {
      rank: 'two_pair',
      value: 3000000 + highPair * 50625 + lowPair * 3375 + kicker * 225,
      description: `Two Pair, ${rankName(highPair)}s and ${rankName(lowPair)}s`,
      kickers: [highPair, lowPair, kicker]
    };
  }
  return null;
}

function checkOnePair(cards: Card[]): HandEvaluation | null {
  const byValue = groupByValue(cards);
  
  for (const value in byValue) {
    if (byValue[value].length === 2) {
      const pairValue = parseInt(value);
      const kickers = getTopKickers(cards, [pairValue], 3);
      return {
        rank: 'one_pair',
        value: 2000000 + pairValue * 50625 + kickers[0] * 3375 + kickers[1] * 225 + kickers[2] * 15 + kickers[3],
        description: `Pair of ${rankName(pairValue)}s`,
        kickers: [pairValue, ...kickers]
      };
    }
  }
  return null;
}

function checkHighCard(cards: Card[]): HandEvaluation {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const kickers = sorted.slice(0, 5).map(c => c.value);
  return {
    rank: 'high_card',
    value: kickers[0] * 50625 + kickers[1] * 3375 + kickers[2] * 225 + kickers[3] * 15 + kickers[4],
    description: `High Card ${rankName(kickers[0])}`,
    kickers
  };
}

// Helper functions
function groupBySuit(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!groups[card.suit]) groups[card.suit] = [];
    groups[card.suit].push(card);
  }
  return groups;
}

function groupByValue(cards: Card[]): Record<string, Card[]> {
  const groups: Record<string, Card[]> = {};
  for (const card of cards) {
    if (!groups[card.value]) groups[card.value] = [];
    groups[card.value].push(card);
  }
  return groups;
}

function findStraightHigh(cards: Card[]): number {
  const uniqueValues = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);
  
  for (let i = 0; i <= uniqueValues.length - 5; i++) {
    if (uniqueValues[i] - uniqueValues[i + 4] === 4) {
      return uniqueValues[i];
    }
  }
  
  if (uniqueValues.includes(14) && uniqueValues.includes(5) && 
      uniqueValues.includes(4) && uniqueValues.includes(3) && uniqueValues.includes(2)) {
    return 5;
  }
  
  return 0;
}

function getHighestKicker(cards: Card[], excludeValues: number[]): number {
  const sorted = cards.filter(c => !excludeValues.includes(c.value)).sort((a, b) => b.value - a.value);
  return sorted.length > 0 ? sorted[0].value : 0;
}

function getTopKickers(cards: Card[], excludeValues: number[], count: number): number[] {
  return cards
    .filter(c => !excludeValues.includes(c.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
    .map(c => c.value);
}

function rankName(value: number): string {
  const names: Record<number, string> = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack',
    10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven',
    6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Deuce'
  };
  return names[value] || String(value);
}

// Compare two 7-card hands
export function compareHands(hand1Cards: Card[], hand2Cards: Card[]): number {
  const eval1 = evaluateHand(hand1Cards);
  const eval2 = evaluateHand(hand2Cards);
  
  if (eval1.value > eval2.value) return 1;
  if (eval1.value < eval2.value) return -1;
  return 0;
}

// Find best 5-card hand from 7 cards
export function findBestHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards];
  const combinations = getCombinations(allCards, 5);
  
  let best: HandEvaluation | null = null;
  for (const combo of combinations) {
    const evalResult = evaluateHand(combo);
    if (!best || evalResult.value > best.value) {
      best = evalResult;
    }
  }
  
  return best!;
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  if (arr.length === k) return [[...arr]];
  
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(combo => [first, ...combo]);
  const withoutFirst = getCombinations(rest, k);
  
  return [...withFirst, ...withoutFirst];
}
