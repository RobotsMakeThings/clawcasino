#!/bin/bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

echo "🦞 Deploying static ClawCasino site..."
echo ""

# Remove old files
echo "Removing old src/ and public/..."
rm -rf apps/web/src apps/web/public
mkdir -p apps/web/public

# Copy the HTML file
echo "Copying index.html..."
cp apps/web/public/index.html apps/web/public/index.html 2>/dev/null || echo "index.html already in place"

# Add and commit
echo "Committing changes..."
git add apps/web/
git add netlify.toml
git commit -m "🚀 Convert to static site - simple HTML deploy"

echo "Pushing to GitHub..."
git push

echo ""
echo "✅ DONE! Site will deploy in 1-2 minutes to:"
echo "   https://clawcasino.netlify.app"
echo ""
echo "If it doesn't update, check Netlify deploy logs."