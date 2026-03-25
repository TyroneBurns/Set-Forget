create table if not exists sf_portfolio (
  id text primary key,
  starting_balance_gbp numeric not null default 1000,
  cash_gbp numeric not null default 1000,
  realised_pnl_gbp numeric not null default 0,
  peak_equity_gbp numeric not null default 1000,
  max_drawdown_pct numeric not null default 0,
  risk_per_trade_pct numeric not null default 25,
  base_confidence numeric not null default 65,
  test_window_days integer not null default 7,
  updated_at timestamptz not null default now()
);

create table if not exists sf_positions (
  id bigserial primary key,
  portfolio_id text not null references sf_portfolio(id) on delete cascade,
  pair text not null,
  side text not null,
  entry_price numeric not null,
  units numeric not null,
  notional_gbp numeric not null,
  source text not null default 'auto',
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists sf_trades (
  id bigserial primary key,
  portfolio_id text not null references sf_portfolio(id) on delete cascade,
  pair text not null,
  side text not null,
  units numeric not null default 0,
  notional_gbp numeric not null default 0,
  entry_price numeric,
  exit_price numeric,
  pnl_gbp numeric,
  type text not null,
  source text not null default 'auto',
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sf_signals (
  id bigserial primary key,
  pair text not null,
  timeframe text not null,
  state text not null,
  bull_pct numeric not null,
  bear_pct numeric not null,
  chop_pct numeric not null,
  confidence_pct numeric not null,
  spread_pct numeric not null,
  quality_score numeric not null,
  adaptive_threshold numeric not null,
  decision text not null,
  last_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists sf_markets (
  pair text primary key,
  timeframe text not null,
  state text not null,
  bull_pct numeric not null,
  bear_pct numeric not null,
  chop_pct numeric not null,
  confidence_pct numeric not null,
  spread_pct numeric not null,
  quality_score numeric not null,
  adaptive_threshold numeric not null,
  decision text not null,
  last_price numeric,
  updated_at timestamptz not null default now()
);

create table if not exists sf_snapshots (
  id bigserial primary key,
  portfolio_id text not null references sf_portfolio(id) on delete cascade,
  snapshot_day date not null,
  equity_gbp numeric not null,
  cash_gbp numeric not null,
  open_pnl_gbp numeric not null,
  realised_pnl_gbp numeric not null,
  created_at timestamptz not null default now(),
  unique (portfolio_id, snapshot_day)
);

create index if not exists idx_sf_trades_portfolio_created on sf_trades (portfolio_id, created_at desc);
create index if not exists idx_sf_signals_pair_created on sf_signals (pair, created_at desc);
