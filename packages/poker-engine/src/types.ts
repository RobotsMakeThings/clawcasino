export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type HandRank = 'high_card' | 'one_pair' | 'two_pair' | 'three_of_a_kind' | 'straight' | 'flush' | 'full_house' | 'four_of_a_kind' | 'straight_flush' | 'royal_flush';

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}

export interface Player {
  agentId: string;
  username: string;
  seat: number;
  chips: number;
  holeCards: Card[];
  status: 'active' | 'folded' | 'all_in' | 'sitting_out';
  currentBet: number;
  totalInvested: number;
  actionTimer?: number;
}

export interface Pot {
  amount: number;
  eligiblePlayers: string[];
}

export interface HandAction {
  agentId: string;
  action: 'fold' | 'check' | 'call' | 'raise' | 'all_in';
  amount?: number;
  timestamp: number;
}

export interface HandResult {
  handId: string;
  winners: { agentId: string; amount: number; handDescription: string }[];
  rake: number;
  totalPot: number;
  communityCards: Card[];
  playerHands: { agentId: string; holeCards: Card[]; handRank: string }[];
  seed: string;
  proofHash: string;
}

export interface TableConfig {
  id: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyin: number;
  maxBuyin: number;
  maxPlayers: number;
  currency: 'SOL' | 'USDC';
}

export interface TableState {
  config: TableConfig;
  players: Player[];
  handInProgress: boolean;
  currentHand?: HandState;
  dealerPosition: number;
  handHistory: HandResult[];
}

export interface HandState {
  handId: string;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
  players: Player[];
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentBet: number;
  minRaise: number;
  lastRaiseAmount: number;
  deck: Card[];
  actions: HandAction[];
  seed: string;
  proofHash: string;
  startedAt: number;
  completedAt?: number;
}

export const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RAKE_CONFIG = {
  percentage: 0.05,
  noFlopNoDrop: true,
  caps: {
    '0.005/0.01':  { 2: 0.01, 3: 0.02, 4: 0.02, 5: 0.03, 6: 0.03 },
    '0.01/0.02':   { 2: 0.02, 3: 0.04, 4: 0.04, 5: 0.05, 6: 0.05 },
    '0.05/0.10':   { 2: 0.10, 3: 0.15, 4: 0.15, 5: 0.25, 6: 0.25 },
    '0.10/0.25':   { 2: 0.25, 3: 0.50, 4: 0.50, 5: 0.75, 6: 0.75 },
    '0.25/0.50':   { 2: 0.50, 3: 1.00, 4: 1.00, 5: 1.50, 6: 1.50 },
    '0.50/1.00':   { 2: 0.75, 3: 1.50, 4: 1.50, 5: 2.00, 6: 2.00 },
    '1.00/2.00':   { 2: 1.00, 3: 2.00, 4: 2.00, 5: 3.00, 6: 3.00 },
    '2.50/5.00':   { 2: 1.50, 3: 2.50, 4: 2.50, 5: 3.50, 6: 3.50 },
    '5.00/10.00':  { 2: 2.00, 3: 3.00, 4: 3.00, 5: 5.00, 6: 5.00 }
  }
};
