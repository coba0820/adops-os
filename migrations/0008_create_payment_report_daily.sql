-- v1.5: payment report details aggregated by registration date.

CREATE TABLE IF NOT EXISTS payment_report_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,
  media_id INTEGER,
  ad_code TEXT NOT NULL,
  payer_count INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  upload_history_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (upload_history_id) REFERENCES upload_history(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_report_daily_unique_target_media_ad_code
  ON payment_report_daily(target_date, COALESCE(media_id, -1), COALESCE(ad_code, ''));

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_target_date
  ON payment_report_daily(target_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_media_date
  ON payment_report_daily(media_id, target_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_ad_code_date
  ON payment_report_daily(ad_code, target_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_upload_history
  ON payment_report_daily(upload_history_id);
