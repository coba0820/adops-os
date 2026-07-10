-- v1.4 hardening: keep only the latest detail row per analysis key,
-- then add unique indexes used by replacement imports and analysis filters.

DELETE FROM ad_media_daily
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY target_date, media_id, COALESCE(campaign_id, '')
        ORDER BY upload_history_id DESC, id DESC
      ) AS row_number
    FROM ad_media_daily
  )
  WHERE row_number > 1
);

DELETE FROM media_summary_daily
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY target_date, COALESCE(media_id, -1), COALESCE(ad_code, '')
        ORDER BY upload_history_id DESC, id DESC
      ) AS row_number
    FROM media_summary_daily
  )
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_media_daily_unique_target_media_campaign
  ON ad_media_daily(target_date, media_id, COALESCE(campaign_id, ''));

CREATE INDEX IF NOT EXISTS idx_ad_media_daily_campaign_date
  ON ad_media_daily(campaign_id, target_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_summary_daily_unique_target_media_ad_code
  ON media_summary_daily(target_date, COALESCE(media_id, -1), COALESCE(ad_code, ''));
