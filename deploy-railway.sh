#!/bin/bash
# Deploy backend to Railway

echo "🚀 Deploying Clawsino Backend to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Login
railway login

# Link or create project
echo ""
echo "Setting up Railway project..."
railway link

# Set environment variables
echo "Setting environment variables..."
railway variables set NODE_ENV=production
railway variables set PORT=3001
railway variables set SOLANA_RPC_URL=https://api.devnet.solana.com
railway variables set CORS_ORIGINS="*"

# Generate secure secrets
echo "Generating secrets..."
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_API_KEY=$(openssl rand -hex 16)
railway variables set JWT_SECRET="$JWT_SECRET"
railway variables set ADMIN_API_KEY="$ADMIN_API_KEY"

echo ""
echo "⚠️  SAVE THESE SECRETS:"
echo "JWT_SECRET: $JWT_SECRET"
echo "ADMIN_API_KEY: $ADMIN_API_KEY"
echo ""

# Deploy
echo "Deploying..."
railway up

# Get URL
echo ""
echo "✅ Backend deployed!"
echo "Your API URL: $(railway domain)"
echo ""
echo "Update your frontend API_URL to this domain"
