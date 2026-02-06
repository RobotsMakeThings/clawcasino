# Clawsino Poker - Git Setup & Deploy Guide

## 🚀 Step-by-Step: GitHub + Netlify Auto-Deploy

### Step 1: Create GitHub Account (You Do This)

1. Go to [github.com/signup](https://github.com/signup)
2. Use your email: `your-email@example.com`
3. Create username: `clawcasino` (or whatever you want)
4. Verify email
5. **Save your password!**

### Step 2: Create Repository

1. Click "+" → "New repository"
2. Repository name: `clawcasino-poker`
3. Description: "The first casino for AI agents - Texas Hold'em with Solana"
4. Make it **Public** (or Private if you prefer)
5. ✅ Initialize with README
6. Click "Create repository"

### Step 3: Upload the Code

**Option A: GitHub Desktop (Easiest)**

1. Download [GitHub Desktop](https://desktop.github.com/)
2. Sign in with your GitHub account
3. Click "File" → "Add local repository"
4. Choose the folder: `/home/fxnction/.openclaw/workspace-forge/clawcasino-poker`
5. Click "Publish repository"
6. Done!

**Option B: Command Line**

```bash
# Navigate to project
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

# Initialize git
git init

# Add all files
git add .

# Commit
git commit -m "🦀 Initial commit - Clawsino poker platform"

# Add remote (replace with YOUR username)
git remote add origin https://github.com/YOUR_USERNAME/clawcasino-poker.git

# Push
git push -u origin main
```

### Step 4: Connect to Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Choose "GitHub"
4. Authorize Netlify to access your GitHub
5. Select the `clawcasino-poker` repository
6. Configure build settings:

```
Base directory: apps/web
Build command: npm run build
Publish directory: dist
```

7. Click "Deploy site"

8. **Add Environment Variables:**
   - Go to Site Settings → Environment Variables
   - Add: `NEXT_PUBLIC_API_URL` = `https://your-api-url.com`

9. Done! Netlify will auto-deploy on every push to main.

### Step 5: Custom Domain (Optional)

1. Buy domain at [Namecheap](https://namecheap.com) or [Cloudflare](https://cloudflare.com)
   - Suggestion: `clawcasino.io` or `clawcasino.xyz`

2. In Netlify:
   - Go to Domain Settings
   - Click "Add custom domain"
   - Enter your domain

3. Update DNS (at your domain registrar):
   - Add CNAME record: `www` → `your-site.netlify.app`
   - Or use Netlify's nameservers

4. SSL certificate is automatic!

---

## 📁 Project Structure for Git

I've already created these files for you:

### `.gitignore`
```
node_modules/
dist/
.env
.env.local
*.log
data/
*.db
.DS_Store
```

### GitHub Actions Workflow (Auto-deploy)
Already created at: `.github/workflows/deploy.yml`

This will:
- Run tests on every PR
- Deploy to Netlify on every push to main
- Build both API docs and web

### README.md
Already updated with:
- Project description
- Setup instructions
- API documentation
- Deploy badges

---

## 🔄 Making Updates

After initial setup, updating is easy:

### GitHub Desktop
1. Make changes to code
2. Open GitHub Desktop
3. See your changes
4. Write commit message
5. Click "Commit to main"
6. Click "Push origin"
7. Netlify auto-deploys! 🎉

### Command Line
```bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker

# Make changes...

# Stage changes
git add .

# Commit
git commit -m "✨ Add new feature"

# Push (triggers Netlify deploy)
git push

# Watch it deploy at https://app.netlify.com/sites/your-site/deploys
```

---

## 🎯 Quick Commands Cheat Sheet

```bash
# Initial setup
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/clawcasino-poker.git
git push -u origin main

# Daily workflow
git pull                    # Get latest changes
git add .                   # Stage all changes
git commit -m "message"     # Commit
git push                    # Push (triggers deploy)

# Check status
git status                  # See what's changed
git log --oneline           # See commit history
```

---

## 🆘 Troubleshooting

**"Permission denied" when pushing**
→ You need to authenticate. Use GitHub Desktop or set up SSH keys.

**"Repository not found"**
→ Check the URL: `https://github.com/YOUR_USERNAME/clawcasino-poker.git`

**Netlify build fails**
→ Check build settings:
   - Base: `apps/web`
   - Command: `npm run build`
   - Publish: `dist`

**Changes not showing on site**
→ Clear browser cache (Ctrl+Shift+R)

---

## 🎉 What You Get

After setup:
- ✅ Git repository with full history
- ✅ Auto-deploys on every push
- ✅ Branch previews (test before merging)
- ✅ Rollback to any previous version
- ✅ Team collaboration (if you add contributors)
- ✅ Issue tracking
- ✅ Free hosting via Netlify

---

## 📱 Mobile App Later?

When you're ready for mobile:
1. Create `apps/mobile/` folder
2. Use React Native or Expo
3. Share code with `packages/poker-engine`
4. Deploy to App Store / Play Store

---

**Questions?**
- Git: [git-scm.com/doc](https://git-scm.com/doc)
- Netlify: [docs.netlify.com](https://docs.netlify.com)
- GitHub: [docs.github.com](https://docs.github.com)

Ready to make your GitHub account? 🚀