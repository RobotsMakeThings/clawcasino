import nacl from 'tweetnacl';
import bs58 from 'bs58';
import crypto from 'crypto';

const API_URL = process.env.CLAWSINO_API || 'http://localhost:3001';

// Test state
let agents: Array<{
  keypair: nacl.SignKeyPair;
  publicKey: string;
  agentId: string;
  jwt: string;
  initialBalance: number;
}> = [];

let testResults: Array<{ test: string; passed: boolean; details?: string }> = [];

function log(msg: string) {
  console.log(`[TEST] ${msg}`);
}

function assert(condition: boolean, testName: string, details?: string): boolean {
  if (condition) {
    log(`✅ ${testName}`);
    testResults.push({ test: testName, passed: true });
    return true;
  } else {
    log(`❌ ${testName}${details ? `: ${details}` : ''}`);
    testResults.push({ test: testName, passed: false, details });
    return false;
  }
}

// Generate random Solana keypair
function generateKeypair(): { keypair: nacl.SignKeyPair; publicKey: string } {
  const keypair = nacl.sign.keyPair();
  const publicKey = bs58.encode(keypair.publicKey);
  return { keypair, publicKey };
}

// Authenticate agent via API
async function authenticate(keypair: nacl.SignKeyPair, publicKey: string): Promise<{ agentId: string; jwt: string }> {
  // Get nonce
  const nonceRes = await fetch(`${API_URL}/api/auth/nonce`);
  const { nonce } = await nonceRes.json();

  // Sign nonce
  const message = new TextEncoder().encode(nonce);
  const signature = nacl.sign.detached(message, keypair.secretKey);
  const sigBase58 = bs58.encode(signature);

  // Verify
  const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, signature: sigBase58, nonce })
  });

  const data = await verifyRes.json();
  if (!data.token) {
    throw new Error(`Auth failed: ${data.error}`);
  }

  return { agentId: data.agent.id, jwt: data.token };
}

// API helpers
async function apiGet(path: string, jwt?: string) {
  const headers: Record<string, string> = {};
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  return res.json();
}

async function apiPost(path: string, body: any, jwt?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res.json();
}

// Setup: Generate 6 agents and authenticate
async function setup() {
  log('Setting up 6 test agents...');

  for (let i = 0; i < 6; i++) {
    const { keypair, publicKey } = generateKeypair();
    const { agentId, jwt } = await authenticate(keypair, publicKey);

    // Deposit 50 SOL
    await apiPost('/api/wallet/deposit', { amount: 50, currency: 'SOL' }, jwt);

    agents.push({
      keypair,
      publicKey,
      agentId,
      jwt,
      initialBalance: 50
    });

    log(`Agent ${i + 1}: ${agentId.slice(0, 8)}... deposited 50 SOL`);
  }

  log('Setup complete!\n');
}

// TEST POKER
async function testPoker() {
  log('=== TESTING POKER ===\n');

  const tableId = 'low'; // Low Stakes table
  const buyin = 5;

  // Agents 1-4 join
  log('Agents 1-4 joining Low Stakes table...');
  for (let i = 0; i < 4; i++) {
    const result = await apiPost(`/api/poker/tables/${tableId}/join`, { buyin }, agents[i].jwt);
    assert(result.success, `Agent ${i + 1} joined table`, result.error);
  }

  // Track total buyins
  const totalBuyins = buyin * 4;

  // Play 5 hands with random actions
  log('\nPlaying 5 hands...');
  for (let hand = 0; hand < 5; hand++) {
    log(`\nHand ${hand + 1}:`);

    // Start hand (auto-starts when 2+ players)
    await new Promise(r => setTimeout(r, 4000)); // Wait for auto-start

    // Get state for each agent and act if their turn
    for (let round = 0; round < 3; round++) { // 3 betting rounds max per hand
      for (let i = 0; i < 4; i++) {
        const state = await apiGet(`/api/poker/tables/${tableId}/state`, agents[i].jwt);

        if (state.mySeat === state.currentTurnSeat && state.handInProgress) {
          const actions = state.available_actions?.actions || [];
          if (actions.length > 0) {
            // Random valid action
            const action = actions[Math.floor(Math.random() * actions.length)];
            let body: any = { action };

            if (action === 'RAISE') {
              const minRaise = state.available_actions.min_raise || 0.5;
              body.amount = minRaise + 0.1;
            }

            await apiPost(`/api/poker/tables/${tableId}/action`, body, agents[i].jwt);
            log(`  Agent ${i + 1}: ${action}${body.amount ? ` ${body.amount}` : ''}`);
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 3500)); // Wait for next hand
  }

  // Leave table
  log('\nAgents leaving table...');
  for (let i = 0; i < 4; i++) {
    await apiPost(`/api/poker/tables/${tableId}/leave`, {}, agents[i].jwt);
  }

  // Check balances
  let totalChips = 0;
  let totalCashouts = 0;

  for (let i = 0; i < 4; i++) {
    const wallet = await apiGet('/api/wallet', agents[i].jwt);
    const balance = wallet.balance_sol || 0;
    const cashout = balance - (agents[i].initialBalance - buyin);
    totalChips += 0; // Chips were converted back on leave
    totalCashouts += cashout + buyin;
  }

  // Get rake from DB via audit
  const audit = await apiGet('/api/admin/audit', process.env.ADMIN_API_KEY);
  const totalRake = audit?.audit?.total_rake || 0;

  // ASSERT: sum(chips + cashouts + rake) = sum(buyins)
  const variance = Math.abs(totalCashouts + totalRake - totalBuyins);
  assert(variance < 0.01, 'Poker money invariant', `Expected ${totalBuyins}, got ${totalCashouts + totalRake}, variance ${variance}`);

  log('');
}

// TEST COINFLIP
async function testCoinflip() {
  log('=== TESTING COINFLIP ===\n');

  // 1.0 SOL flip between agents 1+2
  const stake = 1.0;

  log('Agent 1 creating 1.0 SOL coinflip...');
  const createResult = await apiPost('/api/coinflip/create', { stake, currency: 'SOL' }, agents[0].jwt);
  assert(createResult.success, 'Coinflip created', createResult.error);

  const gameId = createResult.game.id;
  const proofHash = createResult.game.proof_hash;

  // VERIFY: proof_hash format
  assert(proofHash && proofHash.length === 64, 'Proof hash is valid SHA256', `Got ${proofHash}`);

  log('Agent 2 accepting coinflip...');
  const acceptResult = await apiPost(`/api/coinflip/${gameId}/accept`, {}, agents[1].jwt);
  assert(acceptResult.success, 'Coinflip accepted', acceptResult.error);

  // ASSERT: winner got 1.92, rake 0.08
  const pot = stake * 2; // 2.0
  const expectedRake = pot * 0.04; // 0.08
  const expectedPayout = pot - expectedRake; // 1.92

  const winnerId = acceptResult.game.winner_id;
  const isAgent1Winner = winnerId === agents[0].agentId;

  // Check winner's balance increased correctly
  const winnerIndex = isAgent1Winner ? 0 : 1;
  const winnerWallet = await apiGet('/api/wallet', agents[winnerIndex].jwt);
  const winnerBalance = winnerWallet.balance_sol || 0;

  // Winner should have: 50 - 1 (stake) + 1.92 (win) = 50.92
  const expectedWinnerBalance = 50 - stake + expectedPayout;
  const balanceDiff = Math.abs(winnerBalance - expectedWinnerBalance);

  assert(balanceDiff < 0.01, `Winner got ~${expectedPayout} SOL payout`, `Expected ${expectedWinnerBalance}, got ${winnerBalance}`);
  assert(acceptResult.game.rake === expectedRake, `Rake is ${expectedRake} SOL`, `Got ${acceptResult.game.rake}`);

  // VERIFY: SHA256(secret) === proof_hash
  const secret = acceptResult.verification.secret;
  const computedProofHash = crypto.createHash('sha256').update(secret).digest('hex');
  assert(computedProofHash === proofHash, 'Provably fair verification', 'SHA256(secret) !== proof_hash');

  // Run 50 flips
  log('\nRunning 50 flips for rake verification...');
  let totalRake = 0;

  for (let i = 0; i < 50; i++) {
    const smallStake = 0.1;
    const create = await apiPost('/api/coinflip/create', { stake: smallStake, currency: 'SOL' }, agents[0].jwt);
    if (create.success) {
      const accept = await apiPost(`/api/coinflip/${create.game.id}/accept`, {}, agents[1].jwt);
      if (accept.success) {
        totalRake += accept.game.rake || 0;
      }
    }
  }

  // ASSERT: total rake ≈ 4% of total volume
  const expectedTotalRake = 50 * 0.1 * 2 * 0.04; // 50 flips * 0.1 stake * 2 players * 4%
  const rakeVariance = Math.abs(totalRake - expectedTotalRake);
  assert(rakeVariance < 0.5, '50 flips rake ≈ 4%', `Expected ~${expectedTotalRake}, got ${totalRake}`);

  // Test cancel
  log('\nTesting cancel...');
  const cancelCreate = await apiPost('/api/coinflip/create', { stake: 0.5, currency: 'SOL' }, agents[0].jwt);
  const cancelResult = await apiPost(`/api/coinflip/${cancelCreate.game.id}/cancel`, {}, agents[0].jwt);
  assert(cancelResult.success && cancelResult.refunded_amount === 0.5, 'Cancel refunds stake', cancelResult.error);

  log('');
}

// TEST RPS
async function testRPS() {
  log('=== TESTING RPS ===\n');

  // 0.5 SOL bo3 between agents 3+4
  const stake = 0.5;
  const rounds = 3;

  log('Agent 3 creating 0.5 SOL bo3 RPS...');
  const createResult = await apiPost('/api/rps/create', { stake, rounds, currency: 'SOL' }, agents[2].jwt);
  assert(createResult.success, 'RPS created', createResult.error);

  const gameId = createResult.game.id;

  log('Agent 4 accepting...');
  const acceptResult = await apiPost(`/api/rps/${gameId}/accept`, {}, agents[3].jwt);
  assert(acceptResult.success, 'RPS accepted', acceptResult.error);

  // Play rounds with known choices
  log('\nPlaying rounds...');

  for (let round = 1; round <= 3; round++) {
    log(`  Round ${round}:`);

    // Agent 3 commits rock
    const nonce3 = crypto.randomBytes(16).toString('hex');
    const hash3 = crypto.createHash('sha256').update(`rock:${nonce3}`).digest('hex');
    const commit3 = await apiPost(`/api/rps/${gameId}/commit`, { hash: hash3 }, agents[2].jwt);
    assert(commit3.success, `Agent 3 committed`, commit3.error);

    // Agent 4 commits paper (should win round)
    const nonce4 = crypto.randomBytes(16).toString('hex');
    const hash4 = crypto.createHash('sha256').update(`paper:${nonce4}`).digest('hex');
    const commit4 = await apiPost(`/api/rps/${gameId}/commit`, { hash: hash4 }, agents[3].jwt);
    assert(commit4.success, `Agent 4 committed`, commit4.error);

    // Agent 3 reveals
    const reveal3 = await apiPost(`/api/rps/${gameId}/reveal`, { choice: 'rock', nonce: nonce3 }, agents[2].jwt);
    assert(reveal3.success, `Agent 3 revealed`, reveal3.error);

    // Agent 4 reveals
    const reveal4 = await apiPost(`/api/rps/${gameId}/reveal`, { choice: 'paper', nonce: nonce4 }, agents[3].jwt);
    assert(reveal4.success, `Agent 4 revealed`, reveal4.error);

    // Agent 4 should win this round
    if (round === 1) {
      // Paper beats rock
      assert(reveal4.round_winner === 'acceptor', 'Paper beats rock', `Got ${reveal4.round_winner}`);
    }

    // If game ended early, break
    if (reveal4.game_complete) {
      log(`  Game complete! Winner: ${reveal4.final_winner?.slice(0, 8)}...`);
      break;
    }
  }

  // Get final game state
  const game = await apiGet(`/api/rps/${gameId}`);

  // ASSERT: winner got 0.95, rake 0.05 (5% of 1.0 pot)
  const expectedRake = stake * 2 * 0.05; // 0.05
  const expectedPayout = stake * 2 - expectedRake; // 0.95

  assert(game.rake === expectedRake, `Rake is ${expectedRake} SOL`, `Got ${game.rake}`);

  // Test invalid reveal → forfeit
  log('\nTesting invalid reveal (forfeit)...');
  const badGame = await apiPost('/api/rps/create', { stake: 0.1, rounds: 1, currency: 'SOL' }, agents[2].jwt);
  await apiPost(`/api/rps/${badGame.game.id}/accept`, {}, agents[3].jwt);

  const badNonce = crypto.randomBytes(16).toString('hex');
  const badHash = crypto.createHash('sha256').update(`rock:${badNonce}`).digest('hex');
  await apiPost(`/api/rps/${badGame.game.id}/commit`, { hash: badHash }, agents[2].jwt);

  const wrongNonce = crypto.randomBytes(16).toString('hex');
  const badReveal = await apiPost(`/api/rps/${badGame.game.id}/reveal`, { choice: 'rock', nonce: wrongNonce }, agents[2].jwt);

  assert(!badReveal.success, 'Invalid reveal is rejected', 'Should have failed');
  assert(badReveal.error?.includes('forfeit') || badReveal.error?.includes('hash'), 'Forfeit on hash mismatch', badReveal.error);

  log('');
}

// TEST AUDIT
async function testAudit() {
  log('=== TESTING AUDIT ===\n');

  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    log('⚠️  ADMIN_API_KEY not set, skipping audit');
    return;
  }

  const audit = await apiGet('/api/admin/audit', adminKey);

  log('Audit breakdown:');
  log(`  Total deposited: ${audit.audit.total_deposited} SOL`);
  log(`  Total in balances: ${audit.audit.total_in_balances} SOL`);
  log(`  Total on tables: ${audit.audit.total_on_tables} SOL`);
  log(`  Total in coinflip escrow: ${audit.audit.total_in_coinflip_escrow} SOL`);
  log(`  Total in RPS escrow: ${audit.audit.total_in_rps_escrow} SOL`);
  log(`  Total rake: ${audit.audit.total_rake} SOL`);
  log(`  Total withdrawn: ${audit.audit.total_withdrawn} SOL`);
  log(`  Expected total: ${audit.audit.expected_total} SOL`);
  log(`  Variance: ${audit.audit.variance} SOL`);

  assert(audit.balanced === true, 'Money invariant balanced', `Variance: ${audit.audit.variance}`);

  log('');
}

// Main
async function main() {
  console.log('🎰 CLAWSINO FULL TEST SUITE\n');
  console.log(`API: ${API_URL}\n`);

  try {
    await setup();
    await testPoker();
    await testCoinflip();
    await testRPS();
    await testAudit();

    // Summary
    console.log('\n=== TEST SUMMARY ===\n');
    const passed = testResults.filter(r => r.passed).length;
    const total = testResults.length;

    console.log(`Passed: ${passed}/${total}`);

    if (passed === total) {
      console.log('\n✅ ALL TESTS PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ FAILED');
      testResults.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.test}${r.details ? `: ${r.details}` : ''}`);
      });
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ TEST SUITE CRASHED:', err);
    process.exit(1);
  }
}

main();
