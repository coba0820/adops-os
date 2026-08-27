// ============================================================
// マスタ管理画面
// タブ切替: 媒体マスタ / サイトマスタ / 広告コードマスタ / キャンペーングループ管理
// ============================================================
import { showModal, closeModal, confirmDelete } from '../components/modal.js'
import { showToast } from '../components/toast.js'
import { decodeCsvFile, parseCsv } from '../components/csv-parser.js'
import { parseXlsxFile } from '../components/xlsx-parser.js'

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
 * @param {HTMLElement} container #main-content 要素
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
            <button class="icon-btn" data-action="mapping" data-id="${m.id}" title="CSV列マッピング"><i class="fa-solid fa-table-columns"></i></button>
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
        <thead><tr><th>媒体ID</th><th>媒体名</th><th>通貨</th><th>状態</th><th style="width:130px">操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindMediaRowEvents(root, list) {
  root.querySelectorAll('[data-action="mapping"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = list.find((m) => m.id === Number(btn.dataset.id))
      openMediaColumnMappingModal(item)
    })
  })
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
        <label class="form-label">通貨</label>
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

async function openMediaColumnMappingModal(media) {
  if (!media) return

  let fields = []
  let headers = []
  let rows = []
  let savedMappings = []
  let hasDedicatedParser = false

  const mappingRes = await axios.get(`/api/media-column-mappings?media_id=${media.id}`)
    .then((res) => res.data)
    .catch((err) => err.response?.data || { success: false, error: '列マッピングの取得に失敗しました' })

  if (!mappingRes.success) {
    showToast(mappingRes.error || '列マッピングの取得に失敗しました', 'error')
    return
  }

  fields = mappingRes.data.fields || []
  savedMappings = mappingRes.data.mappings || []
  hasDedicatedParser = !!mappingRes.data.has_dedicated_parser

  showModal({
    title: `${media.media_name}のCSV列マッピング`,
    modalClass: 'modal-box-wide',
    confirmLabel: '保存',
    bodyHtml: `
      <div class="column-mapping-panel is-modal">
        ${hasDedicatedParser ? '<div class="form-hint">この媒体は専用Parserが優先されます。ここで保存した設定は、専用Parserがない媒体向けの汎用取込で利用します。</div>' : ''}
        <div class="form-row">
          <label class="form-label">ヘッダー取得用ファイル</label>
          <input type="file" id="media-mapping-file" class="form-input" accept=".csv,.xlsx" />
          <div class="form-hint">CSV / XLSX のヘッダーを読み込むと、プルダウンから列を選べます。</div>
        </div>
        <div id="media-mapping-grid"></div>
        <div id="media-mapping-preview" class="column-mapping-preview"></div>
        <div class="column-mapping-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="media-mapping-preview-btn">
            <i class="fa-solid fa-table"></i>変換プレビュー
          </button>
        </div>
      </div>
    `,
    onConfirm: async () => {
      const modal = document.getElementById('active-modal-overlay')
      const mappings = collectMediaColumnMappings(modal)
      const res = await axios.post('/api/media-column-mappings', {
        media_id: media.id,
        mappings,
      }).then((response) => response.data).catch((err) => err.response?.data || { success: false, error: '保存に失敗しました' })

      if (!res.success) {
        showToast(res.error || '列マッピングの保存に失敗しました', 'error')
        return
      }

      closeModal()
      showToast('列マッピングを保存しました', 'success')
    },
  })

  const modal = document.getElementById('active-modal-overlay')
  const gridRoot = modal.querySelector('#media-mapping-grid')
  const fileInput = modal.querySelector('#media-mapping-file')
  const previewButton = modal.querySelector('#media-mapping-preview-btn')
  const previewRoot = modal.querySelector('#media-mapping-preview')

  function renderGrid(suggestions = []) {
    const sourceByField = new Map([
      ...suggestions.map((mapping) => [mapping.fieldKey, mapping.sourceColumn]),
      ...savedMappings.map((mapping) => [mapping.fieldKey, mapping.sourceColumn]),
    ])
    const optionHeaders = headers.length > 0
      ? headers
      : [...new Set(savedMappings.map((mapping) => mapping.sourceColumn).filter(Boolean))]

    gridRoot.innerHTML = `
      <div class="column-mapping-grid">
        ${fields.map((field) => `
          <div class="column-mapping-row">
            <label>${escapeHtml(field.label)}${field.required ? '<span class="required-mark">*</span>' : ''}</label>
            <select class="form-select" data-media-mapping-field="${escapeHtml(field.key)}">
              <option value="">未設定</option>
              ${optionHeaders.map((header) => `
                <option value="${escapeHtml(header)}" ${sourceByField.get(field.key) === header ? 'selected' : ''}>
                  ${escapeHtml(header)}
                </option>
              `).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    `
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return

    try {
      rows = await parseMediaMappingFile(file)
      headers = rows[0] || []
      const previewRes = await axios.post('/api/media-column-mappings/preview', {
        media_id: media.id,
        rows,
      }).then((res) => res.data).catch((err) => err.response?.data || { success: false, error: 'ヘッダー解析に失敗しました' })
      renderGrid(previewRes.data?.suggested_mappings || [])
      showToast('ヘッダーを読み込みました', 'success')
    } catch (err) {
      showToast(err.message || 'ファイル解析に失敗しました', 'error')
    }
  })

  previewButton.addEventListener('click', async () => {
    if (rows.length === 0) {
      showToast('先にCSV/XLSXファイルを選択してください', 'error')
      return
    }

    const previewRes = await axios.post('/api/media-column-mappings/preview', {
      media_id: media.id,
      rows,
      mappings: collectMediaColumnMappings(modal),
    }).then((res) => res.data).catch((err) => err.response?.data || { success: false, error: '変換プレビューに失敗しました' })

    if (!previewRes.success || !previewRes.data?.ready) {
      showToast(
        previewRes.error ||
        previewRes.data?.preview_error ||
        `必須項目が未設定です: ${(previewRes.data?.missing_required || []).join('、')}`,
        'error'
      )
      return
    }

    renderMediaColumnMappingPreview(previewRoot, previewRes.data.preview_rows || [])
  })

  renderGrid()
}

async function parseMediaMappingFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const { text } = await decodeCsvFile(file)
    return parseCsv(text)
  }
  if (name.endsWith('.xlsx')) {
    const parsed = await parseXlsxFile(file)
    return parsed.rows || []
  }
  throw new Error('CSVまたはXLSXファイルを選択してください')
}

function collectMediaColumnMappings(root) {
  return [...root.querySelectorAll('[data-media-mapping-field]')].map((select) => ({
    fieldKey: select.dataset.mediaMappingField,
    sourceColumn: select.value,
  }))
}

function renderMediaColumnMappingPreview(root, rows) {
  if (rows.length === 0) {
    root.innerHTML = '<div class="empty-state compact">プレビューできる行がありません</div>'
    return
  }

  root.innerHTML = `
    <div class="form-hint">変換後プレビュー</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr><th>日付</th><th>広告費</th><th>Imp</th><th>Click</th><th>媒体CV</th><th>キャンペーン名</th><th>キャンペーンID</th></tr>
        </thead>
        <tbody>
          ${rows.slice(0, 20).map((row) => `
            <tr>
              <td>${escapeHtml(row.targetDate || '-')}</td>
              <td>${Number(row.spend || 0).toLocaleString('ja-JP')}</td>
              <td>${Number(row.impressions || 0).toLocaleString('ja-JP')}</td>
              <td>${Number(row.clicks || 0).toLocaleString('ja-JP')}</td>
              <td>${Number(row.mediaCv || 0).toLocaleString('ja-JP')}</td>
              <td>${escapeHtml(row.campaignName || '-')}</td>
              <td>${escapeHtml(row.campaignId || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
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
      <div class="action-btn-group">
        <button class="btn btn-secondary" id="campaign-template-download-btn">
          <i class="fa-solid fa-download"></i>テンプレートをダウンロード
        </button>
        <button class="btn btn-secondary" id="campaign-bulk-import-btn" ${mediaList.length === 0 || siteList.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-file-import"></i>CSV/XLSX一括取込
        </button>
        <button class="btn btn-primary" id="campaign-add-btn" ${mediaList.length === 0 || siteList.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-plus"></i>広告コードを追加
        </button>
      </div>
    </div>
    ${mediaList.length === 0 || siteList.length === 0 ? '<div class="form-hint" style="margin-bottom:16px">※ 先に媒体マスタ・サイトマスタを1件以上登録してください</div>' : ''}
    ${renderCampaignTable(campaigns)}
  `

  root.querySelector('#campaign-add-btn')?.addEventListener('click', () => openCampaignModal(root, null, mediaList, siteList))
  root.querySelector('#campaign-bulk-import-btn')?.addEventListener('click', () => openCampaignBulkImportModal(root))
  root.querySelector('#campaign-template-download-btn')?.addEventListener('click', downloadCampaignTemplate)
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
        <td title="${escapeHtml(c.site_names || c.site_name || '-')}">${escapeHtml(formatCampaignSiteLabel(c))}</td>
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
  let selectedSites = getCampaignSiteIds(item)
    .map((siteId) => siteList.find((site) => Number(site.id) === Number(siteId)))
    .filter(Boolean)
  let siteSearchText = ''

  const mediaOptions = mediaList
    .map((m) => `<option value="${m.id}" ${isEdit && item.media_id === m.id ? 'selected' : ''}>${escapeHtml(m.media_name)}</option>`)
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
        <input type="text" id="modal-campaign-adcode" class="form-input" value="${isEdit ? escapeHtml(item.ad_code || '') : ''}" placeholder="例 GAD-001" />
      </div>
      <div class="form-row">
        <label class="form-label">サイト</label>
        <div class="campaign-ad-code-picker">
          <input type="search" id="modal-campaign-site-search" class="form-input" placeholder="サイト名で検索" />
          <div id="modal-campaign-selected-sites" class="selected-chip-list"></div>
          <div id="modal-campaign-site-list" class="ad-code-choice-list"></div>
          <div class="form-hint">1つの広告コードに複数サイトを紐付けできます。</div>
        </div>
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
      const siteIds = selectedSites.map((site) => Number(site.id))
      const isActive = Number(document.getElementById('modal-campaign-active').value)

      if (!name || !mediaId || siteIds.length === 0) {
        showToast('キャンペーン名・媒体・サイトは必須です', 'error')
        return
      }

      const payload = {
        campaign_name: name,
        media_id: Number(mediaId),
        ad_code: adCode,
        site_id: siteIds[0],
        site_ids: siteIds,
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

  const modal = document.getElementById('active-modal-overlay')
  const searchInput = modal.querySelector('#modal-campaign-site-search')
  const listRoot = modal.querySelector('#modal-campaign-site-list')
  const chipsRoot = modal.querySelector('#modal-campaign-selected-sites')

  function renderSitePicker() {
    const selectedIds = new Set(selectedSites.map((site) => Number(site.id)))
    const keyword = siteSearchText.trim().toLowerCase()
    const filteredSites = siteList.filter((site) =>
      !keyword || String(site.site_name || '').toLowerCase().includes(keyword)
    )

    chipsRoot.innerHTML = selectedSites.length === 0
      ? `<div class="form-hint">サイトは未選択です</div>`
      : selectedSites.map((site) => `
        <button type="button" class="selected-chip" data-id="${site.id}">
          ${escapeHtml(site.site_name || '-')} <span>×</span>
        </button>
      `).join('')

    listRoot.innerHTML = filteredSites.length === 0
      ? `<div class="empty-state compact">選択できるサイトがありません</div>`
      : filteredSites.map((site) => {
        const selected = selectedIds.has(Number(site.id))
        return `
          <button type="button" class="ad-code-choice ${selected ? 'selected' : ''}" data-id="${site.id}">
            <span class="ad-code-check"><i class="fa-solid ${selected ? 'fa-check' : 'fa-plus'}"></i></span>
            <span>
              <strong>${escapeHtml(site.site_name || '-')}</strong>
              <small>サイトID: ${Number(site.id).toLocaleString('ja-JP')}</small>
            </span>
          </button>
        `
      }).join('')

    chipsRoot.querySelectorAll('.selected-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedSites = selectedSites.filter((site) => Number(site.id) !== Number(chip.dataset.id))
        renderSitePicker()
      })
    })
    listRoot.querySelectorAll('.ad-code-choice').forEach((choice) => {
      choice.addEventListener('click', () => {
        const id = Number(choice.dataset.id)
        const exists = selectedSites.some((site) => Number(site.id) === id)
        if (exists) {
          selectedSites = selectedSites.filter((site) => Number(site.id) !== id)
        } else {
          const site = siteList.find((candidate) => Number(candidate.id) === id)
          if (site) selectedSites = [...selectedSites, site]
        }
        renderSitePicker()
      })
    })
  }

  searchInput.addEventListener('input', () => {
    siteSearchText = searchInput.value
    renderSitePicker()
  })

  renderSitePicker()
}

function getCampaignSiteIds(item) {
  if (!item) return []
  if (Array.isArray(item.site_ids)) return item.site_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
  if (typeof item.site_ids === 'string') {
    return item.site_ids
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  }
  return item.site_id ? [Number(item.site_id)] : []
}

function formatCampaignSiteLabel(item) {
  const count = Number(item.site_count || getCampaignSiteIds(item).length || 0)
  if (count > 1) return `${count.toLocaleString('ja-JP')}サイト`
  return item.site_name || '-'
}

function downloadCampaignTemplate() {
  const link = document.createElement('a')
  link.href = '/api/campaign/template'
  link.download = '広告コード一括取込テンプレート.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function openCampaignBulkImportModal(root) {
  let parsedRows = []
  let selectedFileName = ''
  let previewData = null
  let importData = null
  let showErrorsOnly = false

  showModal({
    title: '広告コードをCSV/XLSXで一括取込',
    modalClass: 'modal-box-wide',
    confirmLabel: '取込を実行',
    bodyHtml: `
      <div class="campaign-bulk-modal">
        <div class="form-row">
          <label class="form-label">取込モード</label>
          <select id="campaign-bulk-mode" class="form-select">
            <option value="upsert">追加＋更新</option>
            <option value="create_only">追加のみ</option>
            <option value="update_only">更新のみ</option>
          </select>
          <div class="form-hint">正常行だけ保存します。エラー行は保存されません。サイト紐付けはファイル内容で置き換えます。</div>
        </div>
        <div class="form-row">
          <label class="form-label">ファイル</label>
          <input type="file" id="campaign-bulk-file" class="form-input" accept=".csv,.xlsx" />
          <div id="campaign-bulk-file-status" class="form-hint">CSVはUTF-8 / UTF-8 BOM / Shift_JISに対応しています。</div>
        </div>
        <div class="campaign-bulk-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="campaign-bulk-preview-btn">
            <i class="fa-solid fa-magnifying-glass"></i>プレビュー
          </button>
          <label class="campaign-bulk-error-toggle">
            <input type="checkbox" id="campaign-bulk-errors-only" />
            エラー行のみ表示
          </label>
          <button type="button" class="btn btn-secondary btn-sm" id="campaign-bulk-result-download-btn" disabled>
            <i class="fa-solid fa-file-arrow-down"></i>エラー/スキップCSV
          </button>
        </div>
        <div id="campaign-bulk-summary" class="campaign-bulk-summary"></div>
        <div id="campaign-bulk-preview-root" class="campaign-bulk-preview-root">
          <div class="empty-state compact">ファイルを選択してプレビューしてください</div>
        </div>
      </div>
    `,
    onConfirm: async () => {
      if (!previewData) {
        showToast('先にプレビューを実行してください', 'error')
        return
      }

      const targetCount = Number(previewData.summary.create || 0) + Number(previewData.summary.update || 0)
      if (targetCount === 0) {
        showToast('取込対象の正常行がありません', 'error')
        return
      }

      if (!window.confirm(`正常行 ${targetCount.toLocaleString('ja-JP')} 件を取り込みます。よろしいですか？`)) return

      const confirmButton = document.getElementById('modal-confirm-btn')
      if (confirmButton) {
        confirmButton.disabled = true
        confirmButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>取込中'
      }

      const res = await axios.post('/api/campaign/bulk-import', {
        mode: getCampaignBulkMode(),
        rows: parsedRows,
      }).then((r) => r.data).catch((e) => e.response?.data || { success: false, error: '一括取込に失敗しました' })

      if (confirmButton) {
        confirmButton.disabled = false
        confirmButton.innerHTML = '取込を実行'
      }

      if (!res.success) {
        showToast(res.error || '一括取込に失敗しました', 'error')
        return
      }

      importData = res.data
      previewData = res.data
      renderCampaignBulkPreview(previewData, {
        root: document.getElementById('campaign-bulk-preview-root'),
        summaryRoot: document.getElementById('campaign-bulk-summary'),
        showErrorsOnly,
        fileName: selectedFileName,
      })
      document.getElementById('campaign-bulk-result-download-btn').disabled = !hasCampaignBulkResultRows(importData)
      showToast('広告コードマスタを一括取込しました', 'success')
      renderCampaignMaster(root)
    },
  })

  const modal = document.getElementById('active-modal-overlay')
  const fileInput = modal.querySelector('#campaign-bulk-file')
  const fileStatus = modal.querySelector('#campaign-bulk-file-status')
  const previewButton = modal.querySelector('#campaign-bulk-preview-btn')
  const errorsOnlyInput = modal.querySelector('#campaign-bulk-errors-only')
  const resultDownloadButton = modal.querySelector('#campaign-bulk-result-download-btn')
  const confirmButton = modal.querySelector('#modal-confirm-btn')
  const summaryRoot = modal.querySelector('#campaign-bulk-summary')
  const previewRoot = modal.querySelector('#campaign-bulk-preview-root')

  if (confirmButton) confirmButton.disabled = true

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    previewData = null
    importData = null
    parsedRows = []
    selectedFileName = file?.name || ''
    summaryRoot.innerHTML = ''
    previewRoot.innerHTML = '<div class="empty-state compact">ファイルを解析しています...</div>'
    resultDownloadButton.disabled = true
    if (confirmButton) confirmButton.disabled = true

    if (!file) {
      fileStatus.textContent = 'CSVはUTF-8 / UTF-8 BOM / Shift_JISに対応しています。'
      previewRoot.innerHTML = '<div class="empty-state compact">ファイルを選択してプレビューしてください</div>'
      return
    }

    try {
      parsedRows = await parseCampaignBulkFile(file)
      fileStatus.textContent = `${file.name} / ${parsedRows.length.toLocaleString('ja-JP')}行を読み込みました`
      previewRoot.innerHTML = '<div class="empty-state compact">プレビューを実行してください</div>'
    } catch (err) {
      fileStatus.textContent = file.name
      previewRoot.innerHTML = `<div class="empty-state compact">${escapeHtml(err.message || 'ファイル解析に失敗しました')}</div>`
      showToast(err.message || 'ファイル解析に失敗しました', 'error')
    }
  })

  modal.querySelector('#campaign-bulk-mode').addEventListener('change', () => {
    previewData = null
    importData = null
    summaryRoot.innerHTML = ''
    previewRoot.innerHTML = '<div class="empty-state compact">モードを変更しました。再度プレビューしてください</div>'
    resultDownloadButton.disabled = true
    if (confirmButton) confirmButton.disabled = true
  })

  previewButton.addEventListener('click', async () => {
    if (parsedRows.length === 0) {
      showToast('取込ファイルを選択してください', 'error')
      return
    }

    previewButton.disabled = true
    previewButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>確認中'
    const res = await axios.post('/api/campaign/bulk-preview', {
      mode: getCampaignBulkMode(),
      rows: parsedRows,
    }).then((r) => r.data).catch((e) => e.response?.data || { success: false, error: 'プレビューに失敗しました' })
    previewButton.disabled = false
    previewButton.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>プレビュー'

    if (!res.success) {
      showToast(res.error || 'プレビューに失敗しました', 'error')
      previewRoot.innerHTML = `<div class="empty-state compact">${escapeHtml(res.error || 'プレビューに失敗しました')}</div>`
      if (confirmButton) confirmButton.disabled = true
      return
    }

    previewData = res.data
    importData = null
    renderCampaignBulkPreview(previewData, { root: previewRoot, summaryRoot, showErrorsOnly, fileName: selectedFileName })
    resultDownloadButton.disabled = !hasCampaignBulkResultRows(previewData)
    if (confirmButton) {
      confirmButton.disabled = (Number(previewData.summary.create || 0) + Number(previewData.summary.update || 0)) === 0
    }
  })

  errorsOnlyInput.addEventListener('change', () => {
    showErrorsOnly = errorsOnlyInput.checked
    if (previewData) {
      renderCampaignBulkPreview(previewData, { root: previewRoot, summaryRoot, showErrorsOnly, fileName: selectedFileName })
    }
  })

  resultDownloadButton.addEventListener('click', () => {
    const data = importData || previewData
    if (!data || !hasCampaignBulkResultRows(data)) return
    downloadCampaignBulkResultCsv(data.rows, selectedFileName)
  })
}

function getCampaignBulkMode() {
  return document.getElementById('campaign-bulk-mode')?.value || 'upsert'
}

async function parseCampaignBulkFile(file) {
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.xlsx')) {
    const parsed = await parseXlsxFile(file)
    return parsed.rows || []
  }
  if (lowerName.endsWith('.csv')) {
    const text = await readCampaignCsvText(file)
    return parseCampaignCsvText(text)
  }
  throw new Error('CSVまたはXLSXファイルを選択してください')
}

async function readCampaignCsvText(file) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  let sjis = ''
  try {
    sjis = new TextDecoder('shift_jis').decode(buffer)
  } catch (_) {
    sjis = utf8
  }

  const score = (text) => (text.match(/\uFFFD/g) || []).length
  const selected = score(sjis) < score(utf8) ? sjis : utf8
  return selected.replace(/^\uFEFF/, '')
}

function parseCampaignCsvText(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some((value) => String(value).trim() !== '')) rows.push(row)

  return rows
}

function renderCampaignBulkPreview(data, { root, summaryRoot, showErrorsOnly, fileName }) {
  const rows = showErrorsOnly
    ? data.rows.filter((row) => row.judgement === 'エラー')
    : data.rows
  const displayRows = rows.slice(0, 500)
  const hiddenCount = Math.max(rows.length - displayRows.length, 0)
  const savedCount = Number(data.created_count || 0) + Number(data.updated_count || 0)

  summaryRoot.innerHTML = `
    <div class="campaign-bulk-summary-grid">
      ${renderBulkSummaryItem('対象ファイル', fileName || '-')}
      ${renderBulkSummaryItem('全体', data.summary.total)}
      ${renderBulkSummaryItem('新規', data.summary.create)}
      ${renderBulkSummaryItem('更新', data.summary.update)}
      ${renderBulkSummaryItem('スキップ', data.summary.skip)}
      ${renderBulkSummaryItem('エラー', data.summary.error)}
      ${savedCount > 0 ? renderBulkSummaryItem('保存済み', savedCount) : ''}
    </div>
  `

  if (data.rows.length === 0) {
    root.innerHTML = '<div class="empty-state compact">取込対象行がありません</div>'
    return
  }

  root.innerHTML = `
    ${hiddenCount > 0 ? `<div class="form-hint" style="margin-bottom:8px">表示は先頭500行までです。残り${hiddenCount.toLocaleString('ja-JP')}行も取込対象に含まれます。</div>` : ''}
    <div class="table-scroll campaign-bulk-table-scroll">
      <table class="data-table campaign-bulk-table">
        <thead>
          <tr>
            <th>行</th><th>キャンペーン名</th><th>媒体</th><th>広告コード</th><th>サイト</th><th>状態</th><th>判定</th><th>エラー/理由</th>
          </tr>
        </thead>
        <tbody>
          ${displayRows.map((row) => `
            <tr class="${row.judgement === 'エラー' ? 'campaign-bulk-row-error' : row.judgement === 'スキップ' ? 'campaign-bulk-row-skip' : ''}">
              <td>${Number(row.row_number).toLocaleString('ja-JP')}</td>
              <td>${escapeHtml(row.campaign_name || '-')}</td>
              <td>${escapeHtml(row.media || '-')}</td>
              <td>${escapeHtml(row.ad_code || '-')}</td>
              <td>${escapeHtml((row.site_names && row.site_names.length > 0 ? row.site_names.join('、') : row.sites) || '-')}</td>
              <td>${escapeHtml(row.status || '有効')}</td>
              <td>${renderCampaignBulkBadge(row.judgement)}</td>
              <td>${escapeHtml((row.errors || []).join(' / ') || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
}

function renderBulkSummaryItem(label, value) {
  const displayValue = typeof value === 'number' ? value.toLocaleString('ja-JP') : escapeHtml(value)
  return `
    <div class="campaign-bulk-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${displayValue}</strong>
    </div>
  `
}

function renderCampaignBulkBadge(judgement) {
  const className = judgement === 'エラー'
    ? 'badge-inactive'
    : judgement === 'スキップ'
      ? 'badge-paused'
      : 'badge-active'
  return `<span class="badge ${className}">${escapeHtml(judgement)}</span>`
}

function hasCampaignBulkResultRows(data) {
  return data.rows.some((row) => row.judgement === 'エラー' || row.judgement === 'スキップ')
}

function downloadCampaignBulkResultCsv(rows, fileName) {
  const targetRows = rows.filter((row) => row.judgement === 'エラー' || row.judgement === 'スキップ')
  const csvRows = [
    ['行番号', 'キャンペーン名', '媒体', '広告コード', 'サイト', '状態', '判定', 'エラー/理由'],
    ...targetRows.map((row) => [
      row.row_number,
      row.campaign_name,
      row.media,
      row.ad_code,
      row.sites,
      row.status,
      row.judgement,
      (row.errors || []).join(' / '),
    ]),
  ]
  const csv = `\uFEFF${csvRows.map((row) => row.map(makeClientCsvValue).join(',')).join('\r\n')}\r\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const baseName = (fileName || 'campaign_bulk_import').replace(/\.[^.]+$/, '')
  link.href = url
  link.download = `${baseName}_errors.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function makeClientCsvValue(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  const escaped = text.replace(/"/g, '""')
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped
}

// ============================================================
// キャンペーングループ管理
// ============================================================
// キャンペーングループ管理
// ============================================================
async function renderCampaignGroupMaster(root) {
  root.innerHTML = `<div class="empty-state">読み込み中...</div>`

  const [groups, mediaList] = await Promise.all([
    fetchList('/api/campaign-groups?include_inactive=1'),
    fetchList('/api/media'),
  ])

  root.innerHTML = `
    <div class="section-toolbar">
      <p class="section-desc mt-0" style="margin-bottom:0">広告コードをキャンペーングループへまとめ、実績分析の集計軸として利用します。</p>
      <button class="btn btn-primary" id="campaign-group-add-btn" ${mediaList.length === 0 ? 'disabled' : ''}>
        <i class="fa-solid fa-plus"></i>グループを追加
      </button>
    </div>
    ${renderCampaignGroupTable(groups)}
  `

  root.querySelector('#campaign-group-add-btn')?.addEventListener('click', () =>
    openCampaignGroupModal(root, null, mediaList)
  )
  bindCampaignGroupEvents(root, groups, mediaList)
}

function renderCampaignGroupTable(groups) {
  if (groups.length === 0) {
    return `<div class="empty-state">キャンペーングループはまだ登録されていません</div>`
  }

  const rows = groups.map((group) => `
    <tr>
      <td>
        <button class="text-link" data-action="edit-group" data-id="${group.id}">
          ${escapeHtml(group.group_name)}
        </button>
      </td>
      <td>${escapeHtml(group.media_name || '-')}</td>
      <td>
        <button class="text-link" data-action="edit-group" data-id="${group.id}" title="所属広告コードを編集">
          ${Number(group.ad_code_count || 0).toLocaleString('ja-JP')}</button>
      </td>
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
  root.querySelectorAll('[data-action="edit-group"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = groups.find((item) => item.id === Number(btn.dataset.id))
      openCampaignGroupModal(root, group, mediaList)
    })
  })
  root.querySelectorAll('[data-action="delete-group"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('このキャンペーングループを削除しますか？広告コード自体は削除されません。')) return
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

async function openCampaignGroupModal(root, group, mediaList) {
  const isEdit = !!group
  let detail = null
  let selectedAdCodes = []
  let availableAdCodes = []
  let currentMediaId = isEdit ? String(group.media_id) : ''
  let searchText = ''

  if (isEdit) {
    try {
      const res = await axios.get(`/api/campaign-groups/${group.id}`)
      detail = res.data.data
      selectedAdCodes = detail.ad_codes || []
      currentMediaId = String(detail.group.media_id)
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || 'キャンペーングループの取得に失敗しました', 'error')
      return
    }
  }

  async function loadAvailableAdCodes() {
    if (!currentMediaId) {
      availableAdCodes = []
      selectedAdCodes = []
      return
    }
    const params = new URLSearchParams()
    params.set('media_id', currentMediaId)
    if (isEdit) params.set('group_id', group.id)
    const res = await axios.get(`/api/campaign-groups/available-ad-codes?${params.toString()}`)
    const list = res.data.data || []
    const merged = new Map()
    list.forEach((item) => merged.set(Number(item.id), item))
    selectedAdCodes.forEach((item) => {
      if (String(item.media_id) === currentMediaId) merged.set(Number(item.id), item)
    })
    availableAdCodes = [...merged.values()].sort((a, b) => String(a.ad_code || '').localeCompare(String(b.ad_code || ''), 'ja'))
    selectedAdCodes = selectedAdCodes.filter((item) => String(item.media_id) === currentMediaId)
  }

  await loadAvailableAdCodes()

  const groupData = detail?.group || group || {}
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${String(media.id) === currentMediaId ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')

  showModal({
    title: isEdit ? 'キャンペーングループを編集' : 'キャンペーングループを追加',
    modalClass: 'modal-box-wide',
    bodyHtml: `
      <div class="campaign-group-modal-grid">
        <div class="form-row">
          <label class="form-label">媒体</label>
          <select id="modal-campaign-group-media" class="form-select">
            <option value="">-- 選択してください --</option>
            ${mediaOptions}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">ステータス</label>
          <select id="modal-campaign-group-active" class="form-select">
            <option value="1" ${!isEdit || groupData.is_active ? 'selected' : ''}>有効</option>
            <option value="0" ${isEdit && !groupData.is_active ? 'selected' : ''}>無効</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">グループ名</label>
        <input type="text" id="modal-campaign-group-name" class="form-input" value="${isEdit ? escapeHtml(groupData.group_name) : ''}" placeholder="例 app395系" />
      </div>
      <div class="form-row">
        <label class="form-label">説明</label>
        <textarea id="modal-campaign-group-description" class="form-input" rows="3">${isEdit ? escapeHtml(groupData.description || '') : ''}</textarea>
      </div>
      <div class="form-row">
        <label class="form-label">広告コード選択</label>
        <div class="campaign-ad-code-picker">
          <input type="search" id="campaign-group-ad-code-search" class="form-input" placeholder="広告コード・キャンペーン名・サイト名で検索" />
          <div id="campaign-group-selected-chips" class="selected-chip-list"></div>
          <div id="campaign-group-ad-code-list" class="ad-code-choice-list"></div>
          <div class="form-hint">既に他のキャンペーングループへ所属している広告コードは候補に表示されません。</div>
        </div>
      </div>
    `,
    onConfirm: async () => {
      const payload = {
        media_id: Number(document.getElementById('modal-campaign-group-media').value),
        group_name: document.getElementById('modal-campaign-group-name').value.trim(),
        description: document.getElementById('modal-campaign-group-description').value.trim(),
        is_active: Number(document.getElementById('modal-campaign-group-active').value),
        ad_code_ids: selectedAdCodes.map((item) => Number(item.id)),
      }

      if (!payload.media_id || !payload.group_name) {
        showToast('媒体とグループ名を入力してください', 'error')
        return
      }
      if (payload.ad_code_ids.length === 0 && !window.confirm('広告コードが選択されていません。このまま保存しますか？')) {
        return
      }

      const res = isEdit
        ? await axios.put(`/api/campaign-groups/${group.id}`, payload).then((r) => r.data).catch((e) => e.response?.data || { success: false })
        : await axios.post('/api/campaign-groups', payload).then((r) => r.data).catch((e) => e.response?.data || { success: false })

      if (res.success) {
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        renderCampaignGroupMaster(root)
      } else {
        showToast(res.error || '保存に失敗しました', 'error')
      }
    },
  })

  const modal = document.getElementById('active-modal-overlay')
  const mediaSelect = modal.querySelector('#modal-campaign-group-media')
  const searchInput = modal.querySelector('#campaign-group-ad-code-search')
  const listRoot = modal.querySelector('#campaign-group-ad-code-list')
  const chipsRoot = modal.querySelector('#campaign-group-selected-chips')

  function renderPicker() {
    const selectedIds = new Set(selectedAdCodes.map((item) => Number(item.id)))
    const keyword = searchText.trim().toLowerCase()
    const filtered = availableAdCodes.filter((item) => {
      const haystack = `${item.ad_code || ''} ${item.campaign_name || ''} ${item.site_name || ''} ${item.site_names || ''}`.toLowerCase()
      return !keyword || haystack.includes(keyword)
    })

    chipsRoot.innerHTML = selectedAdCodes.length === 0
      ? `<div class="form-hint">広告コードは未選択です</div>`
      : selectedAdCodes.map((item) => `
        <button type="button" class="selected-chip" data-id="${item.id}">
          ${escapeHtml(item.ad_code || '-')} <span>×</span>
        </button>
      `).join('')

    listRoot.innerHTML = !currentMediaId
      ? `<div class="empty-state compact">媒体を選択してください</div>`
      : filtered.length === 0
        ? `<div class="empty-state compact">選択できる広告コードがありません</div>`
        : filtered.map((item) => {
          const selected = selectedIds.has(Number(item.id))
          return `
            <button type="button" class="ad-code-choice ${selected ? 'selected' : ''}" data-id="${item.id}">
              <span class="ad-code-check"><i class="fa-solid ${selected ? 'fa-check' : 'fa-plus'}"></i></span>
              <span>
                <strong>${escapeHtml(item.ad_code || '-')}</strong>
                <small>${escapeHtml(item.campaign_name || '-')} / ${escapeHtml(item.site_names || item.site_name || '-')}</small>
              </span>
            </button>
          `
        }).join('')

    chipsRoot.querySelectorAll('.selected-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedAdCodes = selectedAdCodes.filter((item) => Number(item.id) !== Number(chip.dataset.id))
        renderPicker()
      })
    })
    listRoot.querySelectorAll('.ad-code-choice').forEach((choice) => {
      choice.addEventListener('click', () => {
        const id = Number(choice.dataset.id)
        const exists = selectedAdCodes.some((item) => Number(item.id) === id)
        if (exists) {
          selectedAdCodes = selectedAdCodes.filter((item) => Number(item.id) !== id)
        } else {
          const item = availableAdCodes.find((candidate) => Number(candidate.id) === id)
          if (item) selectedAdCodes = [...selectedAdCodes, item]
        }
        renderPicker()
      })
    })
  }

  searchInput.addEventListener('input', () => {
    searchText = searchInput.value
    renderPicker()
  })
  mediaSelect.addEventListener('change', async () => {
    const beforeCount = selectedAdCodes.length
    currentMediaId = mediaSelect.value
    searchText = ''
    searchInput.value = ''
    await loadAvailableAdCodes()
    if (beforeCount > selectedAdCodes.length) {
      showToast('選択した媒体に属さない広告コードを解除しました', 'error')
    }
    renderPicker()
  })

  renderPicker()
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
