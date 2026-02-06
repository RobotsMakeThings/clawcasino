import crypto from 'crypto';
import { Card, Suit, Rank, RANK_VALUES, SUITS, RANKS } from './types';

export function createCard(suit: Suit, rank: Rank): Card {
  return {
    suit,
    rank,
    value: RANK_VALUES[rank]
  };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(suit, rank));
    }
  }
  return deck;
}

// Cryptographically secure shuffle using Fisher-Yates
export function shuffleDeck(deck: Card[]): { deck: Card[]; seed: string } {
  const seed = crypto.randomBytes(32).toString('hex');
  const shuffled = fisherYatesShuffle([...deck], seed);
  return { deck: shuffled, seed };
}

export function fisherYatesShuffle(deck: Card[], seed: string): Card[] {
  const shuffled = [...deck];
  let seedNum = BigInt('0x' + seed.slice(0, 16));
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    seedNum = (seedNum * 1103515245n + 12345n) % (2n ** 31n);
    const j = Number(seedNum % BigInt(i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

export function generateProofHash(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function cardToString(card: Card): string {
  return `${card.rank}${getSuitSymbol(card.suit)}`;
}

function getSuitSymbol(suit: Suit): string {
  const symbols: Record<Suit, string> = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  };
  return symbols[suit];
}

export function stringToCard(str: string): Card {
  const suitMap: Record<string, Suit> = {
    'H': 'hearts', 'D': 'diamonds', 'C': 'clubs', 'S': 'spades',
    '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs', '♠': 'spades'
  };
  
  const rank = str.slice(0, -1) as Rank;
  const suitChar = str.slice(-1);
  const suit = suitMap[suitChar];
  
  if (!suit || !RANK_VALUES[rank]) {
    throw new Error(`Invalid card string: ${str}`);
  }
  
  return createCard(suit, rank);
}
