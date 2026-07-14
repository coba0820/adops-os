// ============================================================
// 左メニュー（サイドバー）コンポーネント
// メニュー定義を配列で持ち、現在のルートに応じて active クラスを付与する。
// 将来画面を追加する場合は MENU_ITEMS に1行追加するだけで良い設計。
// ============================================================

/**
 * メニュー項目定義
 * key: ルーティングのハッシュ値（#/xxx）と一致させる
 * comingSoon: true の場合は「準備中」バッジを表示する
 */
export const MENU_ITEMS = [
  { key: 'dashboard', label: 'ダッシュボード', icon: 'fa-gauge-high', comingSoon: false },
  { key: 'data-import', label: 'データ取込', icon: 'fa-file-arrow-up', comingSoon: false },
  { key: 'master', label: 'マスタ管理', icon: 'fa-database', comingSoon: false },
  { key: 'analysis', label: '実績分析', icon: 'fa-chart-line', comingSoon: false },
  { key: 'budget', label: '予算管理', icon: 'fa-wallet', comingSoon: false },
  { key: 'forecast', label: '着地予測', icon: 'fa-chart-simple', comingSoon: true },
  { key: 'settings', label: '設定', icon: 'fa-gear', comingSoon: true },
]

/**
 * サイドバーをレンダリングする
 * @param {string} activeKey 現在アクティブなメニューのkey
 */
export function renderSidebar(activeKey) {
  const sidebar = document.getElementById('app-sidebar')
  if (!sidebar) return

  const navItemsHtml = MENU_ITEMS.map((item) => {
    const isActive = item.key === activeKey
    return `
      <a href="#/${item.key}" class="sidebar-nav-item ${isActive ? 'active' : ''}" data-key="${item.key}">
        <i class="fa-solid ${item.icon}"></i>
        <span>${item.label}</span>
        ${item.comingSoon ? '<span class="sidebar-nav-badge">準備中</span>' : ''}
      </a>
    `
  }).join('')

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">Ad</div>
      <div class="sidebar-logo-text">
        <span class="sidebar-logo-title">AdOps OS</span>
        <span class="sidebar-logo-sub">SVC広告部 専用</span>
      </div>
    </div>
    <div class="sidebar-nav">
      ${navItemsHtml}
    </div>
  `
}
