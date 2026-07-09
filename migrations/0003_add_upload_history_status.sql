-- ============================================================
-- v1.1: CSV取込履歴ステータス追加
-- 今回はCSV内容のDB保存は行わず、履歴は success 固定で記録する。
-- ============================================================

ALTER TABLE upload_history
  ADD COLUMN status TEXT NOT NULL DEFAULT 'success';

CREATE INDEX IF NOT EXISTS idx_upload_history_uploaded_at
  ON upload_history(uploaded_at);

CREATE INDEX IF NOT EXISTS idx_upload_history_media_uploaded_at
  ON upload_history(media_id, uploaded_at);
