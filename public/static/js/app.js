import { renderSidebar } from './components/sidebar.js'

const ROUTES = {
  dashboard: { title: 'ダッシュボード', load: () => import('./pages/dashboard.js').then((m) => m.renderDashboardPage) },
  'data-import': { title: 'データ取込', load: () => import('./pages/data-import.js').then((m) => m.renderDataImportPage) },
  master: { title: 'マスタ管理', load: () => import('./pages/master.js').then((m) => m.renderMasterPage) },
  analysis: { title: '実績分析', load: () => import('./pages/analysis.js').then((m) => m.renderAnalysisPage) },
  budget: { title: '予算管理', load: () => import('./pages/budget.js').then((m) => m.renderBudgetPage) },
  forecast: { title: '着地予測', load: () => import('./pages/forecast.js').then((m) => m.renderForecastPage) },
  settings: { title: '設定', load: () => import('./pages/settings.js').then((m) => m.renderSettingsPage) },
}

const DEFAULT_ROUTE = 'dashboard'

async function handleRouteChange() {
  const hash = window.location.hash.replace('#/', '') || DEFAULT_ROUTE
  const route = ROUTES[hash] || ROUTES[DEFAULT_ROUTE]
  const routeKey = ROUTES[hash] ? hash : DEFAULT_ROUTE

  const pageTitleEl = document.getElementById('page-title')
  if (pageTitleEl) pageTitleEl.textContent = route.title

  renderSidebar(routeKey)

  const mainContent = document.getElementById('main-content')
  if (!mainContent) return

  mainContent.innerHTML = ''

  try {
    const render = await route.load()
    await render(mainContent)
  } catch (err) {
    renderRouteError(mainContent, route.title, err)
  }
}

function renderRouteError(container, title, err) {
  console.error(`[app] failed to render ${title}`, err)
  container.innerHTML = `
    <div class="card">
      <div class="empty-state">画面の表示中にエラーが発生しました。時間をおいて再読み込みしてください。</div>
    </div>
  `
}

function updateHeaderDate() {
  const dateEl = document.getElementById('header-date')
  if (!dateEl) return

  const now = new Date()
  const formatted = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
  dateEl.textContent = formatted
}

window.addEventListener('hashchange', () => {
  handleRouteChange()
})

window.addEventListener('DOMContentLoaded', () => {
  updateHeaderDate()
  handleRouteChange()
})
