const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  buildTjProductUrl,
  getConfig,
  loadDotEnvFile,
  normalizeProductRow,
  normalizeServiceKey,
  normalizeSupabaseUrl,
  parseStoreSlugFilter,
} = require('../scripts/scrapers/traderjoes')

test('normalizes Supabase URL and service key', () => {
  assert.equal(
    normalizeSupabaseUrl('"https://example.supabase.co/"'),
    'https://example.supabase.co'
  )
  assert.equal(normalizeServiceKey("'service-key'"), 'service-key')
})

test('loads env vars from a .env file without overriding existing process env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-env-'))
  const envPath = path.join(dir, '.env')
  fs.writeFileSync(
    envPath,
    [
      'TJ_TEST_ENV_LOADED="from-file"',
      'TJ_TEST_ENV_EXISTING=from-file',
      '# ignored comment',
      '',
    ].join('\n')
  )

  delete process.env.TJ_TEST_ENV_LOADED
  process.env.TJ_TEST_ENV_EXISTING = 'from-process'

  loadDotEnvFile(envPath)

  assert.equal(process.env.TJ_TEST_ENV_LOADED, 'from-file')
  assert.equal(process.env.TJ_TEST_ENV_EXISTING, 'from-process')

  delete process.env.TJ_TEST_ENV_LOADED
  delete process.env.TJ_TEST_ENV_EXISTING
})

test('builds Trader Joe product URLs without duplicating SKUs', () => {
  assert.equal(
    buildTjProductUrl('banana-12345', '12345'),
    'https://www.traderjoes.com/home/products/pdp/banana-12345'
  )
  assert.equal(
    buildTjProductUrl('organic-bananas', '98765'),
    'https://www.traderjoes.com/home/products/pdp/organic-bananas-98765'
  )
})

test('parses optional store slug filter', () => {
  assert.deepEqual(
    [...parseStoreSlugFilter(' trader-joes-one, trader-joes-two ,, ')],
    ['trader-joes-one', 'trader-joes-two']
  )
})

test('validates numeric scraper config', () => {
  assert.equal(getConfig({ TJ_PAGE_SIZE: '50', TJ_MAX_PAGES: '4' }).pageSize, 50)
  assert.throws(() => getConfig({ TJ_PAGE_SIZE: '0' }), /TJ_PAGE_SIZE/)
})

test('normalizes a TJ product into a raw_scrapes insert row', () => {
  const row = normalizeProductRow(
    { storeId: 'store-1' },
    'run-1',
    {
      item_title: 'Organic Bananas',
      retail_price: '1.99',
      sales_size: '1',
      sales_uom_description: 'Each',
      primary_image: 'https://example.com/banana.jpg',
      url_key: 'organic-bananas',
      sku: '98765',
      availability: 1,
    }
  )

  assert.equal(row.store_id, 'store-1')
  assert.equal(row.scrape_run_id, 'run-1')
  assert.equal(row.provider_product_id, '98765')
  assert.equal(row.raw_price, 1.99)
  assert.equal(row.raw_unit, '1 Each')
  assert.equal(row.availability, '1')
  assert.equal(row.processing_status, 'pending')
})
