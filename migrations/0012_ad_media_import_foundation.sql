-- v1.10: media-specific ad media import foundation.
-- Adds source currency metadata and monthly exchange rates for USD media.

ALTER TABLE media_master
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY';

ALTER TABLE ad_media_daily
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY';

CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_month TEXT NOT NULL,
  currency TEXT NOT NULL,
  rate REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_month, currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_month_currency
  ON exchange_rates(target_month, currency);

UPDATE media_master
SET currency = 'USD'
WHERE lower(media_name) LIKE '%bigo%'
   OR lower(media_name) LIKE '%mintegral%'
   OR lower(media_name) LIKE '%unity%';

UPDATE media_master
SET currency = 'JPY'
WHERE currency IS NULL
   OR currency = '';

UPDATE ad_media_daily
SET currency = 'JPY'
WHERE currency IS NULL
   OR currency = '';
