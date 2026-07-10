-- v1.4: media summary CSV detail table and ad media CV metric.

ALTER TABLE ad_media_daily
  ADD COLUMN media_cv INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS media_summary_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,
  media_id INTEGER,
  ad_code TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  registration_count INTEGER NOT NULL DEFAULT 0,
  provisional_registration_count INTEGER NOT NULL DEFAULT 0,
  upload_history_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (upload_history_id) REFERENCES upload_history(id)
);

CREATE INDEX IF NOT EXISTS idx_media_summary_daily_target_date
  ON media_summary_daily(target_date);

CREATE INDEX IF NOT EXISTS idx_media_summary_daily_media_date
  ON media_summary_daily(media_id, target_date);

CREATE INDEX IF NOT EXISTS idx_media_summary_daily_ad_code_date
  ON media_summary_daily(ad_code, target_date);

CREATE INDEX IF NOT EXISTS idx_media_summary_daily_upload_history
  ON media_summary_daily(upload_history_id);
