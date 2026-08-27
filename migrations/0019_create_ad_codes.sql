-- v1.x: Introduce ad_codes as the ad-code centered master table.
-- Existing relation tables keep their numeric ad_code_id values; ad_codes.id is
-- backfilled from campaign_master.id to preserve current links safely.

CREATE TABLE IF NOT EXISTS ad_codes (
  id INTEGER PRIMARY KEY,
  media_id INTEGER,
  ad_code TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id)
);

INSERT OR IGNORE INTO ad_codes (id, media_id, ad_code, is_active, created_at, updated_at)
SELECT
  MIN(id) AS id,
  media_id,
  TRIM(ad_code) AS ad_code,
  MAX(is_active) AS is_active,
  MIN(created_at) AS created_at,
  MAX(updated_at) AS updated_at
FROM campaign_master
WHERE NULLIF(TRIM(ad_code), '') IS NOT NULL
GROUP BY TRIM(ad_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_codes_unique_ad_code
  ON ad_codes(ad_code);

CREATE INDEX IF NOT EXISTS idx_ad_codes_media
  ON ad_codes(media_id);

CREATE INDEX IF NOT EXISTS idx_ad_codes_active
  ON ad_codes(is_active);

CREATE TRIGGER IF NOT EXISTS trg_campaign_master_ad_codes_insert
AFTER INSERT ON campaign_master
WHEN NULLIF(TRIM(NEW.ad_code), '') IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO ad_codes
    (id, media_id, ad_code, is_active, created_at, updated_at)
  VALUES
    (NEW.id, NEW.media_id, TRIM(NEW.ad_code), NEW.is_active, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_campaign_master_ad_codes_update
AFTER UPDATE OF media_id, ad_code, is_active ON campaign_master
WHEN NULLIF(TRIM(NEW.ad_code), '') IS NOT NULL
BEGIN
  UPDATE ad_codes
  SET media_id = NEW.media_id,
      ad_code = TRIM(NEW.ad_code),
      is_active = NEW.is_active,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;

  INSERT OR IGNORE INTO ad_codes
    (id, media_id, ad_code, is_active, created_at, updated_at)
  VALUES
    (NEW.id, NEW.media_id, TRIM(NEW.ad_code), NEW.is_active, NEW.created_at, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER IF NOT EXISTS trg_campaign_master_ad_codes_delete
AFTER DELETE ON campaign_master
BEGIN
  DELETE FROM ad_codes
  WHERE id = OLD.id;
END;
