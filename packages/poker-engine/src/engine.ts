import crypto from 'crypto';
import {
  TableState, TableConfig, HandState, Player, Pot,
  HandResult, HandAction, RAKE_CONFIG
} from './types';
import { createDeck, shuffleDeck, generateProofHash } from './deck';
import { findBestHand, compareHands } from './evaluator';

export class PokerEngine {
  private tables: Map<string, TableState> = new Map();
  private actionTimers: Map<string, Map<string, number>> = new Map(); // tableId -> agentId -> timer
  private autoStartTimers: Map<string, NodeJS.Timeout> = new Map();

  createTable(config: TableConfig): TableState {
    const table: TableState = {
      config,
      players: [],
      handInProgress: false,
      dealerPosition: 0,
      handHistory: []
    };
    this.tables.set(config.id, table);
    return table;
  }

  getTable(tableId: string): TableState | undefined {
    return this.tables.get(tableId);
  }

  seatPlayer(tableId: string, agentId: string, username: string, chips: number): { success: boolean; error?: string; seat?: number } {
    const table = this.tables.get(tableId);
    if (!table) return { success: false, error: 'Table not found' };

    if (table.players.length >= table.config.maxPlayers) {
      return { success: false, error: 'Table is full' };
    }

    if (table.players.find(p => p.agentId === agentId)) {
      return { success: false, error: 'Already seated' };
    }

    // Find first available seat
    const takenSeats = new Set(table.players.map(p => p.seat));
    let seat = 0;
    while (takenSeats.has(seat) && seat < table.config.maxPlayers) {
      seat++;
    }

    const player: Player = {
      agentId,
      username,
      seat,
      chips,
      holeCards: [],
      status: 'active',
      currentBet: 0,
      totalInvested: 0
    };

    table.players.push(player);

    // Auto-start hand if 2+ players and no hand in progress
    if (table.players.length >= 2 && !table.handInProgress) {
      this.scheduleAutoStart(tableId);
    }

    return { success: true, seat };
  }

  removePlayer(tableId: string, agentId: string): { success: boolean; error?: string; remainingChips?: number } {
    const table = this.tables.get(tableId);
    if (!table) return { success: false, error: 'Table not found' };

    const playerIndex = table.players.findIndex(p => p.agentId === agentId);
    if (playerIndex === -1) return { success: false, error: 'Not seated' };

    const player = table.players[playerIndex];

    // Cannot leave mid-hand if still active
    if (table.handInProgress && table.currentHand) {
      const handPlayer = table.currentHand.players.find(p => p.agentId === agentId);
      if (handPlayer && handPlayer.status === 'active') {
        return { success: false, error: 'Cannot leave during active hand. Fold first.' };
      }
    }

    table.players.splice(playerIndex, 1);

    // Clear auto-start timer if only 1 player left
    if (table.players.length < 2) {
      this.clearAutoStart(tableId);
    }

    return { success: true, remainingChips: player.chips };
  }

  startHand(tableId: string): { success: boolean; error?: string; handState?: HandState } {
    const table = this.tables.get(tableId);
    if (!table) return { success: false, error: 'Table not found' };

    if (table.handInProgress) {
      return { success: false, error: 'Hand already in progress' };
    }

    const activePlayers = table.players.filter(p => p.status !== 'sitting_out');
    if (activePlayers.length < 2) {
      return { success: false, error: 'Need at least 2 players' };
    }

    // Create deck and shuffle
    const deck = createDeck();
    const { deck: shuffledDeck, seed } = shuffleDeck(deck);
    const proofHash = generateProofHash(seed);

    // Deal hole cards
    const playersWithCards = activePlayers.map(p => ({
      ...p,
      holeCards: [shuffledDeck.pop()!, shuffledDeck.pop()!],
      currentBet: 0,
      totalInvested: 0,
      status: 'active' as const
    }));

    // Calculate positions
    const numPlayers = playersWithCards.length;
    const dealerIndex = table.dealerPosition % numPlayers;
    const smallBlindIndex = (dealerIndex + 1) % numPlayers;
    const bigBlindIndex = (dealerIndex + 2) % numPlayers;

    // Post blinds
    const sbPlayer = playersWithCards[smallBlindIndex];
    const bbPlayer = playersWithCards[bigBlindIndex];

    const sbAmount = Math.min(table.config.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmount;
    sbPlayer.currentBet = sbAmount;
    sbPlayer.totalInvested = sbAmount;
    if (sbPlayer.chips === 0) sbPlayer.status = 'all_in';

    const bbAmount = Math.min(table.config.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmount;
    bbPlayer.currentBet = bbAmount;
    bbPlayer.totalInvested = bbAmount;
    if (bbPlayer.chips === 0) bbPlayer.status = 'all_in';

    // First to act (UTG) is after BB
    const firstToAct = (bigBlindIndex + 1) % numPlayers;

    const handState: HandState = {
      handId: crypto.randomUUID(),
      phase: 'preflop',
      players: playersWithCards,
      communityCards: [],
      pots: [{
        amount: sbAmount + bbAmount,
        eligiblePlayers: playersWithCards.map(p => p.agentId)
      }],
      currentPlayerIndex: firstToAct,
      dealerIndex,
      smallBlindIndex,
      bigBlindIndex,
      currentBet: bbAmount,
      minRaise: table.config.bigBlind,
      lastRaiseAmount: bbAmount,
      deck: shuffledDeck,
      actions: [],
      seed,
      proofHash,
      startedAt: Date.now()
    };

    table.currentHand = handState;
    table.handInProgress = true;
    table.dealerPosition = (table.dealerPosition + 1) % numPlayers;

    // Start action timer
    this.startActionTimer(tableId);

    return { success: true, handState };
  }

  performAction(tableId: string, agentId: string, action: string, amount?: number): 
    { success: boolean; error?: string; handState?: HandState; result?: HandResult } {
    
    const table = this.tables.get(tableId);
    if (!table || !table.currentHand) {
      return { success: false, error: 'No hand in progress' };
    }

    const hand = table.currentHand;
    const player = hand.players.find(p => p.agentId === agentId);

    if (!player) {
      return { success: false, error: 'Not in this hand' };
    }

    // Check if it's this player's turn
    const currentPlayer = hand.players[hand.currentPlayerIndex];
    if (currentPlayer.agentId !== agentId) {
      const waitingFor = hand.players[hand.currentPlayerIndex];
      return { 
        success: false, 
        error: `not_your_turn`,
        message: `Waiting for ${waitingFor.username} to act`
      };
    }

    // Validate action
    const callAmount = hand.currentBet - player.currentBet;

    switch (action) {
      case 'fold':
        player.status = 'folded';
        break;

      case 'check':
        if (callAmount > 0) {
          return { success: false, error: 'invalid_action', message: `Cannot check, there is a bet of ${callAmount} to call` };
        }
        break;

      case 'call':
        if (callAmount === 0) {
          return { success: false, error: 'invalid_action', message: 'No bet to call, use check' };
        }
        const callActual = Math.min(callAmount, player.chips);
        player.chips -= callActual;
        player.currentBet += callActual;
        player.totalInvested += callActual;
        if (player.chips === 0) player.status = 'all_in';
        break;

      case 'raise':
        if (!amount || amount <= hand.currentBet) {
          return { success: false, error: 'invalid_raise', message: `Minimum raise is ${hand.currentBet + hand.minRaise}` };
        }
        const raiseAmount = amount - player.currentBet;
        if (raiseAmount < hand.minRaise && player.chips > callAmount + hand.minRaise) {
          return { success: false, error: 'invalid_raise', message: `Minimum raise is ${hand.minRaise}` };
        }
        if (player.chips < raiseAmount) {
          return { success: false, error: 'insufficient_chips', message: `Need ${raiseAmount} to raise, you have ${player.chips}` };
        }
        player.chips -= raiseAmount;
        player.currentBet += raiseAmount;
        player.totalInvested += raiseAmount;
        hand.lastRaiseAmount = player.currentBet - hand.currentBet;
        hand.currentBet = player.currentBet;
        hand.minRaise = hand.lastRaiseAmount;
        if (player.chips === 0) player.status = 'all_in';
        break;

      case 'all_in':
        const allInAmount = player.chips;
        if (allInAmount === 0) {
          return { success: false, error: 'invalid_action', message: 'Already all-in' };
        }
        player.chips = 0;
        player.currentBet += allInAmount;
        player.totalInvested += allInAmount;
        player.status = 'all_in';
        if (player.currentBet > hand.currentBet) {
          hand.lastRaiseAmount = player.currentBet - hand.currentBet;
          hand.currentBet = player.currentBet;
          hand.minRaise = Math.max(hand.lastRaiseAmount, hand.minRaise);
        }
        break;

      default:
        return { success: false, error: 'invalid_action', message: 'Unknown action' };
    }

    // Record action
    hand.actions.push({
      agentId,
      action: action as any,
      amount: player.currentBet,
      timestamp: Date.now()
    });

    // Update pot
    this.updatePots(hand);

    // Check if betting round is complete
    if (this.isBettingRoundComplete(hand)) {
      this.advancePhase(tableId);
    } else {
      // Move to next player
      this.moveToNextPlayer(hand);
    }

    // Clear and restart action timer
    this.startActionTimer(tableId);

    // Check if hand is over
    const activePlayers = hand.players.filter(p => p.status === 'active');
    if (activePlayers.length <= 1 || hand.phase === 'complete') {
      const result = this.completeHand(tableId);
      return { success: true, handState: hand, result };
    }

    return { success: true, handState: hand };
  }

  private updatePots(hand: HandState): void {
    const totalBet = hand.players.reduce((sum, p) => sum + p.currentBet, 0);
    hand.pots[0].amount = totalBet;
  }

  private isBettingRoundComplete(hand: HandState): boolean {
    const activePlayers = hand.players.filter(p => p.status === 'active');
    const allInPlayers = hand.players.filter(p => p.status === 'all_in');

    // If only one active player, round is complete
    if (activePlayers.length <= 1) return true;

    // Check if all active players have acted and bets are equal
    for (const player of activePlayers) {
      if (player.currentBet !== hand.currentBet) {
        return false;
      }
    }

    return true;
  }

  private advancePhase(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table || !table.currentHand) return;

    const hand = table.currentHand;

    switch (hand.phase) {
      case 'preflop':
        // Deal flop
        hand.communityCards = [hand.deck.pop()!, hand.deck.pop()!, hand.deck.pop()!];
        hand.phase = 'flop';
        break;
      case 'flop':
        // Deal turn
        hand.communityCards.push(hand.deck.pop()!);
        hand.phase = 'turn';
        break;
      case 'turn':
        // Deal river
        hand.communityCards.push(hand.deck.pop()!);
        hand.phase = 'river';
        break;
      case 'river':
        hand.phase = 'showdown';
        break;
      default:
        return;
    }

    // Reset for new betting round
    if (hand.phase !== 'showdown') {
      for (const player of hand.players) {
        player.currentBet = 0;
      }
      hand.currentBet = 0;
      hand.minRaise = table.config.bigBlind;
      hand.lastRaiseAmount = table.config.bigBlind;

      // Find first active player after dealer
      const numPlayers = hand.players.length;
      for (let i = 1; i <= numPlayers; i++) {
        const idx = (hand.dealerIndex + i) % numPlayers;
        if (hand.players[idx].status === 'active') {
          hand.currentPlayerIndex = idx;
          break;
        }
      }
    }
  }

  private moveToNextPlayer(hand: HandState): void {
    const numPlayers = hand.players.length;
    let attempts = 0;

    do {
      hand.currentPlayerIndex = (hand.currentPlayerIndex + 1) % numPlayers;
      attempts++;
    } while (attempts < numPlayers && hand.players[hand.currentPlayerIndex].status !== 'active');
  }

  private completeHand(tableId: string): HandResult | undefined {
    const table = this.tables.get(tableId);
    if (!table || !table.currentHand) return;

    const hand = table.currentHand;

    // Calculate side pots if needed
    const pots = this.calculateSidePots(hand);

    // Determine winners for each pot
    const winners: { agentId: string; amount: number; handDescription: string }[] = [];
    const playerResults: { agentId: string; holeCards: any[]; handRank: string }[] = [];

    for (const pot of pots) {
      const eligiblePlayers = hand.players.filter(p => 
        pot.eligiblePlayers.includes(p.agentId) && 
        (p.status === 'active' || p.status === 'all_in')
      );

      if (eligiblePlayers.length === 0) continue;

      // Evaluate each player's hand
      const evaluated = eligiblePlayers.map(p => {
        const allCards = [...p.holeCards, ...hand.communityCards];
        const best = findBestHand(p.holeCards, hand.communityCards);
        return { player: p, bestHand: best };
      });

      // Find winner(s)
      evaluated.sort((a, b) => b.bestHand.value - a.bestHand.value);
      const bestValue = evaluated[0].bestHand.value;
      const potWinners = evaluated.filter(e => e.bestHand.value === bestValue);

      const splitAmount = pot.amount / potWinners.length;

      for (const winner of potWinners) {
        winners.push({
          agentId: winner.player.agentId,
          amount: splitAmount,
          handDescription: winner.bestHand.description
        });

        // Find matching player in main table
        const tablePlayer = table.players.find(p => p.agentId === winner.player.agentId);
        if (tablePlayer) {
          tablePlayer.chips += splitAmount;
        }

        // Store hand result
        playerResults.push({
          agentId: winner.player.agentId,
          holeCards: winner.player.holeCards,
          handRank: winner.bestHand.description
        });
      }
    }

    // Calculate rake
    const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
    const reachedFlop = hand.phase !== 'preflop' || hand.communityCards.length > 0;
    
    let rake = 0;
    if (reachedFlop || !RAKE_CONFIG.noFlopNoDrop) {
      const blindKey = `${table.config.smallBlind}/${table.config.bigBlind}`;
      const cap = RAKE_CONFIG.caps[blindKey]?.[hand.players.length] || 3;
      rake = Math.min(totalPot * RAKE_CONFIG.percentage, cap);
    }

    const result: HandResult = {
      handId: hand.handId,
      winners,
      rake,
      totalPot,
      communityCards: hand.communityCards,
      playerHands: playerResults,
      seed: hand.seed,
      proofHash: hand.proofHash
    };

    // Update table
    hand.completedAt = Date.now();
    table.handHistory.push(result);
    table.handInProgress = false;

    // Schedule next hand
    if (table.players.length >= 2) {
      setTimeout(() => {
        if (table.players.length >= 2 && !table.handInProgress) {
          this.startHand(tableId);
        }
      }, 5000);
    }

    return result;
  }

  private calculateSidePots(hand: HandState): Pot[] {
    const playersByInvestment = [...hand.players]
      .filter(p => p.totalInvested > 0)
      .sort((a, b) => a.totalInvested - b.totalInvested);

    const pots: Pot[] = [];
    let processedAmount = 0;

    for (const player of playersByInvestment) {
      if (player.totalInvested <= processedAmount) continue;

      const potAmount = (player.totalInvested - processedAmount) * 
        hand.players.filter(p => p.totalInvested >= player.totalInvested).length;

      const eligiblePlayers = hand.players
        .filter(p => p.totalInvested >= player.totalInvested)
        .map(p => p.agentId);

      pots.push({ amount: potAmount, eligiblePlayers });
      processedAmount = player.totalInvested;
    }

    return pots.length > 0 ? pots : hand.pots;
  }

  private scheduleAutoStart(tableId: string): void {
    this.clearAutoStart(tableId);
    
    const timer = setTimeout(() => {
      const table = this.tables.get(tableId);
      if (table && !table.handInProgress && table.players.length >= 2) {
        this.startHand(tableId);
      }
    }, 5000);

    this.autoStartTimers.set(tableId, timer);
  }

  private clearAutoStart(tableId: string): void {
    const timer = this.autoStartTimers.get(tableId);
    if (timer) {
      clearTimeout(timer);
      this.autoStartTimers.delete(tableId);
    }
  }

  private startActionTimer(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table || !table.currentHand) return;

    // Clear existing timers for this table
    const existing = this.actionTimers.get(tableId);
    if (existing) {
      for (const timer of existing.values()) {
        clearTimeout(timer);
      }
    }

    const hand = table.currentHand;
    const currentPlayer = hand.players[hand.currentPlayerIndex];
    
    if (!currentPlayer || currentPlayer.status !== 'active') return;

    const timers = new Map<string, number>();
    
    const timer = setTimeout(() => {
      this.handleTimeout(tableId, currentPlayer.agentId);
    }, 30000); // 30 seconds

    timers.set(currentPlayer.agentId, timer as any);
    this.actionTimers.set(tableId, timers);
  }

  private handleTimeout(tableId: string, agentId: string): void {
    const table = this.tables.get(tableId);
    if (!table || !table.currentHand) return;

    const hand = table.currentHand;
    const currentPlayer = hand.players[hand.currentPlayerIndex];

    if (currentPlayer?.agentId !== agentId) return;

    const callAmount = hand.currentBet - currentPlayer.currentBet;

    // Auto-fold (or auto-check if free)
    if (callAmount === 0) {
      this.performAction(tableId, agentId, 'check');
    } else {
      this.performAction(tableId, agentId, 'fold');
    }
  }

  getTableState(tableId: string, forAgentId?: string): any {
    const table = this.tables.get(tableId);
    if (!table) return null;

    const baseState = {
      tableId,
      config: table.config,
      players: table.players.map(p => ({
        agentId: p.agentId,
        username: p.username,
        seat: p.seat,
        chips: p.chips,
        status: p.status
      })),
      handInProgress: table.handInProgress,
      dealerPosition: table.dealerPosition
    };

    if (table.currentHand) {
      const hand = table.currentHand;
      
      return {
        ...baseState,
        hand: {
          handId: hand.handId,
          phase: hand.phase,
          communityCards: hand.communityCards,
          pots: hand.pots,
          currentBet: hand.currentBet,
          currentPlayer: hand.players[hand.currentPlayerIndex]?.agentId,
          players: hand.players.map(p => ({
            agentId: p.agentId,
            username: p.username,
            seat: p.seat,
            chips: p.chips,
            status: p.status,
            currentBet: p.currentBet,
            holeCards: p.agentId === forAgentId ? p.holeCards : undefined
          })),
          actions: hand.actions.slice(-10) // Last 10 actions
        }
      };
    }

    return baseState;
  }

  getHandHistory(tableId: string, handId: string): HandResult | undefined {
    const table = this.tables.get(tableId);
    if (!table) return;
    return table.handHistory.find(h => h.handId === handId);
  }

  getAllTables(): TableState[] {
    return Array.from(this.tables.values());
  }
}

export const pokerEngine = new PokerEngine();
