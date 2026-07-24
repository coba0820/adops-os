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

function parsePositiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function normalizeSiteIds(value: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map(parsePositiveInteger)
        .filter((id): id is number => id !== null)
    )]
  }

  const id = parsePositiveInteger(value)
  return id ? [id] : []
}

async function ensureSitesExist(db: D1Database, siteIds: number[]) {
  if (siteIds.length === 0) {
    throw new Error('サイトの選択は必須です')
  }

  const placeholders = siteIds.map(() => '?').join(', ')
  const { results } = await db.prepare(
    `SELECT id
     FROM site_master
     WHERE id IN (${placeholders})`
  )
    .bind(...siteIds)
    .all<{ id: number }>()

  if (results.length !== siteIds.length) {
    throw new Error('存在しないサイトが含まれています')
  }
}

async function replaceAdCodeSites(db: D1Database, adCodeId: number, siteIds: number[]) {
  const statements = [
    db.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(adCodeId),
    ...siteIds.map((siteId) =>
      db.prepare(
        `INSERT OR IGNORE INTO ad_code_sites
           (ad_code_id, site_id)
         VALUES (?, ?)`
      )
        .bind(adCodeId, siteId)
    ),
  ]

  await db.batch(statements)
}

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
       m.media_name,
       COALESCE(GROUP_CONCAT(DISTINCT s.site_name), '') AS site_names,
       COUNT(DISTINCT acs.site_id) AS site_count,
       COALESCE(
         CASE
           WHEN COUNT(DISTINCT acs.site_id) = 1 THEN MAX(s.site_name)
           WHEN COUNT(DISTINCT acs.site_id) > 1 THEN COUNT(DISTINCT acs.site_id) || 'サイト'
         END,
         legacy_site.site_name,
         ''
       ) AS site_name,
       COALESCE(GROUP_CONCAT(DISTINCT acs.site_id), CAST(c.site_id AS TEXT)) AS site_ids
     FROM campaign_master c
     LEFT JOIN media_master m ON c.media_id = m.id
     LEFT JOIN ad_code_sites acs ON c.id = acs.ad_code_id
     LEFT JOIN site_master s ON acs.site_id = s.id
     LEFT JOIN site_master legacy_site ON c.site_id = legacy_site.id
     GROUP BY c.id
     ORDER BY c.id ASC`
  ).all<CampaignMasterView>()

  return c.json<ApiResponse<CampaignMasterView[]>>({
    success: true,
    data: results.map((campaign) => ({
      ...campaign,
      site_ids: String((campaign as unknown as { site_ids?: string }).site_ids ?? '')
        .split(',')
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    })),
  })
})

// ------------------------------------------------------------
// 新規追加: POST /api/campaign
// body: { campaign_name, media_id, ad_code, site_id, is_active }
// ------------------------------------------------------------
campaignRoute.post('/', async (c) => {
  let createdCampaignId: number | null = null

  try {
    const body = await c.req.json<{
    campaign_name: string
    media_id: number
    ad_code?: string
    site_id?: number
    site_ids?: number[]
    is_active?: number
  }>()
    const siteIds = normalizeSiteIds(body.site_ids ?? body.site_id)

    if (!body.campaign_name || body.campaign_name.trim() === '') {
      throw new Error('キャンペーン名は必須です')
    }
    if (!body.media_id) {
      throw new Error('媒体の選択は必須です')
    }
    await ensureSitesExist(c.env.DB, siteIds)

    const result = await c.env.DB.prepare(
      `INSERT INTO campaign_master
         (campaign_name, media_id, ad_code, site_id, is_active)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        body.campaign_name.trim(),
        body.media_id,
        body.ad_code?.trim() ?? null,
        siteIds[0],
        body.is_active ?? 1
      )
      .run()

    createdCampaignId = result.meta.last_row_id ?? null
    if (!createdCampaignId) throw new Error('広告コードの作成に失敗しました')

    await replaceAdCodeSites(c.env.DB, createdCampaignId, siteIds)
    await backfillMediaSummaryMediaId(c.env.DB, body.ad_code)

    return c.json<ApiResponse<{ id: number | null }>>({
      success: true,
      data: { id: createdCampaignId },
    })
  } catch (err) {
    if (createdCampaignId) {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(createdCampaignId),
        c.env.DB.prepare('DELETE FROM campaign_master WHERE id = ?').bind(createdCampaignId),
      ])
    }

    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '広告コードの保存に失敗しました' },
      400
    )
  }
})

// ------------------------------------------------------------
// 更新: PUT /api/campaign/:id
// ------------------------------------------------------------
campaignRoute.put('/:id', async (c) => {
  try {
    const id = parsePositiveInteger(c.req.param('id'))
    if (!id) throw new Error('広告コードIDが正しくありません')

    const body = await c.req.json<{
      campaign_name: string
      media_id: number
      ad_code?: string
      site_id?: number
      site_ids?: number[]
      is_active?: number
    }>()
    const siteIds = normalizeSiteIds(body.site_ids ?? body.site_id)

    if (!body.campaign_name || body.campaign_name.trim() === '') {
      throw new Error('キャンペーン名は必須です')
    }
    if (!body.media_id) {
      throw new Error('媒体の選択は必須です')
    }
    await ensureSitesExist(c.env.DB, siteIds)

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
        siteIds[0],
        body.is_active ?? 1,
        id
      )
      .run()

    await replaceAdCodeSites(c.env.DB, id, siteIds)
    await backfillMediaSummaryMediaId(c.env.DB, body.ad_code)

    return c.json<ApiResponse<null>>({ success: true })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '広告コードの更新に失敗しました' },
      400
    )
  }
})

// ------------------------------------------------------------
// 削除: DELETE /api/campaign/:id
// ------------------------------------------------------------
campaignRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaign_master WHERE id = ?').bind(id),
  ])

  return c.json<ApiResponse<null>>({ success: true })
})
