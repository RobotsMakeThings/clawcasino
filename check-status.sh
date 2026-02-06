#!/bin/bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

echo "🦀 ClawCasino Git Status Check"
echo "═══════════════════════════════════════════"
echo ""

echo "📁 Git Status:"
git status

echo ""
echo "📜 Recent Commits:"
git log --oneline -5

echo ""
echo "🔗 Remote:"
git remote -v

echo ""
echo "🌐 Check if pushed to GitHub:"
echo "   https://github.com/RobotsMakeThings/clawcasino/commits/main"
echo ""
echo "🚀 Check Netlify deploy status:"
echo "   https://app.netlify.com/sites/papaya-gnome-85385a/deploys"