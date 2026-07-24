-- v1.12: Allow one ad code to be linked to multiple sites.
-- campaign_master.site_id is kept for compatibility, but ad_code_sites becomes
-- the source of truth for ad-code/site relationships.

CREATE TABLE IF NOT EXISTS ad_code_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_code_id INTEGER NOT NULL,
  site_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_code_id) REFERENCES campaign_master(id),
  FOREIGN KEY (site_id) REFERENCES site_master(id),
  UNIQUE(ad_code_id, site_id)
);

INSERT OR IGNORE INTO ad_code_sites (ad_code_id, site_id)
SELECT id, site_id
FROM campaign_master
WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_code_sites_ad_code
  ON ad_code_sites(ad_code_id);

CREATE INDEX IF NOT EXISTS idx_ad_code_sites_site
  ON ad_code_sites(site_id);
