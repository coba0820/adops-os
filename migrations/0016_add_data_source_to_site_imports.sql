-- v1.x: keep YNS and internal site data as separate import sources.
-- Existing rows were imported before this feature and are treated as YNS.

ALTER TABLE media_summary_daily
  ADD COLUMN site_name TEXT NOT NULL DEFAULT '';

ALTER TABLE media_summary_daily
  ADD COLUMN data_source TEXT NOT NULL DEFAULT 'YNS';

ALTER TABLE payment_report_daily
  ADD COLUMN data_source TEXT NOT NULL DEFAULT 'YNS';

DROP INDEX IF EXISTS idx_media_summary_daily_unique_target_media_ad_code;
DROP INDEX IF EXISTS idx_payment_report_daily_unique_registration_media_ad_customer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_summary_daily_unique_target_media_ad_code_source
  ON media_summary_daily(target_date, COALESCE(media_id, -1), COALESCE(ad_code, ''), COALESCE(data_source, 'YNS'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_report_daily_unique_registration_media_ad_customer_source
  ON payment_report_daily(registration_date, COALESCE(media_id, -1), COALESCE(ad_code, ''), COALESCE(customer_id, ''), COALESCE(data_source, 'YNS'));

CREATE INDEX IF NOT EXISTS idx_media_summary_daily_source_date
  ON media_summary_daily(data_source, target_date);

CREATE INDEX IF NOT EXISTS idx_payment_report_daily_source_registration
  ON payment_report_daily(data_source, registration_date);
