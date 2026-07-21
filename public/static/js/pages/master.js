// ============================================================
// 繝槭せ繧ｿ邂｡逅・判髱｢
// 繧ｿ繝門・譖ｿ: 蟐剃ｽ薙・繧ｹ繧ｿ / 繧ｵ繧､繝医・繧ｹ繧ｿ / 繧ｭ繝｣繝ｳ繝壹・繝ｳ繝槭せ繧ｿ
// 蜷・・繧ｹ繧ｿ縺ｯ荳隕ｧ陦ｨ遉ｺ繝ｻ霑ｽ蜉繝ｻ邱ｨ髮・・蜑企勁・・RUD・峨′蜿ｯ閭ｽ縲・
// 繧ｭ繝｣繝ｳ繝壹・繝ｳ繝槭せ繧ｿ縺ｯ縲悟ｪ剃ｽ凪・蠎・相繧ｳ繝ｼ繝俄・繧ｵ繧､繝医阪・邏蝉ｻ倥￠繧呈戟縺､
// 譛驥崎ｦ√・繧ｹ繧ｿ縺ｮ縺溘ａ縲∝ｪ剃ｽ薙・繧ｵ繧､繝医・繝励Ν繝繧ｦ繝ｳ繧貞盾辣ｧ縺吶ｋ縲・
// ============================================================
import { showModal, closeModal, confirmDelete } from '../components/modal.js'
import { showToast } from '../components/toast.js'

const SUB_TABS = [
  { key: 'media', label: '蟐剃ｽ薙・繧ｹ繧ｿ' },
  { key: 'site', label: '繧ｵ繧､繝医・繧ｹ繧ｿ' },
  { key: 'campaign', label: '繧ｭ繝｣繝ｳ繝壹・繝ｳ繝槭せ繧ｿ' },
  { key: 'campaignGroup', label: 'キャンペーングループ管理' },
]

const MEDIA_STATUS_VIEW = {
  active: { label: '泙 遞ｼ蜒堺ｸｭ', badgeClass: 'badge-active' },
  paused: { label: '泯 蛛懈ｭ｢', badgeClass: 'badge-paused' },
  archived: { label: '繧｢繝ｼ繧ｫ繧､繝・, badgeClass: 'badge-inactive' },
}

let activeSubTab = 'media'

/**
 * 繝槭せ繧ｿ邂｡逅・判髱｢繧呈緒逕ｻ縺吶ｋ・医お繝ｳ繝医Μ繝ｼ繝昴う繝ｳ繝茨ｼ・
 * @param {HTMLElement} container #main-content 隕∫ｴ
 */
export function renderMasterPage(container) {
  drawShell(container)
}

/**
 * 繧ｿ繝悶ヰ繝ｼ・九さ繝ｳ繝・Φ繝・棧繧呈緒逕ｻ縺励∫樟蝨ｨ縺ｮ繧ｿ繝悶・蜀・ｮｹ繧定ｪｭ縺ｿ霎ｼ繧
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
// 蟐剃ｽ薙・繧ｹ繧ｿ
// ============================================================
async function renderMediaMaster(root) {
  root.innerHTML = `<div class="empty-state">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</div>`
  const list = await fetchList('/api/media')

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">蠎・相繧帝・菫｡縺吶ｋ蟐剃ｽ薙ｒ邂｡逅・＠縺ｾ縺吶・/p>
      <button class="btn btn-primary" id="media-add-btn"><i class="fa-solid fa-plus"></i>蟐剃ｽ薙ｒ霑ｽ蜉</button>
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
    return `<div class="empty-state">蟐剃ｽ薙′逋ｻ骭ｲ縺輔ｌ縺ｦ縺・∪縺帙ｓ</div>`
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
            <button class="icon-btn" data-action="edit" data-id="${m.id}" title="邱ｨ髮・><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${m.id}" title="蜑企勁"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `}
    )
    .join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>蟐剃ｽ的D</th><th>蟐剃ｽ灘錐</th><th>迥ｶ諷・/th><th style="width:100px">謫堺ｽ・/th></tr></thead>
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
      if (!confirmDelete('縺薙・蟐剃ｽ薙ｒ蜑企勁縺励∪縺吶°・・)) return
      const res = await deleteItem('/api/media', btn.dataset.id)
      if (res.success) {
        showToast('蜑企勁縺励∪縺励◆', 'success')
        renderMediaMaster(root)
      } else {
        showToast(res.error || '蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error')
      }
    })
  })
}

function openMediaModal(root, item) {
  const isEdit = !!item
  const currentStatus = normalizeMediaStatus(item?.status)
  const currentCurrency = item?.currency || 'JPY'
  showModal({
    title: isEdit ? '蟐剃ｽ薙ｒ邱ｨ髮・ : '蟐剃ｽ薙ｒ霑ｽ蜉',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">蟐剃ｽ灘錐</label>
        <input type="text" id="modal-media-name" class="form-input" value="${isEdit ? escapeHtml(item.media_name) : ''}" placeholder="萓・ Google蠎・相" />
      </div>
      <div class="form-row">
        <label class="form-label">迥ｶ諷・/label>
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
        showToast('蟐剃ｽ灘錐繧貞・蜉帙＠縺ｦ縺上□縺輔＞', 'error')
        return
      }
      const res = isEdit
        ? await axios.put(`/api/media/${item.id}`, { media_name: name, status, currency }).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/media', { media_name: name, status, currency }).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '譖ｴ譁ｰ縺励∪縺励◆' : '霑ｽ蜉縺励∪縺励◆', 'success')
        renderMediaMaster(root)
      } else {
        showToast(res.error || '菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆', 'error')
      }
    },
  })
}

// ============================================================
// 繧ｵ繧､繝医・繧ｹ繧ｿ
// ============================================================
async function renderSiteMaster(root) {
  root.innerHTML = `<div class="empty-state">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</div>`
  const list = await fetchList('/api/site')

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">蠎・相縺ｮ蜿励￠逧ｿ縺ｨ縺ｪ繧玖・遉ｾ繧ｵ繧､繝医・LP繧堤ｮ｡逅・＠縺ｾ縺吶・/p>
      <button class="btn btn-primary" id="site-add-btn"><i class="fa-solid fa-plus"></i>繧ｵ繧､繝医ｒ霑ｽ蜉</button>
    </div>
    ${renderSiteTable(list)}
  `

  root.querySelector('#site-add-btn').addEventListener('click', () => openSiteModal(root, null))
  bindSiteRowEvents(root, list)
}

function renderSiteTable(list) {
  if (list.length === 0) {
    return `<div class="empty-state">繧ｵ繧､繝医′逋ｻ骭ｲ縺輔ｌ縺ｦ縺・∪縺帙ｓ</div>`
  }
  const rows = list
    .map(
      (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.site_name)}</td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit" data-id="${s.id}" title="邱ｨ髮・><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="蜑企勁"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `
    )
    .join('')

  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>繧ｵ繧､繝・D</th><th>繧ｵ繧､繝亥錐</th><th style="width:100px">謫堺ｽ・/th></tr></thead>
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
      if (!confirmDelete('縺薙・繧ｵ繧､繝医ｒ蜑企勁縺励∪縺吶°・・)) return
      const res = await deleteItem('/api/site', btn.dataset.id)
      if (res.success) {
        showToast('蜑企勁縺励∪縺励◆', 'success')
        renderSiteMaster(root)
      } else {
        showToast(res.error || '蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error')
      }
    })
  })
}

function openSiteModal(root, item) {
  const isEdit = !!item
  showModal({
    title: isEdit ? '繧ｵ繧､繝医ｒ邱ｨ髮・ : '繧ｵ繧､繝医ｒ霑ｽ蜉',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">繧ｵ繧､繝亥錐</label>
        <input type="text" id="modal-site-name" class="form-input" value="${isEdit ? escapeHtml(item.site_name) : ''}" placeholder="萓・ SVC蜈ｬ蠑上し繧､繝・ />
      </div>
    `,
    onConfirm: async () => {
      const name = document.getElementById('modal-site-name').value.trim()
      if (!name) {
        showToast('繧ｵ繧､繝亥錐繧貞・蜉帙＠縺ｦ縺上□縺輔＞', 'error')
        return
      }
      const res = isEdit
        ? await axios.put(`/api/site/${item.id}`, { site_name: name }).then((r) => r.data).catch((e) => e.response.data)
        : await axios.post('/api/site', { site_name: name }).then((r) => r.data).catch((e) => e.response.data)

      if (res.success) {
        closeModal()
        showToast(isEdit ? '譖ｴ譁ｰ縺励∪縺励◆' : '霑ｽ蜉縺励∪縺励◆', 'success')
        renderSiteMaster(root)
      } else {
        showToast(res.error || '菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆', 'error')
      }
    },
  })
}

// ============================================================
// 繧ｭ繝｣繝ｳ繝壹・繝ｳ繝槭せ繧ｿ・亥ｪ剃ｽ凪・蠎・相繧ｳ繝ｼ繝俄・繧ｵ繧､繝医・邏蝉ｻ倥￠・・
// ============================================================
async function renderCampaignMaster(root) {
  root.innerHTML = `<div class="empty-state">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</div>`

  const [campaigns, mediaList, siteList] = await Promise.all([
    fetchList('/api/campaign'),
    fetchList('/api/media'),
    fetchList('/api/site'),
  ])

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">縲悟ｪ剃ｽ・竊・蠎・相繧ｳ繝ｼ繝・竊・繧ｵ繧､繝医阪ｒ邏蝉ｻ倥￠繧区怙驥崎ｦ√・繧ｹ繧ｿ縺ｧ縺吶・/p>
      <button class="btn btn-primary" id="campaign-add-btn" ${mediaList.length === 0 || siteList.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>繧ｭ繝｣繝ｳ繝壹・繝ｳ繧定ｿｽ蜉
      </button>
    </div>
    ${mediaList.length === 0 || siteList.length === 0 ? '<div class="form-hint" style="margin-bottom:16px">窶ｻ 蜈医↓蟐剃ｽ薙・繧ｹ繧ｿ繝ｻ繧ｵ繧､繝医・繧ｹ繧ｿ繧・莉ｶ莉･荳顔匳骭ｲ縺励※縺上□縺輔＞</div>' : ''}
    ${renderCampaignTable(campaigns)}
  `

  root.querySelector('#campaign-add-btn')?.addEventListener('click', () => openCampaignModal(root, null, mediaList, siteList))
  bindCampaignRowEvents(root, campaigns, mediaList, siteList)
}

function renderCampaignTable(list) {
  if (list.length === 0) {
    return `<div class="empty-state">繧ｭ繝｣繝ｳ繝壹・繝ｳ縺檎匳骭ｲ縺輔ｌ縺ｦ縺・∪縺帙ｓ</div>`
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
        <td><span class="badge ${c.is_active ? 'badge-active' : 'badge-inactive'}">${c.is_active ? '譛牙柑' : '辟｡蜉ｹ'}</span></td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit" data-id="${c.id}" title="邱ｨ髮・><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete" data-id="${c.id}" title="蜑企勁"><i class="fa-solid fa-trash"></i></button>
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
            <th>ID</th><th>繧ｭ繝｣繝ｳ繝壹・繝ｳ蜷・/th><th>蟐剃ｽ・/th><th>蠎・相繧ｳ繝ｼ繝・/th><th>繧ｵ繧､繝・/th><th>迥ｶ諷・/th><th style="width:100px">謫堺ｽ・/th>
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
      if (!confirmDelete('縺薙・繧ｭ繝｣繝ｳ繝壹・繝ｳ繧貞炎髯､縺励∪縺吶°・・)) return
      const res = await deleteItem('/api/campaign', btn.dataset.id)
      if (res.success) {
        showToast('蜑企勁縺励∪縺励◆', 'success')
        renderCampaignMaster(root)
      } else {
        showToast(res.error || '蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error')
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
    title: isEdit ? '繧ｭ繝｣繝ｳ繝壹・繝ｳ繧堤ｷｨ髮・ : '繧ｭ繝｣繝ｳ繝壹・繝ｳ繧定ｿｽ蜉',
    bodyHtml: `
      <div class="form-row">
        <label class="form-label">繧ｭ繝｣繝ｳ繝壹・繝ｳ蜷・/label>
        <input type="text" id="modal-campaign-name" class="form-input" value="${isEdit ? escapeHtml(item.campaign_name) : ''}" placeholder="萓・ 譁ｰ隕冗佐蠕誉讀懃ｴ｢蠎・相" />
      </div>
      <div class="form-row">
        <label class="form-label">蟐剃ｽ・/label>
        <select id="modal-campaign-media" class="form-select">
          <option value="">-- 驕ｸ謚槭＠縺ｦ縺上□縺輔＞ --</option>
          ${mediaOptions}
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">蠎・相繧ｳ繝ｼ繝・/label>
        <input type="text" id="modal-campaign-adcode" class="form-input" value="${isEdit ? escapeHtml(item.ad_code || '') : ''}" placeholder="萓・ GAD-001" />
      </div>
      <div class="form-row">
        <label class="form-label">繧ｵ繧､繝・/label>
        <select id="modal-campaign-site" class="form-select">
          <option value="">-- 驕ｸ謚槭＠縺ｦ縺上□縺輔＞ --</option>
          ${siteOptions}
        </select>
      </div>
      <div class="form-row inline">
        <label class="form-label">迥ｶ諷・/label>
        <select id="modal-campaign-active" class="form-select" style="width:auto">
          <option value="1" ${!isEdit || item.is_active ? 'selected' : ''}>譛牙柑</option>
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
        showToast('繧ｭ繝｣繝ｳ繝壹・繝ｳ蜷阪・蟐剃ｽ薙・繧ｵ繧､繝医・蠢・医〒縺・, 'error')
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
        showToast(isEdit ? '譖ｴ譁ｰ縺励∪縺励◆' : '霑ｽ蜉縺励∪縺励◆', 'success')
        renderCampaignMaster(root)
      } else {
        showToast(res.error || '菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆', 'error')
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

/** GET荳隕ｧ蜿門ｾ励・蜈ｱ騾壹Λ繝・ヱ繝ｼ */
async function fetchList(url) {
  try {
    const res = await axios.get(url)
    return res.data.data || []
  } catch (err) {
    console.error(err)
    showToast('繝・・繧ｿ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆', 'error')
    return []
  }
}

/** DELETE縺ｮ蜈ｱ騾壹Λ繝・ヱ繝ｼ */
async function deleteItem(baseUrl, id) {
  try {
    const res = await axios.delete(`${baseUrl}/${id}`)
    return res.data
  } catch (err) {
    return err.response?.data || { success: false, error: '蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆' }
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
