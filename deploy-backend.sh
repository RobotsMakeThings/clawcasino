#!/bin/bash
# Deploy backend to Railway

echo "🚀 Deploying Clawsino Backend to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Login to Railway
railway login

# Link project (or create new one)
echo "Linking to Railway project..."
railway link

# Set environment variables
echo "Setting environment variables..."
railway variables set NODE_ENV=production
railway variables set PORT=3001
railway variables set SOLANA_RPC_URL=https://api.devnet.solana.com
railway variables set CORS_ORIGINS="*"

# Deploy
echo "Deploying..."
cd apps/api
railway up

echo "✅ Backend deployed!"
echo "Your API URL will be shown above. Copy it and update the frontend."
