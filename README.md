# Thermoform Layout Optimizer

A Progressive Web App (PWA) for calculating optimal thermoforming mold layouts, material usage, and per-part costs.

## Features

- Cavity layout optimization with automatic orientation selection
- Parts centered on the web with equal edge margins
- Real-time SVG layout visualization with dimensions
- Material database (rPET, PET, PETG, HIPS, PP, PVC, ABS, PC, PLA, GPPS)
- Weight calculations (sheet, parts, scrap)
- Optional cost-per-part analysis
- DXF file upload for automatic part dimension extraction
- FRED PPI pricing trend data (embedded)
- Mobile-responsive — installs as an app on Android

## Deploy to Vercel (Step by Step)

### 1. Push to GitHub

If you haven't already, create a new repo on GitHub:

```bash
# In the thermoform-pwa folder:
git init
git add .
git commit -m "Thermoform Layout Optimizer v1.0"

# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/thermoform-layout-optimizer.git
git branch -M main
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account
2. Click **"Add New Project"**
3. Select your `thermoform-layout-optimizer` repository
4. Vercel auto-detects Vite — leave all defaults
5. Click **"Deploy"**

That's it. You'll get a URL like `thermoform-layout-optimizer.vercel.app`.

### 3. (Optional) Custom Domain

In Vercel project settings → Domains, add `tools.lanelson.com` or similar.
Point a CNAME record to `cname.vercel-dns.com` in your DNS settings.

### 4. Install on Android

1. Open the Vercel URL in Chrome on your Android phone
2. Tap the menu (three dots) → **"Install app"** or **"Add to Home screen"**
3. The app launches full-screen like a native app

## Local Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Build for Production

```bash
npm run build
```

Output goes to `dist/` folder.

## Updating FRED PPI Data

The PPI data is embedded in `src/App.jsx` in the `FRED_PPI` array. Update monthly after BLS releases new data (typically the last Thursday of the month). Source: https://fred.stlouisfed.org/series/PCU3252113252111
