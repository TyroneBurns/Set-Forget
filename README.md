# Set & Forget — Ably realtime mobile build

This build swaps the Supabase layer for **Ably realtime** and tightens the UI for **iPhone-sized screens**.

## What's changed

- Ably realtime channels for live in-app updates between open devices
- Darker theme with tighter spacing for iOS Safari
- Smaller Buy / Sell buttons so the hero card fits cleanly on mobile
- Pair and size stay visible at the top
- Controls stay inside the dropdown panel
- Watchlist, manual trades, auto trades, and signal history still work
- No Vercel cron required

## Important

This build uses **in-memory server storage** for client state and saved signal history unless you wire in a durable database later.

That means:
- great for testing and single-session use
- state can reset after redeploys or cold starts

Realtime works while the app is open. Closed-app background push still needs a server-side scan trigger somewhere later.

## Env vars

Add these in Vercel and locally if you run `vercel dev`:

```env
ABLY_API_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
APP_NAME=Set & Forget
```

## Ably setup

1. Create or open your Ably app
2. Copy your API key
3. Set `ABLY_API_KEY` in Vercel
4. Redeploy

The app uses `/api/ably-auth` to create Ably token requests for the browser client.

## Local run

```bash
npm install
npm run dev
```

## Files worth editing next

- `public/styles.css` → mobile UI and theme
- `public/app.js` → client state, realtime subscriptions, and controls
- `api/scan.js` → signal scanning and push trigger point
- `api/_lib/ably.js` → realtime publishing

## Good next upgrade

If you want durable logs later, add a small hosted database and keep Ably only for realtime transport.
