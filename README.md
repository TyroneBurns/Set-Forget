# Set & Forget v5 — Northflank + Postgres

This build is designed for the setup you asked for:

- **Vercel** for the frontend and read-only API routes
- **Northflank PostgreSQL** for persistent storage
- **Northflank scheduled job** for the always-on paper-trading engine
- **Ably optional** for realtime fan-out later

## What v5 does

- starts with a configurable bankroll, default **£1000**
- runs the HMM candle engine on a schedule
- sizes each trade as a % of current equity
- stores **portfolio, positions, trades, signals, markets, snapshots**
- calculates:
  - current equity
  - cash
  - open / realised PnL
  - 1 day / 7 day return
  - win rate
  - max drawdown
  - trade count

## What it does not do

- it does **not** place live trades
- it is a **paper-trading** engine
- it still needs you to create:
  - a Northflank Postgres database
  - a Northflank scheduled job
  - Vercel env vars

## Quick setup

### 1. Create the database
Run:

```sql
-- from db/schema.sql
```

### 2. Add env vars
Add the values from `.env.example` in:
- Vercel
- Northflank job

### 3. Vercel
Deploy this repo on Vercel.
The frontend reads the latest state from:
- `/api/state`
- `/api/markets`
- `/api/trades`
- `/api/signals`

### 4. Northflank scheduled job
Use:

```bash
npm install
node worker/engine.js
```

Schedule it with a cron like:

```cron
*/5 * * * *
```

That runs every 5 minutes.

## Files

- `db/schema.sql` — Postgres schema
- `worker/engine.js` — scheduled paper-trading engine
- `api/*.js` — Vercel read routes
- `index.html`, `app.js`, `styles.css` — mobile dashboard

## Notes

This is the proper architecture for your **set & forget** paper test:
the worker keeps running even when your phone or browser is closed.
