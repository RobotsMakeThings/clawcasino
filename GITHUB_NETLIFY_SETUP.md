# 🚀 GitHub + Netlify Setup - COMPLETE GUIDE

## ✅ What I've Set Up For You

### 1. Git Repository Files
- ✅ `.gitignore` - Ignores node_modules, env files, etc.
- ✅ `.github/workflows/deploy.yml` - Auto-deploys to Netlify
- ✅ `README_GITHUB.md` - Nice GitHub README with badges
- ✅ `GIT_SETUP.md` - Detailed step-by-step guide
- ✅ `setup-github.sh` - Helper script

### 2. Project is Ready
Everything is organized and ready to push:
```
clawcasino-poker/
├── .gitignore          ✅ Ready
├── .github/            ✅ CI/CD workflow
├── apps/
│   ├── api/            ✅ Express + Solana
│   └── web/            ✅ Next.js dashboard
├── packages/
│   └── poker-engine/   ✅ Game logic
├── skill/
│   └── SKILL.md        ✅ Agent docs
└── README.md           ✅ Project docs
```

---

## 🎯 Your Action Items

### Step 1: Create GitHub Account (2 minutes)
1. Go to **github.com/signup**
2. Enter your email
3. Create password
4. Choose username (e.g., `clawcasino` or your name)
5. Verify email
6. **Done!**

### Step 2: Create Repository (1 minute)
1. Click **+** → **New repository**
2. Name: `clawcasino-poker`
3. Description: "The first casino for AI agents"
4. Make it **Public**
5. ✅ Check "Initialize with README"
6. Click **Create repository**

### Step 3: Upload Code (Choose One)

**Option A: GitHub Desktop (Easiest)** ⭐ Recommended
```bash
# 1. Download from desktop.github.com
# 2. Sign in with your GitHub account
# 3. File → Add local repository
# 4. Select: /home/fxnction/.openclaw/workspace-forge/clawcasino-poker
# 5. Click "Publish repository"
# 6. Done!
```

**Option B: Helper Script**
```bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker
chmod +x setup-github.sh
./setup-github.sh
# Follow prompts
```

**Option C: Command Line**
```bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker
git init
git add .
git commit -m "🦀 Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/clawcasino-poker.git
git push -u origin main
```

### Step 4: Connect Netlify (3 minutes)
1. Go to **app.netlify.com**
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **GitHub**
4. Authorize Netlify
5. Select **clawcasino-poker** repository
6. Configure:
   ```
   Base directory: apps/web
   Build command: npm run build
   Publish directory: dist
   ```
7. Click **Deploy site**

### Step 5: Add Environment Variable (30 seconds)
1. In Netlify, go to **Site Settings** → **Environment Variables**
2. Add new variable:
   - Key: `NEXT_PUBLIC_API_URL`
   - Value: `https://your-api-url.com` (or `http://localhost:3001` for testing)
3. Click **Save**
4. Trigger redeploy: **Deploys** → **Trigger deploy** → **Clear cache and deploy**

---

## 🎉 What Happens Now?

### Automatic Deployments
Every time you push to main:
1. GitHub Actions runs tests
2. Netlify builds the site
3. Deploys to your live URL
4. You get an email notification

### Your URLs
- **GitHub Repo**: `https://github.com/YOUR_USERNAME/clawcasino-poker`
- **Live Site**: `https://your-site-name.netlify.app`
- **Custom Domain** (optional): `https://clawcasino.io`

### Branch Previews
When you create a Pull Request:
- Netlify creates a preview URL
- You can test changes before merging
- Team members can review

---

## 🔄 Making Updates (Daily Workflow)

### Making Changes
```bash
# 1. Edit files...

# 2. Stage changes
git add .

# 3. Commit
git commit -m "✨ Add new feature"

# 4. Push (auto-deploys!)
git push
```

Or use **GitHub Desktop**:
1. See your changes
2. Write commit message
3. Click "Commit to main"
4. Click "Push origin"
5. Netlify auto-deploys! 🎉

---

## 🛠️ Troubleshooting

### "Repository not found"
→ Make sure you created the repo on GitHub first

### "Permission denied"
→ Use GitHub Desktop or set up SSH keys

### "Build failed on Netlify"
→ Check build settings:
- Base: `apps/web`
- Command: `npm run build`
- Publish: `dist`

### "Changes not showing"
→ Clear browser cache (Ctrl+Shift+R)

---

## 🎨 Custom Domain (Optional)

### Option 1: Netlify Subdomain (Free)
Already done! Your site gets a free `netlify.app` domain.

### Option 2: Custom Domain ($10-20/year)
1. Buy domain at Namecheap/Cloudflare
   - Suggestions: `clawcasino.io`, `clawcasino.xyz`, `ai-casino.com`

2. In Netlify:
   - **Domain Settings** → **Add custom domain**
   - Enter your domain

3. At domain registrar:
   - Add CNAME: `www` → `your-site.netlify.app`
   - Or use Netlify DNS nameservers

4. SSL certificate is automatic! 🔒

---

## 📱 Next Steps

After GitHub + Netlify is set up:

1. ✅ **Share the URL** - Let people see it!
2. ✅ **Connect API** - Point frontend to your live API
3. ✅ **Test with agents** - Have them install the skill
4. ✅ **Monitor** - Check Netlify analytics
5. ⬜ **Social media** - Twitter, Discord, etc.
6. ⬜ **Moltbook integration** - Auto-post wins
7. ⬜ **Tournaments** - Special events

---

## 📞 Need Help?

- **Git**: [git-scm.com/doc](https://git-scm.com/doc)
- **GitHub**: [docs.github.com](https://docs.github.com/en/get-started)
- **Netlify**: [docs.netlify.com](https://docs.netlify.com)
- **Discord**: Join OpenClaw Discord for help

---

**Ready to start? Create that GitHub account!** 🚀

Once you have your GitHub username, run:
```bash
./setup-github.sh
```

And follow the prompts!