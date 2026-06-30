const TJ_API = 'https://www.traderjoes.com/api/graphql'
const TJ_PROVIDER = 'trader_joes'

const QUERY = `
  query SearchProducts(
    $pageSize: Int
    $currentPage: Int
    $storeCode: String
    $availability: String = "1"
    $published: String = "1"
  ) {
    products(
      filter: {
        store_code: { eq: $storeCode }
        availability: { match: $availability }
        published: { eq: $published }
      }
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      items {
        item_title
        retail_price
        sales_size
        sales_uom_code
        sales_uom_description
        primary_image
        url_key
        sku
        availability
      }
      page_info {
        current_page
        page_size
        total_pages
      }
      total_count
    }
  }
`

let debugPrinted = false

function loadDotEnvFile(filePath = '.env') {
  const fs = require('node:fs')
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    if (process.env[key] !== undefined) continue

    let value = match[2].trim()
    value = value.replace(/^['"]|['"]$/g, '')
    process.env[key] = value
  }
}

function normalizeSupabaseUrl(raw) {
  if (!raw) throw new Error('Missing SUPABASE_URL env var')

  let value = String(raw).trim()
  value = value.replace(/^['"]|['"]$/g, '').trim()
  value = value.replace(/\/+$/, '')

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(
      'Invalid SUPABASE_URL. Expected something like https://<project-ref>.supabase.co (no quotes).'
    )
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid SUPABASE_URL protocol. Expected https://...')
  }

  return value
}

function normalizeServiceKey(raw) {
  if (!raw) throw new Error('Missing SUPABASE_SERVICE_KEY env var')
  return String(raw).trim().replace(/^['"]|['"]$/g, '')
}

function parsePositiveInt(raw, fallback, name) {
  const value = parseInt(raw ?? String(fallback), 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function parseStoreSlugFilter(raw) {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

function getConfig(env = process.env) {
  return {
    availability: env.TJ_AVAILABILITY ?? '1',
    pageSize: parsePositiveInt(env.TJ_PAGE_SIZE, 100, 'TJ_PAGE_SIZE'),
    maxPages: parsePositiveInt(env.TJ_MAX_PAGES, 200, 'TJ_MAX_PAGES'),
    delayMs: parsePositiveInt(env.TJ_DELAY_MS, 750, 'TJ_DELAY_MS'),
    requestTimeoutMs: parsePositiveInt(
      env.TJ_REQUEST_TIMEOUT_MS,
      30000,
      'TJ_REQUEST_TIMEOUT_MS'
    ),
    storeSlugFilter: parseStoreSlugFilter(env.TJ_STORE_SLUGS),
    debug: env.DEBUG_TJ === '1',
  }
}

function createSupabaseClient(env = process.env) {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    normalizeSupabaseUrl(env.SUPABASE_URL),
    normalizeServiceKey(env.SUPABASE_SERVICE_KEY)
  )
}

function buildTjProductUrl(urlKey, sku) {
  if (!urlKey) return null
  const slug = String(urlKey).trim().replace(/\/+$/, '')
  if (!slug) return null
  if (!sku) return `https://www.traderjoes.com/home/products/pdp/${slug}`

  const skuStr = String(sku).trim()
  const hasSku = slug === skuStr || slug.endsWith(`-${skuStr}`) || slug.endsWith(`/${skuStr}`)
  const finalSlug = hasSku ? slug : `${slug}-${skuStr}`
  return `https://www.traderjoes.com/home/products/pdp/${finalSlug}`
}

function tjHeaders() {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'content-type': 'application/json',
    origin: 'https://www.traderjoes.com',
    referer: 'https://www.traderjoes.com/home/products',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  }
}

async function fetchCatalogPage(storeCode, currentPage, config) {
  const res = await fetch(TJ_API, {
    method: 'POST',
    headers: tjHeaders(),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
    body: JSON.stringify({
      operationName: 'SearchProducts',
      query: QUERY,
      variables: {
        storeCode,
        availability: config.availability,
        published: '1',
        pageSize: config.pageSize,
        currentPage,
      },
    }),
  })

  if (!res.ok) {
    let bodySnippet = ''
    try {
      const text = await res.text()
      bodySnippet = text ? ` Body: ${text.slice(0, 200)}` : ''
    } catch {
      // Keep the primary HTTP status error.
    }
    throw new Error(`TJ API error: ${res.status}.${bodySnippet}`)
  }

  let json
  try {
    json = await res.json()
  } catch (err) {
    throw new Error(`TJ API returned non-JSON: ${err?.message ?? err}`)
  }

  if (config.debug && !debugPrinted) {
    debugPrinted = true
    const snippet = JSON.stringify(json)
    console.log('TJ debug: first response snippet:', snippet.slice(0, 1500))
  }

  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    const first = json.errors[0]
    const msg = first?.message ?? 'Unknown GraphQL error'
    throw new Error(`TJ GraphQL error: ${msg}`)
  }

  if (!json?.data?.products) {
    throw new Error('TJ API response missing data.products')
  }

  return json.data.products
}

async function getTraderJoesStoreConfigs(supabase, config) {
  const { data, error } = await supabase
    .from('store_provider_ids')
    .select(
      'store_id, provider_store_code, stores!inner(id, slug, name, location_label, city, scrape_enabled)'
    )
    .eq('provider', TJ_PROVIDER)
    .eq('active', true)
    .eq('stores.scrape_enabled', true)

  if (error) {
    throw new Error(`Failed to load store_provider_ids for Trader Joe's: ${error.message}`)
  }

  const rows = data ?? []
  const filtered = config.storeSlugFilter.size
    ? rows.filter((row) => config.storeSlugFilter.has(row.stores?.slug))
    : rows

  if (filtered.length === 0) {
    throw new Error(
      'No active Trader Joe\'s stores found. Seed stores/store_provider_ids or check TJ_STORE_SLUGS.'
    )
  }

  return filtered.map((row) => {
    const store = row.stores
    return {
      storeId: row.store_id,
      storeCode: row.provider_store_code,
      storeSlug: store.slug,
      storeLabel: `${store.name} - ${store.location_label}${store.city ? `, ${store.city}` : ''}`,
    }
  })
}

async function createScrapeRun(supabase, storeId) {
  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({
      provider: TJ_PROVIDER,
      run_type: 'full_catalog',
      store_id: storeId,
      status: 'running',
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create scrape_run: ${error.message}`)
  return data.id
}

async function finalizeScrapeRun(supabase, runId, updates) {
  const payload = { ...updates, finished_at: new Date().toISOString() }
  const { error } = await supabase
    .from('scrape_runs')
    .update(payload)
    .eq('id', runId)

  if (error) throw new Error(`Failed to finalize scrape_run ${runId}: ${error.message}`)
}

function normalizeProductRow(config, runId, product) {
  if (product?.retail_price === undefined || product?.retail_price === null || !product?.item_title) {
    return null
  }

  const price = parseFloat(product.retail_price)
  if (!Number.isFinite(price)) return null

  const sku = product.sku ? String(product.sku) : null
  const unitParts = []
  if (product.sales_size) unitParts.push(String(product.sales_size).trim())
  if (product.sales_uom_description) unitParts.push(String(product.sales_uom_description).trim())
  else if (product.sales_uom_code) unitParts.push(String(product.sales_uom_code).trim())

  return {
    store_id: config.storeId,
    provider: TJ_PROVIDER,
    provider_product_id: sku,
    scrape_run_id: runId,
    raw_name: product.item_title,
    raw_price: price,
    raw_unit: unitParts.length ? unitParts.join(' ') : null,
    raw_url: buildTjProductUrl(product.url_key, sku),
    raw_image_url: product.primary_image ?? null,
    availability: product.availability === undefined || product.availability === null
      ? null
      : String(product.availability),
    raw_payload: product,
    processing_status: 'pending',
  }
}

async function scrapeStore(supabase, storeConfig, config) {
  const runId = await createScrapeRun(supabase, storeConfig.storeId)
  let totalInserted = 0
  let totalItemsSeen = 0
  let totalPages = null
  let pagesFetched = 0
  let duplicateSkusSkipped = 0
  const seenSkus = new Set()

  console.log(`Starting store ${storeConfig.storeLabel} (slug=${storeConfig.storeSlug}, code=${storeConfig.storeCode})`)

  try {
    for (let page = 1; page <= config.maxPages; page += 1) {
      console.log(
        `Requesting ${storeConfig.storeSlug} page ${page}${totalPages ? `/${totalPages}` : ''}...`
      )

      const products = await fetchCatalogPage(storeConfig.storeCode, page, config)
      const pageInfo = products.page_info ?? null
      const items = products.items ?? []

      if (pageInfo?.total_pages && typeof pageInfo.total_pages === 'number') {
        totalPages = pageInfo.total_pages
      }

      pagesFetched += 1
      totalItemsSeen += items.length
      console.log(`  Page ${page}: ${items.length} items`)

      if (page === 1 && items.length === 0) {
        throw new Error(
          'TJ returned 0 items on page 1. This usually means an invalid provider_store_code or API behavior change.'
        )
      }

      const rows = []
      for (const product of items) {
        const sku = product?.sku ? String(product.sku) : null
        if (sku && seenSkus.has(sku)) {
          duplicateSkusSkipped += 1
          continue
        }
        if (sku) seenSkus.add(sku)

        const row = normalizeProductRow(storeConfig, runId, product)
        if (row) rows.push(row)
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('raw_scrapes').insert(rows)
        if (error) throw new Error(`Insert error (page ${page}): ${error.message}`)
        totalInserted += rows.length
        console.log(`  Inserted ${rows.length} rows`)
      }

      if (totalPages && page >= totalPages) break
      await new Promise((resolve) => setTimeout(resolve, config.delayMs))
    }

    if (totalInserted === 0) {
      throw new Error(`No rows inserted. Total items seen: ${totalItemsSeen}.`)
    }

    const wasTruncated = totalPages && totalPages > config.maxPages
    await finalizeScrapeRun(supabase, runId, {
      status: wasTruncated ? 'partial' : 'success',
      pages_fetched: pagesFetched,
      rows_inserted: totalInserted,
      error_summary: wasTruncated
        ? `Truncated at TJ_MAX_PAGES=${config.maxPages} while total_pages=${totalPages}`
        : null,
    })

    console.log(
      `Finished ${storeConfig.storeSlug}: inserted ${totalInserted} rows (${pagesFetched} pages fetched, ${duplicateSkusSkipped} duplicate SKUs skipped)`
    )
  } catch (err) {
    await finalizeScrapeRun(supabase, runId, {
      status: 'failed',
      pages_fetched: pagesFetched,
      rows_inserted: totalInserted,
      error_summary: err.message?.slice(0, 500) ?? String(err),
    })
    throw err
  }
}

async function main() {
  loadDotEnvFile()
  const config = getConfig()
  const supabase = createSupabaseClient()

  console.log('Starting Trader Joe\'s Bay Area multi-store scrape...')
  const storeConfigs = await getTraderJoesStoreConfigs(supabase, config)
  console.log(`Found ${storeConfigs.length} Trader Joe's stores configured`)

  const failures = []
  for (const storeConfig of storeConfigs) {
    try {
      await scrapeStore(supabase, storeConfig, config)
    } catch (err) {
      const message = err.message ?? String(err)
      console.error(`Store ${storeConfig.storeSlug} failed: ${message}`)
      failures.push(`${storeConfig.storeSlug}: ${message}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Some stores failed (${failures.length}): ${failures.join(' | ')}`)
  }

  console.log('Done - all configured Trader Joe\'s stores scraped successfully')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  TJ_PROVIDER,
  buildTjProductUrl,
  getConfig,
  loadDotEnvFile,
  normalizeProductRow,
  normalizeServiceKey,
  normalizeSupabaseUrl,
  parseStoreSlugFilter,
}
