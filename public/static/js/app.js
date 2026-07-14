// ============================================================
// AdOps OS フロントエンド エントリーポイント
// ハッシュベースの簡易SPAルーター。
// 画面追加時は ROUTES に1行追加するだけで済む設計にしている。
// ============================================================
import { renderSidebar, MENU_ITEMS } from './components/sidebar.js'
import { renderDashboardPage } from './pages/dashboard.js'
import { renderDataImportPage } from './pages/data-import.js'
import { renderMasterPage } from './pages/master.js'
import { renderAnalysisPage } from './pages/analysis.js'
import { renderBudgetPage } from './pages/budget.js'
import { renderComingSoonPage } from './pages/coming-soon.js'

// ------------------------------------------------------------
// ルート定義
// key: URLハッシュ（#/key）
// title: ヘッダーに表示するページ名
// render: #main-content に描画する関数
// ------------------------------------------------------------
const ROUTES = {
  dashboard: { title: 'ダッシュボード', render: renderDashboardPage },
  'data-import': { title: 'データ取込', render: renderDataImportPage },
  master: { title: 'マスタ管理', render: renderMasterPage },
  analysis: { title: '実績分析', render: renderAnalysisPage },
  budget: { title: '予算管理', render: renderBudgetPage },
  forecast: { title: '着地予測', render: (el) => renderComingSoonPage('着地予測', el) },
  settings: { title: '設定', render: (el) => renderComingSoonPage('設定', el) },
}

const DEFAULT_ROUTE = 'dashboard'

/**
 * 現在のURLハッシュから該当ルートを表示する
 */
function handleRouteChange() {
  const hash = window.location.hash.replace('#/', '') || DEFAULT_ROUTE
  const route = ROUTES[hash] || ROUTES[DEFAULT_ROUTE]
  const routeKey = ROUTES[hash] ? hash : DEFAULT_ROUTE

  // ヘッダーのタイトル更新
  const pageTitleEl = document.getElementById('page-title')
  if (pageTitleEl) pageTitleEl.textContent = route.title

  // サイドバーのアクティブ状態更新
  renderSidebar(routeKey)

  // メインコンテンツ描画
  const mainContent = document.getElementById('main-content')
  if (mainContent) {
    mainContent.innerHTML = ''
    route.render(mainContent)
  }
}

/**
 * ヘッダー右側の日付表示を更新する
 */
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

// ------------------------------------------------------------
// 初期化
// ------------------------------------------------------------
window.addEventListener('hashchange', handleRouteChange)
window.addEventListener('DOMContentLoaded', () => {
  updateHeaderDate()
  handleRouteChange()
})
