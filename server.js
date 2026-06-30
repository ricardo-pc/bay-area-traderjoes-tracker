const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')
const { loadDotEnvFile, normalizeServiceKey, normalizeSupabaseUrl } = require('./scripts/scrapers/traderjoes')

loadDotEnvFile()

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const PUBLIC_DIR = path.join(__dirname, 'public')
const PAGE_SIZE = 1000

const supabase = createClient(
  normalizeSupabaseUrl(process.env.SUPABASE_URL),
  normalizeServiceKey(process.env.SUPABASE_SERVICE_KEY)
)

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
])

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function parseStore(row) {
  const store = Array.isArray(row.stores) ? row.stores[0] : row.stores
  return store ?? {}
}

function displayStoreName(store) {
  const parts = [store.location_label, store.city].filter(Boolean)
  return parts.length ? parts.join(', ') : store.slug ?? 'Unknown store'
}

function normalizeImageUrl(raw) {
  if (!raw) return null
  if (String(raw).startsWith('http')) return raw
  if (String(raw).startsWith('/')) return `https://www.traderjoes.com${raw}`
  return raw
}

function roundMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function priceBand(price) {
  if (price < 3) return 'Under $3'
  if (price < 5) return '$3-$4.99'
  if (price < 8) return '$5-$7.99'
  if (price < 12) return '$8-$11.99'
  return '$12+'
}

async function fetchAllRawRows(runIds) {
  const rows = []
  let from = 0

  while (true) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('raw_scrapes')
      .select(
        'id,store_id,provider_product_id,raw_name,raw_price,raw_unit,raw_url,raw_image_url,availability,scraped_at,scrape_run_id,stores!inner(slug,location_label,city)'
      )
      .in('scrape_run_id', runIds)
      .order('raw_name', { ascending: true })
      .range(from, to)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

async function buildDashboardPayload() {
  const { data: runs, error: runsError } = await supabase
    .from('scrape_runs')
    .select('id,store_id,status,pages_fetched,rows_inserted,started_at,finished_at,stores!inner(slug,location_label,city)')
    .order('started_at', { ascending: false })
    .limit(60)

  if (runsError) throw runsError

  const latestByStore = new Map()
  for (const run of runs ?? []) {
    if (run.status !== 'success') continue
    if (!latestByStore.has(run.store_id)) latestByStore.set(run.store_id, run)
  }

  const latestRuns = [...latestByStore.values()]
  const latestRunIds = latestRuns.map((run) => run.id)
  const rawRows = latestRunIds.length ? await fetchAllRawRows(latestRunIds) : []

  const storeSummaries = latestRuns
    .map((run) => {
      const store = parseStore(run)
      return {
        id: run.store_id,
        slug: store.slug,
        name: displayStoreName(store),
        status: run.status,
        pagesFetched: run.pages_fetched,
        productRows: run.rows_inserted,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const productRows = rawRows.map((row) => {
    const store = parseStore(row)
    return {
      id: row.id,
      sku: row.provider_product_id,
      name: row.raw_name,
      price: roundMoney(row.raw_price),
      unit: row.raw_unit,
      url: row.raw_url,
      imageUrl: normalizeImageUrl(row.raw_image_url),
      availability: row.availability,
      scrapedAt: row.scraped_at,
      store: {
        slug: store.slug,
        name: displayStoreName(store),
      },
    }
  })

  const latestProductBySku = new Map()
  for (const row of productRows) {
    if (!row.sku) continue
    const key = `${row.sku}|${row.store.slug}`
    if (!latestProductBySku.has(key)) latestProductBySku.set(key, row)
  }

  const currentProducts = [...latestProductBySku.values()].sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name)
    return a.store.name.localeCompare(b.store.name)
  })

  const prices = currentProducts.map((row) => row.price).filter((price) => Number.isFinite(price))
  const avgPrice = prices.length
    ? roundMoney(prices.reduce((sum, price) => sum + price, 0) / prices.length)
    : null
  const maxPrice = prices.length ? Math.max(...prices) : null
  const minPrice = prices.length ? Math.min(...prices) : null

  const bandOrder = ['Under $3', '$3-$4.99', '$5-$7.99', '$8-$11.99', '$12+']
  const bands = new Map(bandOrder.map((band) => [band, 0]))
  for (const price of prices) bands.set(priceBand(price), (bands.get(priceBand(price)) ?? 0) + 1)

  const mostRecentRun = [...latestRuns].sort(
    (a, b) => new Date(b.finished_at ?? b.started_at).getTime() - new Date(a.finished_at ?? a.started_at).getTime()
  )[0]

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      storesTracked: latestRuns.length,
      currentProductRows: currentProducts.length,
      distinctSkus: new Set(currentProducts.map((row) => row.sku).filter(Boolean)).size,
      avgPrice,
      minPrice,
      maxPrice,
      latestFinishedAt: mostRecentRun?.finished_at ?? mostRecentRun?.started_at ?? null,
    },
    storeSummaries,
    priceDistribution: bandOrder.map((band) => ({ band, count: bands.get(band) ?? 0 })),
    latestRuns: (runs ?? []).slice(0, 12).map((run) => {
      const store = parseStore(run)
      return {
        id: run.id,
        store: displayStoreName(store),
        status: run.status,
        pagesFetched: run.pages_fetched,
        rowsInserted: run.rows_inserted,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
      }
    }),
    products: currentProducts,
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(PUBLIC_DIR, safePath)

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const body = await fs.readFile(filePath)
    const ext = path.extname(filePath)
    res.writeHead(200, {
      'content-type': contentTypes.get(ext) ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    })
    res.end(body)
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    throw err
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname === '/api/dashboard') {
      const payload = await buildDashboardPayload()
      sendJson(res, 200, payload)
      return
    }

    await serveStatic(req, res)
  } catch (err) {
    console.error(err)
    sendJson(res, 500, { error: err.message ?? 'Unexpected server error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on http://localhost:${PORT}`)
})
