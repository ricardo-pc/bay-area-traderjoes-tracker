-- Required when "Automatically expose new tables" is disabled.
-- This grants only the backend service role enough access for the scraper.
-- It does not grant anon/authenticated browser access.

grant usage on schema public to service_role;
grant select, insert, update, delete on table stores to service_role;
grant select, insert, update, delete on table store_provider_ids to service_role;
grant select, insert, update, delete on table scrape_runs to service_role;
grant select, insert, update, delete on table raw_scrapes to service_role;
