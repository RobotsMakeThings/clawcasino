import { Card, formatCards } from './cards';
import { Deck } from './deck';
import { evaluateHand, HandEvaluation, compareHands } from './hand-evaluator';

export type PlayerStatus = 'active' | 'folded' | 'all_in' | 'sitting_out';
export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all_in';
export type Currency = 'SOL' | 'USDC';

export interface Player {
  id: string;
  username: string;
  seat: number;
  chips: number;
  holeCards: Card[];
  status: PlayerStatus;
  currentBet: number;
  totalBetsInHand: number;
  lastAction?: string;
  folded: boolean;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayers: string[];
}

export interface HandResult {
  winners: { playerId: string; username: string; amount: number; hand: HandEvaluation }[];
  rake: number;
  totalPot: number;
  reachedFlop: boolean;
}

export interface PokerGameState {
  tableId: string;
  phase: GamePhase;
  players: Player[];
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  minBet: number;
  maxBet: number;
  currentBet: number;
  deckHash: string;
  handNumber: number;
  currency: Currency;
  timestamp: number;
}

// Industry-standard rake structure (matching PokerStars/GGPoker)
export const RAKE_CONFIG = {
  percentage: 0.05, // 5%
  noFlopNoDrop: true, // ZERO rake if hand ends before flop
  caps: {
    // [blinds]: { numPlayers: cap }
    '0.005/0.01': { 2: 0.01, 3: 0.02, 4: 0.02, 5: 0.03, 6: 0.03 },
    '0.01/0.02': { 2: 0.02, 3: 0.04, 4: 0.04, 5: 0.05, 6: 0.05 },
    '0.05/0.10': { 2: 0.10, 3: 0.15, 4: 0.15, 5: 0.25, 6: 0.25 },
    '0.10/0.25': { 2: 0.25, 3: 0.50, 4: 0.50, 5: 0.75, 6: 0.75 },
    '0.25/0.50': { 2: 0.50, 3: 1.00, 4: 1.00, 5: 1.50, 6: 1.50 },
    '0.50/1.00': { 2: 0.75, 3: 1.50, 4: 1.50, 5: 2.00, 6: 2.00 },
    '1.00/2.00': { 2: 1.00, 3: 2.00, 4: 2.00, 5: 3.00, 6: 3.00 },
    '2.50/5.00': { 2: 1.50, 3: 2.50, 4: 2.50, 5: 3.50, 6: 3.50 },
    '5.00/10.00': { 2: 2.00, 3: 3.00, 4: 3.00, 5: 5.00, 6: 5.00 },
    // USDC caps
    '0.25/0.50': { 2: 0.50, 3: 1.00, 4: 1.00, 5: 1.50, 6: 1.50 },
    '0.50/1.00': { 2: 0.75, 3: 1.50, 4: 1.50, 5: 2.00, 6: 2.00 },
    '1/2': { 2: 1.00, 3: 2.00, 4: 2.00, 5: 3.00, 6: 3.00 },
    '2.50/5': { 2: 1.50, 3: 2.50, 4: 2.50, 5: 3.50, 6: 3.50 },
    '5/10': { 2: 2.00, 3: 3.00, 4: 3.00, 5: 5.00, 6: 5.00 },
  } as Record<string, Record<number, number>>
};

export function calculateRake(
  potSize: number, 
  blindLevel: string, 
  numPlayers: number, 
  reachedFlop: boolean
): number {
  // No flop no drop
  if (!reachedFlop && RAKE_CONFIG.noFlopNoDrop) {
    return 0;
  }

  // Calculate raw rake
  const rawRake = potSize * RAKE_CONFIG.percentage;
  
  // Get cap for this blind level and player count
  const playerCount = Math.min(numPlayers, 6);
  const cap = RAKE_CONFIG.caps[blindLevel]?.[playerCount];
  
  // Apply cap if exists, otherwise use raw rake
  if (cap !== undefined) {
    return Math.min(rawRake, cap);
  }
  
  return rawRake;
}

export class PokerGame {
  private tableId: string;
  private players: Map<string, Player> = new Map();
  private seatedPlayers: Player[] = [];
  private deck: Deck;
  private communityCards: Card[] = [];
  private pots: Pot[] = [];
  private phase: GamePhase = 'waiting';
  private currentPlayerIndex: number = 0;
  private dealerIndex: number = 0;
  private smallBlind: number;
  private bigBlind: number;
  private minBuyin: number;
  private maxBuyin: number;
  private currentBet: number = 0;
  private lastRaise: number = 0;
  private handNumber: number = 0;
  private actionTimer: NodeJS.Timeout | null = null;
  private handResults: HandResult | null = null;
  private currency: Currency;
  private readonly ACTION_TIMEOUT = 30000; // 30 seconds

  constructor(
    tableId: string,
    smallBlind: number,
    bigBlind: number,
    minBuyin: number,
    maxBuyin: number,
    currency: Currency = 'SOL'
  ) {
    this.tableId = tableId;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.minBuyin = minBuyin;
    this.maxBuyin = maxBuyin;
    this.currency = currency;
    this.deck = new Deck();
  }

  getCurrency(): Currency {
    return this.currency;
  }

  getBlindLevel(): string {
    return `${this.smallBlind}/${this.bigBlind}`;
  }

  // Player Management
  joinTable(playerId: string, username: string, buyinAmount: number, seat?: number): { success: boolean; error?: string; player?: Player } {
    if (this.players.has(playerId)) {
      return { success: false, error: 'Player already at table' };
    }

    if (buyinAmount < this.minBuyin || buyinAmount > this.maxBuyin) {
      return { success: false, error: `Buyin must be between ${this.minBuyin} and ${this.maxBuyin} ${this.currency}` };
    }

    if (this.seatedPlayers.length >= 6) {
      return { success: false, error: 'Table is full' };
    }

    // Find available seat
    if (seat === undefined) {
      const takenSeats = new Set(this.seatedPlayers.map(p => p.seat));
      for (let i = 0; i < 6; i++) {
        if (!takenSeats.has(i)) {
          seat = i;
          break;
        }
      }
    }

    if (seat === undefined || seat < 0 || seat > 5) {
      return { success: false, error: 'Invalid seat' };
    }

    if (this.seatedPlayers.some(p => p.seat === seat)) {
      return { success: false, error: 'Seat is taken' };
    }

    const player: Player = {
      id: playerId,
      username,
      seat,
      chips: buyinAmount,
      holeCards: [],
      status: 'active',
      currentBet: 0,
      totalBetsInHand: 0,
      folded: false,
      allIn: false
    };

    this.players.set(playerId, player);
    this.seatedPlayers.push(player);
    this.seatedPlayers.sort((a, b) => a.seat - b.seat);

    return { success: true, player };
  }

  leaveTable(playerId: string): { success: boolean; error?: string; remainingChips?: number } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not at table' };
    }

    // Can't leave during active hand
    if (this.phase !== 'waiting' && this.phase !== 'finished') {
      // Mark as sitting out after current hand
      player.status = 'sitting_out';
      return { success: true, remainingChips: player.chips, message: 'Will leave after current hand' };
    }

    const remainingChips = player.chips;
    this.players.delete(playerId);
    this.seatedPlayers = this.seatedPlayers.filter(p => p.id !== playerId);

    return { success: true, remainingChips };
  }

  // Add chips (rebuy)
  addChips(playerId: string, amount: number): { success: boolean; error?: string; newBalance?: number } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not at table' };
    }

    const newTotal = player.chips + amount;
    if (newTotal > this.maxBuyin) {
      return { success: false, error: `Cannot exceed max buyin of ${this.maxBuyin} ${this.currency}` };
    }

    player.chips += amount;
    return { success: true, newBalance: player.chips };
  }

  // Start a new hand
  startHand(): { success: boolean; error?: string; state?: PokerGameState } {
    if (this.seatedPlayers.length < 2) {
      return { success: false, error: 'Need at least 2 players to start' };
    }

    const activePlayers = this.getActivePlayersInOrder();
    if (activePlayers.length < 2) {
      return { success: false, error: 'Need at least 2 active players' };
    }

    // Reset for new hand
    this.handNumber++;
    this.handResults = null;
    this.phase = 'waiting';
    this.communityCards = [];
    this.pots = [];
    this.currentBet = 0;
    this.lastRaise = 0;

    // Reset player states
    for (const player of this.seatedPlayers) {
      if (player.status === 'sitting_out') continue;
      player.holeCards = [];
      player.status = 'active';
      player.currentBet = 0;
      player.totalBetsInHand = 0;
      player.lastAction = undefined;
      player.folded = false;
      player.allIn = false;
    }

    // Move dealer button
    this.dealerIndex = (this.dealerIndex + 1) % activePlayers.length;
    this.currentPlayerIndex = 0;

    // Deal cards
    this.deck.reset();
    for (const player of activePlayers) {
      player.holeCards = this.deck.dealMultiple(2);
    }

    // Post blinds
    this.postBlinds();

    // Start preflop betting
    this.phase = 'preflop';
    this.setNextPlayerToAct();
    this.startActionTimer();

    return { success: true, state: this.getState() };
  }

  private postBlinds(): void {
    const activePlayers = this.getActivePlayersInOrder();
    if (activePlayers.length < 2) return;

    // Small blind
    const sbIndex = 0;
    const sbPlayer = activePlayers[sbIndex];
    const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentBet = sbAmount;
    sbPlayer.totalBetsInHand = sbAmount;
    sbPlayer.lastAction = `posted small blind ${sbAmount}`;

    // Big blind
    const bbIndex = 1;
    const bbPlayer = activePlayers[bbIndex];
    const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentBet = bbAmount;
    bbPlayer.totalBetsInHand = bbAmount;
    bbPlayer.lastAction = `posted big blind ${bbAmount}`;

    this.currentBet = bbAmount;
    this.lastRaise = bbAmount;
  }

  performAction(playerId: string, action: PlayerAction, amount?: number): { success: boolean; error?: string; state?: PokerGameState } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not at table' };
    }

    if (this.phase === 'waiting' || this.phase === 'finished') {
      return { success: false, error: 'No hand in progress' };
    }

    const activePlayers = this.getActivePlayersInOrder();
    if (activePlayers[this.currentPlayerIndex]?.id !== playerId) {
      return { success: false, error: 'Not your turn to act' };
    }

    if (player.status !== 'active') {
      return { success: false, error: 'You are not active in this hand' };
    }

    this.stopActionTimer();

    let success = false;
    switch (action) {
      case 'fold':
        success = this.handleFold(player);
        break;
      case 'check':
        success = this.handleCheck(player);
        break;
      case 'call':
        success = this.handleCall(player);
        break;
      case 'raise':
        if (amount === undefined) {
          return { success: false, error: 'Raise amount required' };
        }
        success = this.handleRaise(player, amount);
        break;
      case 'all_in':
        success = this.handleAllIn(player);
        break;
      default:
        return { success: false, error: 'Invalid action' };
    }

    if (!success) {
      this.startActionTimer();
      return { success: false, error: 'Action could not be performed' };
    }

    // Check if betting round is complete
    if (this.isBettingRoundComplete()) {
      this.advancePhase();
    } else {
      this.setNextPlayerToAct();
      this.startActionTimer();
    }

    return { success: true, state: this.getState() };
  }

  private handleFold(player: Player): boolean {
    player.folded = true;
    player.status = 'folded';
    player.lastAction = 'folded';
    return true;
  }

  private handleCheck(player: Player): boolean {
    if (player.currentBet < this.currentBet) {
      return false;
    }
    player.lastAction = 'checked';
    return true;
  }

  private handleCall(player: Player): boolean {
    const callAmount = this.currentBet - player.currentBet;
    if (callAmount > player.chips) {
      return false;
    }

    player.chips -= callAmount;
    player.currentBet += callAmount;
    player.totalBetsInHand += callAmount;
    player.lastAction = `called ${callAmount}`;
    return true;
  }

  private handleRaise(player: Player, amount: number): boolean {
    const minRaise = this.currentBet + this.lastRaise;
    if (amount < minRaise) {
      return false;
    }

    const raiseAmount = amount - player.currentBet;
    if (raiseAmount > player.chips) {
      return false;
    }

    player.chips -= raiseAmount;
    player.currentBet = amount;
    player.totalBetsInHand += raiseAmount;
    player.lastAction = `raised to ${amount}`;
    
    this.lastRaise = amount - this.currentBet;
    this.currentBet = amount;

    return true;
  }

  private handleAllIn(player: Player): boolean {
    const allInAmount = player.chips;
    if (allInAmount <= 0) {
      return false;
    }

    player.chips = 0;
    player.currentBet += allInAmount;
    player.totalBetsInHand += allInAmount;
    player.allIn = true;
    player.status = 'all_in';
    player.lastAction = `went all-in for ${player.currentBet}`;

    if (player.currentBet > this.currentBet) {
      this.lastRaise = player.currentBet - this.currentBet;
      this.currentBet = player.currentBet;
    }

    return true;
  }

  private isBettingRoundComplete(): boolean {
    const activePlayers = this.getActivePlayersInOrder().filter(p => !p.folded);
    
    // All players must have acted and bets must be equal
    return activePlayers.every(p => {
      if (p.allIn) return true;
      return p.currentBet === this.currentBet && p.lastAction !== undefined;
    });
  }

  private advancePhase(): void {
    // Collect bets into pot(s)
    this.collectBets();

    switch (this.phase) {
      case 'preflop':
        this.phase = 'flop';
        this.communityCards = this.deck.dealMultiple(3);
        break;
      case 'flop':
        this.phase = 'turn';
        this.communityCards.push(...this.deck.dealMultiple(1));
        break;
      case 'turn':
        this.phase = 'river';
        this.communityCards.push(...this.deck.dealMultiple(1));
        break;
      case 'river':
        this.phase = 'showdown';
        this.resolveHand();
        return;
    }

    // Reset for next betting round
    this.currentBet = 0;
    this.lastRaise = this.bigBlind;
    
    for (const player of this.seatedPlayers) {
      player.currentBet = 0;
      player.lastAction = undefined;
    }

    this.currentPlayerIndex = 0;
    this.setNextPlayerToAct();
    this.startActionTimer();
  }

  private collectBets(): void {
    const activePlayers = this.getActivePlayersInOrder().filter(p => !p.folded);
    
    // Group players by their bet amount for side pots
    const betGroups = new Map<number, Player[]>();
    
    for (const player of activePlayers) {
      const bets = player.totalBetsInHand;
      if (!betGroups.has(bets)) {
        betGroups.set(bets, []);
      }
      betGroups.get(bets)!.push(player);
    }

    // Create pots
    const sortedBets = Array.from(betGroups.keys()).sort((a, b) => a - b);
    let previousBet = 0;

    for (const bet of sortedBets) {
      const playersAtThisLevel = betGroups.get(bet)!;
      const potAmount = (bet - previousBet) * activePlayers.length;
      
      this.pots.push({
        amount: potAmount,
        eligiblePlayers: activePlayers.filter(p => p.totalBetsInHand >= bet).map(p => p.id)
      });

      previousBet = bet;
    }
  }

  private resolveHand(): void {
    const nonFoldedPlayers = this.seatedPlayers.filter(p => !p.folded);
    const reachedFlop = this.phase === 'showdown' && this.communityCards.length >= 3;
    
    if (nonFoldedPlayers.length === 1) {
      // Everyone else folded, single winner
      const winner = nonFoldedPlayers[0];
      const totalPot = this.pots.reduce((sum, pot) => sum + pot.amount, 0);
      const rake = calculateRake(totalPot, this.getBlindLevel(), this.seatedPlayers.length, reachedFlop);
      const winnerAmount = totalPot - rake;
      
      winner.chips += winnerAmount;
      
      this.handResults = {
        winners: [{
          playerId: winner.id,
          username: winner.username,
          amount: winnerAmount,
          hand: evaluateHand([...winner.holeCards, ...this.communityCards])
        }],
        rake,
        totalPot,
        reachedFlop
      };
    } else {
      // Showdown - evaluate all hands
      const handEvaluations = nonFoldedPlayers.map(player => ({
        player,
        evaluation: evaluateHand([...player.holeCards, ...this.communityCards])
      }));

      // Find best hand(s)
      const bestValue = Math.max(...handEvaluations.map(h => h.evaluation.value));
      const winners = handEvaluations.filter(h => h.evaluation.value === bestValue);

      // Distribute pots
      const results: { playerId: string; username: string; amount: number; hand: HandEvaluation }[] = [];
      let totalRake = 0;

      for (const pot of this.pots) {
        const potWinners = winners.filter(w => pot.eligiblePlayers.includes(w.player.id));
        if (potWinners.length === 0) continue;

        const potRake = calculateRake(pot.amount, this.getBlindLevel(), this.seatedPlayers.length, reachedFlop);
        const distributableAmount = pot.amount - potRake;
        const sharePerWinner = distributableAmount / potWinners.length;
        totalRake += potRake;

        for (const { player, evaluation } of potWinners) {
          player.chips += sharePerWinner;
          
          const existing = results.find(r => r.playerId === player.id);
          if (existing) {
            existing.amount += sharePerWinner;
          } else {
            results.push({
              playerId: player.id,
              username: player.username,
              amount: sharePerWinner,
              hand: evaluation
            });
          }
        }
      }

      const totalPot = this.pots.reduce((sum, pot) => sum + pot.amount, 0);
      this.handResults = {
        winners: results,
        rake: totalRake,
        totalPot,
        reachedFlop
      };
    }

    this.phase = 'finished';
  }

  getHandResults(): HandResult | null {
    return this.handResults;
  }

  private getActivePlayersInOrder(): Player[] {
    return this.seatedPlayers.filter(p => p.status !== 'sitting_out');
  }

  private setNextPlayerToAct(): void {
    const activePlayers = this.getActivePlayersInOrder();
    
    // Find first player after dealer for preflop
    if (this.phase === 'preflop' && this.currentPlayerIndex === 0) {
      this.currentPlayerIndex = 2 % activePlayers.length;
      return;
    }

    // Normal rotation
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % activePlayers.length;
    } while (
      activePlayers[this.currentPlayerIndex].folded ||
      activePlayers[this.currentPlayerIndex].allIn
    );
  }

  private startActionTimer(): void {
    this.actionTimer = setTimeout(() => {
      this.handleTimeout();
    }, this.ACTION_TIMEOUT);
  }

  private stopActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  private handleTimeout(): void {
    const activePlayers = this.getActivePlayersInOrder();
    const player = activePlayers[this.currentPlayerIndex];
    
    if (player) {
      this.handleFold(player);
      
      if (this.isBettingRoundComplete()) {
        this.advancePhase();
      } else {
        this.setNextPlayerToAct();
        this.startActionTimer();
      }
    }
  }

  // Getters
  getState(forPlayerId?: string): PokerGameState {
    return {
      tableId: this.tableId,
      phase: this.phase,
      players: this.seatedPlayers.map(p => ({
        ...p,
        holeCards: p.id === forPlayerId ? p.holeCards : []
      })),
      communityCards: this.communityCards,
      pots: this.pots,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      minBet: this.currentBet,
      maxBet: Math.max(...this.seatedPlayers.map(p => p.chips)) + this.currentBet,
      currentBet: this.currentBet,
      deckHash: this.deck.getHash(),
      handNumber: this.handNumber,
      currency: this.currency,
      timestamp: Date.now()
    };
  }

  getPlayers(): Player[] {
    return this.seatedPlayers;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getMinBuyin(): number {
    return this.minBuyin;
  }

  getMaxBuyin(): number {
    return this.maxBuyin;
  }
}
