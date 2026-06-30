-- Trader Joe's-only scraping schema.
-- Run in Supabase SQL Editor or through the Supabase CLI before the scraper.

create extension if not exists pgcrypto;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null default 'Trader Joe''s',
  location_label text not null,
  city text,
  state text not null default 'CA',
  address text,
  scrape_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_provider_ids (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  provider text not null default 'trader_joes' check (provider = 'trader_joes'),
  provider_store_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(store_id, provider)
);

create table if not exists scrape_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'trader_joes' check (provider = 'trader_joes'),
  run_type text not null default 'full_catalog' check (run_type = 'full_catalog'),
  store_id uuid not null references stores(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'success', 'failed', 'partial')),
  pages_fetched int not null default 0,
  rows_inserted int not null default 0,
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists raw_scrapes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  provider text not null default 'trader_joes' check (provider = 'trader_joes'),
  provider_product_id text,
  scrape_run_id uuid references scrape_runs(id) on delete set null,
  raw_name text not null,
  raw_price numeric(10, 2) not null,
  raw_unit text,
  raw_url text,
  raw_image_url text,
  availability text,
  raw_payload jsonb not null,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processed', 'ignored')),
  scraped_at timestamptz not null default now()
);

create index if not exists stores_scrape_enabled_idx
  on stores(scrape_enabled);

create index if not exists store_provider_ids_provider_code_idx
  on store_provider_ids(provider, provider_store_code);

create index if not exists store_provider_ids_active_idx
  on store_provider_ids(active);

create index if not exists scrape_runs_provider_store_started_idx
  on scrape_runs(provider, store_id, started_at desc);

create index if not exists scrape_runs_status_started_idx
  on scrape_runs(status, started_at desc);

create index if not exists raw_scrapes_provider_product_idx
  on raw_scrapes(provider, provider_product_id);

create index if not exists raw_scrapes_store_scraped_idx
  on raw_scrapes(store_id, scraped_at desc);

create index if not exists raw_scrapes_scrape_run_idx
  on raw_scrapes(scrape_run_id);

create index if not exists raw_scrapes_processing_status_idx
  on raw_scrapes(processing_status);

alter table stores enable row level security;
alter table store_provider_ids enable row level security;
alter table scrape_runs enable row level security;
alter table raw_scrapes enable row level security;

-- The scraper uses SUPABASE_SERVICE_KEY, which bypasses RLS. Add read policies later
-- when you connect a public dashboard or API.
grant usage on schema public to service_role;
grant select, insert, update, delete on table stores to service_role;
grant select, insert, update, delete on table store_provider_ids to service_role;
grant select, insert, update, delete on table scrape_runs to service_role;
grant select, insert, update, delete on table raw_scrapes to service_role;
