import { Card } from './engine';

// Hand rank constants (9 = best)
export const HAND_RANKS = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
} as const;

export interface HandEvaluation {
  rank: number;           // 0-9
  name: string;           // "Royal Flush", "Two Pair", etc.
  best5: Card[];          // The best 5 cards
  tiebreakers: number[];  // Comparison values
}

// Generate all C(7,5) = 21 combinations of 5 cards from 7
function generateFiveCardCombinations(cards: Card[]): Card[][] {
  const combinations: Card[][] = [];
  const n = cards.length;
  
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            combinations.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  
  return combinations;
}

// Evaluate a 5-card hand
function evaluateFiveCards(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error('Exactly 5 cards required');
  }
  
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map(c => c.rank);
  const suits = sorted.map(c => c.suit);
  
  // Count frequencies
  const freq = new Map<number, number>();
  for (const r of ranks) {
    freq.set(r, (freq.get(r) || 0) + 1);
  }
  
  const isFlush = suits.every(s => s === suits[0]);
  
  // Check for straight (including wheel: A-2-3-4-5)
  const uniqueRanks = [...new Set(ranks)];
  let isStraight = false;
  let straightHigh = 0;
  
  if (uniqueRanks.length === 5) {
    // Normal straight
    if (ranks[0] - ranks[4] === 4) {
      isStraight = true;
      straightHigh = ranks[0];
    }
    // Wheel: A-2-3-4-5 (ranks would be [14, 5, 4, 3, 2])
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      isStraight = true;
      straightHigh = 5;  // Wheel is 5-high
    }
  }
  
  // Check for straight flush / royal flush
  if (isFlush && isStraight) {
    if (straightHigh === 14 && ranks.includes(13)) {
      return {
        rank: HAND_RANKS.ROYAL_FLUSH,
        name: 'Royal Flush',
        best5: sorted,
        tiebreakers: [14]
      };
    }
    return {
      rank: HAND_RANKS.STRAIGHT_FLUSH,
      name: `Straight Flush, ${rankName(straightHigh)} high`,
      best5: sorted,
      tiebreakers: [straightHigh]
    };
  }
  
  // Four of a kind
  const quads = Array.from(freq.entries()).filter(([r, c]) => c === 4);
  if (quads.length === 1) {
    const quadRank = quads[0][0];
    const kicker = ranks.find(r => r !== quadRank)!;
    return {
      rank: HAND_RANKS.QUADS,
      name: `Four of a Kind, ${rankName(quadRank)}s`,
      best5: sorted,
      tiebreakers: [quadRank, kicker]
    };
  }
  
  // Full house
  const trips = Array.from(freq.entries()).filter(([r, c]) => c === 3);
  const pairs = Array.from(freq.entries()).filter(([r, c]) => c === 2);
  if (trips.length >= 1 && (pairs.length >= 1 || trips.length >= 2)) {
    // If two trips, higher one is trips, lower is pair
    const tripRank = trips.sort((a, b) => b[0] - a[0])[0][0];
    const pairRank = pairs.length > 0 
      ? pairs.sort((a, b) => b[0] - a[0])[0][0]
      : trips.sort((a, b) => b[0] - a[0])[1][0];
    return {
      rank: HAND_RANKS.FULL_HOUSE,
      name: `Full House, ${rankName(tripRank)}s full of ${rankName(pairRank)}s`,
      best5: sorted,
      tiebreakers: [tripRank, pairRank]
    };
  }
  
  // Flush
  if (isFlush) {
    return {
      rank: HAND_RANKS.FLUSH,
      name: `Flush, ${rankName(ranks[0])} high`,
      best5: sorted,
      tiebreakers: ranks.slice(0, 5)  // All 5 ranks high to low
    };
  }
  
  // Straight
  if (isStraight) {
    return {
      rank: HAND_RANKS.STRAIGHT,
      name: `Straight, ${rankName(straightHigh)} high`,
      best5: sorted,
      tiebreakers: [straightHigh]
    };
  }
  
  // Three of a kind
  if (trips.length === 1) {
    const tripRank = trips[0][0];
    const kickers = ranks.filter(r => r !== tripRank).slice(0, 2);
    return {
      rank: HAND_RANKS.TRIPS,
      name: `Three of a Kind, ${rankName(tripRank)}s`,
      best5: sorted,
      tiebreakers: [tripRank, ...kickers]
    };
  }
  
  // Two pair
  if (pairs.length >= 2) {
    const sortedPairs = pairs.sort((a, b) => b[0] - a[0]);
    const highPair = sortedPairs[0][0];
    const lowPair = sortedPairs[1][0];
    const kicker = ranks.find(r => r !== highPair && r !== lowPair)!;
    return {
      rank: HAND_RANKS.TWO_PAIR,
      name: `Two Pair, ${rankName(highPair)}s and ${rankName(lowPair)}s`,
      best5: sorted,
      tiebreakers: [highPair, lowPair, kicker]
    };
  }
  
  // One pair
  if (pairs.length === 1) {
    const pairRank = pairs[0][0];
    const kickers = ranks.filter(r => r !== pairRank).slice(0, 3);
    return {
      rank: HAND_RANKS.PAIR,
      name: `Pair of ${rankName(pairRank)}s`,
      best5: sorted,
      tiebreakers: [pairRank, ...kickers]
    };
  }
  
  // High card
  return {
    rank: HAND_RANKS.HIGH_CARD,
    name: `High Card, ${rankName(ranks[0])}`,
    best5: sorted,
    tiebreakers: ranks.slice(0, 5)
  };
}

// Compare two hand evaluations
// Returns: 1 if a wins, -1 if b wins, 0 if tie
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  // Compare rank first
  if (a.rank !== b.rank) {
    return a.rank > b.rank ? 1 : -1;
  }
  
  // Same rank - compare tiebreakers
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const ta = a.tiebreakers[i] || 0;
    const tb = b.tiebreakers[i] || 0;
    if (ta !== tb) {
      return ta > tb ? 1 : -1;
    }
  }
  
  return 0;  // Tie
}

// Evaluate 7 cards (Texas Hold'em) - find best 5-card hand
export function evaluate(sevenCards: Card[]): HandEvaluation {
  if (sevenCards.length !== 7) {
    throw new Error('Exactly 7 cards required for Hold\'em evaluation');
  }
  
  const combinations = generateFiveCardCombinations(sevenCards);
  
  let bestEval: HandEvaluation | null = null;
  let best5: Card[] = [];
  
  for (const combo of combinations) {
    const eval_ = evaluateFiveCards(combo);
    if (!bestEval || compareHands(eval_, bestEval) > 0) {
      bestEval = eval_;
      best5 = combo;
    }
  }
  
  return { ...bestEval!, best5 };
}

// Find best hand from hole cards and community cards
export function findBestHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) {
    throw new Error('Need at least 5 total cards');
  }
  return evaluate(allCards);
}

// Helper: convert rank number to name
function rankName(rank: number): string {
  if (rank === 14) return 'Ace';
  if (rank === 13) return 'King';
  if (rank === 12) return 'Queen';
  if (rank === 11) return 'Jack';
  return rank.toString();
}

// Helper for tests
export function cardsFromStrings(strings: string[]): Card[] {
  return strings.map(s => {
    if (s.length !== 2) throw new Error(`Invalid card: ${s}`);
    const rankChar = s[0];
    const suit = s[1] as 'h' | 'd' | 'c' | 's';
    const rank = rankChar === 'A' ? 14 :
                 rankChar === 'K' ? 13 :
                 rankChar === 'Q' ? 12 :
                 rankChar === 'J' ? 11 :
                 rankChar === 'T' ? 10 :
                 parseInt(rankChar);
    return { rank, suit };
  });
}
