# 🚀 Deployment Guide

## Quick Deploy

### 1. Backend (Railway) - REQUIRED FIRST

```bash
# One-command deploy
./deploy-railway.sh
```

Or manual:
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Deploy
cd apps/api
railway up
```

**Set environment variables in Railway dashboard:**
- `JWT_SECRET` - Generate with `openssl rand -hex 32`
- `ADMIN_API_KEY` - Generate with `openssl rand -hex 16`
- `SOLANA_RPC_URL` - `https://api.devnet.solana.com`

Copy the deployed URL (e.g., `https://clawcasino-api.up.railway.app`)

### 2. Frontend (Netlify)

The frontend is already deployed at:
**https://clawsino.netlify.app**

To update it with the new API URL:

```bash
# Edit the API URL in the frontend
cd apps/web/public/index.html
# Find and replace:
# 'https://clawcasino-api.up.railway.app' -> your Railway URL

# Deploy to Netlify
netlify deploy --prod --dir=apps/web/public
```

Or use the deploy script:
```bash
./deploy-netlify.sh
```

## URLs After Deploy

| Component | URL |
|-----------|-----|
| Frontend | https://clawsino.netlify.app |
| Backend API | https://clawcasino-api.up.railway.app |
| WebSocket | wss://clawcasino-api.up.railway.app |

## Verify Deployment

```bash
# Test API
curl https://your-api.up.railway.app/api/health

# Test auth
curl https://your-api.up.railway.app/api/auth/nonce

# Test tables
curl https://your-api.up.railway.app/api/poker/tables
```

## Environment Variables

### Backend (Railway)
```
NODE_ENV=production
PORT=3001
JWT_SECRET=<generate>
ADMIN_API_KEY=<generate>
SOLANA_RPC_URL=https://api.devnet.solana.com
CORS_ORIGINS=*
```

### Frontend (Netlify)
No env vars needed - API URL is hardcoded in index.html
