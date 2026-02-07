import { Card } from './engine';

export type BettingStage = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
export type PlayerAction = 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALL_IN';

export interface Player {
  id: string;
  name: string;
  chips: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  betThisRound: number;
  totalBet: number;
  actedThisRound: boolean;
}

export interface Pot {
  id: number;
  amount: number;
  eligiblePlayers: string[];  // Player IDs who can win this pot
}

export interface BettingRound {
  stage: BettingStage;
  currentBet: number;
  lastRaiseSize: number;
  pot: number;
  pots: Pot[];  // Main pot + side pots
  players: Player[];
  activePlayerIndex: number;
  communityCards: Card[];
  dealerPosition: number;
  smallBlind: number;
  bigBlind: number;
  handId: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  newRoundState?: BettingRound;
  handComplete?: boolean;
  winners?: { playerId: string; amount: number; potId: number }[];
}

// Initialize a new betting round
export function initBettingRound(
  players: { id: string; name: string; chips: number }[],
  holeCards: Map<string, Card[]>,
  dealerPosition: number,
  smallBlind: number,
  bigBlind: number,
  handId: string
): BettingRound {
  const playerObjects: Player[] = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    holeCards: holeCards.get(p.id) || [],
    folded: false,
    allIn: false,
    betThisRound: 0,
    totalBet: 0,
    actedThisRound: false
  }));

  const numPlayers = playerObjects.length;
  const sbPos = (dealerPosition + 1) % numPlayers;
  const bbPos = (dealerPosition + 2) % numPlayers;

  // Post blinds
  const sbPlayer = playerObjects[sbPos];
  const bbPlayer = playerObjects[bbPos];

  // Small blind
  const sbAmount = Math.min(smallBlind, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.betThisRound = sbAmount;
  sbPlayer.totalBet = sbAmount;
  sbPlayer.allIn = sbPlayer.chips === 0 && sbAmount < smallBlind;

  // Big blind
  const bbAmount = Math.min(bigBlind, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.betThisRound = bbAmount;
  bbPlayer.totalBet = bbAmount;
  bbPlayer.allIn = bbPlayer.chips === 0 && bbAmount < bigBlind;

  // First to act is UTG (after BB)
  const firstToAct = (bbPos + 1) % numPlayers;

  return {
    stage: 'PREFLOP',
    currentBet: bbAmount,
    lastRaiseSize: bbAmount,
    pot: sbAmount + bbAmount,
    pots: [],
    players: playerObjects,
    activePlayerIndex: firstToAct,
    communityCards: [],
    dealerPosition,
    smallBlind,
    bigBlind,
    handId
  };
}

// Get legal actions for current player
export function getLegalActions(round: BettingRound): PlayerAction[] {
  const player = round.players[round.activePlayerIndex];
  
  if (player.folded || player.allIn) {
    return [];
  }

  const actions: PlayerAction[] = ['FOLD'];

  const toCall = round.currentBet - player.betThisRound;

  // Can check if no bet to call
  if (toCall === 0) {
    actions.push('CHECK');
  }

  // Can call if there's a bet and we have chips
  if (toCall > 0 && player.chips > 0) {
    actions.push('CALL');
  }

  // Can raise if we have more than enough to call
  const minRaise = round.currentBet + Math.max(round.bigBlind, round.lastRaiseSize);
  if (player.chips > toCall && !player.allIn) {
    actions.push('RAISE');
  }

  // Can go all-in
  if (player.chips > 0) {
    actions.push('ALL_IN');
  }

  return actions;
}

// Process a player action
export function processAction(
  round: BettingRound,
  action: PlayerAction,
  raiseAmount?: number
): ActionResult {
  const player = round.players[round.activePlayerIndex];
  const toCall = round.currentBet - player.betThisRound;

  // Validate action is legal
  const legalActions = getLegalActions(round);
  if (!legalActions.includes(action)) {
    return { success: false, error: `Illegal action: ${action}` };
  }

  switch (action) {
    case 'FOLD':
      player.folded = true;
      player.actedThisRound = true;
      
      // Check if only one player remains
      const remainingPlayers = round.players.filter(p => !p.folded);
      if (remainingPlayers.length === 1) {
        return endHand(round, remainingPlayers[0]);
      }
      break;

    case 'CHECK':
      if (toCall !== 0) {
        return { success: false, error: 'Cannot check when there is a bet to call' };
      }
      player.actedThisRound = true;
      break;

    case 'CALL':
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.betThisRound += callAmount;
      player.totalBet += callAmount;
      round.pot += callAmount;
      
      if (player.chips === 0) {
        player.allIn = true;
      }
      player.actedThisRound = true;
      break;

    case 'RAISE':
      if (!raiseAmount || raiseAmount < round.currentBet + Math.max(round.bigBlind, round.lastRaiseSize)) {
        return { 
          success: false, 
          error: `Raise must be at least ${round.currentBet + Math.max(round.bigBlind, round.lastRaiseSize)}` 
        };
      }
      
      const raiseTotal = raiseAmount - player.betThisRound;
      if (raiseTotal > player.chips) {
        return { success: false, error: 'Not enough chips to raise that amount' };
      }

      player.chips -= raiseTotal;
      player.betThisRound = raiseAmount;
      player.totalBet += raiseTotal;
      round.pot += raiseTotal;
      round.lastRaiseSize = raiseAmount - round.currentBet;
      round.currentBet = raiseAmount;
      
      // Reset acted status for others
      round.players.forEach(p => {
        if (p.id !== player.id && !p.folded && !p.allIn) {
          p.actedThisRound = false;
        }
      });
      
      player.actedThisRound = true;
      break;

    case 'ALL_IN':
      const allInAmount = player.chips;
      const newTotalBet = player.betThisRound + allInAmount;
      
      player.chips = 0;
      player.betThisRound = newTotalBet;
      player.totalBet += allInAmount;
      player.allIn = true;
      round.pot += allInAmount;
      
      // If this is a raise, update current bet and reset others
      if (newTotalBet > round.currentBet) {
        round.lastRaiseSize = newTotalBet - round.currentBet;
        round.currentBet = newTotalBet;
        
        // Reset acted status for others
        round.players.forEach(p => {
          if (p.id !== player.id && !p.folded && !p.allIn) {
            p.actedThisRound = false;
          }
        });
      }
      
      player.actedThisRound = true;
      break;
  }

  // Move to next active player
  const nextResult = moveToNextPlayer(round);
  
  if (nextResult.roundComplete) {
    return endBettingRound(round);
  }

  return { success: true, newRoundState: round };
}

// Move to next active player
function moveToNextPlayer(round: BettingRound): { roundComplete: boolean } {
  const numPlayers = round.players.length;
  let checkedAll = 0;

  while (checkedAll < numPlayers) {
    round.activePlayerIndex = (round.activePlayerIndex + 1) % numPlayers;
    checkedAll++;

    const player = round.players[round.activePlayerIndex];
    
    // Skip folded and all-in players
    if (player.folded || player.allIn) {
      continue;
    }

    // Check if this player needs to act
    const toCall = round.currentBet - player.betThisRound;
    
    // Player needs to act if:
    // 1. They haven't acted this round, OR
    // 2. There's a bet to call that they haven't matched
    if (!player.actedThisRound || toCall > 0) {
      return { roundComplete: false };
    }
  }

  // Everyone has acted and bets are equal
  return { roundComplete: true };
}

// End current betting round, move to next stage
function endBettingRound(round: BettingRound): ActionResult {
  // Collect bets into pots (handle side pots)
  createSidePots(round);

  // Reset for next round
  round.players.forEach(p => {
    p.betThisRound = 0;
    p.actedThisRound = false;
  });
  round.currentBet = 0;
  round.lastRaiseSize = round.bigBlind;

  // Move to next stage
  switch (round.stage) {
    case 'PREFLOP':
      round.stage = 'FLOP';
      break;
    case 'FLOP':
      round.stage = 'TURN';
      break;
    case 'TURN':
      round.stage = 'RIVER';
      break;
    case 'RIVER':
      round.stage = 'SHOWDOWN';
      return endHand(round);
  }

  // Check if only one player remains
  const activePlayers = round.players.filter(p => !p.folded);
  if (activePlayers.length === 1) {
    return endHand(round, activePlayers[0]);
  }

  // Set first player to act (after dealer, or SB if heads up)
  const numPlayers = round.players.length;
  if (round.stage === 'FLOP') {
    // First to act is SB (or dealer if heads up)
    round.activePlayerIndex = (round.dealerPosition + 1) % numPlayers;
    while (round.players[round.activePlayerIndex].folded) {
      round.activePlayerIndex = (round.activePlayerIndex + 1) % numPlayers;
    }
  }

  return { success: true, newRoundState: round };
}

// Create side pots when players are all-in for different amounts
export function createSidePots(round: BettingRound): void {
  const activePlayers = round.players.filter(p => !p.folded);
  
  if (activePlayers.length === 0) return;

  // Sort by total bet amount
  const sortedByBet = [...activePlayers].sort((a, b) => a.totalBet - b.totalBet);
  
  let processedAmount = 0;
  const pots: Pot[] = [];
  let potId = 0;

  for (const player of sortedByBet) {
    const contribution = player.totalBet - processedAmount;
    if (contribution <= 0) continue;

    // Find all players who contributed at least this amount
    const eligiblePlayers = activePlayers
      .filter(p => p.totalBet >= player.totalBet)
      .map(p => p.id);

    const potAmount = contribution * eligiblePlayers.length;
    
    pots.push({
      id: potId++,
      amount: potAmount,
      eligiblePlayers
    });

    processedAmount = player.totalBet;
  }

  round.pots = pots;
  round.pot = pots.reduce((sum, p) => sum + p.amount, 0);
}

// End the hand, determine winners
function endHand(round: BettingRound, singleWinner?: Player): ActionResult {
  round.stage = 'SHOWDOWN';

  if (singleWinner) {
    // Only one player left, they win everything
    const totalPot = round.pots.reduce((sum, p) => sum + p.amount, round.pot);
    singleWinner.chips += totalPot;
    
    return {
      success: true,
      handComplete: true,
      winners: [{ playerId: singleWinner.id, amount: totalPot, potId: -1 }],
      newRoundState: round
    };
  }

  // Showdown - evaluate hands and award pots
  // This will be handled by the caller using the evaluator
  return {
    success: true,
    handComplete: true,
    newRoundState: round
  };
}

// Award pots to winners (called by game controller after evaluation)
export function awardPots(
  round: BettingRound,
  potWinners: { potId: number; winnerId: string }[]
): { playerId: string; amount: number; potId: number }[] {
  const results: { playerId: string; amount: number; potId: number }[] = [];

  for (const { potId, winnerId } of potWinners) {
    const pot = potId === -1 
      ? { amount: round.pot, eligiblePlayers: [] }  // Main pot
      : round.pots.find(p => p.id === potId);
    
    if (pot) {
      const winner = round.players.find(p => p.id === winnerId);
      if (winner) {
        winner.chips += pot.amount;
        results.push({ playerId: winnerId, amount: pot.amount, potId });
      }
    }
  }

  return results;
}

// Get total pot amount including side pots
export function getTotalPot(round: BettingRound): number {
  return round.pot + round.pots.reduce((sum, p) => sum + p.amount, 0);
}

// Check if betting round is complete
export function isBettingRoundComplete(round: BettingRound): boolean {
  const activePlayers = round.players.filter(p => !p.folded && !p.allIn);
  
  // All active players must have acted and bets must be equal
  return activePlayers.every(p => {
    const toCall = round.currentBet - p.betThisRound;
    return p.actedThisRound && toCall === 0;
  });
}
