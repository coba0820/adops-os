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
  - 「読み込み用スプレッドシート」に IMPORTRANGE で集約したデータを、毎日 JST 12:00 に自動で読み込む（画面の「今すぐ同期」でも実行可）
  - **読み込み用スプレッドシートは月ごとに作り、設定画面で対象月（YYYY-MM）ごとに URL を登録する**。登録画面の「接続テスト」で、シートが読めるか・同期するタブがすべてあるかを確認できる
  - 1タブ＝1データ種別。広告媒体は媒体ごと、サイト側は YNS／自社 × 媒体集計／決済レポートの4種。タブ名は全月共通
  - 同期のたびに **当月＋前月**（設定で変更可）を対象にし、**各月をその月に登録したシートから読み、その月の範囲だけを置き換える**（シートに他の月の行があっても、その月の行だけを使う）
  - シートが未登録の月はスキップして理由を記録する。当月が未登録ならダッシュボードに警告を出す
  - 置き換えは差分書き込み：既存の行と突き合わせ、追加・値が変わった行の更新・なくなった行の削除だけを書き込む（D1 の書き込み行数を抑えるため。結果は丸ごと置き換えた場合と同じ）
  - 安全チェックに引っかかったタブは取り込まずに理由を記録（タブなし、ヘッダー空、`#REF!` などのエラー値、期間内0件、行数の大幅減少、パースエラー）。1つの月・1つのタブの失敗は他に影響しない
  - 実行履歴とタブ別結果（対象月つき）は `sheet_sync_runs` / `sheet_sync_tab_results` に記録し、データ取込画面に表示
- **手動アップロード（予備）**
  - 広告媒体CSV（媒体選択）／媒体集計CSV／決済レポートCSV を CSV・XLSX でアップロード
  - 取込処理は同期と共通（`src/lib/import-service.ts`）。取込履歴は `import_method`（手動／シート同期）で区別
  - 取込履歴を削除すると、その取込で書き込んだ明細が消える。同期は値が変わらない行に書き込まないため、同期開始後も古い手動アップロードの明細が残っていることがある。その履歴を削除しようとすると、画面に注意を表示する（消えた行は次回の同期で再び取り込まれる）

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
| GET | `/api/sheet-sync/status` | 同期設定の状態、最新の実行とタブ別結果、同期する期間、対象月ごとのシート登録状況（`sync_months`） |
| GET | `/api/sheet-sync/runs` | 同期の実行履歴（`?limit=`、既定20件） |
| GET | `/api/sheet-sync/runs/:id` | 指定した実行のタブ別結果 |
| POST | `/api/sheet-sync/run` | 今すぐ同期（手動実行） |
| GET | `/api/sheet-sync/spreadsheets` | 月ごとのスプレッドシート一覧と当月 |
| PUT | `/api/sheet-sync/spreadsheets` | 月ごとのスプレッドシートの登録・更新 `{ target_month: 'YYYY-MM', url }`（URL から ID を取り出して保存） |
| DELETE | `/api/sheet-sync/spreadsheets/:month` | 月ごとのスプレッドシートの登録を削除（取り込み済みデータは消さない） |
| POST | `/api/sheet-sync/spreadsheets/test` | 接続テスト `{ url }`：シートが読めるか、同期するタブがすべてあり1行目が入っているか |
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
  - `sheet_sync_tab_results`（タブ別結果）: id, run_id, source_id, target_month, tab_name, status(imported/skipped/failed), row_count, date_from, date_to, reason, upload_history_id
  - `sheet_sync_spreadsheets`（月ごとの読み込み用スプレッドシート）: id, target_month(YYYY-MM, 一意), spreadsheet_id, spreadsheet_url
- **マイグレーション**: `migrations/`（スプレッドシート同期は `0020_sheet_sync.sql`、月ごとのシート登録は `0021_sheet_sync_monthly.sql`）
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
3. **月ごとに**読み込み用スプレッドシートを作成し、サービスアカウントのメールアドレスに「閲覧者」で共有する（「ウェブに公開」は使わない）
4. データの種類ごとにタブを作り、各元シートから IMPORTRANGE で取り込む。**1行目は元のエクスポートと同じ列名**にする。タブ名は毎月同じにする（AdOps OS 側のタブ名の設定は全月共通）

### 2. 鍵をシークレットとして登録（Pages と Worker の両方）
```bash
# Pages（画面の「今すぐ同期」「接続テスト」用）
npx wrangler pages secret put GOOGLE_SERVICE_ACCOUNT_JSON --project-name adops-os < service-account.json
# Worker（毎日 12:00 の定時実行用）
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config workers/sheet-sync/wrangler.jsonc < service-account.json
```
PowerShell では `Get-Content service-account.json -Raw | npx wrangler ...` の形で渡す。

### 3. 本番反映の手順（初回は「同期する月数 = 1」で始める）

Workers Free プランで運用する前提。D1 の書き込みは 1日 10万行まで（DELETE・インデックス更新も数える）なので、初回は対象を当月だけに絞る。

**事前準備**
1. `feature/sheet-sync` を `main` にマージする（Pages の本番は `main` から出す）
2. 本番 D1 の状態を控える。D1 の Time Travel で過去の時点に戻せる（Free プランは7日まで）ので、作業開始時刻をメモしておく（必要なら `npx wrangler d1 export adops-os-db --remote --output backup.sql` でエクスポートも取る）
3. 当月の読み込み用スプレッドシートを用意し、サービスアカウントに共有しておく

**反映（この順番で行う）**
1. `npm run db:migrate:prod`：0020・0021 を本番 D1 に適用する（**コードより先に**行う。設定の「同期を有効にする」は OFF のまま入る）
2. Pages のシークレットを登録する（上記 2.）
3. `npm run deploy`：Pages をデプロイする（シークレットは登録後のデプロイから有効になる）
4. `npm run worker:sheet-sync:deploy`：定時実行 Worker をデプロイする
5. Worker のシークレットを登録する（上記 2.）。同期が OFF の間は、定時実行は何もせずに終わる

**画面での設定**
1. 設定 > スプレッドシート同期：**同期する月数 = 1**、行数減少の許容率（初期値 50%）。この時点では「自動同期を有効にする」は OFF のまま保存する
2. 設定 > サイト側のタブ名：YNS／自社 の媒体集計・決済レポートのタブ名
3. マスタ管理 > 媒体：各媒体の「読み込むタブ名」（空欄なら同期対象外。停止中の媒体は同期しない）
4. 設定 > 月ごとのスプレッドシート：当月の URL を入力して「接続テスト」→ すべてのタブが「OK」になることを確認してから「登録」
5. 「自動同期を有効にする」を ON にして保存

**初回同期と確認**
1. データ取込 >「今すぐ同期」。タブごとの結果（取込行数・期間・スキップ理由）を確認する
2. 同じ月を手動アップロードした場合と件数・合計が合っているかを、実績分析などで確認する
3. Cloudflare ダッシュボードの D1 > Metrics で「Rows written」を確認する。手動アップロード済みのデータと値が同じなら書き込みは少ない。シートの表示形式の違いでほぼ全行が書き換わった場合は、当月の行数 × 約8 行になる（月末の媒体集計で約9万行）。**その日は手動アップロードや再同期を重ねない**
4. 翌日 12:00 以降に、取込履歴に「定時」の実行があること、Workers のログ（Observability）で CPU 時間・エラーがないことを確認する。Free プランの CPU 上限（1回 10ms）を超えて失敗する場合は、タブごとに分けて実行する対応を検討する

**前月分も同期する場合（任意）**
- 前月のスプレッドシートを登録して接続テストを通してから、「同期する月数」を 2 にする

**問題があったとき**
- 「自動同期を有効にする」を OFF にすれば、定時実行・今すぐ同期とも止まる（手動アップロードはそのまま使える）
- データを戻す必要がある場合は、D1 の Time Travel で作業開始前の時点に戻す（`npx wrangler d1 time-travel restore adops-os-db --timestamp=<作業開始時刻のUNIX秒>`。Free プランは7日以内のみ。戻すと以降のデータも消えるため、実行前に必ず確認する）

### 4. 毎月の運用
- **月が変わる前に**（遅くとも1日の 12:00 の定時実行まで）、次の2つを済ませておく
  1. 翌月の読み込み用スプレッドシートを作成・共有し、設定画面で登録して接続テストを通す（タブ名・タブ構成は前月と同じにする）
  2. USD の媒体（BIGO・Mintegral・Unity など）がある場合は、設定 > 為替レート管理で**翌月の USD レート**を登録する。未登録だと、その月の USD 媒体のタブは「為替レートが未設定」でスキップされる
- 当月のシートが未登録だと、当月分はスキップされ、ダッシュボードに「スプレッドシート未登録」の警告が出る（設定 > アラートで ON/OFF）
- 前月のシートは、月数が 2 以上の間は前月分の読み込みに使われる（月末の数値の確定分を翌月に取り込むため、通常は月数 2 で運用する）。登録を削除しても取り込み済みのデータは消えない

### 5. 広告媒体のタブを追加する手順
新しい広告媒体（例：BIGO、Mintegral）をスプレッドシート同期の対象に加えるときの手順。同期の対象にした媒体は、その媒体の手動アップロードはやめる（両方で入れると、取込のたびに互いの期間を置き換え合う）。

**1. 媒体マスタを確認する（マスタ管理 > 媒体）**
- 状態が「稼働中」であること（停止中の媒体は同期しない）
- 媒体名：次の媒体は、媒体名にその名前が含まれていれば専用のパーサーで読む。それ以外の媒体は手順 3 の列マッピングが必要
  | 専用パーサー | 媒体名に含める文字 | 通貨 | 備考 |
  |---|---|---|---|
  | Taboola | taboola | JPY | |
  | Facebook | facebook / meta | JPY | |
  | Moloco | moloco | JPY | |
  | popIn | popin | JPY | |
  | LOGLY | logly | JPY | |
  | UZOU | uzou | JPY | |
  | BIGO | bigo | USD | エクスポートの**2行目が見出し**（1行目はタイトル行）。シートも同じ並びのまま貼る |
  | Mintegral | mintegral | USD | 「sum」の合計行は自動で除外 |
  | Unity | unity | USD | |
- 通貨：専用パーサーの媒体は上の表の通貨で読む。列マッピングで読む媒体は、媒体マスタの「通貨」が使われる

**2. 為替レートを確認する（USD の媒体のみ。設定 > 為替レート管理）**
- 同期する月（月数 2 なら当月と前月）すべての USD レートが登録されていること。足りない月のタブは「為替レートが未設定」でスキップされる

**3. 列マッピングを設定する（専用パーサーがない媒体のみ）**
- マスタ管理 > 媒体 の「CSV列マッピング」ボタンで、日付・広告費（必須）、Imp・クリック・CV・キャンペーン名などがどの列かを設定する。データ取込画面からその媒体の CSV を一度手動アップロードすると、列の候補を見ながら設定できる
- シートのタブの見出しは、マッピングで設定した列名と同じにする（列名で読むため）

**4. 読み込み用スプレッドシートにタブを追加する**
- **当月のシートと、月数 2 なら前月のシートの両方に**タブを追加する。前月のシートにタブがないと、前月分が毎日「タブが見つかりません」でスキップされ、ダッシュボードに「一部スキップ」の警告が出続ける
- タブ名は全月共通。媒体ごとに1タブ
- 中身は、媒体のエクスポートと**同じ見出し・同じ列の並び**にする（IMPORTRANGE で元シートから取り込む）。日付・金額の表示形式を変えない（`2026/10/01`・`2026-10-01`・`10/01/2026` などの形式は読める。金額のカンマや「¥」は外して読む）
- その月の日付の行が入っていれば、他の月の行が混ざっていてもよい（その月の行だけを使う）

**5. AdOps OS 側でタブ名を設定する**
- マスタ管理 > 媒体 の編集画面で「読み込むタブ名」に、追加したタブ名を入れて保存する

**6. 接続テスト → 同期 → 確認**
1. 設定 > 月ごとのスプレッドシート で、当月（と前月）の行の「接続テスト」を押し、追加したタブが「OK」になることを確認する（「タブなし」はタブ名の違い、「1行目が空」は見出しの位置を確認）
2. データ取込 >「今すぐ同期」を押し、追加した媒体のタブが「取込済」になることを確認する。スキップされた場合は「理由・注意」の内容を直す
3. 実績分析で、その媒体の数値が媒体の管理画面（またはエクスポート）と合っているかを確認する

- 書き込み行数：追加した媒体の初回同期は、その媒体の 2か月分（数百行程度）が新規登録になる。広告媒体は行数が少ないので、Free の上限への影響は小さい
- うまく読めない場合は、その媒体の「読み込むタブ名」を空欄に戻せば同期の対象から外れる（取り込み済みのデータは消えない）

### 運用メモ
- 実行時刻は `workers/sheet-sync/wrangler.jsonc` の `triggers.crons`（UTC。現在は `0 3 * * *` = JST 12:00）。変更するときは `src/lib/sheet-sync.ts` の `SCHEDULED_SYNC_HOUR_JST` も合わせ、Worker の再デプロイ（`npm run worker:sheet-sync:deploy`）と Pages のデプロイ（`main` への push）の両方を行う
- D1 の書き込み行数（Free は1日10万行）は UTC 0時 = JST 9:00 に区切られる。12:00 の定時実行は、その日の 9:00 以降の手動アップロード・「今すぐ同期」と同じ日に数えられる
- 各月は、その月に登録したシートの「その月の日付の行」だけで置き換える。シートに前月の行が残っていても、その月の置き換えには使わない
- 行数チェックは「置き換え前に DB にある同じ月・同じデータの行数 × 許容率」と比べる。月初に期間が短くなっても誤ってスキップしない
- 置き換えは差分書き込み。値が変わらない行には書き込まないため、その行の `upload_history_id` は以前の取込のまま残る。古い手動アップロードの履歴を削除すると、その取込の行が消える（画面で注意を表示。次回の同期で再び取り込まれる）
- 15分以上「実行中」のまま残った実行は、次の同期開始時に失敗扱いにして打ち切る
- ダッシュボードでは「最新の同期が失敗／一部スキップ」「JST 14時（定時実行の2時間後）を過ぎても当日の同期がない」「当月のシートが未登録」の場合に警告する（設定 > アラートでON/OFF）

### ローカルでの確認
- `npm run db:migrate:local` で 0020・0021 を適用
- `.dev.vars` に `SHEET_SYNC_TEST_MODE=true` を書くと、Google に接続せずに試せる（本番では設定しない）
  - 同期：`POST /api/sheet-sync/run` の body に `{ "tabs_by_month": { "2026-10": { "タブ名": [["見出し", ...], [...]] } } }`（月ごとのシートの中身）または `{ "tabs": { ... } }`（登録済みの全月で同じ中身）
  - 接続テスト：`POST /api/sheet-sync/spreadsheets/test` の body に `{ "url": "...", "sheet_titles": ["タブ名", ...], "headers": { "タブ名": ["見出し", ...] } }`
- 実際のシートで試す場合は `.dev.vars` に `GOOGLE_SERVICE_ACCOUNT_JSON=...`（1行のJSON）を書く
- Worker は `npm run worker:sheet-sync:dev` で起動し、`http://localhost:8787/__scheduled` を開くと定時実行を再現できる（ローカル D1 は Pages と共有。Worker 用の鍵は `workers/sheet-sync/.dev.vars` に書く）

## デプロイ
- **プラットフォーム**: Cloudflare Pages
- **状態**: 開発中（サンドボックス環境で動作確認済み）
- **技術スタック**: Hono + TypeScript + Cloudflare D1 + Vanilla JS（フロント） + Font Awesome（CDN）
- **最終更新**: 2026-07-07
