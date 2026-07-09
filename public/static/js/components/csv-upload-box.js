// ============================================================
// CSVアップロード＋プレビュー 共通コンポーネント
// データ取込画面の3種類（広告媒体CSV / 媒体集計CSV / 決済レポートCSV）
// で共通利用するUIブロック。
// v1では「アップロード＋プレビュー表示」のみが目的で、
// 広告媒体CSVは日次実績も保存し、それ以外は履歴だけAPIに記録する。
// ============================================================
import { parseCsv } from './csv-parser.js'
import { showToast } from './toast.js'

const PREVIEW_MAX_ROWS = 20 // プレビューに表示する最大行数（ヘッダ除く）

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
      <label class="form-label">CSVファイル</label>
      <div id="${id}-dropzone" class="upload-dropzone">
        <input type="file" id="${id}-file-input" accept=".csv" style="display:none" />
        <i class="fa-solid fa-file-arrow-up"></i>
        <div class="upload-dropzone-text">クリックしてCSVファイルを選択、またはドラッグ&ドロップ</div>
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
   * 選択/ドロップされたCSVファイルを読み込み、プレビューを描画する
   */
  function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('CSVファイルを選択してください', 'error')
      return
    }

    // 媒体選択が必須の場合はバリデーション
    if (showMediaSelect && mediaSelect && !mediaSelect.value) {
      showToast('先に媒体を選択してください', 'error')
      fileInput.value = ''
      return
    }

    filenameEl.textContent = `選択中: ${file.name}`

    const reader = new FileReader()
    reader.onload = async (event) => {
      const text = event.target.result
      const rows = parseCsv(text)

      if (rows.length === 0) {
        previewArea.innerHTML = `<div class="empty-state">CSVにデータがありません</div>`
        return
      }

      renderPreview(previewArea, rows)

      const rowCount = rows.length

      // アップロード履歴をAPIに記録し、広告媒体CSVは実績行も保存する
      try {
        await axios.post('/api/upload', {
          file_type: fileType,
          media_id: showMediaSelect && mediaSelect ? Number(mediaSelect.value) : null,
          file_name: file.name,
          row_count: rowCount,
          csv_rows: fileType === 'ad_media_csv' ? rows : undefined,
          csv_text: fileType === 'ad_media_csv' ? text : undefined,
        })
        if (fileType === 'ad_media_csv') {
          showToast('広告媒体CSVの実績を保存しました', 'success')
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
        showToast(err.response?.data?.error || 'アップロード履歴の記録に失敗しました', 'error')
      }
    }
    reader.readAsText(file, 'UTF-8')
  }
}

/**
 * CSVプレビュー用のテーブルを描画する
 * 先頭行をヘッダーとして扱い、以降を最大PREVIEW_MAX_ROWS行だけ表示する
 */
function renderPreview(previewArea, rows) {
  const [header, ...body] = rows
  const displayRows = body.slice(0, PREVIEW_MAX_ROWS)

  const headHtml = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyHtml = displayRows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  previewArea.innerHTML = `
    <div class="form-row">
      <div class="form-hint">
        <i class="fa-solid fa-circle-info"></i>
        プレビュー: 全${body.length}件中 先頭${displayRows.length}件を表示（保存・分析はv1では未対応）
      </div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `
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
