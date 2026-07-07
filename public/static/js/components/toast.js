// ============================================================
// トースト通知コンポーネント
// 画面右下に一時的なメッセージを表示する共通ユーティリティ。
// ============================================================

/**
 * トースト表示用のコンテナをbodyに用意する（未作成時のみ）
 */
function ensureContainer() {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  return container
}

/**
 * トーストを表示する
 * @param {string} message 表示するメッセージ
 * @param {'success'|'error'} type トーストの種類
 */
export function showToast(message, type = 'success') {
  const container = ensureContainer()
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.textContent = message
  container.appendChild(toast)

  // 3秒後にフェードアウトして削除
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}
