-- v1.7: monthly budget plans.
-- scope_type supports overall/media/site now and leaves room for ad_code later.

CREATE TABLE IF NOT EXISTS budget_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_month TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'media',
  media_id INTEGER,
  site_id INTEGER,
  ad_code TEXT,
  monthly_budget REAL NOT NULL DEFAULT 0,
  target_cpa REAL NOT NULL DEFAULT 0,
  target_recovery_rate REAL NOT NULL DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id),
  FOREIGN KEY (site_id) REFERENCES site_master(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_plans_unique_scope
  ON budget_plans(
    target_month,
    scope_type,
    COALESCE(media_id, -1),
    COALESCE(site_id, -1),
    COALESCE(ad_code, '')
  );

CREATE INDEX IF NOT EXISTS idx_budget_plans_target_month
  ON budget_plans(target_month);

CREATE INDEX IF NOT EXISTS idx_budget_plans_media_month
  ON budget_plans(media_id, target_month);

CREATE INDEX IF NOT EXISTS idx_budget_plans_site_month
  ON budget_plans(site_id, target_month);
