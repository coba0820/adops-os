// ============================================================
// モーダルコンポーネント（マスタ管理の追加・編集で共通利用）
// ============================================================

/**
 * モーダルを表示する
 * @param {object} options
 * @param {string} options.title モーダルタイトル
 * @param {string} options.bodyHtml モーダル本文のHTML（フォーム部分）
 * @param {string} options.confirmLabel 確定ボタンのラベル（デフォルト: 保存）
 * @param {() => void} options.onConfirm 確定ボタン押下時のコールバック
 */
export function showModal({ title, bodyHtml, confirmLabel = '保存', onConfirm }) {
  // 既存モーダルがあれば削除
  closeModal()

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'active-modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${title}</div>
      <div id="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="modal-cancel-btn">キャンセル</button>
        <button class="btn btn-primary" id="modal-confirm-btn">${confirmLabel}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  // オーバーレイクリックで閉じる（本体クリックは伝播を止める）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal()
  })

  overlay.querySelector('#modal-cancel-btn').addEventListener('click', closeModal)
  overlay.querySelector('#modal-confirm-btn').addEventListener('click', () => {
    onConfirm && onConfirm()
  })
}

/**
 * 現在表示中のモーダルを閉じる
 */
export function closeModal() {
  const existing = document.getElementById('active-modal-overlay')
  if (existing) existing.remove()
}

/**
 * 削除確認用の簡易confirmラッパー（将来的にカスタムUIへ差し替えやすくするため関数化）
 */
export function confirmDelete(message) {
  return window.confirm(message)
}
