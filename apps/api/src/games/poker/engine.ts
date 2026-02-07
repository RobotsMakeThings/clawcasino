import crypto from 'crypto';

export type Suit = 'h' | 'd' | 'c' | 's';

export interface Card {
  rank: number;  // 2-14, 14=Ace
  suit: Suit;
}

// Display format helpers
export function cardToString(card: Card): string {
  const rankChar = card.rank === 14 ? 'A' :
                   card.rank === 13 ? 'K' :
                   card.rank === 12 ? 'Q' :
                   card.rank === 11 ? 'J' :
                   card.rank === 10 ? 'T' :
                   String(card.rank);
  return rankChar + card.suit;
}

export function stringToCard(str: string): Card {
  if (str.length !== 2) throw new Error(`Invalid card string: ${str}`);
  
  const rankChar = str[0];
  const suit = str[1] as Suit;
  
  if (!['h', 'd', 'c', 's'].includes(suit)) {
    throw new Error(`Invalid suit: ${suit}`);
  }
  
  const rank = rankChar === 'A' ? 14 :
               rankChar === 'K' ? 13 :
               rankChar === 'Q' ? 12 :
               rankChar === 'J' ? 11 :
               rankChar === 'T' ? 10 :
               parseInt(rankChar);
               
  if (isNaN(rank) || rank < 2 || rank > 14) {
    throw new Error(`Invalid rank: ${rankChar}`);
  }
  
  return { rank, suit };
}

// Create a standard 52-card deck
export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits: Suit[] = ['h', 'd', 'c', 's'];
  
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  
  return deck;
}

// Fisher-Yates shuffle using crypto.randomBytes
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Get random bytes for this position
    const randomBytes = crypto.randomBytes(4);
    const randomValue = randomBytes.readUInt32BE(0);
    const j = randomValue % (i + 1);
    
    // Swap
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Generate provably fair shuffle with seed
export interface ShuffledDeck {
  deck: Card[];
  seed: string;        // 32-byte seed (hex)
  seedHash: string;    // SHA256(seed) - revealed before hand
}

export function createShuffledDeck(): ShuffledDeck {
  const seed = crypto.randomBytes(32).toString('hex');
  const seedHash = crypto.createHash('sha256').update(seed).digest('hex');
  
  // Use seed to shuffle deterministically
  const deck = createDeck();
  const shuffled = shuffleWithSeed(deck, seed);
  
  return { deck: shuffled, seed, seedHash };
}

// Deterministic shuffle using seed (for verification)
function shuffleWithSeed(deck: Card[], seed: string): Card[] {
  const shuffled = [...deck];
  let seedIndex = 0;
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Use bytes from seed
    const byte1 = parseInt(seed.slice(seedIndex % 64, (seedIndex % 64) + 2), 16);
    seedIndex += 2;
    const byte2 = parseInt(seed.slice(seedIndex % 64, (seedIndex % 64) + 2), 16);
    seedIndex += 2;
    
    const j = ((byte1 << 8) + byte2) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Verify that a deck was shuffled with the given seed
export function verifyShuffle(deck: Card[], seed: string): boolean {
  const originalDeck = createDeck();
  const expectedDeck = shuffleWithSeed(originalDeck, seed);
  
  if (deck.length !== expectedDeck.length) return false;
  
  for (let i = 0; i < deck.length; i++) {
    if (deck[i].rank !== expectedDeck[i].rank || deck[i].suit !== expectedDeck[i].suit) {
      return false;
    }
  }
  
  return true;
}

// Deal cards from deck
export function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  return {
    cards: deck.slice(0, count),
    remaining: deck.slice(count)
  };
}
