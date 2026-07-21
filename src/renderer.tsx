// ============================================================
// AdOps OS アプリシェル（レンダラー）
// SPA構成：ここで左メニュー＋ヘッダー＋コンテンツ枠を出力し、
// 実際の画面内容は public/static/js 配下のJSがハッシュルーティングで
// #main-content に描画する。
// ============================================================
import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>AdOps OS｜広告部の意思決定OS</title>

        {/* アイコン用 Font Awesome（CDN） */}
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        {/* デザインシステム（ライトテーマ・管理画面風） */}
        <link href="/static/css/main.css" rel="stylesheet" />
      </head>
      <body>
        {/* ------------------------------------------------------
            アプリ全体レイアウト
            左サイドバー（固定メニュー） + 右側メインエリア
            ------------------------------------------------------ */}
        <div id="app-shell">
          {/* 左メニュー：sidebar.js が id="app-sidebar" に描画 */}
          <nav id="app-sidebar" aria-label="メインナビゲーション"></nav>

          <div id="app-main">
            {/* 上部ヘッダー：現在ページ名・日付など */}
            <header id="app-header">
              <h1 id="page-title">ダッシュボード</h1>
              <div id="header-right">
                <span id="header-date"></span>
              </div>
            </header>

            {/* 画面コンテンツはここにJSで描画される */}
            <main id="main-content" aria-live="polite"></main>
          </div>
        </div>

        {/* axios（API通信用） */}
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        {/* アプリ本体（ESモジュール） */}
        <script type="module" src="/static/js/app.js"></script>
      </body>
    </html>
  )
})
