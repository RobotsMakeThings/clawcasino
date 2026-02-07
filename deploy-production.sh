#!/bin/bash
# Complete Clawsino Deployment Script
# This deploys both backend (Railway) and frontend (Netlify)

set -e

echo "🦀 CLAWSINO PRODUCTION DEPLOYMENT 🦀"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Backend Deployment
echo -e "${CYAN}Step 1: Deploying Backend to Railway...${NC}"
echo "------------------------------------"

if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

echo ""
echo "You'll need to login to Railway. A browser window will open."
echo "Press Enter to continue..."
read

railway login

echo ""
echo "Creating Railway project..."
cd apps/api

# Initialize Railway project if not exists
if [ ! -f ../../.railway/project.json ]; then
    railway init --name clawcasino-api
fi

# Set environment variables
echo "Setting environment variables..."
railway variables set NODE_ENV=production
railway variables set PORT=3001
railway variables set SOLANA_RPC_URL=https://api.devnet.solana.com
railway variables set CORS_ORIGINS="*"
railway variables set JWT_SECRET=$(openssl rand -hex 32)
railway variables set ADMIN_API_KEY=$(openssl rand -hex 16)

# Deploy
echo "Deploying backend..."
railway up

# Get the URL
BACKEND_URL=$(railway domain)
echo ""
echo -e "${GREEN}✅ Backend deployed!${NC}"
echo -e "${CYAN}API URL: https://$BACKEND_URL${NC}"

cd ../..

# Step 2: Update Frontend API URL
echo ""
echo -e "${CYAN}Step 2: Updating frontend API URL...${NC}"
echo "------------------------------------"

sed -i "s|https://clawcasino-api.up.railway.app|https://$BACKEND_URL|g" apps/web/public/index.html

git add apps/web/public/index.html
git commit -m "Update API URL to production backend"
git push origin master

echo -e "${GREEN}✅ Frontend updated with API URL${NC}"

# Step 3: Frontend Deployment
echo ""
echo -e "${CYAN}Step 3: Deploying Frontend to Netlify...${NC}"
echo "------------------------------------"

if ! command -v netlify &> /dev/null; then
    echo "Installing Netlify CLI..."
    npm install -g netlify-cli
fi

echo ""
echo "You'll need to login to Netlify. A browser window will open."
echo "Press Enter to continue..."
read

netlify login

echo ""
echo "Initializing Netlify site..."
cd apps/web

if [ ! -f .netlify/state.json ]; then
    netlify init --manual
fi

echo "Deploying to production..."
netlify deploy --prod --dir=public

cd ../..

echo ""
echo "===================================="
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE! 🎉${NC}"
echo "===================================="
echo ""
echo -e "Backend API: ${CYAN}https://$BACKEND_URL${NC}"
echo -e "Frontend: ${CYAN}$(cd apps/web && netlify site:info --json 2>/dev/null | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo 'Check Netlify dashboard')${NC}"
echo ""
echo "Your casino is now LIVE! 🦀🎰"
