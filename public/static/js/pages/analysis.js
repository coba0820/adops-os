// ============================================================
// 実績分析画面
// v1.2では広告媒体CSV由来の指標を日付×媒体で表示する。
// 今後、媒体集計CSV・決済レポートCSVの列を同じテーブルへ追加する。
// ============================================================

const SUMMARY_CARDS = [
  { key: 'cost', label: '広告費', icon: 'fa-yen-sign', format: formatCurrency },
  { key: 'impressions', label: 'Imp', icon: 'fa-eye', format: formatInteger },
  { key: 'clicks', label: 'Click', icon: 'fa-arrow-pointer', format: formatInteger },
  { key: 'ctr', label: 'CTR', icon: 'fa-percent', format: formatPercent },
  { key: 'cpc', label: '平均CPC', icon: 'fa-hand-pointer', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: '平均CPM', icon: 'fa-gauge-high', format: formatCurrencyNoDecimal },
]

const METRIC_COLUMNS = [
  { key: 'cost', label: 'Cost', format: formatCurrency },
  { key: 'impressions', label: 'Imp', format: formatInteger },
  { key: 'clicks', label: 'Click', format: formatInteger },
  { key: 'ctr', label: 'CTR', format: formatPercent },
  { key: 'cpc', label: 'CPC', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: 'CPM', format: formatCurrencyNoDecimal },
]

/**
 * 実績分析画面を描画する
 * @param {HTMLElement} container #main-content 要素
 */
export async function renderAnalysisPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  const mediaList = await fetchMediaList()
  const state = {
    startDate: '',
    endDate: '',
    mediaId: '',
  }

  async function draw() {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-chart-line"></i>実績分析</div>
            <div class="card-subtitle">広告媒体CSVの実績を日付×媒体で集計</div>
          </div>
        </div>
        ${renderFilters(state, mediaList)}
      </div>

      <div id="analysis-result-root">
        <div class="card"><div class="empty-state">読み込み中...</div></div>
      </div>
    `

    bindFilterEvents(container, state, draw)
    await refreshAnalysis(container, state)
  }

  await draw()
}

async function refreshAnalysis(container, state) {
  const root = container.querySelector('#analysis-result-root')
  if (!root) return

  try {
    const params = new URLSearchParams()
    if (state.startDate) params.set('start_date', state.startDate)
    if (state.endDate) params.set('end_date', state.endDate)
    if (state.mediaId) params.set('media_id', state.mediaId)

    const url = `/api/analysis/summary${params.toString() ? `?${params.toString()}` : ''}`
    const res = await axios.get(url)
    const data = res.data.data

    root.innerHTML = `
      ${renderSummaryCards(data.summary)}
      ${renderAnalysisTable(data.summary, data.rows)}
    `
  } catch (err) {
    console.error(err)
    root.innerHTML = `<div class="card"><div class="empty-state">実績データの取得に失敗しました</div></div>`
  }
}

function renderFilters(state, mediaList) {
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${String(media.id) === state.mediaId ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')

  return `
    <div class="analysis-filter-bar">
      <div class="form-row">
        <label class="form-label">開始日</label>
        <input type="date" id="analysis-start-date" class="form-input" value="${escapeHtml(state.startDate)}" />
      </div>
      <div class="form-row">
        <label class="form-label">終了日</label>
        <input type="date" id="analysis-end-date" class="form-input" value="${escapeHtml(state.endDate)}" />
      </div>
      <div class="form-row">
        <label class="form-label">媒体</label>
        <select id="analysis-media-id" class="form-select">
          <option value="">すべて</option>
          ${mediaOptions}
        </select>
      </div>
      <div class="analysis-filter-actions">
        <button class="btn btn-primary" id="analysis-filter-apply">
          <i class="fa-solid fa-filter"></i>適用
        </button>
        <button class="btn btn-secondary" id="analysis-filter-reset">
          <i class="fa-solid fa-rotate-left"></i>リセット
        </button>
      </div>
    </div>
  `
}

function bindFilterEvents(container, state, redraw) {
  container.querySelector('#analysis-filter-apply')?.addEventListener('click', () => {
    state.startDate = container.querySelector('#analysis-start-date')?.value || ''
    state.endDate = container.querySelector('#analysis-end-date')?.value || ''
    state.mediaId = container.querySelector('#analysis-media-id')?.value || ''
    refreshAnalysis(container, state)
  })

  container.querySelector('#analysis-filter-reset')?.addEventListener('click', () => {
    state.startDate = ''
    state.endDate = ''
    state.mediaId = ''
    redraw()
  })
}

function renderSummaryCards(summary) {
  const cards = SUMMARY_CARDS.map(
    (card) => `
      <div class="analysis-summary-card">
        <div class="analysis-summary-label"><i class="fa-solid ${card.icon}"></i>${card.label}</div>
        <div class="analysis-summary-value">${card.format(summary[card.key] || 0)}</div>
      </div>
    `
  ).join('')

  return `
    <div class="card">
      <div class="analysis-summary-grid">
        ${cards}
      </div>
    </div>
  `
}

function renderAnalysisTable(summary, rows) {
  if (!rows || rows.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-table"></i>日別実績</div>
            <div class="card-subtitle">条件に一致する広告媒体CSV実績がありません</div>
          </div>
        </div>
        <div class="empty-state">データ取込画面から広告媒体CSVを取り込んでください</div>
      </div>
    `
  }

  const totalRow = renderTableRow({
    target_date: '合計',
    media_name: '-',
    ...summary,
  }, true)

  const bodyRows = rows.map((row) => renderTableRow(row, false)).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-table"></i>日別実績</div>
          <div class="card-subtitle">日付昇順・媒体名順</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table analysis-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>媒体</th>
              ${METRIC_COLUMNS.map((column) => `<th class="text-right">${column.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${totalRow}
            ${bodyRows}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderTableRow(row, isTotal) {
  return `
    <tr class="${isTotal ? 'analysis-total-row' : ''}">
      <td>${escapeHtml(row.target_date)}</td>
      <td>${escapeHtml(row.media_name || '-')}</td>
      ${METRIC_COLUMNS.map((column) => `<td class="text-right">${column.format(row[column.key] || 0)}</td>`).join('')}
    </tr>
  `
}

async function fetchMediaList() {
  try {
    const res = await axios.get('/api/media')
    return res.data.data || []
  } catch (err) {
    console.error(err)
    return []
  }
}

function formatCurrency(value) {
  return '¥' + Math.round(Number(value || 0)).toLocaleString('ja-JP')
}

function formatCurrencyNoDecimal(value) {
  return '¥' + Math.round(Number(value || 0)).toLocaleString('ja-JP')
}

function formatInteger(value) {
  return Math.round(Number(value || 0)).toLocaleString('ja-JP')
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
