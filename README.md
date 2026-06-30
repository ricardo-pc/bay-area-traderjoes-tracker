# Bay Area Trader Joe's Tracker

Trader Joe's-only scraper and raw catalog store spun out of the Berkeley grocery tracker.

This repo intentionally excludes the old dashboard, cross-store matching, Whole Foods logic, and Safeway logic. It keeps the useful Trader Joe's pipeline:

- Fetch paginated Trader Joe's product catalogs from the public GraphQL endpoint.
- Scrape all active configured stores.
- Store full raw payloads plus normalized name, price, unit, image, URL, SKU, availability, and run metadata in Supabase.
- Run locally or on a weekly GitHub Actions schedule.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a Supabase project and run these SQL migrations in order:

   ```text
   supabase/migrations/20260629_init_traderjoes_schema.sql
   supabase/migrations/20260629_seed_initial_east_bay_stores.sql
   ```

3. Copy `.env.example` to `.env` and fill in:

   ```text
   SUPABASE_URL
   SUPABASE_SERVICE_KEY
   ```

4. Run the scraper:

   ```sh
   npm run scrape:tj
   ```

To scrape only specific stores, set `TJ_STORE_SLUGS` to a comma-separated list of store slugs.

## Dashboard

Run the Replit-friendly dashboard locally with:

```sh
npm start
```

The dashboard reads Supabase on the server, so `SUPABASE_SERVICE_KEY` stays private and is never sent to the browser.

For Replit:

1. Import this GitHub repo.
2. Add Replit Secrets for `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
3. Run the app with `npm start`.
4. Publish the Repl to get a public `.replit.app` URL.

## GitHub Actions

The workflow at `.github/workflows/scrape-traderjoes.yml` runs weekly on Mondays at 8:00 UTC and can also be triggered manually.

Add these repository secrets before running it:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

## Store Coverage

The initial seed keeps the three Trader Joe's stores from the Berkeley project:

- University Ave, Berkeley (`186`)
- Emeryville (`72`)
- College Ave, Oakland (`231`)

To make this a broader Bay Area tracker, add more Trader Joe's stores to `stores` and their official store codes to `store_provider_ids`.

## Validation

Run the helper tests with:

```sh
npm test
```
