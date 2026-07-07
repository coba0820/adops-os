// ============================================================
// ダッシュボード画面
// 「朝5分で意思決定を終わらせる」ための4カード構成。
// v1では /api/dashboard/summary からダミーデータを取得して表示する。
// ============================================================

/**
 * 金額を「¥1,234,567」形式にフォーマットする
 */
function formatCurrency(value) {
  return '¥' + value.toLocaleString('ja-JP')
}

/**
 * 差分(%)を「+8.2%」「-3.1%」形式にフォーマットする
 */
function formatDiff(value) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

/**
 * 要対応アラートカードのHTMLを生成
 */
function renderAlertsCard(alerts) {
  const iconMap = {
    critical: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  }

  const itemsHtml = alerts
    .map(
      (a) => `
      <div class="alert-item level-${a.level}">
        <i class="fa-solid ${iconMap[a.level] || 'fa-circle-info'} alert-icon"></i>
        <div>
          <div class="alert-title">${a.title}</div>
          <div class="alert-detail">${a.detail}</div>
        </div>
      </div>
    `
    )
    .join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-bell"></i>要対応アラート</div>
          <div class="card-subtitle">今すぐ確認が必要な項目</div>
        </div>
      </div>
      ${itemsHtml}
    </div>
  `
}

/**
 * 今日のKPIカードのHTMLを生成
 */
function renderKpiCard(kpi) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-gauge-high"></i>今日のKPI</div>
          <div class="card-subtitle">前日比較（ダミーデータ）</div>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">広告費</div>
          <div class="kpi-value">${formatCurrency(kpi.spend)}</div>
          <div class="kpi-diff ${kpi.spend_diff_pct >= 0 ? 'up' : 'down'}">${formatDiff(kpi.spend_diff_pct)} 前日比</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">CV数</div>
          <div class="kpi-value">${kpi.conversions.toLocaleString('ja-JP')}</div>
          <div class="kpi-diff ${kpi.conversions_diff_pct >= 0 ? 'up' : 'down'}">${formatDiff(kpi.conversions_diff_pct)} 前日比</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">CPA</div>
          <div class="kpi-value">${formatCurrency(kpi.cpa)}</div>
          <div class="kpi-diff ${kpi.cpa_diff_pct >= 0 ? 'up' : 'down'}">${formatDiff(kpi.cpa_diff_pct)} 前日比</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">売上</div>
          <div class="kpi-value">${formatCurrency(kpi.revenue)}</div>
          <div class="kpi-diff ${kpi.revenue_diff_pct >= 0 ? 'up' : 'down'}">${formatDiff(kpi.revenue_diff_pct)} 前日比</div>
        </div>
      </div>
    </div>
  `
}

/**
 * 月末着地予測カードのHTMLを生成
 */
function renderForecastCard(forecast) {
  const pct = Math.min(100, Math.round((forecast.forecast_spend / forecast.budget) * 100))
  const isOver = forecast.status === 'over'

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-chart-simple"></i>月末着地予測</div>
          <div class="card-subtitle">残り${forecast.days_remaining}日の予算消化予測</div>
        </div>
      </div>
      <div class="forecast-meta">
        <span>予算 ${formatCurrency(forecast.budget)}</span>
        <span>予測 ${formatCurrency(forecast.forecast_spend)}</span>
      </div>
      <div class="forecast-bar-track">
        <div class="forecast-bar-fill ${isOver ? 'over' : ''}" style="width: ${pct}%"></div>
      </div>
      <div class="forecast-status ${isOver ? 'over' : ''}">
        <i class="fa-solid ${isOver ? 'fa-arrow-trend-up' : 'fa-check'}"></i>
        このままだと予算比 ${formatDiff(forecast.forecast_diff_pct)} で着地予測
      </div>
    </div>
  `
}

/**
 * 今日やることカードのHTMLを生成
 */
function renderTodoCard(todos) {
  const itemsHtml = todos
    .map(
      (t) => `
      <div class="todo-item ${t.done ? 'done' : ''}">
        <span class="todo-checkbox">${t.done ? '<i class="fa-solid fa-check"></i>' : ''}</span>
        <span>${t.text}</span>
      </div>
    `
    )
    .join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-list-check"></i>今日やること</div>
          <div class="card-subtitle">意思決定に必要なアクション</div>
        </div>
      </div>
      <div class="todo-list">
        ${itemsHtml}
      </div>
    </div>
  `
}

/**
 * ダッシュボード画面全体を描画する
 * @param {HTMLElement} container #main-content 要素
 */
export async function renderDashboardPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  try {
    const { data } = (await axios.get('/api/dashboard/summary')).data

    container.innerHTML = `
      <div class="dashboard-grid">
        ${renderAlertsCard(data.alerts)}
        ${renderKpiCard(data.kpi)}
        ${renderForecastCard(data.forecast)}
        ${renderTodoCard(data.todo)}
      </div>
    `
  } catch (err) {
    console.error(err)
    container.innerHTML = `<div class="card"><div class="empty-state">ダッシュボードデータの取得に失敗しました</div></div>`
  }
}
