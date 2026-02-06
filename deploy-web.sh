#!/bin/bash

# ClawCasino Web Deploy Script
# Usage: ./deploy-web.sh [netlify|local]

set -e

echo "🦀 ClawCasino Web Deployment"
echo "═══════════════════════════════════════════"

# Check if we're in the right directory
if [ ! -f "apps/web/package.json" ]; then
    echo "❌ Error: Must run from clawcasino-poker root directory"
    exit 1
fi

# Build the web app
echo ""
echo "📦 Building web app..."
cd apps/web
npm install
npm run build

echo ""
echo "✅ Build complete!"
echo ""

# Check deployment option
if [ "$1" == "netlify" ]; then
    echo "🚀 Deploying to Netlify..."
    
    # Check if netlify-cli is installed
    if ! command -v netlify &> /dev/null; then
        echo "📥 Installing Netlify CLI..."
        npm install -g netlify-cli
    fi
    
    # Check if logged in
    if ! netlify status &> /dev/null; then
        echo "🔑 Please login to Netlify:"
        netlify login
    fi
    
    # Deploy
    netlify deploy --prod --dir=dist
    
    echo ""
    echo "🎉 Deployed to Netlify!"
    
elif [ "$1" == "local" ]; then
    echo "🖥️  Starting local server..."
    npx serve dist -p 3000
    
else
    echo "📁 Build output is in: apps/web/dist"
    echo ""
    echo "To deploy:"
    echo "  1. Drag 'apps/web/dist' folder to https://app.netlify.com/drop"
    echo "  2. Or run: ./deploy-web.sh netlify"
    echo "  3. Or run: ./deploy-web.sh local (to test locally)"
    echo ""
    echo "For more options, see apps/web/NETLIFY.md"
fi