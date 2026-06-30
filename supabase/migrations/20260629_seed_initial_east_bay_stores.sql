-- Starter Trader Joe's stores carried over from the Berkeley grocery tracker.
-- Add more Bay Area stores by extending this values list with official TJ store codes.

insert into stores (slug, name, location_label, city, state, scrape_enabled)
values
  ('trader-joes-university-ave', 'Trader Joe''s', 'University Ave', 'Berkeley', 'CA', true),
  ('trader-joes-emeryville', 'Trader Joe''s', 'Emeryville', 'Emeryville', 'CA', true),
  ('trader-joes-college-ave', 'Trader Joe''s', 'College Ave', 'Oakland', 'CA', true)
on conflict (slug)
do update set
  name = excluded.name,
  location_label = excluded.location_label,
  city = excluded.city,
  state = excluded.state,
  scrape_enabled = excluded.scrape_enabled,
  updated_at = now();

insert into store_provider_ids (store_id, provider, provider_store_code, active)
select s.id, 'trader_joes', v.provider_store_code, true
from (
  values
    ('trader-joes-university-ave', '186'),
    ('trader-joes-emeryville', '72'),
    ('trader-joes-college-ave', '231')
) as v(slug, provider_store_code)
join stores s on s.slug = v.slug
on conflict (store_id, provider)
do update set
  provider_store_code = excluded.provider_store_code,
  active = excluded.active;
