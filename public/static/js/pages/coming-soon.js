// ============================================================
// Coming Soon 画面
// v1未実装の画面（実績分析・予算管理・着地予測・設定）で共通利用する。
// ============================================================

/**
 * @param {HTMLElement} container 描画先要素
 * @param {string} pageName 画面名（表示用）
 */
export function renderComingSoonPage(pageName, container) {
  // app.js から container が第一引数で来ないケースに対応
  const target = container instanceof HTMLElement ? container : document.getElementById('main-content')
  if (!target) return

  target.innerHTML = `
    <div class="card">
      <div class="coming-soon-box">
        <i class="fa-solid fa-flask"></i>
        <h2>${pageName}は準備中です</h2>
        <p>この画面は次のバージョンで実装予定です。まずはダッシュボード・データ取込・マスタ管理から運用を開始してください。</p>
      </div>
    </div>
  `
}
