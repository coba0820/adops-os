-- v1.5: payment report details.
-- Payment metrics are analyzed by registration_date, not by first_payment_at.

CREATE TABLE IF NOT EXISTS payment_report_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_date TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL,
  ad_code TEXT NOT NULL,
  registration_status TEXT NOT NULL DEFAULT '',
  first_payment_at TEXT,
  payment_count INTEGER NOT NULL DEFAULT 0,
  payment_amount REAL NOT NULL DEFAULT 0,
  media_type TEXT NOT NULL DEFAULT '',
  media_id INTEGER,
  upload_history_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (upload_history_id) REFERENCES upload_history(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_report_daily_unique_registration_media_ad_customer
  ON payment_report_daily(registration_date, COALESCE(media_id, -1), COALESCE(ad_code, ''), COALESCE(customer_id, ''));

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_registration_date
  ON payment_report_daily(registration_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_media_registration
  ON payment_report_daily(media_id, registration_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_ad_code_registration
  ON payment_report_daily(ad_code, registration_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_upload_history
  ON payment_report_daily(upload_history_id);
