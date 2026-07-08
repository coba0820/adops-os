-- ============================================================
-- v1.1: 媒体ステータス追加
-- CSV取込率の計算では、停止媒体を対象外にするための状態管理を追加する。
-- 将来的に archived を追加できるよう、TEXT カラムとして保持する。
-- ============================================================

ALTER TABLE media_master
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_media_master_status ON media_master(status);
