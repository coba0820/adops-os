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
import { campaignGroupRoute } from './routes/api/campaign-groups'
import { uploadRoute } from './routes/api/upload'
import { dashboardRoute } from './routes/api/dashboard'
import { analysisRoute } from './routes/api/analysis'
import { budgetRoute } from './routes/api/budget'
import { forecastRoute } from './routes/api/forecast'
import { settingsRoute } from './routes/api/settings'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  await next()
  const contentType = c.res.headers.get('Content-Type') || ''
  if (contentType.startsWith('text/html')) {
    c.res.headers.set('Content-Type', 'text/html; charset=utf-8')
  }
})

// ------------------------------------------------------------
// HTMLシェルのレンダラーを全ページに適用
// ------------------------------------------------------------
app.use(renderer)

app.route('/api/campaign-groups', campaignGroupRoute)

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
app.route('/api/forecast', forecastRoute) // 着地予測
app.route('/api/settings', settingsRoute) // 設定

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
