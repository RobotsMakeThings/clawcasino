import { Card, formatCards } from './cards';
import { Deck } from './deck';
import { evaluateHand, HandEvaluation, compareHands } from './hand-evaluator';

export type PlayerStatus = 'active' | 'folded' | 'all_in' | 'sitting_out';
export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

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
  timestamp: number;
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
  private readonly ACTION_TIMEOUT = 30000; // 30 seconds
  private readonly RAKE_PERCENTAGE = 0.05; // 5%
  private readonly RAKE_CAP = 3; // max 3 SOL

  constructor(
    tableId: string,
    smallBlind: number,
    bigBlind: number,
    minBuyin: number,
    maxBuyin: number
  ) {
    this.tableId = tableId;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.minBuyin = minBuyin;
    this.maxBuyin = maxBuyin;
    this.deck = new Deck();
  }

  // Player Management
  joinTable(playerId: string, username: string, buyinAmount: number, seat?: number): { success: boolean; error?: string; player?: Player } {
    if (this.players.has(playerId)) {
      return { success: false, error: 'Player already at table' };
    }

    if (buyinAmount < this.minBuyin || buyinAmount > this.maxBuyin) {
      return { success: false, error: `Buyin must be between ${this.minBuyin} and ${this.maxBuyin} SOL` };
    }

    if (this.seatedPlayers.length >= 6) {
      return { success: false, error: 'Table is full' };
    }

    // Find available seat
    if (seat === undefined) {
      const occupiedSeats = new Set(this.seatedPlayers.map(p => p.seat));
      for (let i = 0; i < 6; i++) {
        if (!occupiedSeats.has(i)) {
          seat = i;
          break;
        }
      }
    }

    if (seat === undefined || seat < 0 || seat >= 6) {
      return { success: false, error: 'Invalid seat' };
    }

    if (this.seatedPlayers.some(p => p.seat === seat)) {
      return { success: false, error: 'Seat already taken' };
    }

    const player: Player = {
      id: playerId,
      username,
      seat,
      chips: buyinAmount,
      holeCards: [],
      status: 'sitting_out',
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

  leaveTable(playerId: string): { success: boolean; error?: string; cashoutAmount?: number } {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not at table' };
    }

    if (this.phase !== 'waiting' && this.phase !== 'finished' && player.status !== 'sitting_out') {
      return { success: false, error: 'Cannot leave during active hand. Please wait for hand to finish or fold.' };
    }

    const cashoutAmount = player.chips;
    this.players.delete(playerId);
    this.seatedPlayers = this.seatedPlayers.filter(p => p.id !== playerId);

    return { success: true, cashoutAmount };
  }

  // Hand Management
  startHand(): { success: boolean; error?: string; state?: PokerGameState } {
    if (this.seatedPlayers.length < 2) {
      return { success: false, error: 'Need at least 2 players to start' };
    }

    if (this.phase !== 'waiting' && this.phase !== 'finished') {
      return { success: false, error: 'Hand already in progress' };
    }

    // Reset for new hand
    this.communityCards = [];
    this.pots = [];
    this.currentBet = 0;
    this.lastRaise = 0;
    this.handResults = null;
    this.handNumber++;

    // Reset players
    for (const player of this.seatedPlayers) {
      player.holeCards = [];
      player.status = player.chips > 0 ? 'active' : 'sitting_out';
      player.currentBet = 0;
      player.totalBetsInHand = 0;
      player.lastAction = undefined;
      player.folded = false;
      player.allIn = false;
    }

    const activePlayers = this.seatedPlayers.filter(p => p.status === 'active');
    if (activePlayers.length < 2) {
      return { success: false, error: 'Need at least 2 active players with chips' };
    }

    // Move dealer button
    this.dealerIndex = (this.dealerIndex + 1) % this.seatedPlayers.length;
    while (this.seatedPlayers[this.dealerIndex].status === 'sitting_out') {
      this.dealerIndex = (this.dealerIndex + 1) % this.seatedPlayers.length;
    }

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
    player.currentBet += allInAmount;
    player.totalBetsInHand += allInAmount;
    player.chips = 0;
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
    const activePlayers = this.seatedPlayers.filter(p => 
      p.status === 'active' || p.status === 'all_in'
    );

    // Check if only one player remains (everyone else folded)
    const nonFoldedPlayers = activePlayers.filter(p => !p.folded);
    if (nonFoldedPlayers.length === 1) {
      return true;
    }

    // Check if all active players have matched the current bet or are all-in
    return activePlayers.every(p => 
      p.folded || 
      p.allIn || 
      p.currentBet === this.currentBet
    );
  }

  private advancePhase(): void {
    // Collect bets into pot
    this.collectBets();

    switch (this.phase) {
      case 'preflop':
        this.communityCards.push(...this.deck.dealMultiple(3));
        this.phase = 'flop';
        break;
      case 'flop':
        this.communityCards.push(this.deck.deal());
        this.phase = 'turn';
        break;
      case 'turn':
        this.communityCards.push(this.deck.deal());
        this.phase = 'river';
        break;
      case 'river':
        this.phase = 'showdown';
        this.resolveHand();
        return;
    }

    // Reset for next betting round
    this.resetBets();
    this.setNextPlayerToAct();
    this.startActionTimer();
  }

  private collectBets(): void {
    const activePlayers = this.seatedPlayers.filter(p => !p.folded);
    
    // Group players by their total contribution to create side pots
    const contributions = activePlayers.map(p => ({
      playerId: p.id,
      amount: p.totalBetsInHand
    })).sort((a, b) => a.amount - b.amount);

    let previousAmount = 0;
    for (const contribution of contributions) {
      if (contribution.amount > previousAmount) {
        const potAmount = (contribution.amount - previousAmount) * 
          contributions.filter(c => c.amount >= contribution.amount).length;
        
        this.pots.push({
          amount: potAmount,
          eligiblePlayers: contributions
            .filter(c => c.amount >= contribution.amount)
            .map(c => c.playerId)
        });
        
        previousAmount = contribution.amount;
      }
    }
  }

  private resetBets(): void {
    this.currentBet = 0;
    this.lastRaise = 0;
    for (const player of this.seatedPlayers) {
      player.currentBet = 0;
    }
  }

  private resolveHand(): void {
    const nonFoldedPlayers = this.seatedPlayers.filter(p => !p.folded);
    
    if (nonFoldedPlayers.length === 1) {
      // Everyone else folded, single winner
      const winner = nonFoldedPlayers[0];
      const totalPot = this.pots.reduce((sum, pot) => sum + pot.amount, 0);
      const rake = Math.min(totalPot * this.RAKE_PERCENTAGE, this.RAKE_CAP);
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
        totalPot
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

        const potRake = Math.min(pot.amount * this.RAKE_PERCENTAGE, this.RAKE_CAP);
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
        totalPot
      };
    }

    this.phase = 'finished';
  }

  private getActivePlayersInOrder(): Player[] {
    return this.seatedPlayers.filter(p => p.status !== 'sitting_out');
  }

  private setNextPlayerToAct(): void {
    const activePlayers = this.getActivePlayersInOrder();
    
    // Find first player after dealer for preflop
    if (this.phase === 'preflop' && this.currentPlayerIndex === 0) {
      this.currentPlayerIndex = 2 % activePlayers.length; // First to act after big blind
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
      // Auto-fold on timeout
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
        // Hide hole cards unless it's for the specific player
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
      timestamp: Date.now()
    };
  }

  getPlayerView(playerId: string): { state: PokerGameState; holeCards: Card[]; availableActions: PlayerAction[]; toCall: number } | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    const state = this.getState(playerId);
    const availableActions: PlayerAction[] = [];
    const toCall = this.currentBet - player.currentBet;

    if (this.phase !== 'waiting' && this.phase !== 'finished' && player.status === 'active') {
      availableActions.push('fold');
      
      if (toCall === 0) {
        availableActions.push('check');
      }
      
      if (toCall > 0 && player.chips >= toCall) {
        availableActions.push('call');
      }
      
      const minRaise = this.currentBet + this.lastRaise;
      if (player.chips > toCall) {
        availableActions.push('raise');
      }
      
      if (player.chips > 0) {
        availableActions.push('all_in');
      }
    }

    return {
      state,
      holeCards: player.holeCards,
      availableActions,
      toCall
    };
  }

  getHandResults(): HandResult | null {
    return this.handResults;
  }

  getTableInfo(): { id: string; smallBlind: number; bigBlind: number; minBuyin: number; maxBuyin: number; playerCount: number } {
    return {
      id: this.tableId,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      minBuyin: this.minBuyin,
      maxBuyin: this.maxBuyin,
      playerCount: this.seatedPlayers.length
    };
  }
}