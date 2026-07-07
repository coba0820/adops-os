-- ============================================================
-- AdOps OS 初期スキーマ (v1)
-- 作成日: 2026-07-07
-- 概要:
--   ・媒体マスタ / サイトマスタ / キャンペーンマスタ
--   ・CSVアップロード履歴（実データは保存しない。メタ情報のみ）
--   将来的に実績データ（広告媒体実績・媒体集計・決済レポート）を
--   蓄積するテーブルを追加していく前提の土台テーブル群。
-- ============================================================

-- ------------------------------------------------------------
-- 媒体マスタ（media_master）
-- 広告を配信する媒体（Google広告 / Yahoo!広告 / Meta広告 など）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- 媒体ID（内部連番）
  media_name TEXT NOT NULL,               -- 媒体名（例: Google広告）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- サイトマスタ（site_master）
-- 広告の受け皿となる自社サイト・LPなど
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- サイトID（内部連番）
  site_name TEXT NOT NULL,                -- サイト名
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- キャンペーンマスタ（campaign_master）
-- 「媒体 → 広告コード → サイト」を紐付ける最重要マスタ。
-- このマスタが後続の実績分析・予算管理・着地予測の
-- 名寄せ（データ結合）の軸になる。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- キャンペーンID（内部連番）
  campaign_name TEXT NOT NULL,            -- キャンペーン名
  media_id INTEGER NOT NULL,              -- 媒体（media_master.id への外部キー）
  ad_code TEXT,                           -- 広告コード（媒体側の識別コード）
  site_id INTEGER NOT NULL,               -- サイト（site_master.id への外部キー）
  is_active INTEGER NOT NULL DEFAULT 1,   -- 有効/無効（1=有効, 0=無効）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (site_id) REFERENCES site_master(id)
);

-- ------------------------------------------------------------
-- CSVアップロード履歴（upload_history）
-- v1ではCSVの実データ保存・分析・結合は行わないが、
-- 「いつ・誰が・どの種類のCSVを・何件アップロードしたか」の
-- 履歴だけは記録しておく（将来の取込フロー拡張の土台）。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_type TEXT NOT NULL,                -- 'ad_media' | 'media_aggregate' | 'payment_report'
  media_id INTEGER,                       -- 広告媒体CSVの場合、選択された媒体（media_master.id）
  file_name TEXT NOT NULL,                -- アップロードされたファイル名
  row_count INTEGER NOT NULL DEFAULT 0,   -- CSVの行数（ヘッダ除く）
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id)
);

-- ------------------------------------------------------------
-- インデックス
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaign_media_id ON campaign_master(media_id);
CREATE INDEX IF NOT EXISTS idx_campaign_site_id ON campaign_master(site_id);
CREATE INDEX IF NOT EXISTS idx_upload_history_file_type ON upload_history(file_type);
