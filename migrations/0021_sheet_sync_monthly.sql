-- v2.1: スプレッドシートを月ごとに登録する
-- ・sheet_sync_spreadsheets : 対象月（YYYY-MM）ごとの読み込み用スプレッドシート
-- ・sheet_sync_tab_results.target_month : どの月のシートから読んだ結果か
-- ・app_settings の sheet_sync.spreadsheet_id（1つだけの設定）は廃止し、値があれば当月分として引き継ぐ

CREATE TABLE IF NOT EXISTS sheet_sync_spreadsheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_month TEXT NOT NULL,             -- 'YYYY-MM'
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_url TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sheet_sync_spreadsheets_month
  ON sheet_sync_spreadsheets(target_month);

ALTER TABLE sheet_sync_tab_results
  ADD COLUMN target_month TEXT;

INSERT OR IGNORE INTO sheet_sync_spreadsheets (target_month, spreadsheet_id, spreadsheet_url)
SELECT strftime('%Y-%m', 'now', '+9 hours'), setting_value, ''
FROM app_settings
WHERE setting_group = 'sheet_sync'
  AND setting_key = 'spreadsheet_id'
  AND TRIM(setting_value) <> '';

DELETE FROM app_settings
WHERE setting_group = 'sheet_sync'
  AND setting_key = 'spreadsheet_id';

INSERT OR IGNORE INTO app_settings
  (setting_group, setting_key, setting_value, value_type, description)
VALUES
  ('alerts', 'warn_sheet_sync_missing_sheet', 'true', 'boolean', 'Warn when no spreadsheet is registered for the current month');
