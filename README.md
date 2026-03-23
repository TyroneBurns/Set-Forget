# Set & Forget — Supabase realtime build

This build swaps the old KV + Vercel cron setup for **Supabase Postgres + Realtime**.

## What changed

- Supabase stores client state, watchlists, manual trades, auto trades, and saved signal history
- Supabase Realtime pushes updates between open devices instantly
- Vercel cron is removed
- UI stays mobile-first with the quick pair + size strip and big Buy / Sell actions
- Manual trades and auto trades both log into the same paper trade ledger

## Important truth

This build gives you **live in-app updates with Supabase Realtime**.

For **phone notifications while the app is fully closed**, you still need a server-side signal producer running somewhere, because web push can only be sent from a backend when a signal flips.

I included:

- `/api/scan` for on-demand scanning from the open app
- `supabase/schema.sql` for the database

So this version is great for:

- live multi-device syncing
- shared watchlist state
- saved history and trades
- push notifications while a scan is being run server-side

If you want true always-on closed-app push later, the clean next step is a small always-on worker or Supabase Edge Function runner that calls `/api/scan` or reproduces the same logic.

## Setup

### 1) Create a Supabase project

In Supabase, create a new project and copy:

- Project URL
- anon public key
- service role key

### 2) Run the SQL

Open the SQL editor in Supabase and run:

- `supabase/schema.sql`

### 3) Add env vars to Vercel

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
APP_NAME=Set & Forget
```

### 4) Local dev

```bash
npm install
npm run dev
```

### 5) Push enabled notifications

Generate VAPID once:

```bash
npx web-push generate-vapid-keys
```

## How realtime works here

- open app scans the watchlist with `/api/scan`
- signal flips get saved into `saf_signal_history`
- client state changes get saved into `saf_clients`
- open devices subscribe to Supabase Realtime and refresh instantly when rows change

## Files you will care about

- `public/index.html` → UI shell
- `public/app.js` → front-end state, polling, and Supabase Realtime subscriptions
- `api/scan.js` → watchlist scan + history write + push send + auto paper trading
- `api/_lib/state.js` → Supabase-backed client state store
- `supabase/schema.sql` → tables and realtime publication

## Security note

This starter keeps the database setup simple so it is easy to launch.

For a proper production app, add Supabase Auth and tighten row policies before you store anything sensitive.
