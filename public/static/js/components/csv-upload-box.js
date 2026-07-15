// ============================================================
// CSVアップロード＋プレビュー 共通コンポーネント
// データ取込画面の3種類（広告媒体CSV / 媒体集計CSV / 決済レポートCSV）
// で共通利用するUIブロック。
// v1では「アップロード＋プレビュー表示」のみが目的で、
// 広告媒体CSVは日次実績も保存し、それ以外は履歴だけAPIに記録する。
// ============================================================
import { parseCsv } from './csv-parser.js'
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
 * @param {Array<{id:number, media_name:string}>} [options.mediaList] 媒体選択肢
 * @param {(payload: object) => void} [options.onUploadSuccess] 履歴登録成功後の通知
 */
export function mountCsvUploadBox(rootEl, options) {
  const {
    id,
    fileType,
    showMediaSelect,
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

  rootEl.innerHTML = `
    ${mediaSelectHtml}
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
      })

      const rowCount = countBodyRows(rows)

      await axios.post('/api/upload', {
        file_type: fileType,
        media_id: showMediaSelect && mediaSelect ? Number(mediaSelect.value) : null,
        file_name: file.name,
        row_count: rowCount,
        csv_rows: shouldSendCsvRows(fileType) ? rows : undefined,
        csv_text: shouldSendCsvRows(fileType) && fileFormat === 'csv' ? text : undefined,
      })
      if (fileType === 'ad_media_csv') {
        showToast(`広告媒体${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
      } else if (fileType === 'site_summary_csv') {
        showToast(`媒体集計${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
      } else if (fileType === 'payment_report_csv') {
        showToast(`決済レポート${fileFormat.toUpperCase()}の実績を保存しました`, 'success')
      } else {
        showToast(`「${file.name}」を取込みました（${rowCount}行）`, 'success')
      }
      onUploadSuccess({
        file_type: fileType,
        file_name: file.name,
        row_count: rowCount,
      })
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || err.message || 'ファイルの解析または保存に失敗しました', 'error')
    }
  }
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
    const text = await readFileAsText(file)
    const rows = parseCsv(text)
    if (rows.length === 0) throw new Error('CSVにデータがありません。')
    return { rows, text, sheetName: null }
  }

  if (fileFormat === 'xlsx') {
    return parseXlsxFile(file)
  }

  throw new Error('未対応のファイル形式です。')
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(String(event.target.result || ''))
    reader.onerror = () => reject(new Error('CSVファイルの読み込みに失敗しました。'))
    reader.readAsText(file, 'UTF-8')
  })
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
