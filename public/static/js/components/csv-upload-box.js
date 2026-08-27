// ============================================================
// CSVアップロード＋プレビュー 共通コンポーネント
// データ取込画面の3種類（広告媒体CSV / 媒体集計CSV / 決済レポートCSV）
// で共通利用するUIブロック。
// v1では「アップロード＋プレビュー表示」のみが目的で、
// 広告媒体CSVは日次実績も保存し、それ以外は履歴だけAPIに記録する。
// ============================================================
import { decodeCsvFile, parseCsv } from './csv-parser.js'
import { parseXlsxFile } from './xlsx-parser.js'
import { showToast } from './toast.js'

const PREVIEW_MAX_ROWS = 20 // プレビューに表示する最大行数（ヘッダ除く）
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024
const SUPPORTED_EXTENSIONS = ['csv', 'xlsx']

/**
 * CSVアップロードボックスを指定要素内に構築する
 * @param {HTMLElement} rootEl このコンポーネントを描画する親要素
 * @param {object} options
 * @param {string} options.id DOM要素のユニークID接頭辞
 * @param {string} options.fileType upload_history に記録するタイプ('ad_media_csv'等)
 * @param {boolean} options.showMediaSelect 媒体選択ドロップダウンを表示するか
 * @param {boolean} [options.showDataSourceSelect] データ元選択ドロップダウンを表示するか
 * @param {Array<{id:number, media_name:string}>} [options.mediaList] 媒体選択肢
 * @param {(payload: object) => void} [options.onUploadSuccess] 履歴登録成功後の通知
 */
export function mountCsvUploadBox(rootEl, options) {
  const {
    id,
    fileType,
    showMediaSelect,
    showDataSourceSelect = false,
    mediaList = [],
    onUploadSuccess = () => {},
  } = options

  const mediaSelectHtml = showMediaSelect
    ? `
      <div class="form-row">
        <label class="form-label" for="${id}-media-select">媒体を選択</label>
        <select id="${id}-media-select" class="form-select" ${mediaList.length === 0 ? 'disabled' : ''}>
          <option value="">${mediaList.length === 0 ? '-- 稼働中媒体がありません --' : '-- 媒体を選択してください --'}</option>
          ${mediaList.map((m) => `<option value="${m.id}">${escapeHtml(m.media_name)}</option>`).join('')}
        </select>
        ${mediaList.length === 0 ? '<div class="form-hint">停止中媒体は取込対象外です。媒体マスタで稼働中の媒体を登録してください。</div>' : ''}
      </div>
    `
    : ''

  const dataSourceSelectHtml = showDataSourceSelect
    ? `
      <div class="form-row">
        <label class="form-label" for="${id}-data-source-select">データ元</label>
        <select id="${id}-data-source-select" class="form-select">
          <option value="YNS" selected>YNS</option>
          <option value="INTERNAL">自社システム</option>
        </select>
      </div>
    `
    : ''

  rootEl.innerHTML = `
    ${mediaSelectHtml}
    ${dataSourceSelectHtml}
    <div class="form-row">
      <label class="form-label">取込ファイル</label>
      <div id="${id}-dropzone" class="upload-dropzone">
        <input type="file" id="${id}-file-input" accept=".csv,.xlsx" style="display:none" />
        <i class="fa-solid fa-file-arrow-up"></i>
        <div class="upload-dropzone-text">クリックしてCSVまたはExcelファイルを選択、またはドラッグ&ドロップ</div>
        <div class="form-hint">対応形式：CSV / XLSX</div>
        <div id="${id}-filename" class="upload-dropzone-filename"></div>
      </div>
    </div>
    <div id="${id}-preview-area"></div>
  `

  const dropzone = rootEl.querySelector(`#${id}-dropzone`)
  const fileInput = rootEl.querySelector(`#${id}-file-input`)
  const filenameEl = rootEl.querySelector(`#${id}-filename`)
  const previewArea = rootEl.querySelector(`#${id}-preview-area`)
  const mediaSelect = showMediaSelect ? rootEl.querySelector(`#${id}-media-select`) : null
  const dataSourceSelect = showDataSourceSelect ? rootEl.querySelector(`#${id}-data-source-select`) : null

  // クリックでファイル選択ダイアログを開く
  dropzone.addEventListener('click', () => fileInput.click())

  // ドラッグ&ドロップ対応
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  })
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover')
  })
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0])
    }
  })

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0])
    }
  })

  /**
   * 選択/ドロップされたファイルを読み込み、プレビューを描画する
   */
  async function handleFile(file) {
    const fileFormat = getFileFormat(file.name)
    if (!SUPPORTED_EXTENSIONS.includes(fileFormat)) {
      showToast('未対応の拡張子です。CSVまたはXLSXを選択してください', 'error')
      fileInput.value = ''
      return
    }

    if (file.name.toLowerCase().endsWith('.xlsm') || file.name.toLowerCase().endsWith('.xls')) {
      showToast('対応しているExcel形式は .xlsx のみです', 'error')
      fileInput.value = ''
      return
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      showToast(`ファイルサイズが大きすぎます。${formatFileSize(MAX_UPLOAD_SIZE)}以下のファイルを選択してください`, 'error')
      fileInput.value = ''
      return
    }

    // 媒体選択が必須の場合はバリデーション
    if (showMediaSelect && mediaSelect && !mediaSelect.value) {
      showToast('先に媒体を選択してください', 'error')
      fileInput.value = ''
      return
    }

    filenameEl.innerHTML = `
      <div>選択中: ${escapeHtml(file.name)}</div>
      <div class="form-hint">形式: ${fileFormat.toUpperCase()} / サイズ: ${formatFileSize(file.size)}</div>
    `

    try {
      const parsed = await parseFile(file, fileFormat)
      const { rows, text, sheetName } = parsed

      if (rows.length === 0) {
        previewArea.innerHTML = `<div class="empty-state">ファイルにデータがありません</div>`
        return
      }

      if (!rows[0] || rows[0].every((cell) => String(cell ?? '').trim() === '')) {
        previewArea.innerHTML = `<div class="empty-state">ヘッダー行がありません</div>`
        return
      }

      if (countBodyRows(rows) === 0) {
        previewArea.innerHTML = `<div class="empty-state">行データがありません</div>`
        return
      }

      renderPreview(previewArea, rows, {
        fileFormat,
        sheetName,
        encoding: parsed.encoding,
      })

      const rowCount = countBodyRows(rows)

      const performUpload = async () => {
        const uploadRes = await axios.post('/api/upload', {
          file_type: fileType,
          media_id: showMediaSelect && mediaSelect ? Number(mediaSelect.value) : null,
          data_source: showDataSourceSelect && dataSourceSelect ? dataSourceSelect.value : 'YNS',
          file_name: file.name,
          row_count: rowCount,
          csv_rows: shouldSendCsvRows(fileType) ? rows : undefined,
          csv_text: shouldSendCsvRows(fileType) && fileFormat === 'csv' ? text : undefined,
        })
        const warnings = uploadRes.data?.data?.warnings || []
        if (fileType === 'ad_media_csv') {
          showToast(`広告媒体${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
        } else if (fileType === 'site_summary_csv') {
          showToast(`媒体集計${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
        } else if (fileType === 'payment_report_csv') {
          if (warnings.length > 0) {
            showToast('決済レポートのアップロードは完了しましたが、未登録の広告コードがあります', 'warning')
          } else {
            showToast(`決済レポート${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
          }
        } else {
          showToast(`「${file.name}」を取込みました（${rowCount}行）`, 'success')
        }
        renderUploadWarnings(previewArea, warnings)
        onUploadSuccess({
          file_type: fileType,
          data_source: showDataSourceSelect && dataSourceSelect ? dataSourceSelect.value : 'YNS',
          file_name: file.name,
          row_count: rowCount,
          warnings,
        })
      }

      if (fileType === 'ad_media_csv' && showMediaSelect && mediaSelect) {
        const ready = await ensureAdMediaColumnMapping({
          mediaId: Number(mediaSelect.value),
          rows,
          previewArea,
          onReady: performUpload,
        })
        if (!ready) return
      }

      await performUpload()
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || err.message || 'ファイルの解析または保存に失敗しました', 'error')
    }
  }
}

function renderUploadWarnings(previewArea, warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return

  const html = warnings.map((warning) => `
    <div class="upload-warning-box">
      <strong>アップロードは完了しました。</strong>
      <div>ただし、未登録の広告コードが${Number(warning.count || 0).toLocaleString('ja-JP')}件ありました。</div>
      <div style="margin-top:8px">これらの広告コードは媒体を特定できないため取り込まれていません。<br />広告コードマスタへ登録後、再アップロードしてください。</div>
      <div class="upload-warning-codes">
        ${(warning.ad_codes || []).map((code) => `<span class="upload-warning-code">${escapeHtml(code)}</span>`).join('')}
      </div>
    </div>
  `).join('')

  previewArea.insertAdjacentHTML('beforeend', html)
}

async function ensureAdMediaColumnMapping({ mediaId, rows, previewArea, onReady }) {
  const res = await axios.post('/api/media-column-mappings/preview', {
    media_id: mediaId,
    rows,
  }).then((response) => response.data).catch((err) => err.response?.data || {
    success: false,
    error: '列マッピングの確認に失敗しました',
  })

  if (!res.success) {
    renderAdMediaMappingRequired(previewArea, {
      mediaId,
      rows,
      error: res.error || '列マッピングの確認に失敗しました',
    }, onReady)
    return false
  }

  const data = res.data
  if (data.has_dedicated_parser || data.ready) return true

  renderAdMediaMappingRequired(previewArea, {
    mediaId,
    rows,
    data,
  }, onReady)
  return false
}

function renderAdMediaMappingRequired(previewArea, state, onReady) {
  const data = state.data || {}
  const fields = data.fields || []
  const headers = data.headers || (state.rows?.[0] || [])
  const sourceByField = new Map([
    ...(data.suggested_mappings || []).map((mapping) => [mapping.fieldKey, mapping.sourceColumn]),
    ...(data.mappings || []).map((mapping) => [mapping.fieldKey, mapping.sourceColumn]),
  ])

  const fieldRows = fields.map((field) => `
    <div class="column-mapping-row">
      <label>
        ${escapeHtml(field.label)}
        ${field.required ? '<span class="required-mark">*</span>' : ''}
      </label>
      <select class="form-select" data-mapping-field="${escapeHtml(field.key)}">
        <option value="">未設定</option>
        ${headers.map((header) => `
          <option value="${escapeHtml(header)}" ${sourceByField.get(field.key) === header ? 'selected' : ''}>
            ${escapeHtml(header)}
          </option>
        `).join('')}
      </select>
    </div>
  `).join('')

  previewArea.insertAdjacentHTML('beforeend', `
    <div class="column-mapping-panel" id="ad-media-column-mapping-panel">
      <div class="column-mapping-header">
        <div>
          <strong>この媒体の列マッピングが設定されていません</strong>
          <p>${escapeHtml(state.error || 'CSV/XLSXの列とAdOps OSの項目を紐付けてください。')}</p>
        </div>
      </div>
      ${data.missing_required?.length ? `
        <div class="form-hint">未設定項目: ${data.missing_required.map(escapeHtml).join('、')}</div>
      ` : ''}
      <div class="column-mapping-grid">${fieldRows}</div>
      <div id="ad-media-mapping-preview" class="column-mapping-preview"></div>
      <div class="column-mapping-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="ad-media-mapping-preview-btn">
          <i class="fa-solid fa-table"></i>変換プレビュー
        </button>
        <button type="button" class="btn btn-primary btn-sm" id="ad-media-mapping-save-btn">
          <i class="fa-solid fa-floppy-disk"></i>この媒体のマッピングとして保存して取込
        </button>
      </div>
    </div>
  `)

  const panel = previewArea.querySelector('#ad-media-column-mapping-panel')
  const previewButton = panel.querySelector('#ad-media-mapping-preview-btn')
  const saveButton = panel.querySelector('#ad-media-mapping-save-btn')
  const previewRoot = panel.querySelector('#ad-media-mapping-preview')

  previewButton.addEventListener('click', async () => {
    const preview = await previewAdMediaColumnMapping(state.mediaId, state.rows, collectAdMediaMappings(panel))
    if (!preview.success || !preview.data?.ready) {
      showToast(
        preview.error ||
        preview.data?.preview_error ||
        `必須項目が未設定です: ${(preview.data?.missing_required || []).join('、')}`,
        'error'
      )
      return
    }
    renderAdMediaMappingPreview(previewRoot, preview.data.preview_rows || [])
  })

  saveButton.addEventListener('click', async () => {
    const mappings = collectAdMediaMappings(panel)
    const preview = await previewAdMediaColumnMapping(state.mediaId, state.rows, mappings)
    if (!preview.success || !preview.data.ready) {
      showToast(preview.error || preview.data?.preview_error || `必須項目が未設定です: ${(preview.data?.missing_required || []).join('、')}`, 'error')
      return
    }

    saveButton.disabled = true
    const saveRes = await axios.post('/api/media-column-mappings', {
      media_id: state.mediaId,
      mappings,
    }).then((response) => response.data).catch((err) => err.response?.data || {
      success: false,
      error: '列マッピングの保存に失敗しました',
    })
    saveButton.disabled = false

    if (!saveRes.success) {
      showToast(saveRes.error || '列マッピングの保存に失敗しました', 'error')
      return
    }

    showToast('列マッピングを保存しました', 'success')
    await onReady()
  })
}

function collectAdMediaMappings(panel) {
  return [...panel.querySelectorAll('[data-mapping-field]')].map((select) => ({
    fieldKey: select.dataset.mappingField,
    sourceColumn: select.value,
  }))
}

async function previewAdMediaColumnMapping(mediaId, rows, mappings) {
  return axios.post('/api/media-column-mappings/preview', {
    media_id: mediaId,
    rows,
    mappings,
  }).then((response) => response.data).catch((err) => err.response?.data || {
    success: false,
    error: '変換プレビューに失敗しました',
  })
}

function renderAdMediaMappingPreview(root, rows) {
  if (rows.length === 0) {
    root.innerHTML = '<div class="empty-state compact">プレビューできる行がありません</div>'
    return
  }

  root.innerHTML = `
    <div class="form-hint">変換後プレビュー</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>日付</th><th>広告費</th><th>Imp</th><th>Click</th><th>媒体CV</th><th>キャンペーン名</th><th>キャンペーンID</th>
          </tr>
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

function shouldSendCsvRows(fileType) {
  return fileType === 'ad_media_csv' ||
    fileType === 'site_summary_csv' ||
    fileType === 'payment_report_csv'
}

/**
 * CSVプレビュー用のテーブルを描画する
 * 先頭行をヘッダーとして扱い、以降を最大PREVIEW_MAX_ROWS行だけ表示する
 */
function renderPreview(previewArea, rows, meta = {}) {
  const [header, ...body] = rows
  const nonBlankBody = body.filter((row) => !isBlankRow(row))
  const displayRows = nonBlankBody.slice(0, PREVIEW_MAX_ROWS)
  const firstRow = nonBlankBody[0] || []

  const headHtml = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyHtml = displayRows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  previewArea.innerHTML = `
    <div class="form-row">
      <div class="form-hint">
        <i class="fa-solid fa-circle-info"></i>
        認識したヘッダー: ${header.length}列 / 総行数: ${nonBlankBody.length}件 / 先頭${displayRows.length}件を表示
        ${meta.encoding ? ` / 文字コード: ${escapeHtml(meta.encoding)}` : ''}
        ${meta.fileFormat === 'xlsx' && meta.sheetName ? ` / シート: ${escapeHtml(meta.sheetName)}` : ''}
      </div>
      <div class="form-hint">先頭行: ${escapeHtml(firstRow.slice(0, 6).join(' / ') || '-')}</div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `
}

async function parseFile(file, fileFormat) {
  if (fileFormat === 'csv') {
    const { text, encoding } = await decodeCsvFile(file)
    const rows = parseCsv(text)
    if (rows.length === 0) throw new Error('CSVにデータがありません。')
    return { rows, text, sheetName: null, encoding }
  }

  if (fileFormat === 'xlsx') {
    return parseXlsxFile(file)
  }

  throw new Error('未対応のファイル形式です。')
}

function getFileFormat(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([^.]+)$/)
  return match ? match[1] : ''
}

function countBodyRows(rows) {
  return rows.slice(1).filter((row) => !isBlankRow(row)).length
}

function isBlankRow(row) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size)) return '-'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)}KB`
  return `${size}B`
}

/**
 * HTMLエスケープ（XSS対策）
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
