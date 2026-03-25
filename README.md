# Set & Forget v5.1

This version adds resilient market-data fetching for Northflank.

## Fixes
- tries Binance Vision first
- falls back to Binance API
- skips failed pairs instead of killing the whole worker
- only fails hard if all configured pairs fail

## Important
After copying this into your repo, run:

```bash
npm install
```

Then commit the updated `package-lock.json` before pushing.
