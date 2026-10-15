# AdOps OS

## プロジェクト概要
- **名称**: AdOps OS
- **目的**: SVC広告部が毎朝最初に開き、「今日の広告運用の意思決定を5分で終わらせる」ための業務システム
- **思想**: 単なる「広告分析ツール」ではなく「広告部の意思決定OS」。最終目標は、朝5分で
  - 何が起きているか
  - 今どうなっているか
  - このままだとどうなるか
  - 今日は何をすべきか
  が分かるプロダクトであること。
- **対象**: SVC広告部専用（汎用SaaS化は考慮しない）

## 現在完成している機能（v1）

### ① ダッシュボード
- 要対応アラート（ダミーデータ）
- 今日のKPI（広告費・CV数・CPA・売上、前日比）（ダミーデータ）
- 月末着地予測（予算消化バー）（ダミーデータ）
- 今日やること（チェックリスト）（ダミーデータ）

### ② データ取込
- **スプレッドシート同期（自動取込）**
  - 「読み込み用スプレッドシート」に IMPORTRANGE で集約したデータを、毎朝 JST 8:00 に自動で読み込む（画面の「今すぐ同期」でも実行可）
  - 1タブ＝1データ種別。広告媒体は媒体ごと、サイト側は YNS／自社 × 媒体集計／決済レポートの4種
  - 同期のたびに **当月＋前月**（設定で変更可）の範囲を読み込み、その範囲のデータを置き換える
  - 安全チェックに引っかかったタブは取り込まずに理由を記録（タブなし、ヘッダー空、`#REF!` などのエラー値、期間内0件、行数の大幅減少、パースエラー）。1タブの失敗は他のタブに影響しない
  - 実行履歴とタブ別結果は `sheet_sync_runs` / `sheet_sync_tab_results` に記録し、データ取込画面に表示
- **手動アップロード（予備）**
  - 広告媒体CSV（媒体選択）／媒体集計CSV／決済レポートCSV を CSV・XLSX でアップロード
  - 取込処理は同期と共通（`src/lib/import-service.ts`）。取込履歴は `import_method`（手動／シート同期）で区別

### ③ マスタ管理
- 媒体マスタ（CRUD）
- サイトマスタ（CRUD）
- キャンペーンマスタ（CRUD、媒体→広告コード→サイトの紐付け管理）
  - 媒体・サイトはキャンペーンから参照中の場合は削除不可のガードあり

### 左メニュー（その他画面）
- 実績分析／予算管理／着地予測／設定 → 「Coming Soon」表示のみ

## 機能エントリーポイント（API一覧）

| Method | Path | 概要 |
|---|---|---|
| GET | `/api/dashboard/summary` | ダッシュボード用ダミーデータ取得 |
| GET | `/api/media` | 媒体マスタ一覧 |
| POST | `/api/media` | 媒体マスタ追加 `{ media_name }` |
| PUT | `/api/media/:id` | 媒体マスタ更新 `{ media_name }` |
| DELETE | `/api/media/:id` | 媒体マスタ削除（キャンペーンで使用中は失敗） |
| GET | `/api/site` | サイトマスタ一覧 |
| POST | `/api/site` | サイトマスタ追加 `{ site_name }` |
| PUT | `/api/site/:id` | サイトマスタ更新 `{ site_name }` |
| DELETE | `/api/site/:id` | サイトマスタ削除（キャンペーンで使用中は失敗） |
| GET | `/api/campaign` | キャンペーンマスタ一覧（媒体名・サイト名をJOIN） |
| POST | `/api/campaign` | キャンペーンマスタ追加 `{ campaign_name, media_id, ad_code, site_id, is_active }` |
| PUT | `/api/campaign/:id` | キャンペーンマスタ更新 |
| DELETE | `/api/campaign/:id` | キャンペーンマスタ削除 |
| GET | `/api/upload` | 取込履歴一覧（直近50件、`import_method` 付き） |
| POST | `/api/upload` | 手動アップロード `{ file_type, media_id?, data_source?, file_name, row_count, csv_rows }`（`csv_rows` の代わりに `csv_text` も可） |
| GET | `/api/sheet-sync/status` | 同期設定の状態、最新の実行とタブ別結果、同期する期間 |
| GET | `/api/sheet-sync/runs` | 同期の実行履歴（`?limit=`、既定20件） |
| GET | `/api/sheet-sync/runs/:id` | 指定した実行のタブ別結果 |
| POST | `/api/sheet-sync/run` | 今すぐ同期（手動実行） |
| GET | `/api/sheet-sync/sources` | 読み込むタブの定義（広告媒体ごと＋サイト側4種） |
| PUT | `/api/sheet-sync/sources` | タブ定義の更新 `{ sources: [{ source_type, media_id?, data_source?, tab_name, is_active? }] }` |

## データアーキテクチャ

- **ストレージ**: Cloudflare D1（SQLite）
- **テーブル**:
  - `media_master`（媒体マスタ）: id, media_name, created_at, updated_at
  - `site_master`（サイトマスタ）: id, site_name, created_at, updated_at
  - `campaign_master`（キャンペーンマスタ）: id, campaign_name, media_id(FK), ad_code, site_id(FK), is_active, created_at, updated_at
  - `upload_history`（アップロード履歴）: id, file_type, media_id(FK), file_name, row_count, target_date, status, import_method, uploaded_at
  - `sheet_sync_sources`（同期するタブの定義）: id, source_type, media_id, data_source, tab_name, is_active
  - `sheet_sync_runs`（同期の実行履歴）: id, trigger(cron/manual), status(running/success/partial/failed), date_from, date_to, started_at, finished_at, error_message
  - `sheet_sync_tab_results`（タブ別結果）: id, run_id, source_id, tab_name, status(imported/skipped/failed), row_count, date_from, date_to, reason, upload_history_id
- **マイグレーション**: `migrations/`（スプレッドシート同期は `0020_sheet_sync.sql`）
- **シードデータ**: `seed.sql`（開発用ダミーマスタデータ）

## ディレクトリ構成

```
webapp/
├── src/
│   ├── index.tsx           # エントリーポイント（ルーティング登録）
│   ├── renderer.tsx        # SPAシェル（HTML雛形、左メニュー枠を出力）
│   ├── types/index.ts      # 共通型定義（Bindings, Master型など）
│   ├── lib/
│   │   ├── import-service.ts  # 取込処理（手動アップロード・同期で共通）
│   │   ├── google-sheets.ts   # Google Sheets API 読み込み（サービスアカウント認証）
│   │   ├── sheet-sync.ts      # スプレッドシート同期（安全チェック・期間置き換え・履歴）
│   │   ├── ad-media-parsers.ts
│   │   └── settings.ts
│   └── routes/api/         # APIルート（機能ごとにファイル分割）
│       ├── media.ts        # 媒体マスタ CRUD
│       ├── site.ts         # サイトマスタ CRUD
│       ├── campaign.ts     # キャンペーンマスタ CRUD
│       ├── upload.ts       # 手動アップロード・取込履歴
│       ├── sheet-sync.ts   # スプレッドシート同期 API
│       └── dashboard.ts    # ダッシュボード
├── public/static/
│   ├── css/main.css        # デザインシステム（ライトテーマ・管理画面風）
│   └── js/
│       ├── app.js          # SPAルーター（ハッシュベース）
│       ├── components/     # 共通UIパーツ（サイドバー、モーダル、トースト、CSVパーサー等）
│       └── pages/          # 画面ごとのロジック（dashboard/data-import/master/coming-soon）
├── workers/sheet-sync/      # 定時実行用 Worker（Cron で同期を呼ぶ。src/lib を共有）
├── migrations/              # D1マイグレーションSQL
├── seed.sql                 # 開発用シードデータ
└── wrangler.jsonc           # Cloudflare設定（D1バインディング含む）
```

将来画面を追加する場合は
1. `src/routes/api/xxx.ts` にAPI追加
2. `public/static/js/pages/xxx.js` に画面ロジック追加
3. `public/static/js/app.js` の `ROUTES` に1行追加
4. `public/static/js/components/sidebar.js` の `MENU_ITEMS` の `comingSoon` を `false` に変更

という手順のみで拡張可能な設計にしている。

## 未実装の機能（v1では対象外）
- CSVの保存・分析・データ結合
- CPA / CTR / CVR / ROAS 等の広告指標計算
- 売上分析
- 予算管理（実データに基づく管理）
- 着地予測（実データに基づく予測ロジック）
- AI分析
- 権限管理・ログイン認証

## 推奨される次の開発ステップ
1. データ取込画面で取り込んだCSVの実データをD1に保存するテーブル設計（媒体別実績・媒体集計・決済レポート）
2. キャンペーンマスタを軸にしたデータ名寄せ・結合ロジック
3. 実績分析画面（CPA/CTR/CVR/ROAS等の指標計算）の実装
4. 予算管理画面（予算入力・消化率トラッキング）
5. 着地予測ロジック（実データベースの予測アルゴリズム）
6. ダッシュボードのアラート・KPI・着地予測・Todoを実データ連動に置き換え

## 使い方（ユーザーガイド）
1. 左メニュー「マスタ管理」で媒体・サイトを登録し、それらを紐付けたキャンペーンマスタを作成する
2. 左メニュー「データ取込」で3種類のCSV（広告媒体CSV／媒体集計CSV／決済レポートCSV）をアップロードし、内容をプレビュー確認する（v1では保存されず、履歴のみ記録）
3. 左メニュー「ダッシュボード」で、今日確認すべきアラート・KPI・月末着地予測・やることリストを確認する（v1はダミーデータ）

## スプレッドシート同期のセットアップ

### 1. Google 側の準備（ユーザー作業）
1. Google Cloud でプロジェクトを作成し、Google Sheets API を有効化する
2. サービスアカウントを作成し、JSON鍵を発行する（鍵ファイルはリポジトリに置かない）
3. 読み込み用スプレッドシートを作成し、サービスアカウントのメールアドレスに「閲覧者」で共有する（「ウェブに公開」は使わない）
4. データの種類ごとにタブを作り、各元シートから IMPORTRANGE で取り込む。**1行目は元のエクスポートと同じ列名**にする

### 2. 鍵をシークレットとして登録（Pages と Worker の両方）
```bash
# Pages（画面の「今すぐ同期」用）
npx wrangler pages secret put GOOGLE_SERVICE_ACCOUNT_JSON --project-name adops-os < service-account.json
# Worker（毎朝の定時実行用）
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config workers/sheet-sync/wrangler.jsonc < service-account.json
```
PowerShell では `Get-Content service-account.json -Raw | npx wrangler ...` の形で渡す。

### 3. 本番反映の順番
1. `npm run db:migrate:prod`（0020 を本番 D1 に適用。**コードより先に**行う）
2. `npm run deploy`（Pages）
3. `npm run worker:sheet-sync:deploy`（定時実行 Worker）
4. 上記 2. のシークレット登録

### 4. 画面での設定
1. 設定 > スプレッドシート同期：有効化、スプレッドシートID（URLを貼ってもよい）、同期する月数、行数減少の許容率
2. 設定 > サイト側のタブ名：YNS／自社 の媒体集計・決済レポートのタブ名
3. マスタ管理 > 媒体：各媒体の「読み込むタブ名」（空欄なら同期対象外。停止中の媒体は同期しない）
4. データ取込 > 「今すぐ同期」で結果を確認

### 運用メモ
- 実行時刻は `workers/sheet-sync/wrangler.jsonc` の `triggers.crons`（UTC）。変更後は Worker を再デプロイする
- 行数チェックは「置き換え前に DB にある同じ期間・同じデータの行数 × 許容率」と比べる。月初に期間が短くなっても誤ってスキップしない
- 15分以上「実行中」のまま残った実行は、次の同期開始時に失敗扱いにして打ち切る
- ダッシュボードでは「最新の同期が失敗／一部スキップ」と「JST 10時を過ぎても当日の同期がない」場合に警告する（設定 > アラートでON/OFF）

### ローカルでの確認
- `npm run db:migrate:local` で 0020 を適用
- `.dev.vars` に `SHEET_SYNC_TEST_MODE=true` を書くと、`POST /api/sheet-sync/run` の body に `{ "tabs": { "タブ名": [["見出し", ...], [...]] } }` を渡して、Google に接続せずに同期処理を試せる（本番では設定しない）
- 実際のシートで試す場合は `.dev.vars` に `GOOGLE_SERVICE_ACCOUNT_JSON=...`（1行のJSON）を書く
- Worker は `npm run worker:sheet-sync:dev` で起動し、`http://localhost:8787/__scheduled` を開くと定時実行を再現できる（ローカル D1 は Pages と共有。Worker 用の鍵は `workers/sheet-sync/.dev.vars` に書く）

## デプロイ
- **プラットフォーム**: Cloudflare Pages
- **状態**: 開発中（サンドボックス環境で動作確認済み）
- **技術スタック**: Hono + TypeScript + Cloudflare D1 + Vanilla JS（フロント） + Font Awesome（CDN）
- **最終更新**: 2026-07-07
