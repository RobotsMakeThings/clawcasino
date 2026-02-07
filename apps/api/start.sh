#!/bin/bash
# Deploy script for Railway

echo "🚀 Deploying Clawsino API to Railway..."

# Install deps and run directly with tsx (no build step)
cd apps/api
npm install
npx tsx src/index.ts
