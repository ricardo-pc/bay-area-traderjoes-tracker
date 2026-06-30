const state = {
  products: [],
}

const els = {
  status: document.querySelector('#refresh-status'),
  latestFinished: document.querySelector('#latest-finished'),
  kpiStores: document.querySelector('#kpi-stores'),
  kpiProducts: document.querySelector('#kpi-products'),
  kpiSkus: document.querySelector('#kpi-skus'),
  kpiAverage: document.querySelector('#kpi-average'),
  storeBars: document.querySelector('#store-bars'),
  priceDistribution: document.querySelector('#price-distribution'),
  productTable: document.querySelector('#product-table'),
  productSearch: document.querySelector('#product-search'),
  runList: document.querySelector('#run-list'),
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value ?? 0)
}

function formatMoney(value) {
  if (value === null || value === undefined) return '--'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value) {
  if (!value) return '--'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderKpis(data) {
  els.kpiStores.textContent = formatNumber(data.kpis.storesTracked)
  els.kpiProducts.textContent = formatNumber(data.kpis.currentProductRows)
  els.kpiSkus.textContent = formatNumber(data.kpis.distinctSkus)
  els.kpiAverage.textContent = formatMoney(data.kpis.avgPrice)
  els.latestFinished.textContent = `Updated ${formatDate(data.kpis.latestFinishedAt)}`
}

function renderStoreBars(stores) {
  const max = Math.max(...stores.map((store) => store.productRows), 1)
  els.storeBars.innerHTML = stores
    .map((store) => {
      const width = Math.max(3, Math.round((store.productRows / max) * 100))
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(store.name)}</div>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width: ${width}%"></div>
          </div>
          <div class="bar-value">${formatNumber(store.productRows)}</div>
        </div>
      `
    })
    .join('')
}

function renderDistribution(distribution) {
  const max = Math.max(...distribution.map((item) => item.count), 1)
  els.priceDistribution.innerHTML = distribution
    .map((item) => {
      const width = Math.max(2, Math.round((item.count / max) * 100))
      return `
        <div class="distribution-item">
          <div class="distribution-label">${escapeHtml(item.band)}</div>
          <div class="distribution-line" aria-hidden="true">
            <div class="distribution-fill" style="width: ${width}%"></div>
          </div>
          <div class="distribution-value">${formatNumber(item.count)}</div>
        </div>
      `
    })
    .join('')
}

function renderProducts(products) {
  const rows = products.slice(0, 150)
  if (rows.length === 0) {
    els.productTable.innerHTML = '<tr><td colspan="5">No products match the current search.</td></tr>'
    return
  }

  els.productTable.innerHTML = rows
    .map((product) => {
      const img = product.imageUrl
        ? `<img src="${escapeHtml(product.imageUrl)}" alt="">`
        : '<span class="product-placeholder" aria-hidden="true"></span>'
      const name = product.url
        ? `<a class="product-name" href="${escapeHtml(product.url)}" target="_blank" rel="noreferrer">${escapeHtml(product.name)}</a>`
        : `<span class="product-name">${escapeHtml(product.name)}</span>`

      return `
        <tr>
          <td>
            <div class="product-cell">
              ${img}
              <div>${name}</div>
            </div>
          </td>
          <td>${escapeHtml(product.store.name)}</td>
          <td>${escapeHtml(product.unit ?? '--')}</td>
          <td>${escapeHtml(product.sku ?? '--')}</td>
          <td class="numeric">${formatMoney(product.price)}</td>
        </tr>
      `
    })
    .join('')
}

function renderRuns(runs) {
  els.runList.innerHTML = runs
    .map((run) => {
      return `
        <div class="run-card">
          <div>
            <div class="run-title">${escapeHtml(run.store)}</div>
            <div class="muted">${formatDate(run.finishedAt ?? run.startedAt)}</div>
          </div>
          <span class="badge">${escapeHtml(run.status)}</span>
          <div class="muted">${formatNumber(run.rowsInserted)} rows / ${formatNumber(run.pagesFetched)} pages</div>
        </div>
      `
    })
    .join('')
}

function applySearch() {
  const query = els.productSearch.value.trim().toLowerCase()
  if (!query) {
    renderProducts(state.products)
    return
  }

  const filtered = state.products.filter((product) => {
    return [
      product.name,
      product.sku,
      product.unit,
      product.store?.name,
      product.store?.slug,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })

  renderProducts(filtered)
}

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard')
    if (!res.ok) throw new Error(`Dashboard API returned ${res.status}`)
    const data = await res.json()

    state.products = data.products ?? []
    renderKpis(data)
    renderStoreBars(data.storeSummaries ?? [])
    renderDistribution(data.priceDistribution ?? [])
    renderProducts(state.products)
    renderRuns(data.latestRuns ?? [])

    els.status.textContent = 'Live from Supabase'
  } catch (err) {
    console.error(err)
    els.status.textContent = 'Data error'
    els.status.classList.add('error')
    els.productTable.innerHTML = `<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`
  }
}

els.productSearch.addEventListener('input', applySearch)
loadDashboard()
