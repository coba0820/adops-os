-- v1.11: campaign group master.
-- Campaign groups become the analysis axis; campaign_master rows remain ad-code management records.

CREATE TABLE IF NOT EXISTS campaign_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  group_name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  UNIQUE(media_id, group_name)
);

CREATE TABLE IF NOT EXISTS campaign_group_ad_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_group_id INTEGER NOT NULL,
  ad_code_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_group_id) REFERENCES campaign_groups(id),
  FOREIGN KEY (ad_code_id) REFERENCES campaign_master(id),
  UNIQUE(ad_code_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_groups_media
  ON campaign_groups(media_id);

CREATE INDEX IF NOT EXISTS idx_campaign_groups_active
  ON campaign_groups(is_active);

CREATE INDEX IF NOT EXISTS idx_campaign_group_ad_codes_group
  ON campaign_group_ad_codes(campaign_group_id);
