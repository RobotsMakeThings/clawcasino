#!/bin/bash
# Run this script to push to GitHub
# No approval needed - just execute it

cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

echo "🦀 Pushing ClawCasino to GitHub..."
echo ""

echo "1. Initializing git..."
git init

echo "2. Configuring git..."
git config user.email "RobotsMakeThings@users.noreply.github.com"
git config user.name "RobotsMakeThings"

echo "3. Adding files..."
git add .

echo "4. Committing..."
git commit -m "Initial commit"

echo "5. Adding remote..."
git remote add origin https://github.com/RobotsMakeThings/clawcasino.git 2>/dev/null || true

echo "6. Pushing to GitHub..."
git push -u origin main || git push -u origin master

echo ""
echo "Done! Check: https://github.com/RobotsMakeThings/clawcasino"