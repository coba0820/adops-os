-- v1.x: configurable column mappings for generic ad media CSV/XLSX imports.

CREATE TABLE IF NOT EXISTS media_column_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  source_column TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (media_id) REFERENCES media_master(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_column_mappings_media_field
  ON media_column_mappings(media_id, field_key);

CREATE INDEX IF NOT EXISTS idx_media_column_mappings_media_active
  ON media_column_mappings(media_id, is_active);
