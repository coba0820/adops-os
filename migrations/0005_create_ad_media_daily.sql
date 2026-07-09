-- ============================================================
-- v1.1 Issue #4: 広告媒体CSV 日次実績テーブル
-- upload_history に紐づけて、広告媒体CSVの明細行を保存する。
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_media_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  account_name TEXT,
  account_id TEXT,
  campaign_name TEXT,
  campaign_id TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  served_ads INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0,
  upload_history_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (upload_history_id) REFERENCES upload_history(id)
);

CREATE INDEX IF NOT EXISTS idx_ad_media_daily_target_date
  ON ad_media_daily(target_date);

CREATE INDEX IF NOT EXISTS idx_ad_media_daily_media_date
  ON ad_media_daily(media_id, target_date);

CREATE INDEX IF NOT EXISTS idx_ad_media_daily_upload_history
  ON ad_media_daily(upload_history_id);
