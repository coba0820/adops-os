-- v2.0: 読み込み用スプレッドシートからの自動同期
-- ・sheet_sync_sources     : 読み込むタブの定義（広告媒体は媒体ごと、サイト側は種別×データソースごと）
-- ・sheet_sync_runs        : 同期の実行履歴
-- ・sheet_sync_tab_results : 実行ごとのタブ別結果
-- ・upload_history.import_method : 手動アップロード / シート同期の区別

CREATE TABLE IF NOT EXISTS sheet_sync_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,              -- 'ad_media_csv' | 'site_summary_csv' | 'payment_report_csv'
  media_id INTEGER,                       -- 広告媒体のみ
  data_source TEXT,                       -- サイト側のみ 'YNS' | 'INTERNAL'
  tab_name TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sheet_sync_sources_media
  ON sheet_sync_sources(media_id)
  WHERE source_type = 'ad_media_csv';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sheet_sync_sources_site
  ON sheet_sync_sources(source_type, data_source)
  WHERE source_type <> 'ad_media_csv';

CREATE TABLE IF NOT EXISTS sheet_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,                  -- 'cron' | 'manual'
  status TEXT NOT NULL,                   -- 'running' | 'success' | 'partial' | 'failed'
  date_from TEXT,
  date_to TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_runs_started_at
  ON sheet_sync_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_runs_status
  ON sheet_sync_runs(status);

CREATE TABLE IF NOT EXISTS sheet_sync_tab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  source_id INTEGER,
  tab_name TEXT NOT NULL,
  status TEXT NOT NULL,                   -- 'imported' | 'skipped' | 'failed'
  row_count INTEGER NOT NULL DEFAULT 0,
  date_from TEXT,
  date_to TEXT,
  reason TEXT,
  upload_history_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES sheet_sync_runs(id),
  FOREIGN KEY (source_id) REFERENCES sheet_sync_sources(id),
  FOREIGN KEY (upload_history_id) REFERENCES upload_history(id)
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_tab_results_run
  ON sheet_sync_tab_results(run_id);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_tab_results_source_status
  ON sheet_sync_tab_results(source_id, status);

ALTER TABLE upload_history
  ADD COLUMN import_method TEXT NOT NULL DEFAULT 'manual';

INSERT OR IGNORE INTO app_settings
  (setting_group, setting_key, setting_value, value_type, description)
VALUES
  ('sheet_sync', 'enabled', 'false', 'boolean', 'Enable spreadsheet sync'),
  ('sheet_sync', 'spreadsheet_id', '', 'string', 'Spreadsheet ID to read'),
  ('sheet_sync', 'months_to_sync', '2', 'number', 'Number of months to sync (current month included)'),
  ('sheet_sync', 'min_row_ratio', '0.5', 'number', 'Skip a tab when new rows fall below existing rows times this ratio'),
  ('alerts', 'warn_sheet_sync_failed', 'true', 'boolean', 'Warn when the latest spreadsheet sync failed or partially failed'),
  ('alerts', 'warn_sheet_sync_not_run', 'true', 'boolean', 'Warn when spreadsheet sync has not run today');
