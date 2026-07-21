const SUMMARY_CARDS = [
  { key: 'cost', label: '蠎・相雋ｻ', icon: 'fa-yen-sign', format: formatCurrency },
  { key: 'impressions', label: 'Imp', icon: 'fa-eye', format: formatInteger },
  { key: 'clicks', label: 'Click', icon: 'fa-arrow-pointer', format: formatInteger },
  { key: 'ctr', label: 'CTR', icon: 'fa-percent', format: formatPercent },
  { key: 'cpc', label: '蟷ｳ蝮④PC', icon: 'fa-hand-pointer', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: '蟷ｳ蝮④PM', icon: 'fa-gauge-high', format: formatCurrencyNoDecimal },
  { key: 'media_cv', label: '蟐剃ｽ鼎V', icon: 'fa-bullseye', format: formatInteger },
  { key: 'media_cpa', label: '蟐剃ｽ鼎PA', icon: 'fa-coins', format: formatCurrencyNoDecimal },
  { key: 'media_cvr', label: '蟐剃ｽ鼎VR', icon: 'fa-chart-simple', format: formatPercent },
  { key: 'access_count', label: '繧｢繧ｯ繧ｻ繧ｹ', icon: 'fa-users-viewfinder', format: formatInteger },
  { key: 'registration_count', label: '逋ｻ骭ｲ', icon: 'fa-user-check', format: formatInteger },
  { key: 'provisional_registration_count', label: '莉ｮ逋ｻ骭ｲ', icon: 'fa-user-clock', format: formatInteger },
  { key: 'cpf', label: 'CPF', icon: 'fa-calculator', format: formatCurrencyNoDecimal },
  { key: 'cpa', label: 'CPA', icon: 'fa-receipt', format: formatCurrencyNoDecimal },
  { key: 'cvr', label: 'CVR', icon: 'fa-percent', format: formatPercent },
  { key: 'payer_count', label: '蜈･驥題・焚', icon: 'fa-user-plus', format: formatInteger },
  { key: 'revenue', label: '螢ｲ荳・, icon: 'fa-sack-dollar', format: formatCurrency },
  { key: 'payment_rate', label: '蜈･驥醍紫', icon: 'fa-circle-dollar-to-slot', format: formatPercent },
  { key: 'recovery_rate', label: '蝗槫庶邇・, icon: 'fa-chart-pie', format: formatPercent },
]

const METRIC_COLUMNS = [
  { key: 'cost', label: 'Cost', format: formatCurrency },
  { key: 'impressions', label: 'Imp', format: formatInteger },
  { key: 'clicks', label: 'Click', format: formatInteger },
  { key: 'ctr', label: 'CTR', format: formatPercent },
  { key: 'cpc', label: 'CPC', format: formatCurrencyNoDecimal },
  { key: 'cpm', label: 'CPM', format: formatCurrencyNoDecimal },
  { key: 'media_cv', label: '蟐剃ｽ鼎V', format: formatInteger },
  { key: 'media_cpa', label: '蟐剃ｽ鼎PA', format: formatCurrencyNoDecimal },
  { key: 'media_cvr', label: '蟐剃ｽ鼎VR', format: formatPercent },
  { key: 'access_count', label: '繧｢繧ｯ繧ｻ繧ｹ', format: formatInteger },
  { key: 'registration_count', label: '逋ｻ骭ｲ', format: formatInteger },
  { key: 'provisional_registration_count', label: '莉ｮ逋ｻ骭ｲ', format: formatInteger },
  { key: 'cpf', label: 'CPF', format: formatCurrencyNoDecimal },
  { key: 'cpa', label: 'CPA', format: formatCurrencyNoDecimal },
  { key: 'cvr', label: 'CVR', format: formatPercent },
  { key: 'payer_count', label: '蜈･驥題・焚', format: formatInteger },
  { key: 'revenue', label: '螢ｲ荳・, format: formatCurrency },
  { key: 'payment_rate', label: '蜈･驥醍紫', format: formatPercent, totalOnly: true },
  { key: 'recovery_rate', label: '蝗槫庶邇・, format: formatPercent, totalOnly: true },
]

const GROUP_LABELS = {
  daily: '譌･蛻･',
  weekly: '騾ｱ蛻･',
  monthly: '譛亥挨',
}

let analysisDisplaySettings = {
  default_group_by: 'daily',
  default_target_month: 'current',
  money_decimal_digits: 0,
  percent_decimal_digits: 1,
  count_decimal_digits: 0,
}

export async function renderAnalysisPage(container) {
  container.innerHTML = `<div class="empty-state">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</div>`

  const [mediaList, campaignGroupList, settings] = await Promise.all([
    fetchMediaList(),
    fetchCampaignGroupList(),
    fetchSettings(),
  ])
  analysisDisplaySettings = { ...analysisDisplaySettings, ...settings.display }
  const defaultDateRange = getDefaultDateRange(analysisDisplaySettings.default_target_month)
  const state = {
    groupBy: analysisDisplaySettings.default_group_by || 'daily',
    startDate: defaultDateRange.startDate,
    endDate: defaultDateRange.endDate,
    mediaId: '',
    campaignGroupId: '',
  }

  async function draw() {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-chart-line"></i>螳溽ｸｾ蛻・梵</div>
            <div class="card-subtitle">蠎・相蟐剃ｽ鼎SV縺ｨ蟐剃ｽ馴寔險・SV縺ｮ螳溽ｸｾ繧呈悄髢灘挨繝ｻ蟐剃ｽ灘挨繝ｻ蠎・相繧ｳ繝ｼ繝牙挨縺ｫ髮・ｨ医＠縺ｾ縺・/div>
          </div>
        </div>
        ${renderFilters(state, mediaList, campaignGroupList)}
      </div>

      <div id="analysis-result-root">
        <div class="card"><div class="empty-state">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</div></div>
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
    if (state.campaignGroupId) params.set('campaign_group_id', state.campaignGroupId)

    const url = `/api/analysis/summary${params.toString() ? `?${params.toString()}` : ''}`
    const res = await axios.get(url)
    const data = res.data.data

    root.innerHTML = `
      ${renderSummaryCards(data.summary)}
      ${renderAnalysisTable(data.summary, data.rows, state.groupBy)}
    `
  } catch (err) {
    console.error(err)
    root.innerHTML = `<div class="card"><div class="empty-state">螳溽ｸｾ繝・・繧ｿ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆</div></div>`
  }
}

function renderFilters(state, mediaList, campaignGroupList) {
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${String(media.id) === state.mediaId ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')
  const campaignGroupOptions = campaignGroupList
    .filter((group) => !state.mediaId || String(group.media_id) === state.mediaId)
    .map((group) => `<option value="${group.id}" ${String(group.id) === state.campaignGroupId ? 'selected' : ''}>${escapeHtml(group.group_name)}</option>`)
    .join('')

  return `
    <div class="analysis-filter-bar">
      <div class="form-row">
        <label class="form-label">髮・ｨ亥腰菴・/label>
        <select id="analysis-group-by" class="form-select">
          <option value="daily" ${state.groupBy === 'daily' ? 'selected' : ''}>譌･蛻･</option>
          <option value="weekly" ${state.groupBy === 'weekly' ? 'selected' : ''}>騾ｱ蛻･</option>
          <option value="monthly" ${state.groupBy === 'monthly' ? 'selected' : ''}>譛亥挨</option>
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">髢句ｧ区律</label>
        <input type="date" id="analysis-start-date" class="form-input" value="${escapeHtml(state.startDate)}" />
      </div>
      <div class="form-row">
        <label class="form-label">邨ゆｺ・律</label>
        <input type="date" id="analysis-end-date" class="form-input" value="${escapeHtml(state.endDate)}" />
      </div>
      <div class="form-row">
        <label class="form-label">蟐剃ｽ・/label>
        <select id="analysis-media-id" class="form-select">
          <option value="">縺吶∋縺ｦ</option>
          ${mediaOptions}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">キャンペーングループ</label>
        <select id="analysis-campaign-group-id" class="form-select">
          <option value="">縺吶∋縺ｦ</option>
          ${campaignGroupOptions}
        </select>
      </div>
      <div class="analysis-filter-actions">
        <button class="btn btn-primary" id="analysis-filter-apply">
          <i class="fa-solid fa-filter"></i>驕ｩ逕ｨ
        </button>
        <button class="btn btn-secondary" id="analysis-filter-reset">
          <i class="fa-solid fa-rotate-left"></i>繝ｪ繧ｻ繝・ヨ
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
    state.campaignGroupId = container.querySelector('#analysis-campaign-group-id')?.value || ''
    refreshAnalysis(container, state)
  })

  container.querySelector('#analysis-filter-reset')?.addEventListener('click', () => {
    const defaultDateRange = getDefaultDateRange(analysisDisplaySettings.default_target_month)
    state.groupBy = analysisDisplaySettings.default_group_by || 'daily'
    state.startDate = defaultDateRange.startDate
    state.endDate = defaultDateRange.endDate
    state.mediaId = ''
    state.campaignGroupId = ''
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
            <div class="card-title"><i class="fa-solid fa-table"></i>${groupLabel}螳溽ｸｾ</div>
            <div class="card-subtitle">譚｡莉ｶ縺ｫ荳閾ｴ縺吶ｋ螳溽ｸｾ縺後≠繧翫∪縺帙ｓ</div>
          </div>
        </div>
        <div class="empty-state">繝・・繧ｿ蜿冶ｾｼ逕ｻ髱｢縺九ｉCSV繧貞叙霎ｼ繧薙〒縺上□縺輔＞</div>
      </div>
    `
  }

  const totalRow = renderTableRow({
    period: '蜷郁ｨ・,
    media_name: '-',
    campaign_group_name: '-',
    ...summary,
  }, true, groupBy)

  const bodyRows = rows.map((row) => renderTableRow(row, false, groupBy)).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-table"></i>${groupLabel}螳溽ｸｾ</div>
          <div class="card-subtitle">譛滄俣譏・・・蟐剃ｽ灘錐鬆・・蠎・相繧ｳ繝ｼ繝蛾・/div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table analysis-table">
          <thead>
            <tr>
              <th>譛滄俣</th>
              <th>蟐剃ｽ・/th>
              <th>キャンペーングループ</th>
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
      <td>${escapeHtml(isTotal ? '-' : row.media_name || '譛ｪ險ｭ螳・)}</td>
      <td>${escapeHtml(isTotal ? '-' : row.campaign_group_name || '譛ｪ險ｭ螳・)}</td>
      ${METRIC_COLUMNS.map((column) => {
        const value = column.totalOnly && !isTotal ? null : row[column.key]
        return `<td class="text-right">${column.format(value)}</td>`
      }).join('')}
    </tr>
  `
}

function formatPeriod(row, groupBy) {
  if (groupBy === 'weekly') {
    return `${formatSlashDate(row.period_start)}縲・{formatSlashDate(row.period_end)}`
  }
  if (groupBy === 'monthly') {
    const [year, month] = String(row.period_start || row.period || '').split('-')
    if (year && month) return `${year}蟷ｴ${Number(month)}譛・
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

async function fetchCampaignGroupList() {
  try {
    const res = await axios.get('/api/campaign-groups')
    return res.data.data || []
  } catch (err) {
    console.error(err)
    return []
  }
}

async function fetchSettings() {
  try {
    const res = await axios.get('/api/settings')
    return res.data.data?.settings || {}
  } catch (err) {
    console.error(err)
    return {}
  }
}

function isDisplayableNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function getDefaultDateRange(defaultTargetMonth = 'current') {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + (defaultTargetMonth === 'previous' ? -1 : 0), 1)
  const start = new Date(target.getFullYear(), target.getMonth(), 1)
  const end = new Date(target.getFullYear(), target.getMonth() + 1, 0)

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
  return 'ﾂ･' + Number(value).toLocaleString('ja-JP', {
    minimumFractionDigits: analysisDisplaySettings.money_decimal_digits,
    maximumFractionDigits: analysisDisplaySettings.money_decimal_digits,
  })
}

function formatCurrencyNoDecimal(value) {
  if (!isDisplayableNumber(value)) return '-'
  return 'ﾂ･' + Number(value).toLocaleString('ja-JP', {
    minimumFractionDigits: analysisDisplaySettings.money_decimal_digits,
    maximumFractionDigits: analysisDisplaySettings.money_decimal_digits,
  })
}

function formatInteger(value) {
  if (!isDisplayableNumber(value)) return '-'
  return Number(value).toLocaleString('ja-JP', {
    minimumFractionDigits: analysisDisplaySettings.count_decimal_digits,
    maximumFractionDigits: analysisDisplaySettings.count_decimal_digits,
  })
}

function formatPercent(value) {
  if (!isDisplayableNumber(value)) return '-'
  return `${(Number(value) * 100).toFixed(analysisDisplaySettings.percent_decimal_digits)}%`
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

