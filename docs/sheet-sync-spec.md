# 実装指示書：読み込み用スプレッドシートからの自動同期

この文書は AdOps OS に「Googleスプレッドシートからの自動データ取込」を追加するための指示書です。Claude Code はこの文書を読み、既存コードを確認したうえで、下記「作業の進め方」の順に実装してください。

## 1. 背景と目的

現在、広告媒体（Taboola / Meta / Moloco / popIn / logly / UZOU / BIGO / Mintegral / Unity ほか）と競馬サイト側（YNS / 自社システムの媒体集計・決済レポート）のデータは、CSV/XLSXを手動でダウンロードし、データ取込画面から1ファイルずつアップロードしている。

担当者はスプレッドシートでの集計のために元データを手動で取得しているため、その流れを活かし、**「読み込み用スプレッドシート」に各データを IMPORTRANGE で集約し、AdOps OS が毎朝自動で読み込む**方式にする。広告媒体のAPI連携は行わない。

## 2. 決定事項

- 読み込み用スプレッドシートは1つ。データの種類ごとに1タブ。
- 各タブの1行目は、元のエクスポートと同じ列名（既存パーサーは列名で読むため）。
- 媒体ごとの「読み込むタブ名」は媒体マスタ画面で設定する。サイト側4種のタブ名は設定画面で設定する。
- 認証は Google サービスアカウント。読み込み用スプレッドシートだけをサービスアカウントに「閲覧者」で共有する。「ウェブに公開」は使わない（決済レポートに顧客IDが含まれるため）。
- 毎朝の定時実行に加えて、画面から「今すぐ同期」もできる。
- 同期のたびに **当月＋前月** の範囲を読み込み、その範囲を置き換える（媒体数値の後日確定に追従するため）。
- 手動のCSV/XLSXアップロード画面は予備として残す。

## 3. 既存コードについて把握しておくこと

- 構成：Hono + TypeScript + Cloudflare Pages + D1。フロントは `public/static/js` の Vanilla JS（`dist/` はビルド成果物なので直接編集しない）。
- `src/routes/api/upload.ts` の POST 処理が、行データ（`string[][]`）を受け取り、パース → マスタ補完 → 対象日付範囲の旧データ削除 → 挿入、まで行っている。`deleteOld*RowsInRange`、`build*DailyRows`、`aggregate*Rows` などの関数群がある。
- 広告媒体のパースは `src/lib/ad-media-parsers.ts`（専用パーサー9媒体＋列マッピングによる汎用パース）。
- 金額・日付のパースは `parseMoney` / `parseTargetDate` / `normalizeDateTime`。
- サイト側は `data_source`（`YNS` / `INTERNAL`）で区別。
- 設定は `app_settings`（setting_group / setting_key のKV）と `src/lib/settings.ts`。

## 4. 実装内容

### 4-1. 取込処理の共通化（最初に行う）

`upload.ts` の POST ハンドラーから、「行データを受け取って保存するまで」の処理を `src/lib/import-service.ts` に切り出す。

```ts
// イメージ。引数・戻り値の詳細は既存コードに合わせて決めてよい
importRows(db, {
  fileType,          // 既存の UploadFileType
  mediaId,           // 広告媒体のとき
  dataSource,        // サイト側のとき 'YNS' | 'INTERNAL'
  rows,              // string[][]（1行目がヘッダー）
  fileName,          // 手動は元ファイル名、同期は `sheet:<タブ名>`
  importMethod,      // 'manual' | 'sheet_sync'
  dateRange?,        // 同期時：この範囲の行だけ取り込み、この範囲を置き換える
}) => { uploadHistoryId, rowCount, dateRange, totals }
```

既存の手動アップロードはこの関数を呼ぶ形に置き換え、**挙動が変わらないこと**を確認する（同じファイルを取り込んで、件数と合計値が変更前と一致すること）。

### 4-2. マイグレーション（`migrations/0020_sheet_sync.sql`）

- `sheet_sync_sources`：読み込み対象タブの定義
  - `id`, `source_type`（`ad_media` / `media_summary` / `payment_report`。既存の fileType の値に合わせる）, `media_id`（広告媒体のみ）, `data_source`（サイト側のみ）, `tab_name`, `is_active`, `created_at`, `updated_at`
  - 広告媒体は `media_id` ごとに1件、サイト側は `source_type`×`data_source` ごとに1件のユニーク制約
- `sheet_sync_runs`：同期の実行履歴
  - `id`, `trigger`（`cron` / `manual`）, `status`（`running` / `success` / `partial` / `failed`）, `started_at`, `finished_at`, `error_message`
- `sheet_sync_tab_results`：タブごとの結果
  - `id`, `run_id`, `source_id`, `tab_name`, `status`（`imported` / `skipped` / `failed`）, `row_count`, `date_from`, `date_to`, `reason`, `upload_history_id`
- `upload_history` に `import_method TEXT NOT NULL DEFAULT 'manual'` を追加
- `app_settings` に初期値を追加（group は `sheet_sync`）
  - `enabled`（boolean, false）, `spreadsheet_id`（string, 空）, `months_to_sync`（number, 2）, `min_row_ratio`（number, 0.5）

### 4-3. Google スプレッドシート読み込み（`src/lib/google-sheets.ts`）

- サービスアカウントJSONは環境変数 `GOOGLE_SERVICE_ACCOUNT_JSON`（シークレット）から読む。`Bindings` 型に追加する。
- Web Crypto で RS256 署名したJWTを作り、`https://oauth2.googleapis.com/token` でアクセストークンを取得。スコープは `https://www.googleapis.com/auth/spreadsheets.readonly`。外部ライブラリは追加しない。
- `spreadsheets.values:batchGet` で有効な全タブをまとめて取得。`valueRenderOption=FORMATTED_VALUE`（手動CSVと同じ文字列表現にして既存パースを使い回すため）。
- 取得結果は `string[][]` に変換し、行ごとに列数をヘッダーに揃える（末尾の空セルは返ってこないため）。

### 4-4. 同期処理（`src/lib/sheet-sync.ts`）

`runSheetSync(env, trigger)` を実装する。

1. `enabled` が false、または `spreadsheet_id` が空なら何もしない（手動実行時はエラーメッセージを返す）。
2. `sheet_sync_runs` に `running` で記録。同時実行中の run があれば開始しない。
3. 対象期間を算出：JSTで「前月1日〜今日」（`months_to_sync` に従う）。
4. タブごとに次の**安全チェック**を行い、1つでも該当したらそのタブは取り込まず `skipped` として理由を記録する。
   - タブが存在しない／1行目のヘッダーが空
   - セルに `#REF!` `#N/A` `#ERROR!` `#VALUE!` `#NAME?` `Loading...` が含まれる（IMPORTRANGE の更新中・失敗）
   - 対象期間内の行が0件
   - 対象期間内の行数が、同じタブの前回成功時の行数 × `min_row_ratio` を下回る
   - 既存パーサーでのパースがエラーになった
5. チェックを通ったタブは、対象期間内の行だけを `importRows`（4-1）に渡し、その期間を置き換える。**1タブの失敗が他のタブに影響しないこと。**
6. 結果に応じて run を `success` / `partial` / `failed` で終了。

### 4-5. 定時実行用 Worker（`workers/sheet-sync/`）

- Cloudflare Pages の関数は Cron Trigger を使えないため、別の Worker を作る。
- 専用の `wrangler.jsonc` を置き、**同じ D1（`adops-os-db`）をバインド**する。`scheduled` ハンドラーから `runSheetSync(env, 'cron')` を呼ぶ。コードは `src/lib` を import して共有する。
- スケジュールは毎朝 JST 8:00（`0 23 * * *`、UTC）。時刻は後で変えやすいようにする。
- `package.json` に Worker 用のスクリプト（ローカル実行、デプロイ）を追加する。

### 4-6. API（`src/routes/api/sheet-sync.ts`）

- `GET /api/sheet-sync/status`：最新の run とタブ別結果、設定の有効状態
- `GET /api/sheet-sync/runs`：直近の実行履歴
- `POST /api/sheet-sync/run`：手動同期（`runSheetSync(env, 'manual')`）
- `GET/PUT /api/sheet-sync/sources`：タブ定義の取得・更新
- `src/index.tsx` にルートを登録する。

### 4-7. 画面

- **データ取込画面**：上部に「スプレッドシート同期」カードを追加。最終同期日時、状態、タブごとの結果（取込行数・期間・スキップ理由）、「今すぐ同期」ボタン。既存のアップロード欄はその下に残す。手動アップロード履歴とは `import_method` で見分けられるようにする。
- **マスタ管理 > 媒体**：各媒体の編集フォームに「読み込むタブ名」欄を追加（空なら同期対象外）。
- **設定画面**：「スプレッドシート同期」セクションを追加。有効／無効、スプレッドシートID（URLを貼っても ID を抜き出す）、同期する月数、行数減少の許容率、サイト側4種（YNS 媒体集計／YNS 決済レポート／自社 媒体集計／自社 決済レポート）のタブ名。

### 4-8. アラート連携

ダッシュボードの要対応アラートに、「最新の同期が `failed` または `partial`」「当日の同期が実行されていない」場合の警告を追加する。既存の `warn_missing_*` 設定の考え方に合わせる。

## 5. 作業の進め方

1. 既存コード（特に `upload.ts`、`ad-media-parsers.ts`、`settings.ts`、マイグレーション一式）を読み、この指示書と食い違う点があれば実装前に報告する。
2. 4-1 の共通化 → 手動アップロードの挙動が変わらないことを確認してコミット。
3. 4-2 → `npm run db:migrate:local` で適用確認。
4. 4-3〜4-6 → ローカルで動作確認。Google 接続部分は、実シートがなくても安全チェックと取込処理をテストできるよう、取得済みの `string[][]` を渡せる形にしておく。
5. 4-7、4-8。
6. README の機能説明・API一覧・セットアップ手順を更新。

機能のまとまりごとにコミットする。

## 6. 守ってほしいこと

- **本番DBへのマイグレーション（`--remote`）、Pages / Worker のデプロイ、`git push` は、実行前に必ず確認を取ること。**
- サービスアカウントの鍵などの秘密情報をコードやリポジトリに含めないこと。シークレットの登録はユーザーが行う。
- `dist/` や `.wrangler/` を編集しないこと。
- 既存の手動アップロードの挙動を壊さないこと。

## 7. ユーザー側で行う準備（実装と並行で可）

1. Google Cloud でプロジェクトを作成し、Google Sheets API を有効化
2. サービスアカウントを作成し、JSON鍵を発行
3. 読み込み用スプレッドシートを作成し、サービスアカウントのメールアドレスに「閲覧者」で共有
4. タブを作成し、各元シートから IMPORTRANGE で取り込む（1行目は元エクスポートと同じ列名）
5. 鍵を Pages と Worker の両方にシークレットとして登録（`wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` など。具体的なコマンドは実装後に Claude Code が案内する）

## 8. 完了条件

- 設定画面でスプレッドシートIDとタブ名を設定し、「今すぐ同期」で全タブが取り込まれる
- 取込後の件数・合計値が、同じデータを手動アップロードした場合と一致する
- `#REF!` を含むタブ、行数が極端に減ったタブは取り込まれず、理由が画面に表示される
- 1つのタブが失敗しても他のタブは取り込まれる
- 毎朝の定時実行が動き、履歴に残る
- 同期失敗がダッシュボードのアラートに出る

## 9. 実装中に確認が必要な点

- `FORMATTED_VALUE` で取得した日付・金額が、既存の `parseTargetDate` / `parseMoney` で正しく読めるか（シートの表示形式によっては調整が必要）
- 決済レポートなど行数の多いタブで、Worker の実行時間・D1 の書き込み件数の制限に収まるか（収まらない場合はタブ単位で分割実行する）

## 10. 仕様変更（2026-10-23）

実装後の打ち合わせで、次のとおり変更した（README の「スプレッドシート同期のセットアップ」も参照）。

- **スプレッドシートは月ごとに作る。** 設定画面で対象月（YYYY-MM）ごとに URL を登録する（`sheet_sync_spreadsheets`。2-2 の `spreadsheet_id` 1つの設定は廃止）。
- 同期では、対象期間の各月について、その月に登録したシートから読み、**その月の範囲だけ**を置き換える。シートに他の月の行があっても使わない。
- 当月のシートが未登録の場合は、その月をスキップして理由を記録し、ダッシュボードに警告を出す（`warn_sheet_sync_missing_sheet`）。
- 登録画面に「接続テスト」を付ける：シートが読めるか、媒体マスタ・設定画面のタブ名がすべてあり、1行目が入っているかを確認する。
- タブ名は月が変わっても共通（媒体マスタ・設定画面の設定をそのまま使う）。
- Workers Free プランで運用する。D1 の書き込み行数（1日10万行）に収めるため、置き換えは差分書き込み（追加・変更・削除の行だけ書き込む）とし、初回の同期は「同期する月数 = 1」で始める。
- 同期開始後に古い手動アップロードの履歴を削除しようとしたときは、「同期中のデータが消える可能性がある」と注意を表示する。
