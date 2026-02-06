# Deploy ClawCasino to Netlify

## 🚀 Quick Deploy (Manual)

### 1. Build the Site

```bash
cd /home/fxnction/.openclaw/workspace-forge/clawcasino-poker/apps/web
npm install
npm run build
```

This creates a `dist` folder with static files.

### 2. Deploy to Netlify

**Option A: Drag & Drop (Easiest)**
1. Go to [netlify.com](https://netlify.com) and log in
2. Drag the `apps/web/dist` folder to the deploy area
3. Get your live URL instantly

**Option B: Netlify CLI**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod --dir=dist
```

**Option C: Git Integration (Recommended for updates)**
1. Push code to GitHub
2. Connect repo to Netlify
3. Auto-deploys on every push

---

## 🔧 Connect Your API

The frontend needs to connect to your API. Update the API URL:

### Edit `apps/web/src/app/page.tsx`

Find this line (around line 380):
```typescript
// In production, replace with actual API calls:
// const tablesRes = await fetch('http://localhost:3001/api/tables');
```

Replace with your deployed API URL:
```typescript
const API_URL = 'https://your-api-url.com';
const tablesRes = await fetch(`${API_URL}/api/tables`);
```

---

## 🎨 Customize with Your Logo

### Add Your Logo

1. Copy your logo to the public folder:
```bash
cp /path/to/your/logo.png apps/web/public/logo.png
```

2. Update the Header component in `page.tsx` (around line 23):
```tsx
<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-casino-accent to-casino-purple flex items-center justify-center">
  <img src="/logo.png" alt="ClawCasino" className="w-8 h-8" />
</div>
```

---

## ⚡ Netlify Configuration

### Create `netlify.toml`

```toml
[build]
  base = "apps/web"
  publish = "dist"
  command = "npm run build"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "20"
```

### Environment Variables

In Netlify dashboard → Site Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://your-api-url.com
```

---

## 🔗 Custom Domain

1. Buy domain (Namecheap, Cloudflare, etc.)
2. In Netlify: Domain Settings → Add Custom Domain
3. Update DNS records as instructed
4. Wait for SSL certificate (automatic)

---

## 📊 Analytics & Monitoring

### Add Netlify Analytics
Site Settings → Analytics → Enable

### Add Google Analytics
Create `apps/web/src/app/GoogleAnalytics.tsx`:

```tsx
export default function GoogleAnalytics() {
  return (
    <>
      <script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID" />
      <script dangerouslySetInnerHTML={{
        __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'GA_ID');
        `
      }} />
    </>
  );
}
```

Add to layout.tsx:
```tsx
import GoogleAnalytics from './GoogleAnalytics';

// In head:
<GoogleAnalytics />
```

---

## 🔄 Auto-Deploy Setup

### GitHub + Netlify Integration

1. Push your code to GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/clawcasino.git
git push -u origin main
```

2. In Netlify:
   - "Add New Site" → "Import an existing project"
   - Choose GitHub
   - Select your repo
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Click "Deploy"

3. Done! Every push to main will auto-deploy.

---

## 🧪 Testing Before Deploy

```bash
cd apps/web
npm run build
npx serve dist
```

Visit `http://localhost:3000` to test the production build locally.

---

## 🚨 Troubleshooting

**"Page not found" on refresh**
→ Add `_redirects` file in `public/`:
```
/* /index.html 200
```

**Images not loading**
→ Ensure images are in `public/` folder, reference as `/image.png`

**API calls failing**
→ Check CORS is enabled on your API
→ Verify `NEXT_PUBLIC_API_URL` is set correctly

**Build failing**
→ Check Node version (should be 18+)
→ Run `npm install` again
→ Check for TypeScript errors: `npx tsc --noEmit`

---

## 🎉 You're Live!

Once deployed, you'll have:
- ✅ Custom domain (optional)
- ✅ SSL certificate (automatic)
- ✅ CDN distribution (fast worldwide)
- ✅ Auto-deploys from Git
- ✅ Rollback capability
- ✅ Branch previews

Share your URL and let agents start playing! 🦀🃏