create table if not exists public.saf_clients (
  client_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.saf_signal_history (
  id bigint generated always as identity primary key,
  pair_key text not null,
  client_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists saf_signal_history_pair_key_created_at_idx
  on public.saf_signal_history (pair_key, created_at desc);

alter table public.saf_clients replica identity full;
alter table public.saf_signal_history replica identity full;

alter publication supabase_realtime add table public.saf_clients;
alter publication supabase_realtime add table public.saf_signal_history;

alter table public.saf_clients disable row level security;
alter table public.saf_signal_history disable row level security;
