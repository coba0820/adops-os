-- v1.x: Manage media campaign names independently from ad codes.
-- campaign_master remains as the ad-code master for compatibility.

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  campaign_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_unique_media_name
  ON campaigns(media_id, campaign_name);

CREATE INDEX IF NOT EXISTS idx_campaigns_media
  ON campaigns(media_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_name
  ON campaigns(campaign_name);

CREATE TABLE IF NOT EXISTS ad_code_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_code_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_code_id) REFERENCES campaign_master(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_code_campaigns_unique
  ON ad_code_campaigns(ad_code_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_ad_code_campaigns_ad_code
  ON ad_code_campaigns(ad_code_id);

CREATE INDEX IF NOT EXISTS idx_ad_code_campaigns_campaign
  ON ad_code_campaigns(campaign_id);

INSERT OR IGNORE INTO campaigns (media_id, campaign_name, is_active, created_at, updated_at)
SELECT
  media_id,
  TRIM(campaign_name),
  1,
  MIN(created_at),
  MAX(updated_at)
FROM campaign_master
WHERE media_id IS NOT NULL
  AND NULLIF(TRIM(campaign_name), '') IS NOT NULL
GROUP BY media_id, TRIM(campaign_name);

INSERT OR IGNORE INTO ad_code_campaigns (ad_code_id, campaign_id, created_at)
SELECT
  cm.id,
  c.id,
  CURRENT_TIMESTAMP
FROM campaign_master cm
INNER JOIN campaigns c
  ON c.media_id = cm.media_id
 AND c.campaign_name = TRIM(cm.campaign_name)
WHERE NULLIF(TRIM(cm.campaign_name), '') IS NOT NULL;
