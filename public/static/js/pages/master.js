// ============================================================
// マスタ管理画面
// タブ切替: 媒体マスタ / サイトマスタ / 広告コードマスタ / キャンペーングループ管理
// ============================================================
import { showModal, closeModal, confirmDelete } from '../components/modal.js'
import { showToast } from '../components/toast.js'

const SUB_TABS = [
  { key: 'media', label: '媒体マスタ' },
  { key: 'site', label: 'サイトマスタ' },
  { key: 'campaign', label: '広告コードマスタ' },
  { key: 'campaignGroup', label: 'キャンペーングループ管理' },
]

const MEDIA_STATUS_VIEW = {
  active: { label: '稼働中', badgeClass: 'badge-active' },
  paused: { label: '停止中', badgeClass: 'badge-paused' },
  archived: { label: 'アーカイブ', badgeClass: 'badge-inactive' },
}

let activeSubTab = 'media'

/**
 * マスタ管理画面を描画する
 * @param {HTMLElement} container #main-content 隕∫ｴ
 */
export function renderMasterPage(container) {
  drawShell(container)
}

/**
 * タブバーとコンテンツ枠を描画し、現在のタブ内容を読み込む
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
  } else if (activeSubTab === 'campaignGroup') {
    renderCampaignGroupMaster(contentRoot)
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
        <td>${escapeHtml(m.currency || 'JPY')}</td>
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
        <thead><tr><th>媒体ID</th><th>媒体名</th><th>通貨</th><th>状態</th><th style="width:100px">操作</th></tr></thead>
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
  const currentCurrency = item?.currency || 'JPY'
  showModal({
    title: isEdit ? '媒体を編集' : '媒体を追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">媒体名</label>
        <input type="text" id="modal-media-name" class="form-input" value="${isEdit ? escapeHtml(item.media_name) : ''}" placeholder="例 Google広告" />
      </div>
      <div class="form-row">
        <label class="form-label">状態</label>
        <select id="modal-media-status" class="form-select">
          <option value="active" ${currentStatus === 'active' ? 'selected' : ''}>active</option>
          <option value="paused" ${currentStatus === 'paused' ? 'selected' : ''}>paused</option>
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">騾夊ｲｨ</label>
        <select id="modal-media-currency" class="form-select">
          <option value="JPY" ${currentCurrency === 'JPY' ? 'selected' : ''}>JPY</option>
          <option value="USD" ${currentCurrency === 'USD' ? 'selected' : ''}>USD</option>
        </select>
      </div>
    `,
    onConfirm: async () => {
      const name = document.getElementById('modal-media-name').value.trim()
      const status = document.getElementById('modal-media-status').value
      const currency = document.getElementById('modal-media-currency').value
      if (!name) {
        showToast('媒体名を入力してください', 'error')
        return
      }
      const res = isEdit
        ? await axios.put(`/api/media/${item.id}`, { media_name: name, status, currency }).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/media', { media_name: name, status, currency }).then((r) => r.data).catch((e) => e.response.data)

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
        <input type="text" id="modal-site-name" class="form-input" value="${isEdit ? escapeHtml(item.site_name) : ''}" placeholder="例 SVC公式サイト" />
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
// 広告コードマスタ（媒体・広告コード・サイトの紐付け）
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
      <p class="section-desc mt-0" style="margin-bottom:0">「媒体 → 広告コード → サイト」を紐付ける重要なマスタです。</p>
      <button class="btn btn-primary" id="campaign-add-btn" ${mediaList.length === 0 || siteList.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>広告コードを追加
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
    return `<div class="empty-state">広告コードが登録されていません</div>`
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
      if (!confirmDelete('この広告コードを削除しますか？')) return
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
    title: isEdit ? '広告コードを編集' : '広告コードを追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">キャンペーン名</label>
        <input type="text" id="modal-campaign-name" class="form-input" value="${isEdit ? escapeHtml(item.campaign_name) : ''}" placeholder="例 新規獲得検索広告" />
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
        <input type="text" id="modal-campaign-adcode" class="form-input" value="${isEdit ? escapeHtml(item.ad_code || '') : ''}" placeholder="萓・ GAD-001" />
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
          <option value="0" ${isEdit && !item.is_active ? 'selected' : ''}>辟｡蜉ｹ</option>
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
// キャンペーングループ管理
// ============================================================
async function renderCampaignGroupMaster(root, selectedGroupId = null) {
  root.innerHTML = `<div class="empty-state">読み込み中...</div>`

  const [groups, mediaList] = await Promise.all([
    fetchList('/api/campaign-groups?include_inactive=1'),
    fetchList('/api/media'),
  ])

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">広告コードをキャンペーングループへまとめ、実績分析の集計単位として利用します。</p>
      <button class="btn btn-primary" id="campaign-group-add-btn" ${mediaList.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>グループを追加
      </button>
    </div>
    <div class="master-split-layout">
      <div>
        ${renderCampaignGroupTable(groups)}
      </div>
      <div id="campaign-group-detail-root">
        <div class="empty-state">グループを選択してください</div>
      </div>
    </div>
  `

  root.querySelector('#campaign-group-add-btn')?.addEventListener('click', () =>
    openCampaignGroupModal(root, null, mediaList)
  )
  bindCampaignGroupEvents(root, groups, mediaList)

  if (selectedGroupId) {
    await renderCampaignGroupDetail(root, selectedGroupId)
  }
}

function renderCampaignGroupTable(groups) {
  if (groups.length === 0) {
    return `<div class="empty-state">キャンペーングループはまだ登録されていません</div>`
  }

  const rows = groups.map((group) => `
    <tr>
      <td>
        <button class="text-link" data-action="detail" data-id="${group.id}">
          ${escapeHtml(group.group_name)}
        </button>
      </td>
      <td>${escapeHtml(group.media_name || '-')}</td>
      <td>${Number(group.ad_code_count || 0).toLocaleString('ja-JP')}</td>
      <td>${formatDateTime(group.updated_at || group.created_at)}</td>
      <td><span class="badge ${group.is_active ? 'badge-active' : 'badge-inactive'}">${group.is_active ? '有効' : '無効'}</span></td>
      <td>
        <div class="action-btn-group">
          <button class="icon-btn" data-action="edit-group" data-id="${group.id}" title="編集"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" data-action="delete-group" data-id="${group.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>グループ名</th><th>媒体</th><th>広告コード数</th><th>更新日時</th><th>ステータス</th><th style="width:100px">操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindCampaignGroupEvents(root, groups, mediaList) {
  root.querySelectorAll('[data-action="detail"]').forEach((btn) => {
    btn.addEventListener('click', () => renderCampaignGroupDetail(root, Number(btn.dataset.id)))
  })
  root.querySelectorAll('[data-action="edit-group"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = groups.find((item) => item.id === Number(btn.dataset.id))
      openCampaignGroupModal(root, group, mediaList)
    })
  })
  root.querySelectorAll('[data-action="delete-group"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('このキャンペーングループを削除しますか？ 広告コード自体は削除されません。')) return
      const res = await deleteItem('/api/campaign-groups', btn.dataset.id)
      if (res.success) {
        showToast('キャンペーングループを削除しました', 'success')
        renderCampaignGroupMaster(root)
      } else {
        showToast(res.error || '削除に失敗しました', 'error')
      }
    })
  })
}

function openCampaignGroupModal(root, group, mediaList) {
  const isEdit = !!group
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${isEdit && group.media_id === media.id ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')

  showModal({
    title: isEdit ? 'キャンペーングループ編集' : 'キャンペーングループ追加',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">媒体</label>
        <select id="modal-campaign-group-media" class="form-select">
          <option value="">-- 選択してください --</option>
          ${mediaOptions}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">グループ名</label>
        <input type="text" id="modal-campaign-group-name" class="form-input" value="${isEdit ? escapeHtml(group.group_name) : ''}" placeholder="例 app395系" />
      </div>
      <div class="form-row">
        <label class="form-label">説明</label>
        <textarea id="modal-campaign-group-description" class="form-input" rows="3">${isEdit ? escapeHtml(group.description || '') : ''}</textarea>
      </div>
      <div class="form-row inline">
        <label class="form-label">ステータス</label>
        <select id="modal-campaign-group-active" class="form-select" style="width:auto">
          <option value="1" ${!isEdit || group.is_active ? 'selected' : ''}>有効</option>
          <option value="0" ${isEdit && !group.is_active ? 'selected' : ''}>無効</option>
        </select>
      </div>
    `,
    onConfirm: async () => {
      const payload = {
        media_id: Number(document.getElementById('modal-campaign-group-media').value),
        group_name: document.getElementById('modal-campaign-group-name').value.trim(),
        description: document.getElementById('modal-campaign-group-description').value.trim(),
        is_active: Number(document.getElementById('modal-campaign-group-active').value),
      }
      if (!payload.media_id || !payload.group_name) {
        showToast('媒体とグループ名を入力してください', 'error')
        return
      }

      const res = isEdit
        ? await axios.put(`/api/campaign-groups/${group.id}`, payload).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/campaign-groups', payload).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        renderCampaignGroupMaster(root, isEdit ? group.id : res.data?.id)
      } else {
        showToast(res.error || '保存に失敗しました', 'error')
      }
    },
  })
}

async function renderCampaignGroupDetail(root, groupId) {
  const detailRoot = root.querySelector('#campaign-group-detail-root')
  if (!detailRoot) return
  detailRoot.innerHTML = `<div class="empty-state">読み込み中...</div>`

  try {
    const detailRes = await axios.get(`/api/campaign-groups/${groupId}`)
    const { group, ad_codes: adCodes } = detailRes.data.data
    const availableRes = await axios.get(`/api/campaign-groups/available-ad-codes?group_id=${groupId}&media_id=${group.media_id}`)
    const availableAdCodes = availableRes.data.data || []
    detailRoot.innerHTML = renderCampaignGroupDetailHtml(group, adCodes, availableAdCodes)
    bindCampaignGroupDetailEvents(root, group, availableAdCodes)
  } catch (err) {
    console.error(err)
    detailRoot.innerHTML = `<div class="empty-state">詳細を取得できませんでした</div>`
  }
}

function renderCampaignGroupDetailHtml(group, adCodes, availableAdCodes) {
  const adCodeRows = adCodes.length === 0
    ? `<tr><td colspan="4">所属広告コードはありません</td></tr>`
    : adCodes.map((item) => `
      <tr>
        <td>${escapeHtml(item.ad_code || '-')}</td>
        <td>${escapeHtml(item.campaign_name || '-')}</td>
        <td>${escapeHtml(item.site_name || '-')}</td>
        <td>
          <button class="icon-btn danger" data-action="remove-group-ad-code" data-id="${item.id}" title="削除">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('')

  const options = availableAdCodes
    .map((item) => `<option value="${item.id}">${escapeHtml(item.ad_code || '-') } / ${escapeHtml(item.campaign_name || '-')} / ${escapeHtml(item.site_name || '-')}</option>`)
    .join('')

  return `
    <div class="card-subtitle" style="margin-bottom:12px">${escapeHtml(group.media_name || '-')}</div>
    <div class="card-title" style="margin-bottom:12px">${escapeHtml(group.group_name)}</div>
    <div class="form-row">
      <label class="form-label">広告コード追加</label>
      <select id="campaign-group-ad-code-select" class="form-select" multiple size="6">
        ${options}
      </select>
      <div class="form-hint">既に他グループへ所属している広告コードは表示されません。</div>
      <button class="btn btn-secondary" id="campaign-group-add-ad-codes" ${availableAdCodes.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>追加
      </button>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>広告コード</th><th>キャンペーン名</th><th>サイト</th><th style="width:80px">操作</th></tr></thead>
        <tbody>${adCodeRows}</tbody>
      </table>
    </div>
  `
}

function bindCampaignGroupDetailEvents(root, group, availableAdCodes) {
  root.querySelector('#campaign-group-add-ad-codes')?.addEventListener('click', async () => {
    const select = root.querySelector('#campaign-group-ad-code-select')
    const adCodeIds = [...(select?.selectedOptions || [])].map((option) => Number(option.value))
    if (adCodeIds.length === 0) {
      showToast('追加する広告コードを選択してください', 'error')
      return
    }

    try {
      await axios.post(`/api/campaign-groups/${group.id}/ad-codes`, { ad_code_ids: adCodeIds })
      showToast('広告コードを追加しました', 'success')
      renderCampaignGroupDetail(root, group.id)
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || '広告コードの追加に失敗しました', 'error')
    }
  })

  root.querySelectorAll('[data-action="remove-group-ad-code"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('この広告コードをグループから外しますか？')) return
      try {
        await axios.delete(`/api/campaign-groups/${group.id}/ad-codes/${btn.dataset.id}`)
        showToast('広告コードを外しました', 'success')
        renderCampaignGroupDetail(root, group.id)
      } catch (err) {
        console.error(err)
        showToast(err.response?.data?.error || '広告コードの削除に失敗しました', 'error')
      }
    })
  })
}

// ============================================================
// 蜈ｱ騾壹Θ繝ｼ繝・ぅ繝ｪ繝・ぅ
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

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
