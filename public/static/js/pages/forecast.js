const METRIC_LABELS = {
  cost: '広告費',
  registrations: '登録数',
  cpa: 'CPA',
}

const MODE_LABELS = {
  current_month: '当月予測',
  past_month: '確定値',
  future_month: '未来月',
  no_actual: '実績なし',
}

const BASIS_LABELS = {
  latest_actual_date: '実績の最新日',
  today: '今日',
  full_month: '月末',
  future_month: '未来月',
  no_actual: '実績なし',
}

let forecastState = {
  targetMonth: getCurrentMonth(),
}

export async function renderForecastPage(container) {
  container.innerHTML = `<div class="card"><div class="empty-state">読み込み中...</div></div>`
  const settings = await fetchSettings()
  forecastState.targetMonth = getDefaultTargetMonth(settings.display?.default_target_month)

  async function draw() {
    try {
      const [year, month] = forecastState.targetMonth.split('-')
      const res = await axios.get(`/api/forecast?year=${year}&month=${Number(month)}`)
      const data = res.data.data
      container.innerHTML = `
        ${renderHeader(data)}
        ${renderOverall(data)}
        ${renderEntitySection('媒体別の着地予測', '媒体', data.media_forecasts, 'media')}
        ${renderEntitySection('サイト別の着地予測', 'サイト', data.site_forecasts, 'site')}
      `
      bindEvents(container, draw)
    } catch (err) {
      console.error(err)
      container.innerHTML = `<div class="card"><div class="empty-state">着地予測データの取得に失敗しました</div></div>`
    }
  }

  await draw()
}

function renderHeader(data) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-chart-simple"></i>着地予測</div>
          <div class="card-subtitle">現在進捗、着地予測、予算管理の目標を比較します</div>
        </div>
      </div>
      <div class="forecast-filter-bar">
        <div class="form-row">
          <label class="form-label">対象月</label>
          <input type="month" id="forecast-target-month" class="form-input" value="${escapeHtml(forecastState.targetMonth)}" />
        </div>
        <div class="forecast-filter-actions">
          <button class="btn btn-primary" id="forecast-apply"><i class="fa-solid fa-filter"></i>適用</button>
        </div>
        <div class="forecast-period-meta">
          <span>${escapeHtml(MODE_LABELS[data.mode] || data.mode)}</span>
          <span>${data.days_in_month}日中 ${data.elapsed_days}日経過</span>
          <span>基準: ${escapeHtml(BASIS_LABELS[data.elapsed_basis] || data.elapsed_basis)}</span>
          <span>最新実績日: ${escapeHtml(data.latest_actual_date || '-')}</span>
        </div>
      </div>
    </div>
  `
}

function renderOverall(data) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-layer-group"></i>全体の着地予測</div>
          <div class="card-subtitle">目標取得元: ${formatTargetSource(data.overall.target_source)}</div>
        </div>
      </div>
      <div class="forecast-metric-grid">
        ${renderMetricCard('cost', data.overall.cost)}
        ${renderMetricCard('registrations', data.overall.registrations)}
        ${renderMetricCard('cpa', data.overall.cpa)}
      </div>
    </div>
  `
}

function renderMetricCard(key, metric) {
  return `
    <div class="forecast-metric-card ${statusClass(metric.status)}">
      <div class="forecast-metric-title">${METRIC_LABELS[key]}</div>
      <div class="forecast-vertical-flow">
        ${renderVerticalValue('現在進捗', metric.current, key, metric.current_ratio)}
        ${renderProgressBar(metric.current_ratio, key, metric.target_missing)}
        ${renderVerticalValue('着地予測', metric.forecast, key, metric.forecast_ratio)}
        ${renderProgressBar(metric.forecast_ratio, key, metric.target_missing)}
        ${renderTargetValue(metric.target, key, metric.target_missing)}
      </div>
      <div class="forecast-diff-block ${statusClass(metric.status)}">
        <div class="forecast-diff-label">差分</div>
        <div class="forecast-diff-value">${formatMetric(metric.diff, key, true)}</div>
        <div class="forecast-judgement">${judgementText(key, metric)}</div>
      </div>
    </div>
  `
}

function renderVerticalValue(label, value, key, ratio) {
  return `
    <div class="forecast-vertical-row">
      <span>${label}</span>
      <strong>${formatMetricWithRatio(value, key, ratio)}</strong>
    </div>
  `
}

function renderTargetValue(value, key, targetMissing) {
  return `
    <div class="forecast-vertical-row forecast-target-row">
      <span>目標</span>
      <strong>${targetMissing ? '目標未設定' : formatMetric(value, key)}</strong>
    </div>
  `
}

function renderProgressBar(ratio, key, targetMissing) {
  const percent = isNumber(ratio) ? Number(ratio) * 100 : 0
  const width = Math.max(0, Math.min(100, percent))
  const tone = targetMissing ? 'neutral' : progressTone(key, ratio)
  const overClass = !targetMissing && isNumber(ratio) && Number(ratio) > 1 ? 'is-over' : ''

  return `
    <div class="forecast-progress-wrap">
      <div class="forecast-progress-meta">
        <span>進捗率</span>
        <span>${isNumber(ratio) ? `${Math.round(percent)}%` : '-'}</span>
      </div>
      <div class="forecast-progress-track ${overClass}">
        <div class="forecast-progress-fill forecast-progress-${tone}" style="width:${width}%"></div>
        <span class="forecast-progress-marker"></span>
      </div>
    </div>
  `
}

function renderEntitySection(title, nameLabel, rows, type) {
  const body = rows.length === 0
    ? `<tr><td colspan="10" class="text-center">表示できるデータがありません</td></tr>`
    : rows.map((row) => `
      <tr>
        <td>${escapeHtml(type === 'media' ? row.media_name : row.site_name)}</td>
        ${renderCompactMetricCells(row.cost, 'cost')}
        ${renderCompactMetricCells(row.registrations, 'registrations')}
        ${renderCompactMetricCells(row.cpa, 'cpa')}
      </tr>
    `).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-table"></i>${title}</div>
          <div class="card-subtitle">現在進捗 → 着地予測 → 目標 → 差分</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table forecast-table">
          <thead>
            <tr>
              <th>${nameLabel}</th>
              <th colspan="3">広告費</th>
              <th colspan="3">登録数</th>
              <th colspan="3">CPA</th>
            </tr>
            <tr>
              <th></th>
              <th>現在/予測</th><th>目標</th><th>差分</th>
              <th>現在/予測</th><th>目標</th><th>差分</th>
              <th>現在/予測</th><th>目標</th><th>差分</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `
}

function renderCompactMetricCells(metric, key) {
  return `
    <td>
      <div class="forecast-cell-main">${formatMetric(metric.current, key)}</div>
      <div class="forecast-cell-sub">${formatMetric(metric.forecast, key)} / ${formatRatio(metric.forecast_ratio)}</div>
    </td>
    <td>${metric.target_missing ? '目標未設定' : `${formatMetric(metric.target, key)} / 100%`}</td>
    <td class="${statusClass(metric.status)}">${formatMetric(metric.diff, key, true)}</td>
  `
}

function bindEvents(container, redraw) {
  container.querySelector('#forecast-apply')?.addEventListener('click', () => {
    forecastState.targetMonth = container.querySelector('#forecast-target-month')?.value || getCurrentMonth()
    redraw()
  })
}

function judgementText(key, metric) {
  if (metric.target_missing) return '目標未設定'
  if (metric.forecast === null || metric.forecast === undefined) return '予測なし'
  if (key === 'cost') return metric.status === 'good' ? '予算内見込' : '予算超過見込'
  if (key === 'registrations') return metric.status === 'good' ? '目標達成見込' : '目標未達見込'
  return metric.status === 'good' ? '目標以内' : '目標超過見込'
}

function statusClass(status) {
  if (status === 'good') return 'forecast-good'
  if (status === 'bad') return 'forecast-bad'
  return 'forecast-neutral'
}

function formatTargetSource(source) {
  if (source === 'overall') return '全体予算'
  if (source === 'media') return '媒体別予算の合計'
  if (source === 'site') return 'サイト別予算の合計'
  return '目標未設定'
}

function formatMetric(value, key, signed = false) {
  if (!isNumber(value)) return '-'
  const number = Number(value)
  const sign = signed && number > 0 ? '+' : ''
  if (key === 'registrations') return `${sign}${Math.round(number).toLocaleString('ja-JP')}件`
  return `${sign}¥${Math.round(number).toLocaleString('ja-JP')}`
}

function formatMetricWithRatio(value, key, ratio) {
  const formatted = formatMetric(value, key)
  if (!isNumber(value) || !isNumber(ratio)) return formatted
  return `${formatted}（${Math.round(Number(ratio) * 100)}%）`
}

function formatRatio(value) {
  if (!isNumber(value)) return '-'
  return `${Math.round(Number(value) * 100)}%`
}

function progressTone(key, ratio) {
  if (!isNumber(ratio)) return 'neutral'
  const numericRatio = Number(ratio)
  if (key === 'registrations') return numericRatio >= 1 ? 'good' : 'bad'
  return numericRatio > 1 ? 'bad' : 'good'
}

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

function getDefaultTargetMonth(mode = 'current') {
  const now = new Date()
  if (mode === 'previous') now.setMonth(now.getMonth() - 1)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
