#!/bin/bash

# ClawCasino GitHub Push Script
# Run: ./push-to-github.sh

echo "🦀 ClawCasino GitHub Push Script"
echo "═══════════════════════════════════════════"
echo ""

# Navigate to project
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

echo "Step 1/5: Initializing git repository..."
git init

echo ""
echo "Step 2/5: Configuring git..."
git config user.email "RobotsMakeThings@users.noreply.github.com"
git config user.name "RobotsMakeThings"

echo ""
echo "Step 3/5: Adding all files to git..."
git add .

echo ""
echo "Step 4/5: Creating commit..."
git commit -m "🦀 Initial commit - ClawCasino poker platform

Features:
- PvP Texas Hold'em poker for AI agents
- Solana blockchain integration with real SOL deposits/withdrawals
- Next.js web dashboard with live game viewing
- Provably fair deck hashing
- 5% rake system capped at 3 SOL per pot
- 6-max tables with side pot calculations
- OpenClaw skill for agent integration
- SQLite database for persistence
- WebSocket real-time updates

Built with TypeScript, Express.js, Next.js, and @solana/web3.js"

echo ""
echo "Step 5/5: Creating GitHub repository and pushing..."
echo "This may take a moment..."

# Create repo and push
gh repo create RobotsMakeThings/clawcasino --public --description "The first casino for AI agents - Texas Hold'em poker" --source=. --remote=origin --push

if [ $? -eq 0 ]; then
    echo ""
    echo "═══════════════════════════════════════════"
    echo "✅ SUCCESS! Repository pushed to GitHub"
    echo "═══════════════════════════════════════════"
    echo ""
    echo "📁 Repository URL:"
    echo "   https://github.com/RobotsMakeThings/clawcasino"
    echo ""
    echo "🚀 Next Steps:"
    echo "   1. Go to https://app.netlify.com"
    echo "   2. Click 'Add new site' → 'Import from GitHub'"
    echo "   3. Select 'clawcasino' repository"
    echo "   4. Set build settings:"
    echo "      - Base directory: apps/web"
    echo "      - Build command: npm run build"
    echo "      - Publish directory: dist"
    echo "   5. Add environment variable:"
    echo "      - NEXT_PUBLIC_API_URL=https://your-api-url.com"
    echo "   6. Deploy!"
    echo ""
    echo "🎉 Your casino is ready to go live!"
else
    echo ""
    echo "❌ There was an issue with the push."
    echo ""
    echo "Trying alternative method..."
    
    # Try manual push
    git remote add origin https://github.com/RobotsMakeThings/clawcasino.git 2>/dev/null || true
    git push -u origin main || git push -u origin master
    
    if [ $? -eq 0 ]; then
        echo "✅ Push successful!"
        echo "   https://github.com/RobotsMakeThings/clawcasino"
    else
        echo "❌ Push failed. Please check your GitHub authentication."
    fi
fi