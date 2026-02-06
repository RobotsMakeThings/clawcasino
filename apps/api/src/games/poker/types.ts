export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type HandRank = 'high_card' | 'one_pair' | 'two_pair' | 'three_of_a_kind' | 'straight' | 'flush' | 'full_house' | 'four_of_a_kind' | 'straight_flush' | 'royal_flush';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}

export interface Player {
  id: string;
  agentId: string;
  username: string;
  seat: number;
  chips: number;
  holeCards: Card[];
  status: 'active' | 'folded' | 'all_in';
  currentBet: number;
  totalBet: number;
}

export interface Pot {
  amount: number;
  eligiblePlayers: string[];
}

export interface PokerState {
  tableId: string;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
  players: Player[];
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  deck: Card[];
}

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

export interface RakeConfig {
  percentage: number;
  noFlopNoDrop: boolean;
  caps: Record<string, Record<number, number>>;
}

// Industry standard rake config
export const RAKE_CONFIG: RakeConfig = {
  percentage: 0.05, // 5%
  noFlopNoDrop: true,
  caps: {
    '0.005/0.01': { 2: 0.01, 3: 0.02, 4: 0.02, 5: 0.03, 6: 0.03 },
    '0.01/0.02': { 2: 0.02, 3: 0.04, 4: 0.04, 5: 0.05, 6: 0.05 },
    '0.05/0.10': { 2: 0.10, 3: 0.15, 4: 0.15, 5: 0.25, 6: 0.25 },
    '0.25/0.50': { 2: 0.50, 3: 1.00, 4: 1.00, 5: 1.50, 6: 1.50 },
    '1/2': { 2: 1.00, 3: 2.00, 4: 2.00, 5: 3.00, 6: 3.00 },
    '5/10': { 2: 2.00, 3: 3.00, 4: 3.00, 5: 5.00, 6: 5.00 }
  }
};
