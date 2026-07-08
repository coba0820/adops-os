// ============================================================
// マスタ管理画面
// タブ切替: 媒体マスタ / サイトマスタ / キャンペーンマスタ
// 各マスタは一覧表示・追加・編集・削除（CRUD）が可能。
// キャンペーンマスタは「媒体→広告コード→サイト」の紐付けを持つ
// 最重要マスタのため、媒体・サイトのプルダウンを参照する。
// ============================================================
import { showModal, closeModal, confirmDelete } from '../components/modal.js'
import { showToast } from '../components/toast.js'

const SUB_TABS = [
  { key: 'media', label: '媒体マスタ' },
  { key: 'site', label: 'サイトマスタ' },
  { key: 'campaign', label: 'キャンペーンマスタ' },
]

const MEDIA_STATUS_VIEW = {
  active: { label: '🟢 稼働中', badgeClass: 'badge-active' },
  paused: { label: '🟡 停止', badgeClass: 'badge-paused' },
  archived: { label: 'アーカイブ', badgeClass: 'badge-inactive' },
}

let activeSubTab = 'media'

/**
 * マスタ管理画面を描画する（エントリーポイント）
 * @param {HTMLElement} container #main-content 要素
 */
export function renderMasterPage(container) {
  drawShell(container)
}

/**
 * タブバー＋コンテンツ枠を描画し、現在のタブの内容を読み込む
 */
function drawShell(container) {
  const tabBarHtml = SUB_TABS.map(
    (t) => `<div class="tab-item ${t.key === activeSubTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</div>`
  ).join('')

  container.innerHTML = `
    <div class="card">
      <div class="tab-bar">${tabBarHtml}</div>
      <div id="master-content-root"></div>
    </div>
  `

  container.querySelectorAll('.tab-item').forEach((el) => {
    el.addEventListener('click', () => {
      activeSubTab = el.dataset.tab
      drawShell(container)
    })
  })

  const contentRoot = container.querySelector('#master-content-root')
  if (activeSubTab === 'media') {
    renderMediaMaster(contentRoot)
  } else if (activeSubTab === 'site') {
    renderSiteMaster(contentRoot)
  } else if (activeSubTab === 'campaign') {
    renderCampaignMaster(contentRoot)
  }
}

// ============================================================
// 媒体マスタ
// ============================================================
async function renderMediaMaster(root) {
  root.innerHTML = `<div class="empty-state">読み込み中...</div>`
  const list = await fetchList('/api/media')

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">広告を配信する媒体を管理します。</p>
      <button class="btn btn-primary" id="media-add-btn"><i class="fa-solid fa-plus"></i>媒体を追加</button>
    </div>
    ${renderMediaTable(list)}
  `

  root.querySelector('#media-add-btn').addEventListener('click', () => openMediaModal(root, null))
  bindMediaRowEvents(root, list)
}

function normalizeMediaStatus(status) {
  return MEDIA_STATUS_VIEW[status] ? status : 'active'
}

function renderMediaStatusBadge(status) {
  const view = MEDIA_STATUS_VIEW[status] || MEDIA_STATUS_VIEW.active
  return `<span class="badge ${view.badgeClass}">${view.label}</span>`
}

function renderMediaTable(list) {
  if (list.length === 0) {
    return `<div class="empty-state">媒体が登録されていません</div>`
  }
  const rows = list
    .map(
      (m) => {
        const status = normalizeMediaStatus(m.status)
        return `
      <tr class="${status === 'paused' ? 'media-row-paused' : ''}">
        <td>${m.id}</td>
        <td>${escapeHtml(m.media_name)}</td>
        <td>${renderMediaStatusBadge(status)}</td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit" data-id="${m.id}" title="編集"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${m.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `}
    )
    .join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>媒体ID</th><th>媒体名</th><th>状態</th><th style="width:100px">操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindMediaRowEvents(root, list) {
  root.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = list.find((m) => m.id === Number(btn.dataset.id))
      openMediaModal(root, item)
    })
  })
  root.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('この媒体を削除しますか？')) return
      const res = await deleteItem('/api/media', btn.dataset.id)
      if (res.success) {
        showToast('削除しました', 'success')
        renderMediaMaster(root)
      } else {
        showToast(res.error || '削除に失敗しました', 'error')
      }
    })
  })
}

function openMediaModal(root, item) {
  const isEdit = !!item
  const currentStatus = normalizeMediaStatus(item?.status)
  showModal({
    title: isEdit ? '媒体を編集' : '媒体を追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">媒体名</label>
        <input type="text" id="modal-media-name" class="form-input" value="${isEdit ? escapeHtml(item.media_name) : ''}" placeholder="例: Google広告" />
      </div>
      <div class="form-row">
        <label class="form-label">状態</label>
        <select id="modal-media-status" class="form-select">
          <option value="active" ${currentStatus === 'active' ? 'selected' : ''}>active</option>
          <option value="paused" ${currentStatus === 'paused' ? 'selected' : ''}>paused</option>
        </select>
      </div>
    `,
    onConfirm: async () => {
      const name = document.getElementById('modal-media-name').value.trim()
      const status = document.getElementById('modal-media-status').value
      if (!name) {
        showToast('媒体名を入力してください', 'error')
        return
      }
      const res = isEdit
        ? await axios.put(`/api/media/${item.id}`, { media_name: name, status }).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/media', { media_name: name, status }).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        renderMediaMaster(root)
      } else {
        showToast(res.error || '保存に失敗しました', 'error')
      }
    },
  })
}

// ============================================================
// サイトマスタ
// ============================================================
async function renderSiteMaster(root) {
  root.innerHTML = `<div class="empty-state">読み込み中...</div>`
  const list = await fetchList('/api/site')

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">広告の受け皿となる自社サイト・LPを管理します。</p>
      <button class="btn btn-primary" id="site-add-btn"><i class="fa-solid fa-plus"></i>サイトを追加</button>
    </div>
    ${renderSiteTable(list)}
  `

  root.querySelector('#site-add-btn').addEventListener('click', () => openSiteModal(root, null))
  bindSiteRowEvents(root, list)
}

function renderSiteTable(list) {
  if (list.length === 0) {
    return `<div class="empty-state">サイトが登録されていません</div>`
  }
  const rows = list
    .map(
      (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.site_name)}</td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit" data-id="${s.id}" title="編集"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>サイトID</th><th>サイト名</th><th style="width:100px">操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindSiteRowEvents(root, list) {
  root.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = list.find((s) => s.id === Number(btn.dataset.id))
      openSiteModal(root, item)
    })
  })
  root.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('このサイトを削除しますか？')) return
      const res = await deleteItem('/api/site', btn.dataset.id)
      if (res.success) {
        showToast('削除しました', 'success')
        renderSiteMaster(root)
      } else {
        showToast(res.error || '削除に失敗しました', 'error')
      }
    })
  })
}

function openSiteModal(root, item) {
  const isEdit = !!item
  showModal({
    title: isEdit ? 'サイトを編集' : 'サイトを追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">サイト名</label>
        <input type="text" id="modal-site-name" class="form-input" value="${isEdit ? escapeHtml(item.site_name) : ''}" placeholder="例: SVC公式サイト" />
      </div>
    `,
    onConfirm: async () => {
      const name = document.getElementById('modal-site-name').value.trim()
      if (!name) {
        showToast('サイト名を入力してください', 'error')
        return
      }
      const res = isEdit
        ? await axios.put(`/api/site/${item.id}`, { site_name: name }).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/site', { site_name: name }).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        renderSiteMaster(root)
      } else {
        showToast(res.error || '保存に失敗しました', 'error')
      }
    },
  })
}

// ============================================================
// キャンペーンマスタ（媒体→広告コード→サイトの紐付け）
// ============================================================
async function renderCampaignMaster(root) {
  root.innerHTML = `<div class="empty-state">読み込み中...</div>`

  const [campaigns, mediaList, siteList] = await Promise.all([
    fetchList('/api/campaign'),
    fetchList('/api/media'),
    fetchList('/api/site'),
  ])

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">「媒体 → 広告コード → サイト」を紐付ける最重要マスタです。</p>
      <button class="btn btn-primary" id="campaign-add-btn" ${mediaList.length === 0 || siteList.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>キャンペーンを追加
      </button>
    </div>
    ${mediaList.length === 0 || siteList.length === 0 ? '<div class="form-hint" style="margin-bottom:16px">※ 先に媒体マスタ・サイトマスタを1件以上登録してください</div>' : ''}
    ${renderCampaignTable(campaigns)}
  `

  root.querySelector('#campaign-add-btn')?.addEventListener('click', () => openCampaignModal(root, null, mediaList, siteList))
  bindCampaignRowEvents(root, campaigns, mediaList, siteList)
}

function renderCampaignTable(list) {
  if (list.length === 0) {
    return `<div class="empty-state">キャンペーンが登録されていません</div>`
  }
  const rows = list
    .map(
      (c) => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.campaign_name)}</td>
        <td>${escapeHtml(c.media_name || '-')}</td>
        <td>${escapeHtml(c.ad_code || '-')}</td>
        <td>${escapeHtml(c.site_name || '-')}</td>
        <td><span class="badge ${c.is_active ? 'badge-active' : 'badge-inactive'}">${c.is_active ? '有効' : '無効'}</span></td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit" data-id="${c.id}" title="編集"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${c.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>キャンペーン名</th><th>媒体</th><th>広告コード</th><th>サイト</th><th>状態</th><th style="width:100px">操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindCampaignRowEvents(root, list, mediaList, siteList) {
  root.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = list.find((c) => c.id === Number(btn.dataset.id))
      openCampaignModal(root, item, mediaList, siteList)
    })
  })
  root.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('このキャンペーンを削除しますか？')) return
      const res = await deleteItem('/api/campaign', btn.dataset.id)
      if (res.success) {
        showToast('削除しました', 'success')
        renderCampaignMaster(root)
      } else {
        showToast(res.error || '削除に失敗しました', 'error')
      }
    })
  })
}

function openCampaignModal(root, item, mediaList, siteList) {
  const isEdit = !!item

  const mediaOptions = mediaList
    .map((m) => `<option value="${m.id}" ${isEdit && item.media_id === m.id ? 'selected' : ''}>${escapeHtml(m.media_name)}</option>`)
    .join('')
  const siteOptions = siteList
    .map((s) => `<option value="${s.id}" ${isEdit && item.site_id === s.id ? 'selected' : ''}>${escapeHtml(s.site_name)}</option>`)
    .join('')

  showModal({
    title: isEdit ? 'キャンペーンを編集' : 'キャンペーンを追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">キャンペーン名</label>
        <input type="text" id="modal-campaign-name" class="form-input" value="${isEdit ? escapeHtml(item.campaign_name) : ''}" placeholder="例: 新規獲得_検索広告" />
      </div>
      <div class="form-row">
        <label class="form-label">媒体</label>
        <select id="modal-campaign-media" class="form-select">
          <option value="">-- 選択してください --</option>
          ${mediaOptions}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">広告コード</label>
        <input type="text" id="modal-campaign-adcode" class="form-input" value="${isEdit ? escapeHtml(item.ad_code || '') : ''}" placeholder="例: GAD-001" />
      </div>
      <div class="form-row">
        <label class="form-label">サイト</label>
        <select id="modal-campaign-site" class="form-select">
          <option value="">-- 選択してください --</option>
          ${siteOptions}
        </select>
      </div>
      <div class="form-row inline">
        <label class="form-label">状態</label>
        <select id="modal-campaign-active" class="form-select" style="width:auto">
          <option value="1" ${!isEdit || item.is_active ? 'selected' : ''}>有効</option>
          <option value="0" ${isEdit && !item.is_active ? 'selected' : ''}>無効</option>
        </select>
      </div>
    `,
    onConfirm: async () => {
      const name = document.getElementById('modal-campaign-name').value.trim()
      const mediaId = document.getElementById('modal-campaign-media').value
      const adCode = document.getElementById('modal-campaign-adcode').value.trim()
      const siteId = document.getElementById('modal-campaign-site').value
      const isActive = Number(document.getElementById('modal-campaign-active').value)

      if (!name || !mediaId || !siteId) {
        showToast('キャンペーン名・媒体・サイトは必須です', 'error')
        return
      }

      const payload = {
        campaign_name: name,
        media_id: Number(mediaId),
        ad_code: adCode,
        site_id: Number(siteId),
        is_active: isActive,
      }

      const res = isEdit
        ? await axios.put(`/api/campaign/${item.id}`, payload).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/campaign', payload).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        renderCampaignMaster(root)
      } else {
        showToast(res.error || '保存に失敗しました', 'error')
      }
    },
  })
}

// ============================================================
// 共通ユーティリティ
// ============================================================

/** GET一覧取得の共通ラッパー */
async function fetchList(url) {
  try {
    const res = await axios.get(url)
    return res.data.data || []
  } catch (err) {
    console.error(err)
    showToast('データの取得に失敗しました', 'error')
    return []
  }
}

/** DELETEの共通ラッパー */
async function deleteItem(baseUrl, id) {
  try {
    const res = await axios.delete(`${baseUrl}/${id}`)
    return res.data
  } catch (err) {
    return err.response?.data || { success: false, error: '削除に失敗しました' }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
