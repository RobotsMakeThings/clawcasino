// Rake caps by blind level and number of players (in the same currency as blinds)
export const RAKE_CAPS: Record<string, Record<number, number>> = {
  '0.005/0.01': { 2: 0.01, 3: 0.02, 4: 0.02, 5: 0.03, 6: 0.03 },
  '0.01/0.02': { 2: 0.02, 3: 0.04, 4: 0.04, 5: 0.05, 6: 0.05 },
  '0.05/0.10': { 2: 0.10, 3: 0.15, 4: 0.15, 5: 0.25, 6: 0.25 },
  '0.25/0.50': { 2: 0.50, 3: 1.00, 4: 1.00, 5: 1.50, 6: 1.50 },
  '1.00/2.00': { 2: 1.00, 3: 2.00, 4: 2.00, 5: 3.00, 6: 3.00 },
  '5.00/10.00': { 2: 2.00, 3: 3.00, 4: 3.00, 5: 5.00, 6: 5.00 },
};

export interface RakeResult {
  rake: number;
  distributed: number;
  logEntry: {
    game_type: string;
    game_id: string;
    amount: number;
    currency: string;
    pot_size: number;
    num_players: number;
    saw_flop: boolean;
  };
}

/**
 * Calculate rake for a poker hand
 * @param pot - Total pot size
 * @param blindLevel - String like "0.05/0.10" 
 * @param numPlayers - Number of players dealt in
 * @param sawFlop - Whether the hand saw a flop (no flop no drop)
 * @param gameId - Unique hand ID for logging
 * @returns Rake amount and distribution info
 */
export function calculateRake(
  pot: number,
  blindLevel: string,
  numPlayers: number,
  sawFlop: boolean,
  gameId: string,
  currency: string = 'SOL'
): RakeResult {
  // No flop no drop - no rake if hand ended preflop
  if (!sawFlop) {
    return {
      rake: 0,
      distributed: pot,
      logEntry: {
        game_type: 'poker',
        game_id: gameId,
        amount: 0,
        currency,
        pot_size: pot,
        num_players: numPlayers,
        saw_flop: false
      }
    };
  }

  // Get cap for this blind level and player count
  const capTable = RAKE_CAPS[blindLevel];
  if (!capTable) {
    throw new Error(`Unknown blind level: ${blindLevel}`);
  }

  // Clamp player count to valid range (2-6)
  const clampedPlayers = Math.max(2, Math.min(6, numPlayers));
  const cap = capTable[clampedPlayers];

  // Calculate 5% rake
  const rawRake = pot * 0.05;
  
  // Round to avoid float issues (2 decimal places for SOL)
  const rake = Math.min(
    Math.round(rawRake * 100) / 100,
    cap
  );

  const distributed = Math.round((pot - rake) * 100) / 100;

  return {
    rake,
    distributed,
    logEntry: {
      game_type: 'poker',
      game_id: gameId,
      amount: rake,
      currency,
      pot_size: pot,
      num_players: numPlayers,
      saw_flop: true
    }
  };
}

/**
 * Distribute pot after rake, handling side pots
 * @param pots - Array of pots (main + side)
 * @param winners - Array of { potId, winnerId, handRank }
 * @param rakeResult - Rake calculation result
 * @returns Array of distributions
 */
export function distributePot(
  pots: { id: number; amount: number; eligiblePlayers: string[] }[],
  winners: { potId: number; winnerId: string }[],
  rakeResult: RakeResult
): { playerId: string; amount: number; potId: number }[] {
  const distributions: { playerId: string; amount: number; potId: number }[] = [];

  for (const winner of winners) {
    const pot = pots.find(p => p.id === winner.potId);
    if (!pot) continue;

    // Calculate this pot's share of rake proportionally
    const potShare = pot.amount / rakeResult.logEntry.pot_size;
    const potRake = Math.round(rakeResult.rake * potShare * 100) / 100;
    const amount = Math.round((pot.amount - potRake) * 100) / 100;

    distributions.push({
      playerId: winner.winnerId,
      amount,
      potId: winner.potId
    });
  }

  return distributions;
}

/**
 * Get rake percentage and cap info for display
 */
export function getRakeInfo(blindLevel: string, numPlayers: number): {
  percentage: number;
  cap: number;
  effectiveCap: number;
} {
  const capTable = RAKE_CAPS[blindLevel];
  if (!capTable) {
    throw new Error(`Unknown blind level: ${blindLevel}`);
  }

  const clampedPlayers = Math.max(2, Math.min(6, numPlayers));
  
  return {
    percentage: 5,
    cap: capTable[clampedPlayers],
    effectiveCap: capTable[clampedPlayers]
  };
}
