// ============================================================
// キャンペーンマスタ API（/api/campaign）
// 「媒体 → 広告コード → サイト」を紐付ける最重要マスタ。
// 一覧取得時は媒体名・サイト名をJOINして返す。
// ============================================================
import { Hono } from 'hono'
import type {
  Bindings,
  CampaignMasterView,
  ApiResponse,
} from '../../types'

export const campaignRoute = new Hono<{ Bindings: Bindings }>()

async function backfillMediaSummaryMediaId(db: D1Database, adCode: string | null | undefined) {
  const normalizedAdCode = adCode?.trim()
  if (!normalizedAdCode) return

  try {
    await db.prepare(
      `WITH candidate AS (
         SELECT
           NULLIF(TRIM(ad_code), '') AS ad_code,
           MIN(media_id) AS media_id,
           COUNT(DISTINCT media_id) AS media_count
         FROM campaign_master
         WHERE NULLIF(TRIM(ad_code), '') = ?
         GROUP BY NULLIF(TRIM(ad_code), '')
       )
       UPDATE media_summary_daily
       SET media_id = (
         SELECT media_id
         FROM candidate
         WHERE media_count = 1
       )
       WHERE media_id IS NULL
         AND NULLIF(TRIM(ad_code), '') = ?
         AND EXISTS (
           SELECT 1
           FROM candidate
           WHERE media_count = 1
         )
         AND NOT EXISTS (
           SELECT 1
           FROM media_summary_daily existing
           JOIN candidate ON candidate.media_count = 1
           WHERE existing.id <> media_summary_daily.id
             AND existing.target_date = media_summary_daily.target_date
             AND COALESCE(existing.media_id, -1) = candidate.media_id
             AND COALESCE(NULLIF(TRIM(existing.ad_code), ''), '') =
                 COALESCE(NULLIF(TRIM(media_summary_daily.ad_code), ''), '')
         )`
    )
      .bind(normalizedAdCode, normalizedAdCode)
      .run()
  } catch (err) {
    console.warn('[api/campaign] media_summary_daily backfill skipped', {
      adCode: normalizedAdCode,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ------------------------------------------------------------
// 一覧取得: GET /api/campaign
// 媒体マスタ・サイトマスタをJOINして名称も一緒に返す
// ------------------------------------------------------------
campaignRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       c.id, c.campaign_name, c.media_id, c.ad_code, c.site_id,
       c.is_active, c.created_at, c.updated_at,
       m.media_name, s.site_name
     FROM campaign_master c
     LEFT JOIN media_master m ON c.media_id = m.id
     LEFT JOIN site_master s ON c.site_id = s.id
     ORDER BY c.id ASC`
  ).all<CampaignMasterView>()

  return c.json<ApiResponse<CampaignMasterView[]>>({
    success: true,
    data: results,
  })
})

// ------------------------------------------------------------
// 新規追加: POST /api/campaign
// body: { campaign_name, media_id, ad_code, site_id, is_active }
// ------------------------------------------------------------
campaignRoute.post('/', async (c) => {
  const body = await c.req.json<{
    campaign_name: string
    media_id: number
    ad_code?: string
    site_id: number
    is_active?: number
  }>()

  if (!body.campaign_name || body.campaign_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'キャンペーン名は必須です' },
      400
    )
  }
  if (!body.media_id) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '媒体の選択は必須です' },
      400
    )
  }
  if (!body.site_id) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'サイトの選択は必須です' },
      400
    )
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO campaign_master
       (campaign_name, media_id, ad_code, site_id, is_active)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      body.campaign_name.trim(),
      body.media_id,
      body.ad_code?.trim() ?? null,
      body.site_id,
      body.is_active ?? 1
    )
    .run()

  await backfillMediaSummaryMediaId(c.env.DB, body.ad_code)

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: result.meta.last_row_id ?? null },
  })
})

// ------------------------------------------------------------
// 更新: PUT /api/campaign/:id
// ------------------------------------------------------------
campaignRoute.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    campaign_name: string
    media_id: number
    ad_code?: string
    site_id: number
    is_active?: number
  }>()

  if (!body.campaign_name || body.campaign_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'キャンペーン名は必須です' },
      400
    )
  }

  await c.env.DB.prepare(
    `UPDATE campaign_master
     SET campaign_name = ?, media_id = ?, ad_code = ?, site_id = ?,
         is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      body.campaign_name.trim(),
      body.media_id,
      body.ad_code?.trim() ?? null,
      body.site_id,
      body.is_active ?? 1,
      id
    )
    .run()

  await backfillMediaSummaryMediaId(c.env.DB, body.ad_code)

  return c.json<ApiResponse<null>>({ success: true })
})

// ------------------------------------------------------------
// 削除: DELETE /api/campaign/:id
// ------------------------------------------------------------
campaignRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  await c.env.DB.prepare('DELETE FROM campaign_master WHERE id = ?')
    .bind(id)
    .run()

  return c.json<ApiResponse<null>>({ success: true })
})
