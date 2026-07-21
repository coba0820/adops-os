export function showModal({ title, bodyHtml, confirmLabel = '保存', modalClass = '', onConfirm }) {
  closeModal()

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'active-modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box ${escapeHtml(modalClass)}">
      <div class="modal-title">${title}</div>
      <div id="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="modal-cancel-btn">キャンセル</button>
        <button class="btn btn-primary" id="modal-confirm-btn">${confirmLabel}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal()
  })

  overlay.querySelector('#modal-cancel-btn').addEventListener('click', closeModal)
  overlay.querySelector('#modal-confirm-btn').addEventListener('click', () => {
    onConfirm && onConfirm()
  })
}

export function closeModal() {
  const existing = document.getElementById('active-modal-overlay')
  if (existing) existing.remove()
}

export function confirmDelete(message) {
  return window.confirm(message)
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
