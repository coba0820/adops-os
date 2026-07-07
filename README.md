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
- 広告媒体CSV（媒体選択＋アップロード＋プレビュー）
- 媒体集計CSV（アップロード＋プレビュー）
- 決済レポートCSV（アップロード＋プレビュー）
- ※ v1では「保存・分析・結合」は未実装。アップロード履歴（ファイル名・行数・種別）のみ`upload_history`テーブルに記録

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
| GET | `/api/upload` | CSVアップロード履歴一覧（直近50件） |
| POST | `/api/upload` | アップロード履歴記録 `{ file_type, media_id, file_name, row_count }` |

## データアーキテクチャ

- **ストレージ**: Cloudflare D1（SQLite）
- **テーブル**:
  - `media_master`（媒体マスタ）: id, media_name, created_at, updated_at
  - `site_master`（サイトマスタ）: id, site_name, created_at, updated_at
  - `campaign_master`（キャンペーンマスタ）: id, campaign_name, media_id(FK), ad_code, site_id(FK), is_active, created_at, updated_at
  - `upload_history`（アップロード履歴）: id, file_type, media_id(FK), file_name, row_count, uploaded_at
- **マイグレーション**: `migrations/0001_initial_schema.sql`
- **シードデータ**: `seed.sql`（開発用ダミーマスタデータ）

## ディレクトリ構成

```
webapp/
├── src/
│   ├── index.tsx           # エントリーポイント（ルーティング登録）
│   ├── renderer.tsx        # SPAシェル（HTML雛形、左メニュー枠を出力）
│   ├── types/index.ts      # 共通型定義（Bindings, Master型など）
│   └── routes/api/         # APIルート（機能ごとにファイル分割）
│       ├── media.ts        # 媒体マスタ CRUD
│       ├── site.ts         # サイトマスタ CRUD
│       ├── campaign.ts     # キャンペーンマスタ CRUD
│       ├── upload.ts       # アップロード履歴
│       └── dashboard.ts    # ダッシュボード用ダミーデータ
├── public/static/
│   ├── css/main.css        # デザインシステム（ライトテーマ・管理画面風）
│   └── js/
│       ├── app.js          # SPAルーター（ハッシュベース）
│       ├── components/     # 共通UIパーツ（サイドバー、モーダル、トースト、CSVパーサー等）
│       └── pages/          # 画面ごとのロジック（dashboard/data-import/master/coming-soon）
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

## デプロイ
- **プラットフォーム**: Cloudflare Pages
- **状態**: 開発中（サンドボックス環境で動作確認済み）
- **技術スタック**: Hono + TypeScript + Cloudflare D1 + Vanilla JS（フロント） + Font Awesome（CDN）
- **最終更新**: 2026-07-07
