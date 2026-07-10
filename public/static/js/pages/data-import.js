// ============================================================
// データ取込画面
// 3種類のCSVをタブで切り替えてアップロード＋プレビューできる画面。
// v1.1ではCSVの実データは保存せず、upload_history に履歴のみ記録する。
// ============================================================
import { mountCsvUploadBox } from '../components/csv-upload-box.js'
import { showToast } from '../components/toast.js'

const TABS = [
  {
    key: 'ad_media_csv',
    label: '① 広告媒体CSV',
    desc: '媒体別の広告配信レポートCSVを取り込みます。媒体を選択してからアップロードしてください。',
    needsMedia: true,
  },
  {
    key: 'site_summary_csv',
    label: '② 媒体集計CSV',
    desc: '複数媒体を横断した集計CSVを取り込みます。',
    needsMedia: false,
  },
  {
    key: 'payment_report_csv',
    label: '③ 決済レポートCSV',
    desc: '決済代行会社から出力される売上・決済データCSVを取り込みます。',
    needsMedia: false,
  },
]

const FILE_TYPE_LABELS = {
  ad_media_csv: '広告媒体CSV',
  site_summary_csv: '媒体集計CSV',
  payment_report_csv: '決済レポートCSV',
  ad_media: '広告媒体CSV',
  media_aggregate: '媒体集計CSV',
  payment_report: '決済レポートCSV',
}

/**
 * データ取込画面を描画する
 * @param {HTMLElement} container #main-content 要素
 */
export async function renderDataImportPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  let mediaList = []
  try {
    const res = await axios.get('/api/media')
    mediaList = res.data.data || []
  } catch (err) {
    console.error(err)
  }

  const activeMediaList = mediaList.filter((m) => normalizeMediaStatus(m.status) === 'active')
  let activeTab = TABS[0].key

  function draw() {
    const tabBarHtml = TABS.map(
      (t) => `<div class="tab-item ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</div>`
    ).join('')

    const currentTab = TABS.find((t) => t.key === activeTab)

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-calendar-check"></i>今日の取込状況</div>
            <div class="card-subtitle">稼働中媒体のみ対象。停止中媒体は必要数に含めません。</div>
          </div>
        </div>
        <div id="today-upload-status-root">
          <div class="empty-state">読み込み中...</div>
        </div>
      </div>

      <div class="card">
        <div class="tab-bar">${tabBarHtml}</div>
        <p class="section-desc">${currentTab.desc}</p>
        <div id="upload-box-root"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title"><i class="fa-solid fa-clock-rotate-left"></i>取込履歴</div>
            <div class="card-subtitle">直近50件</div>
          </div>
        </div>
        <div id="upload-history-root">
          <div class="empty-state">読み込み中...</div>
        </div>
      </div>
    `

    container.querySelectorAll('.tab-item').forEach((el) => {
      el.addEventListener('click', () => {
        activeTab = el.dataset.tab
        draw()
      })
    })

    const uploadRoot = container.querySelector('#upload-box-root')
    mountCsvUploadBox(uploadRoot, {
      id: `upload-${currentTab.key}`,
      fileType: currentTab.key,
      showMediaSelect: currentTab.needsMedia,
      mediaList: activeMediaList,
      onUploadSuccess: () => refreshUploadPanels(container),
    })

    refreshUploadPanels(container)
  }

  draw()
}

async function refreshUploadPanels(container) {
  await Promise.all([
    refreshTodayStatus(container),
    refreshUploadHistory(container),
  ])
}

async function refreshTodayStatus(container) {
  const root = container.querySelector('#today-upload-status-root')
  if (!root) return

  try {
    const res = await axios.get('/api/upload/today')
    root.innerHTML = renderTodayStatus(res.data.data)
  } catch (err) {
    console.error(err)
    root.innerHTML = `<div class="empty-state">今日の取込状況を取得できませんでした</div>`
  }
}

async function refreshUploadHistory(container) {
  const root = container.querySelector('#upload-history-root')
  if (!root) return

  try {
    const res = await axios.get('/api/upload')
    root.innerHTML = renderUploadHistory(res.data.data || [])
    bindUploadHistoryEvents(root, container)
  } catch (err) {
    console.error(err)
    root.innerHTML = `<div class="empty-state">取込履歴を取得できませんでした</div>`
  }
}

function renderTodayStatus(status) {
  const rate = clampPercent(status?.completion_rate ?? 0)
  const uploadedCount = status?.uploaded_count ?? 0
  const requiredCount = status?.required_count ?? 0
  const activeMediaCount = status?.active_media_count ?? 0
  const targetDate = formatDateOnly(status?.target_date)

  return `
    <div class="import-summary-grid">
      <div class="import-summary-box">
        <div class="import-summary-label">取込済 / 必要数</div>
        <div class="import-summary-value">${uploadedCount} / ${requiredCount}</div>
      </div>
      <div class="import-summary-box">
        <div class="import-summary-label">完了率</div>
        <div class="import-summary-value">${rate}%</div>
      </div>
      <div class="import-summary-box">
        <div class="import-summary-label">対象媒体</div>
        <div class="import-summary-value">${activeMediaCount}</div>
      </div>
      <div class="import-summary-box">
        <div class="import-summary-label">対象日</div>
        <div class="import-summary-value small">${targetDate}</div>
      </div>
    </div>

    <div class="import-progress-track">
      <div class="import-progress-fill" style="width: ${rate}%"></div>
    </div>

    ${renderTodayStatusTable(status?.items || [])}
  `
}

function renderTodayStatusTable(items) {
  if (items.length === 0) {
    return `<div class="empty-state">今日の取込対象がありません</div>`
  }

  const rows = items
    .map((item) => {
      const upload = item.latest_upload
      return `
        <tr>
          <td>${escapeHtml(item.label || getFileTypeLabel(item.file_type))}</td>
          <td>${escapeHtml(item.media_name || '全体')}</td>
          <td>${renderImportStatusBadge(item.uploaded)}</td>
          <td>${upload ? formatDateTime(upload.uploaded_at) : '-'}</td>
          <td>${upload ? `${Number(upload.row_count).toLocaleString('ja-JP')}行` : '-'}</td>
          <td>${upload ? escapeHtml(upload.file_name) : '-'}</td>
        </tr>
      `
    })
    .join('')

  return `
    <div class="table-scroll import-status-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>CSV種別</th>
            <th>対象</th>
            <th>状況</th>
            <th>最終取込</th>
            <th>行数</th>
            <th>ファイル名</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function renderUploadHistory(list) {
  if (list.length === 0) {
    return `<div class="empty-state">取込履歴はまだありません</div>`
  }

  const rows = list
    .map(
      (item) => `
      <tr>
        <td>${getFileTypeLabel(item.file_type)}</td>
        <td>${escapeHtml(item.media_name || '-')}</td>
        <td>${escapeHtml(item.file_name)}</td>
        <td>${Number(item.row_count).toLocaleString('ja-JP')}行</td>
        <td><span class="badge badge-active">success</span></td>
        <td>${formatDateTime(item.uploaded_at)}</td>
        <td>
          <button class="icon-btn danger" data-action="delete-upload" data-id="${item.id}" data-file-name="${escapeHtml(item.file_name)}" title="削除">
            <i class="fa-solid fa-trash"></i>
          </button>
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
            <th>CSV種別</th>
            <th>媒体</th>
            <th>ファイル名</th>
            <th>行数</th>
            <th>status</th>
            <th>取込日時</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function bindUploadHistoryEvents(root, container) {
  root.querySelectorAll('[data-action="delete-upload"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id
      const fileName = btn.dataset.fileName || ''
      if (!id) return

      const confirmed = window.confirm(`「${fileName}」の取込履歴と紐づく明細を削除します。よろしいですか？`)
      if (!confirmed) return

      btn.disabled = true
      try {
        await axios.delete(`/api/upload/${id}`)
        showToast('取込履歴を削除しました', 'success')
        window.dispatchEvent(new CustomEvent('adops:analysis-invalidated'))
        await refreshUploadPanels(container)
      } catch (err) {
        console.error(err)
        showToast(err.response?.data?.error || '取込履歴の削除に失敗しました', 'error')
        btn.disabled = false
      }
    })
  })
}

function renderImportStatusBadge(uploaded) {
  return uploaded
    ? '<span class="badge badge-active">取込済</span>'
    : '<span class="badge badge-inactive">未取込</span>'
}

function getFileTypeLabel(fileType) {
  return FILE_TYPE_LABELS[fileType] || escapeHtml(fileType || '-')
}

function normalizeMediaStatus(status) {
  return status === 'paused' || status === 'archived' ? status : 'active'
}

function clampPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, number))
}

function formatDateOnly(value) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00+09:00`)
  return date.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  })
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
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
