// ============================================================
// ダッシュボード画面
// 毎朝「今日何をすればいいか」を確認する実データサマリー。
// ============================================================

const MONEY_KEYS = new Set(['cost', 'cpa', 'revenue'])
const INTEGER_KEYS = new Set(['registrations', 'payer_count'])
const RATE_KEYS = new Set(['recovery_rate'])

export async function renderDashboardPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  try {
    const { data } = (await axios.get('/api/dashboard/summary')).data
    const visibility = data.settings?.dashboard || {}

    container.innerHTML = `
      <div class="dashboard-stack">
        ${visibility.show_today_kpi !== false ? renderKpiSection(data.kpis) : ''}
        ${visibility.show_alerts !== false ? renderAlertsSection(data.alerts) : ''}
        ${visibility.show_forecast_summary !== false ? renderForecastSection(data.forecast_summary, data.days_remaining) : ''}
        ${visibility.show_monthly_summary !== false ? renderMonthlySummary(data.target_month, data.monthly_summary) : ''}
        ${visibility.show_monthly_progress !== false ? renderMonthlyProgress(data.monthly_progress) : ''}
        ${visibility.show_media_summary !== false ? renderEntitySummary('媒体別サマリー', '媒体名', data.media_summary) : ''}
        ${visibility.show_site_summary !== false ? renderEntitySummary('サイト別サマリー', 'サイト名', data.site_summary) : ''}
        ${visibility.show_csv_status !== false ? renderCsvStatus(data.data_status) : ''}
        ${visibility.show_todos !== false ? renderTodoSection(data.todos) : ''}
      </div>
    `

    bindDashboardEvents(container)
  } catch (err) {
    console.error(err)
    container.innerHTML = `<div class="card"><div class="empty-state">ダッシュボードデータの取得に失敗しました</div></div>`
  }
}

function renderKpiSection(kpis) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-gauge-high"></i>今日のKPI</div>
          <div class="card-subtitle">今日・昨日・前日比</div>
        </div>
      </div>
      <div class="dashboard-kpi-grid">
        ${kpis.map((item) => renderKpiBox(item)).join('')}
      </div>
    </div>
  `
}

function renderKpiBox(item) {
  const diffClass = kpiDiffClass(item)
  const icon = item.diff_rate === null ? 'fa-minus' : item.diff_rate >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'
  return `
    <button class="dashboard-kpi-box" data-route="${escapeHtml(item.route)}">
      <div class="kpi-label">${escapeHtml(item.label)}</div>
      <div class="kpi-value">${formatMetric(item.today, item.key)}</div>
      <div class="dashboard-kpi-sub">昨日 ${formatMetric(item.yesterday, item.key)}</div>
      <div class="kpi-diff ${diffClass}">
        <i class="fa-solid ${icon}"></i>
        ${formatDiffRate(item.diff_rate)} 前日比
      </div>
    </button>
  `
}

function kpiDiffClass(item) {
  if (!isNumber(item.diff_rate)) return 'neutral'
  const lowerIsGood = item.key === 'cost' || item.key === 'cpa'
  const isGood = lowerIsGood ? item.diff_rate <= 0 : item.diff_rate >= 0
  return isGood ? 'good' : 'bad'
}

function renderAlertsSection(alerts) {
  const iconMap = {
    critical: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  }
  const items = alerts.length === 0
    ? `<div class="empty-state">今すぐ対応が必要なアラートはありません</div>`
    : alerts.map((alert) => `
      <button class="alert-item level-${escapeHtml(alert.level)}" data-route="${escapeHtml(alert.route)}">
        <i class="fa-solid ${iconMap[alert.level] || 'fa-circle-info'} alert-icon"></i>
        <div>
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          <div class="alert-detail">${escapeHtml(alert.detail)}</div>
        </div>
      </button>
    `).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-bell"></i>要対応アラート</div>
          <div class="card-subtitle">最大5件を自動判定</div>
        </div>
      </div>
      <div class="dashboard-list">${items}</div>
    </div>
  `
}

function renderForecastSection(forecast, daysRemaining) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-chart-simple"></i>着地予測サマリー</div>
          <div class="card-subtitle">残り${daysRemaining}日の月末見込み</div>
        </div>
        <button class="btn btn-secondary" data-route="forecast">詳細を見る</button>
      </div>
      <div class="dashboard-forecast-grid">
        ${renderForecastMetric('広告費', 'cost', forecast.cost)}
        ${renderForecastMetric('登録数', 'registrations', forecast.registrations)}
        ${renderForecastMetric('CPA', 'cpa', forecast.cpa)}
      </div>
    </div>
  `
}

function renderForecastMetric(label, key, metric) {
  return `
    <div class="dashboard-forecast-card ${statusClass(metric.status)}">
      <div class="dashboard-section-label">${escapeHtml(label)}</div>
      <div class="dashboard-mini-row"><span>現在</span><strong>${formatMetric(metric.current, key)}</strong></div>
      <div class="dashboard-mini-row"><span>着地予測</span><strong>${formatMetric(metric.forecast, key)}</strong></div>
      <div class="dashboard-mini-row"><span>目標</span><strong>${formatMetric(metric.target, key)}</strong></div>
      <div class="dashboard-progress">
        <div class="dashboard-progress-head">
          <span>達成率</span>
          <strong>${formatPercent(metric.achievement_rate)}</strong>
        </div>
        <div class="dashboard-progress-track">
          <div class="dashboard-progress-fill ${statusClass(metric.status)}" style="width:${progressWidth(metric.achievement_rate)}%"></div>
        </div>
      </div>
    </div>
  `
}

function renderMonthlySummary(targetMonth, summary) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-calendar-days"></i>月間サマリー</div>
          <div class="card-subtitle">対象月 ${escapeHtml(targetMonth)}</div>
        </div>
      </div>
      <div class="dashboard-summary-grid">
        ${summary.map((item) => `
          <div class="dashboard-summary-item">
            <div class="dashboard-section-label">${escapeHtml(item.label)}</div>
            <div class="dashboard-mini-row"><span>実績</span><strong>${formatMetric(item.actual, item.key)}</strong></div>
            <div class="dashboard-mini-row"><span>目標</span><strong>${formatMetric(item.target, item.key)}</strong></div>
            <div class="dashboard-mini-row"><span>達成率</span><strong>${formatPercent(item.achievement_rate)}</strong></div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function renderMonthlyProgress(progress) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-bars-progress"></i>月間進捗</div>
          <div class="card-subtitle">広告費・登録数・CPAのみ</div>
        </div>
      </div>
      <div class="dashboard-progress-list">
        ${progress.map((item) => `
          <div class="dashboard-progress-item">
            <div class="dashboard-progress-head">
              <span>${escapeHtml(item.label)}</span>
              <strong>${formatMetric(item.current, item.key)} / ${formatMetric(item.target, item.key)}（${formatPercent(item.achievement_rate)}）</strong>
            </div>
            <div class="dashboard-progress-track">
              <div class="dashboard-progress-fill ${statusClass(item.status)}" style="width:${progressWidth(item.achievement_rate)}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function renderEntitySummary(title, nameLabel, rows) {
  const body = rows.length === 0
    ? `<tr><td colspan="7" class="text-center">表示できるデータがありません</td></tr>`
    : rows.map((row) => `
      <tr class="dashboard-entity-row level-${escapeHtml(row.judgement_level)}">
        <td>${escapeHtml(row.name)}</td>
        <td class="text-right">${formatCurrency(row.cost)}</td>
        <td class="text-right">${formatInteger(row.registrations)}</td>
        <td class="text-right">${formatCurrency(row.current_cpa)}</td>
        <td class="text-right">${formatCurrency(row.target_cpa)}</td>
        <td class="text-right">${formatCurrency(row.forecast_cpa)}</td>
        <td><span class="dashboard-judgement">${escapeHtml(row.judgement)}</span></td>
      </tr>
    `).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-table-list"></i>${escapeHtml(title)}</div>
          <div class="card-subtitle">広告費の多い順に全件表示</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table dashboard-summary-table">
          <thead>
            <tr>
              <th>${escapeHtml(nameLabel)}</th>
              <th>広告費</th>
              <th>登録数</th>
              <th>現在CPA</th>
              <th>目標CPA</th>
              <th>着地CPA</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `
}

function renderTodoSection(todos) {
  const items = todos.length === 0
    ? `<div class="empty-state">今日の自動タスクはありません</div>`
    : todos.map((todo) => `
      <button class="todo-item level-${escapeHtml(todo.level)}" data-route="${escapeHtml(todo.route)}">
        <span class="todo-checkbox"><i class="fa-solid fa-arrow-right"></i></span>
        <span>${escapeHtml(todo.text)}</span>
      </button>
    `).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-list-check"></i>今日やること</div>
          <div class="card-subtitle">アラートと媒体別状況から自動生成</div>
        </div>
      </div>
      <div class="todo-list">${items}</div>
    </div>
  `
}

function renderCsvStatus(status) {
  const items = [
    ['稼働中媒体', `${formatInteger(status?.active_media_count)}件`],
    ['広告媒体CSV未取込', `${formatInteger(status?.missing_ad_media_count)}件`],
    ['媒体集計CSV', status?.site_summary_uploaded_today ? '取込済' : '未取込'],
    ['決済レポートCSV', status?.payment_report_uploaded_today ? '取込済' : '未取込'],
  ]

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-file-circle-check"></i>CSV取込状況</div>
          <div class="card-subtitle">今日の取込対象の概要</div>
        </div>
        <button class="btn btn-secondary" data-route="data-import">詳細を見る</button>
      </div>
      <div class="dashboard-summary-grid">
        ${items.map(([label, value]) => `
          <div class="dashboard-summary-item">
            <div class="dashboard-section-label">${escapeHtml(label)}</div>
            <div class="kpi-value">${escapeHtml(value)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function bindDashboardEvents(container) {
  container.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', () => {
      const route = el.dataset.route
      if (route) window.location.hash = `#/${route}`
    })
  })
}

function formatMetric(value, key) {
  if (MONEY_KEYS.has(key)) return formatCurrency(value)
  if (INTEGER_KEYS.has(key)) return formatInteger(value)
  if (RATE_KEYS.has(key)) return formatPercent(value)
  return value === null || value === undefined ? '-' : String(value)
}

function formatCurrency(value) {
  if (!isNumber(value)) return '-'
  return `¥${Math.round(Number(value)).toLocaleString('ja-JP')}`
}

function formatInteger(value) {
  if (!isNumber(value)) return '-'
  return Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatPercent(value) {
  if (!isNumber(value)) return '-'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function formatDiffRate(value) {
  if (!isNumber(value)) return '-'
  return `${Math.abs(Number(value) * 100).toFixed(1)}%`
}

function progressWidth(value) {
  if (!isNumber(value)) return 0
  return Math.max(0, Math.min(100, Number(value) * 100))
}

function statusClass(status) {
  if (status === 'good') return 'good'
  if (status === 'bad') return 'bad'
  return 'neutral'
}

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
