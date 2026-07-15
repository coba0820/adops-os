-- v1.x: Backfill media_summary_daily.media_id from campaign_master when ad_code maps to one media only.
-- Ambiguous ad_code values with multiple media candidates are intentionally left unchanged.

WITH unique_ad_code_media AS (
  SELECT
    NULLIF(TRIM(ad_code), '') AS ad_code,
    MIN(media_id) AS media_id,
    COUNT(DISTINCT media_id) AS media_count
  FROM campaign_master
  WHERE NULLIF(TRIM(ad_code), '') IS NOT NULL
  GROUP BY NULLIF(TRIM(ad_code), '')
),
safe_ad_code_media AS (
  SELECT ad_code, media_id
  FROM unique_ad_code_media
  WHERE media_count = 1
)
UPDATE media_summary_daily
SET media_id = (
  SELECT safe_ad_code_media.media_id
  FROM safe_ad_code_media
  WHERE safe_ad_code_media.ad_code = NULLIF(TRIM(media_summary_daily.ad_code), '')
)
WHERE media_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM safe_ad_code_media
    WHERE safe_ad_code_media.ad_code = NULLIF(TRIM(media_summary_daily.ad_code), '')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM media_summary_daily existing
    JOIN safe_ad_code_media
      ON safe_ad_code_media.ad_code = NULLIF(TRIM(media_summary_daily.ad_code), '')
    WHERE existing.id <> media_summary_daily.id
      AND existing.target_date = media_summary_daily.target_date
      AND COALESCE(existing.media_id, -1) = safe_ad_code_media.media_id
      AND COALESCE(NULLIF(TRIM(existing.ad_code), ''), '') =
          COALESCE(NULLIF(TRIM(media_summary_daily.ad_code), ''), '')
  );
