// ============================================================
// データ取込画面
// 3種類のCSVをタブで切り替えてアップロード＋プレビューできる画面。
// v1では保存・分析・結合は行わず、「取込めること」のみを目的とする。
// ============================================================
import { mountCsvUploadBox } from '../components/csv-upload-box.js'

// タブ定義（今後CSV種別が増えてもここに追加するだけで対応可能）
const TABS = [
  { key: 'ad_media', label: '① 広告媒体CSV', desc: '媒体別の広告配信レポートCSVを取り込みます。媒体を選択してからアップロードしてください。', needsMedia: true },
  { key: 'media_aggregate', label: '② 媒体集計CSV', desc: '複数媒体を横断した集計CSVを取り込みます。' , needsMedia: false},
  { key: 'payment_report', label: '③ 決済レポートCSV', desc: '決済代行会社から出力される売上・決済データCSVを取り込みます。', needsMedia: false },
]

/**
 * データ取込画面を描画する
 * @param {HTMLElement} container #main-content 要素
 */
export async function renderDataImportPage(container) {
  container.innerHTML = `<div class="empty-state">読み込み中...</div>`

  // 媒体選択リストを取得（広告媒体CSVタブで使用）
  let mediaList = []
  try {
    const res = await axios.get('/api/media')
    // TODO(v1.1): CSV取込率の対象媒体は status === 'active' のみとする。
    // ここでは既存挙動維持のため、媒体一覧の絞り込みはまだ行わない。
    mediaList = res.data.data || []
  } catch (err) {
    console.error(err)
  }

  let activeTab = TABS[0].key

  function draw() {
    const tabBarHtml = TABS.map(
      (t) => `<div class="tab-item ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</div>`
    ).join('')

    const currentTab = TABS.find((t) => t.key === activeTab)

    container.innerHTML = `
      <div class="card">
        <div class="tab-bar">${tabBarHtml}</div>
        <p class="section-desc">${currentTab.desc}</p>
        <div id="upload-box-root"></div>
      </div>
    `

    // タブ切り替えイベント
    container.querySelectorAll('.tab-item').forEach((el) => {
      el.addEventListener('click', () => {
        activeTab = el.dataset.tab
        draw()
      })
    })

    // アップロードボックスをマウント
    const uploadRoot = container.querySelector('#upload-box-root')
    mountCsvUploadBox(uploadRoot, {
      id: `upload-${currentTab.key}`,
      fileType: currentTab.key,
      showMediaSelect: currentTab.needsMedia,
      mediaList,
    })
  }

  draw()
}
