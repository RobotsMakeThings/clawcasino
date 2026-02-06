import crypto from 'crypto';
import { Card, Suit, Rank, SUITS, RANKS, createCard } from './cards';

export class Deck {
  private cards: Card[] = [];
  private seed: string;
  private hash: string;

  constructor() {
    this.seed = crypto.randomBytes(32).toString('hex');
    this.hash = crypto.createHash('sha256').update(this.seed).digest('hex');
    this.reset();
  }

  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(createCard(suit, rank));
      }
    }
    this.shuffle();
  }

  private shuffle(): void {
    // Fisher-Yates with crypto seed
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = this.getRandomInt(0, i);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  private getRandomInt(min: number, max: number): number {
    const range = max - min + 1;
    const randomBytes = crypto.randomBytes(4);
    const randomValue = randomBytes.readUInt32BE(0);
    return min + (randomValue % range);
  }

  deal(): Card {
    if (this.cards.length === 0) {
      throw new Error('Deck is empty');
    }
    return this.cards.pop()!;
  }

  dealMultiple(count: number): Card[] {
    return Array.from({ length: count }, () => this.deal());
  }

  remaining(): number {
    return this.cards.length;
  }

  getHash(): string {
    return this.hash;
  }

  verifySeed(seed: string): boolean {
    const computedHash = crypto.createHash('sha256').update(seed).digest('hex');
    return computedHash === this.hash;
  }
}