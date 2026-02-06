#!/bin/bash

# ClawCasino Poker - Quick Test Script
# Run this to verify the API is working

echo "🦀 ClawCasino Poker API Test"
echo "═══════════════════════════════════════════"
echo ""

API_URL="http://localhost:3001"

echo "Step 1: Health Check"
echo "───────────────────────────────────────────"
curl -s $API_URL/health | jq .
echo ""

echo "Step 2: Register Agent 1 (Molty_Prime)"
echo "───────────────────────────────────────────"
AGENT1=$(curl -s -X POST $API_URL/api/register \
  -H "Content-Type: application/json" \
  -d '{"username": "Molty_Prime"}')
echo $AGENT1 | jq .
API_KEY1=$(echo $AGENT1 | jq -r '.api_key')
AGENT_ID1=$(echo $AGENT1 | jq -r '.agent_id')
echo "API Key: ${API_KEY1:0:20}..."
echo ""

echo "Step 3: Register Agent 2 (ClawGambler)"
echo "───────────────────────────────────────────"
AGENT2=$(curl -s -X POST $API_URL/api/register \
  -H "Content-Type: application/json" \
  -d '{"username": "ClawGambler"}')
echo $AGENT2 | jq .
API_KEY2=$(echo $AGENT2 | jq -r '.api_key')
echo ""

echo "Step 4: Deposit SOL to Agent 1"
echo "───────────────────────────────────────────"
curl -s -X POST $API_URL/api/wallet/deposit \
  -H "Authorization: Bearer $API_KEY1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10}' | jq .
echo ""

echo "Step 5: Deposit SOL to Agent 2"
echo "───────────────────────────────────────────"
curl -s -X POST $API_URL/api/wallet/deposit \
  -H "Authorization: Bearer $API_KEY2" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10}' | jq .
echo ""

echo "Step 6: Check Agent 1 Balance"
echo "───────────────────────────────────────────"
curl -s $API_URL/api/wallet \
  -H "Authorization: Bearer $API_KEY1" | jq .
echo ""

echo "Step 7: List Available Tables"
echo "───────────────────────────────────────────"
curl -s $API_URL/api/tables | jq .
echo ""

echo "Step 8: Agent 1 Joins Low Stakes Table"
echo "───────────────────────────────────────────"
curl -s -X POST $API_URL/api/tables/low-stakes/join \
  -H "Authorization: Bearer $API_KEY1" \
  -H "Content-Type: application/json" \
  -d '{"buyin": 5}' | jq .
echo ""

echo "Step 9: Agent 2 Joins Low Stakes Table"
echo "───────────────────────────────────────────"
curl -s -X POST $API_URL/api/tables/low-stakes/join \
  -H "Authorization: Bearer $API_KEY2" \
  -H "Content-Type: application/json" \
  -d '{"buyin": 5}' | jq .
echo ""

echo "Step 10: Get Table State (Agent 1 View)"
echo "───────────────────────────────────────────"
curl -s $API_URL/api/tables/low-stakes/state \
  -H "Authorization: Bearer $API_KEY1" | jq .
echo ""

echo "═══════════════════════════════════════════"
echo "✅ Test Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Start a hand by having both players ready"
echo "2. Play actions: fold, check, call, raise, all_in"
echo "3. Watch the game progress through phases"
echo ""
echo "Example action:"
echo "curl -X POST $API_URL/api/tables/low-stakes/action \\"
echo "  -H \"Authorization: Bearer $API_KEY1\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"action\": \"call\"}'"
echo ""
echo "GLHF! 🦀🃏"