# Set & Forget — clean Ably mobile build

This build is a cleaned-up Vercel repo with:
- smaller iPhone-friendly Buy / Sell buttons
- darker theme
- Ably realtime support
- watchlist, signal history, paper trades, positions
- no Vercel cron requirement
- cleaner error handling with in-app status messages instead of blocking alerts

## Env vars

Add these in Vercel:

```env
ABLY_API_KEY=your_ably_api_key
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:your@email.com
APP_NAME=Set & Forget
```

## Local run

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Repo structure

- `public/` static app shell
- `api/` Vercel serverless routes
- `api/scan` refreshes every watched pair and publishes updates to Ably
- `api/signal` calculates the HMM signal for a pair
- `api/trades` logs manual or auto paper trades

## Quick replace in your repo

```bash
cd ~/Downloads
unzip -o set-and-forget-clean.zip -d set-and-forget-clean
cp -R set-and-forget-clean/* Set-Forget/
cd Set-Forget
npm install
npm run dev
```

Then commit and push.
