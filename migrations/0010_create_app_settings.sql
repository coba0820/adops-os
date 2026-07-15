-- v1.9: application settings.
-- Flexible key-value settings for alert thresholds, display defaults, dashboard sections, and import targets.

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_group TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  value_type TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_group_key
  ON app_settings(setting_group, setting_key);

CREATE INDEX IF NOT EXISTS idx_app_settings_group
  ON app_settings(setting_group);

INSERT OR IGNORE INTO app_settings
  (setting_group, setting_key, setting_value, value_type, description)
VALUES
  ('alerts', 'cpa_warning_rate', '1.1', 'number', 'CPA warning threshold multiplier'),
  ('alerts', 'cpa_critical_rate', '1.2', 'number', 'CPA critical threshold multiplier'),
  ('alerts', 'registration_warning_rate', '0.9', 'number', 'Registration warning lower threshold multiplier'),
  ('alerts', 'registration_critical_rate', '0.8', 'number', 'Registration critical lower threshold multiplier'),
  ('alerts', 'budget_warning_rate', '1.05', 'number', 'Budget warning threshold multiplier'),
  ('alerts', 'budget_critical_rate', '1.1', 'number', 'Budget critical threshold multiplier'),
  ('alerts', 'warn_missing_ad_media_csv', 'true', 'boolean', 'Warn when ad media CSV is missing'),
  ('alerts', 'warn_missing_site_summary_csv', 'true', 'boolean', 'Warn when site summary CSV is missing'),
  ('alerts', 'warn_missing_payment_report_csv', 'true', 'boolean', 'Warn when payment report CSV is missing'),
  ('alerts', 'warn_zero_revenue', 'false', 'boolean', 'Warn when revenue is zero'),
  ('alerts', 'warn_zero_payer', 'false', 'boolean', 'Warn when payer count is zero'),
  ('alerts', 'warn_recovery_drop', 'false', 'boolean', 'Warn when recovery rate drops'),
  ('dashboard', 'show_today_kpi', 'true', 'boolean', 'Show today KPI section'),
  ('dashboard', 'show_alerts', 'true', 'boolean', 'Show alerts section'),
  ('dashboard', 'show_forecast_summary', 'true', 'boolean', 'Show forecast summary section'),
  ('dashboard', 'show_monthly_summary', 'true', 'boolean', 'Show monthly summary section'),
  ('dashboard', 'show_monthly_progress', 'true', 'boolean', 'Show monthly progress section'),
  ('dashboard', 'show_media_summary', 'true', 'boolean', 'Show media summary section'),
  ('dashboard', 'show_site_summary', 'true', 'boolean', 'Show site summary section'),
  ('dashboard', 'show_todos', 'true', 'boolean', 'Show todos section'),
  ('dashboard', 'show_csv_status', 'true', 'boolean', 'Show CSV status section'),
  ('display', 'default_group_by', 'daily', 'string', 'Default analysis grouping'),
  ('display', 'week_start_day', 'monday', 'string', 'Week start day'),
  ('display', 'money_decimal_digits', '0', 'number', 'Money decimal digits'),
  ('display', 'percent_decimal_digits', '1', 'number', 'Percent decimal digits'),
  ('display', 'count_decimal_digits', '0', 'number', 'Count decimal digits'),
  ('display', 'default_target_month', 'current', 'string', 'Default target month'),
  ('import', 'enable_ad_media_csv', 'true', 'boolean', 'Enable ad media CSV import'),
  ('import', 'enable_site_summary_csv', 'true', 'boolean', 'Enable site summary CSV import'),
  ('import', 'enable_payment_report_csv', 'true', 'boolean', 'Enable payment report CSV import');
