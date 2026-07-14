const SUMMARY_CARDS = [
  { key: 'cost', label: '広告費', icon: 'fa-yen-sign', format: formatCurrency },
  { key: 'impressions', label: 'Imp', icon: 'fa-eye', format: formatInteger },
  { key: 'clicks', label: 'Click', icon: 'fa-arrow-pointer', format: formatInteger },
  { key: 'ctr', label: 'CTR', icon: 'fa-percent', format: formatPercent },
  { key: 'cpc', label: '平均CPC', icon: 'fa-hand-pointer', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: '平均CPM', icon: 'fa-gauge-high', format: formatCurrencyNoDecimal },
  { key: 'media_cv', label: '媒体CV', icon: 'fa-bullseye', format: formatInteger },
  { key: 'media_cpa', label: '媒体CPA', icon: 'fa-coins', format: formatCurrencyNoDecimal },
  { key: 'media_cvr', label: '媒体CVR', icon: 'fa-chart-simple', format: formatPercent },
  { key: 'access_count', label: 'アクセス', icon: 'fa-users-viewfinder', format: formatInteger },
  { key: 'registration_count', label: '登録', icon: 'fa-user-check', format: formatInteger },
  { key: 'provisional_registration_count', label: '仮登録', icon: 'fa-user-clock', format: formatInteger },
  { key: 'cpf', label: 'CPF', icon: 'fa-calculator', format: formatCurrencyNoDecimal },
  { key: 'cpa', label: 'CPA', icon: 'fa-receipt', format: formatCurrencyNoDecimal },
  { key: 'cvr', label: 'CVR', icon: 'fa-percent', format: formatPercent },
  { key: 'payer_count', label: '入金者数', icon: 'fa-user-plus', format: formatInteger },
  { key: 'revenue', label: '売上', icon: 'fa-sack-dollar', format: formatCurrency },
  { key: 'payment_rate', label: '入金率', icon: 'fa-circle-dollar-to-slot', format: formatPercent },
  { key: 'recovery_rate', label: '回収率', icon: 'fa-chart-pie', format: formatPercent },
]

const METRIC_COLUMNS = [
  { key: 'cost', label: 'Cost', format: formatCurrency },
  { key: 'impressions', label: 'Imp', format: formatInteger },
  { key: 'clicks', label: 'Click', format: formatInteger },
  { key: 'ctr', label: 'CTR', format: formatPercent },
  { key: 'cpc', label: 'CPC', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: 'CPM', format: formatCurrencyNoDecimal },
  { key: 'media_cv', label: '媒体CV', format: formatInteger },
  { key: 'media_cpa', label: '媒体CPA', format: formatCurrencyNoDecimal },
  { key: 'media_cvr', label: '媒体CVR', format: formatPercent },
  { key: 'access_count', label: 'アクセス', format: formatInteger },
  { key: 'registration_count', label: '登録', format: formatInteger },
  { key: 'provisional_registration_count', label: '仮登録', format: formatInteger },
  { key: 'cpf', label: 'CPF', format: formatCurrencyNoDecimal },
  { key: 'cpa', label: 'CPA', format: formatCurrencyNoDecimal },
  { key: 'cvr', label: 'CVR', format: formatPercent },
  { key: 'payer_count', label: '入金者数', format: formatInteger },
  { key: 'revenue', label: '売上', format: formatCurrency },
  { key: 'payment_rate', label: '入金率', format: formatPercent, totalOnly: true },
  { key: 'recovery_rate', label: '回収率', format: formatPercent, totalOnly: true },
]

const GROUP_LABELS = {
  daily: '日別',
  weekly: '週別',
  monthly: '月別',
}

export async function renderAnalysisPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  const mediaList = await fetchMediaList()
  const adCodeList = await fetchAdCodeList()
  const defaultDateRange = getDefaultDateRange()
  const state = {
    groupBy: 'daily',
    startDate: defaultDateRange.startDate,
    endDate: defaultDateRange.endDate,
    mediaId: '',
    adCode: '',
  }

  async function draw() {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-chart-line"></i>実績分析</div>
            <div class="card-subtitle">広告媒体CSVと媒体集計CSVの実績を期間別・媒体別・広告コード別に集計します</div>
          </div>
        </div>
        ${renderFilters(state, mediaList, adCodeList)}
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
    params.set('group_by', state.groupBy)
    if (state.startDate) params.set('start_date', state.startDate)
    if (state.endDate) params.set('end_date', state.endDate)
    if (state.mediaId) params.set('media_id', state.mediaId)
    if (state.adCode) params.set('ad_code', state.adCode)

    const url = `/api/analysis/summary${params.toString() ? `?${params.toString()}` : ''}`
    const res = await axios.get(url)
    const data = res.data.data

    root.innerHTML = `
      ${renderSummaryCards(data.summary)}
      ${renderAnalysisTable(data.summary, data.rows, state.groupBy)}
    `
  } catch (err) {
    console.error(err)
    root.innerHTML = `<div class="card"><div class="empty-state">実績データの取得に失敗しました</div></div>`
  }
}

function renderFilters(state, mediaList, adCodeList) {
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${String(media.id) === state.mediaId ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')
  const adCodeOptions = adCodeList
    .map((adCode) => `<option value="${escapeHtml(adCode)}" ${adCode === state.adCode ? 'selected' : ''}>${escapeHtml(adCode)}</option>`)
    .join('')

  return `
    <div class="analysis-filter-bar">
      <div class="form-row">
        <label class="form-label">集計単位</label>
        <select id="analysis-group-by" class="form-select">
          <option value="daily" ${state.groupBy === 'daily' ? 'selected' : ''}>日別</option>
          <option value="weekly" ${state.groupBy === 'weekly' ? 'selected' : ''}>週別</option>
          <option value="monthly" ${state.groupBy === 'monthly' ? 'selected' : ''}>月別</option>
        </select>
      </div>
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
      <div class="form-row">
        <label class="form-label">広告コード</label>
        <select id="analysis-ad-code" class="form-select">
          <option value="">すべて</option>
          ${adCodeOptions}
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
    state.groupBy = container.querySelector('#analysis-group-by')?.value || 'daily'
    state.startDate = container.querySelector('#analysis-start-date')?.value || ''
    state.endDate = container.querySelector('#analysis-end-date')?.value || ''
    state.mediaId = container.querySelector('#analysis-media-id')?.value || ''
    state.adCode = container.querySelector('#analysis-ad-code')?.value || ''
    refreshAnalysis(container, state)
  })

  container.querySelector('#analysis-filter-reset')?.addEventListener('click', () => {
    const defaultDateRange = getDefaultDateRange()
    state.groupBy = 'daily'
    state.startDate = defaultDateRange.startDate
    state.endDate = defaultDateRange.endDate
    state.mediaId = ''
    state.adCode = ''
    redraw()
  })
}

function renderSummaryCards(summary) {
  const cards = SUMMARY_CARDS.map(
    (card) => `
      <div class="analysis-summary-card">
        <div class="analysis-summary-label"><i class="fa-solid ${card.icon}"></i>${card.label}</div>
        <div class="analysis-summary-value">${card.format(summary?.[card.key])}</div>
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

function renderAnalysisTable(summary, rows, groupBy) {
  const groupLabel = GROUP_LABELS[groupBy] || GROUP_LABELS.daily

  if (!rows || rows.length === 0) {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-table"></i>${groupLabel}実績</div>
            <div class="card-subtitle">条件に一致する実績がありません</div>
          </div>
        </div>
        <div class="empty-state">データ取込画面からCSVを取込んでください</div>
      </div>
    `
  }

  const totalRow = renderTableRow({
    period: '合計',
    media_name: '-',
    ad_code: '-',
    ...summary,
  }, true, groupBy)

  const bodyRows = rows.map((row) => renderTableRow(row, false, groupBy)).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-table"></i>${groupLabel}実績</div>
          <div class="card-subtitle">期間昇順・媒体名順・広告コード順</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table analysis-table">
          <thead>
            <tr>
              <th>期間</th>
              <th>媒体</th>
              <th>広告コード</th>
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

function renderTableRow(row, isTotal, groupBy) {
  return `
    <tr class="${isTotal ? 'analysis-total-row' : ''}">
      <td>${escapeHtml(isTotal ? row.period : formatPeriod(row, groupBy))}</td>
      <td>${escapeHtml(isTotal ? '-' : row.media_name || '未設定')}</td>
      <td>${escapeHtml(isTotal ? '-' : row.ad_code || '未設定')}</td>
      ${METRIC_COLUMNS.map((column) => {
        const value = column.totalOnly && !isTotal ? null : row[column.key]
        return `<td class="text-right">${column.format(value)}</td>`
      }).join('')}
    </tr>
  `
}

function formatPeriod(row, groupBy) {
  if (groupBy === 'weekly') {
    return `${formatSlashDate(row.period_start)}〜${formatSlashDate(row.period_end)}`
  }
  if (groupBy === 'monthly') {
    const [year, month] = String(row.period_start || row.period || '').split('-')
    if (year && month) return `${year}年${Number(month)}月`
  }
  return formatSlashDate(row.period_start || row.period)
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

async function fetchAdCodeList() {
  try {
    const res = await axios.get('/api/campaign')
    const campaigns = res.data.data || []
    return [...new Set(
      campaigns
        .map((campaign) => String(campaign.ad_code || '').trim())
        .filter((adCode) => adCode !== '')
    )].sort((a, b) => a.localeCompare(b, 'ja'))
  } catch (err) {
    console.error(err)
    return []
  }
}

function isDisplayableNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 29)

  return {
    startDate: formatInputDate(start),
    endDate: formatInputDate(end),
  }
}

function formatInputDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCurrency(value) {
  if (!isDisplayableNumber(value)) return '-'
  return '¥' + Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatCurrencyNoDecimal(value) {
  if (!isDisplayableNumber(value)) return '-'
  return '¥' + Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatInteger(value) {
  if (!isDisplayableNumber(value)) return '-'
  return Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatPercent(value) {
  if (!isDisplayableNumber(value)) return '-'
  return `${(Number(value) * 100).toFixed(2)}%`
}

function formatSlashDate(value) {
  const [year, month, day] = String(value || '').split('-')
  if (!year || !month || !day) return String(value || '-')
  return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
