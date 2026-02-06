#!/bin/bash

# GitHub Setup Helper Script
# Run this after creating your GitHub account

echo "🦀 ClawCasino GitHub Setup Helper"
echo "═══════════════════════════════════════════"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Installing..."
    
    # Try to install based on OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update && sudo apt-get install -y git
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Please install Git: brew install git"
        exit 1
    else
        echo "Please install Git manually from https://git-scm.com/"
        exit 1
    fi
fi

echo "✅ Git is installed"
echo ""

# Get GitHub username
echo "Enter your GitHub username:"
read USERNAME

if [ -z "$USERNAME" ]; then
    echo "❌ Username is required"
    exit 1
fi

# Get repo name
echo "Enter repository name (default: clawcasino-poker):"
read REPO_NAME
REPO_NAME=${REPO_NAME:-clawcasino-poker}

echo ""
echo "Setting up git repository..."
echo ""

# Navigate to project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Initialize git if not already
git init

echo "📁 Adding files to git..."
git add .

echo "💾 Creating initial commit..."
git commit -m "🦀 Initial commit - ClawCasino poker platform

Features:
- PvP Texas Hold'em for AI agents
- Solana blockchain integration
- Next.js web dashboard
- Provably fair deck hashing
- 5% rake system

Ready for deployment!"

echo ""
echo "🔗 Adding remote origin..."
git remote add origin "https://github.com/$USERNAME/$REPO_NAME.git" 2>/dev/null || git remote set-url origin "https://github.com/$USERNAME/$REPO_NAME.git"

echo ""
echo "⬆️  Pushing to GitHub..."
echo "(You may be prompted for your GitHub credentials)"
echo ""

git push -u origin main 2>/dev/null || git push -u origin master

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ SUCCESS! Repository pushed to GitHub"
    echo ""
    echo "Repository URL:"
    echo "  https://github.com/$USERNAME/$REPO_NAME"
    echo ""
    echo "Next steps:"
    echo "1. Go to https://app.netlify.com"
    echo "2. Click 'Add new site' → 'Import an existing project'"
    echo "3. Choose GitHub and select '$REPO_NAME'"
    echo "4. Set build settings:"
    echo "   - Base directory: apps/web"
    echo "   - Build command: npm run build"
    echo "   - Publish directory: dist"
    echo "5. Add environment variable: NEXT_PUBLIC_API_URL"
    echo "6. Deploy!"
    echo ""
    echo "📖 Full guide: GIT_SETUP.md"
else
    echo ""
    echo "❌ Push failed. Common issues:"
    echo "1. Repository doesn't exist on GitHub yet"
    echo "   → Create it at https://github.com/new"
    echo "2. Authentication failed"
    echo "   → Use GitHub Desktop or set up SSH keys"
    echo "3. Network issues"
    echo "   → Check your internet connection"
    echo ""
    echo "Try GitHub Desktop: https://desktop.github.com/"
fi