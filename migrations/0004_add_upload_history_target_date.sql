-- ============================================================
-- v1.1: CSV取込履歴の対象日追加
-- 既存の upload_history は保持し、今後の取込分に target_date を保存する。
-- status は 0003_add_upload_history_status.sql で success 固定の既定値を追加済み。
-- ============================================================

ALTER TABLE upload_history
  ADD COLUMN target_date TEXT;

CREATE INDEX IF NOT EXISTS idx_upload_history_target_date
  ON upload_history(target_date);

CREATE INDEX IF NOT EXISTS idx_upload_history_target_file_type
  ON upload_history(target_date, file_type);
