// ============================================================
// AdOps OS エントリーポイント
// Hono アプリのルーティング定義。
// - HTMLシェルは renderer.tsx が返す（SPA的にJSでページ切替）
// - 各種データAPIは /api/* 配下に分割して実装（src/routes/api/*）
// ============================================================
import { Hono } from 'hono'
import { renderer } from './renderer'
import type { Bindings } from './types'

// API ルート（機能ごとにファイル分割）
import { mediaRoute } from './routes/api/media'
import { siteRoute } from './routes/api/site'
import { campaignRoute } from './routes/api/campaign'
import { uploadRoute } from './routes/api/upload'
import { dashboardRoute } from './routes/api/dashboard'
import { analysisRoute } from './routes/api/analysis'
import { budgetRoute } from './routes/api/budget'

const app = new Hono<{ Bindings: Bindings }>()

// ------------------------------------------------------------
// HTMLシェルのレンダラーを全ページに適用
// ------------------------------------------------------------
app.use(renderer)

// ------------------------------------------------------------
// API ルーティング登録
// ------------------------------------------------------------
app.route('/api/media', mediaRoute) // 媒体マスタ CRUD
app.route('/api/site', siteRoute) // サイトマスタ CRUD
app.route('/api/campaign', campaignRoute) // キャンペーンマスタ CRUD
app.route('/api/upload', uploadRoute) // CSVアップロード履歴
app.route('/api/dashboard', dashboardRoute) // ダッシュボード用データ
app.route('/api/analysis', analysisRoute) // 実績分析
app.route('/api/budget', budgetRoute) // 予算管理

// ------------------------------------------------------------
// トップページ（SPAシェルを返す。以降はフロントJSがルーティング）
// ------------------------------------------------------------
app.get('/', (c) => {
  return c.render(<></>)
})

// 他の全パスもSPAシェルを返す（ブラウザ直リンク・リロード対応）
app.get('*', (c) => {
  return c.render(<></>)
})

export default app
