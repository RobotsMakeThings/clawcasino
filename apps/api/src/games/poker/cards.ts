import { Card, HandRank } from './types';

// Card suits and ranks
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

// Card values for comparison
export const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    }
  }
  return shuffle(deck);
}

export function shuffle(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function evaluateHand(cards: Card[]): { rank: HandRank; value: number; description: string } {
  if (cards.length < 5) {
    return { rank: 'high_card', value: Math.max(...cards.map(c => c.value)), description: 'Incomplete hand' };
  }

  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = values.every((v, i) => i === 0 || v === values[i - 1] - 1);
  const isRoyal = isFlush && isStraight && values[0] === 14;

  const valueCounts = new Map<number, number>();
  values.forEach(v => valueCounts.set(v, (valueCounts.get(v) || 0) + 1));
  const counts = Array.from(valueCounts.values()).sort((a, b) => b - a);

  // Royal Flush
  if (isRoyal) {
    return { rank: 'royal_flush', value: 1000000, description: 'Royal Flush' };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: 'straight_flush', value: 900000 + values[0], description: `Straight Flush, ${sorted[0].rank} high` };
  }

  // Four of a Kind
  if (counts[0] === 4) {
    const quadValue = Array.from(valueCounts.entries()).find(([_, c]) => c === 4)![0];
    const kicker = values.find(v => v !== quadValue)!;
    return { rank: 'four_of_a_kind', value: 800000 + quadValue * 15 + kicker, description: `Four of a Kind, ${cardName(quadValue)}s` };
  }

  // Full House
  if (counts[0] === 3 && counts[1] >= 2) {
    const tripValue = Array.from(valueCounts.entries()).find(([_, c]) => c === 3)![0];
    const pairValue = Array.from(valueCounts.entries()).find(([v, c]) => c >= 2 && v !== tripValue)![0];
    return { rank: 'full_house', value: 700000 + tripValue * 15 + pairValue, description: `Full House, ${cardName(tripValue)}s full of ${cardName(pairValue)}s` };
  }

  // Flush
  if (isFlush) {
    return { rank: 'flush', value: 600000 + values[0], description: `Flush, ${sorted[0].rank} high` };
  }

  // Straight
  if (isStraight) {
    return { rank: 'straight', value: 500000 + values[0], description: `Straight, ${sorted[0].rank} high` };
  }

  // Three of a Kind
  if (counts[0] === 3) {
    const tripValue = Array.from(valueCounts.entries()).find(([_, c]) => c === 3)![0];
    const kickers = values.filter(v => v !== tripValue).slice(0, 2);
    return { rank: 'three_of_a_kind', value: 400000 + tripValue * 225 + kickers[0] * 15 + kickers[1], description: `Three of a Kind, ${cardName(tripValue)}s` };
  }

  // Two Pair
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = Array.from(valueCounts.entries()).filter(([_, c]) => c === 2).map(([v]) => v).sort((a, b) => b - a);
    const kicker = values.find(v => !pairs.includes(v))!;
    return { rank: 'two_pair', value: 300000 + pairs[0] * 225 + pairs[1] * 15 + kicker, description: `Two Pair, ${cardName(pairs[0])}s and ${cardName(pairs[1])}s` };
  }

  // One Pair
  if (counts[0] === 2) {
    const pairValue = Array.from(valueCounts.entries()).find(([_, c]) => c === 2)![0];
    const kickers = values.filter(v => v !== pairValue).slice(0, 3);
    return { rank: 'one_pair', value: 200000 + pairValue * 3375 + kickers[0] * 225 + kickers[1] * 15 + kickers[2], description: `Pair of ${cardName(pairValue)}s` };
  }

  // High Card
  return { 
    rank: 'high_card', 
    value: values[0] * 50625 + values[1] * 3375 + values[2] * 225 + values[3] * 15 + values[4],
    description: `High Card ${sorted[0].rank}`
  };
}

function cardName(value: number): string {
  const entries = Object.entries(RANK_VALUES);
  const entry = entries.find(([_, v]) => v === value);
  return entry ? entry[0] : String(value);
}

export function compareHands(hand1: Card[], hand2: Card[]): number {
  const eval1 = evaluateHand(hand1);
  const eval2 = evaluateHand(hand2);
  
  if (eval1.value > eval2.value) return 1;
  if (eval1.value < eval2.value) return -1;
  return 0;
}
