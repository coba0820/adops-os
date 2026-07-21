import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'

export const campaignGroupRoute = new Hono<{ Bindings: Bindings }>()

type CampaignGroupView = {
  id: number
  media_id: number
  media_name: string
  group_name: string
  description: string | null
  is_active: number
  ad_code_count: number
  created_at: string
  updated_at: string
}

type CampaignGroupAdCodeView = {
  id: number
  campaign_name: string
  media_id: number
  media_name: string
  ad_code: string | null
  site_id: number
  site_name: string
  is_active: number
  group_id: number | null
  group_name: string | null
}

function parsePositiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function normalizeText(value: unknown) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

async function fetchGroup(db: D1Database, id: number) {
  return db.prepare(
    `SELECT
       g.id, g.media_id, m.media_name, g.group_name, g.description,
       g.is_active, g.created_at, g.updated_at,
       COUNT(l.id) AS ad_code_count
     FROM campaign_groups g
     LEFT JOIN media_master m ON g.media_id = m.id
     LEFT JOIN campaign_group_ad_codes l ON g.id = l.campaign_group_id
     WHERE g.id = ?
     GROUP BY g.id`
  )
    .bind(id)
    .first<CampaignGroupView>()
}

async function fetchGroupAdCodes(db: D1Database, id: number) {
  const { results } = await db.prepare(
    `SELECT
       c.id, c.campaign_name, c.media_id, m.media_name, c.ad_code,
       c.site_id, s.site_name, c.is_active,
       g.id AS group_id, g.group_name
     FROM campaign_group_ad_codes l
     INNER JOIN campaign_master c ON l.ad_code_id = c.id
     LEFT JOIN media_master m ON c.media_id = m.id
     LEFT JOIN site_master s ON c.site_id = s.id
     LEFT JOIN campaign_groups g ON l.campaign_group_id = g.id
     WHERE l.campaign_group_id = ?
     ORDER BY c.ad_code ASC, c.id ASC`
  )
    .bind(id)
    .all<CampaignGroupAdCodeView>()

  return results
}

campaignGroupRoute.get('/', async (c) => {
  const includeInactive = c.req.query('include_inactive') === '1'
  const whereSql = includeInactive ? '' : 'WHERE g.is_active = 1'

  const { results } = await c.env.DB.prepare(
    `SELECT
       g.id, g.media_id, m.media_name, g.group_name, g.description,
       g.is_active, g.created_at, g.updated_at,
       COUNT(l.id) AS ad_code_count
     FROM campaign_groups g
     LEFT JOIN media_master m ON g.media_id = m.id
     LEFT JOIN campaign_group_ad_codes l ON g.id = l.campaign_group_id
     ${whereSql}
     GROUP BY g.id
     ORDER BY m.media_name ASC, g.group_name ASC`
  ).all<CampaignGroupView>()

  return c.json<ApiResponse<CampaignGroupView[]>>({
    success: true,
    data: results,
  })
})

campaignGroupRoute.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      media_id: number
      group_name: string
      description?: string
      is_active?: number
    }>()
    const mediaId = parsePositiveInteger(body.media_id)
    const groupName = normalizeText(body.group_name)
    const description = normalizeText(body.description)
    const isActive = body.is_active === 0 ? 0 : 1

    if (!mediaId) throw new Error('媒体を選択してください')
    if (!groupName) throw new Error('グループ名を入力してください')

    const result = await c.env.DB.prepare(
      `INSERT INTO campaign_groups
         (media_id, group_name, description, is_active)
       VALUES (?, ?, ?, ?)`
    )
      .bind(mediaId, groupName, description, isActive)
      .run()

    return c.json<ApiResponse<{ id: number | null }>>({
      success: true,
      data: { id: result.meta.last_row_id ?? null },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : 'キャンペーングループの保存に失敗しました' },
      400
    )
  }
})

campaignGroupRoute.get('/available-ad-codes', async (c) => {
  const groupId = parsePositiveInteger(c.req.query('group_id') ?? null)
  const mediaId = parsePositiveInteger(c.req.query('media_id') ?? null)
  const bindings: number[] = []
  const where: string[] = [
    '(l.campaign_group_id IS NULL OR l.campaign_group_id = ?)',
  ]
  bindings.push(groupId ?? -1)

  if (mediaId) {
    where.push('c.media_id = ?')
    bindings.push(mediaId)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       c.id, c.campaign_name, c.media_id, m.media_name, c.ad_code,
       c.site_id, s.site_name, c.is_active,
       l.campaign_group_id AS group_id,
       g.group_name
     FROM campaign_master c
     LEFT JOIN campaign_group_ad_codes l ON c.id = l.ad_code_id
     LEFT JOIN campaign_groups g ON l.campaign_group_id = g.id
     LEFT JOIN media_master m ON c.media_id = m.id
     LEFT JOIN site_master s ON c.site_id = s.id
     WHERE ${where.join(' AND ')}
     ORDER BY c.ad_code ASC, c.id ASC`
  )
    .bind(...bindings)
    .all<CampaignGroupAdCodeView>()

  return c.json<ApiResponse<CampaignGroupAdCodeView[]>>({
    success: true,
    data: results,
  })
})

campaignGroupRoute.get('/:id', async (c) => {
  const id = parsePositiveInteger(c.req.param('id'))
  if (!id) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'キャンペーングループIDが正しくありません' },
      400
    )
  }

  const group = await fetchGroup(c.env.DB, id)
  if (!group) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'キャンペーングループが見つかりません' },
      404
    )
  }

  return c.json<ApiResponse<{
    group: CampaignGroupView
    ad_codes: CampaignGroupAdCodeView[]
  }>>({
    success: true,
    data: {
      group,
      ad_codes: await fetchGroupAdCodes(c.env.DB, id),
    },
  })
})

campaignGroupRoute.put('/:id', async (c) => {
  try {
    const id = parsePositiveInteger(c.req.param('id'))
    if (!id) throw new Error('キャンペーングループIDが正しくありません')

    const body = await c.req.json<{
      media_id: number
      group_name: string
      description?: string
      is_active?: number
    }>()
    const mediaId = parsePositiveInteger(body.media_id)
    const groupName = normalizeText(body.group_name)
    const description = normalizeText(body.description)
    const isActive = body.is_active === 0 ? 0 : 1

    if (!mediaId) throw new Error('媒体を選択してください')
    if (!groupName) throw new Error('グループ名を入力してください')

    await c.env.DB.prepare(
      `UPDATE campaign_groups
       SET media_id = ?,
           group_name = ?,
           description = ?,
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(mediaId, groupName, description, isActive, id)
      .run()

    return c.json<ApiResponse<null>>({ success: true })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : 'キャンペーングループの更新に失敗しました' },
      400
    )
  }
})

campaignGroupRoute.delete('/:id', async (c) => {
  const id = parsePositiveInteger(c.req.param('id'))
  if (!id) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'キャンペーングループIDが正しくありません' },
      400
    )
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM campaign_group_ad_codes WHERE campaign_group_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaign_groups WHERE id = ?').bind(id),
  ])

  return c.json<ApiResponse<null>>({ success: true })
})

campaignGroupRoute.post('/:id/ad-codes', async (c) => {
  try {
    const id = parsePositiveInteger(c.req.param('id'))
    if (!id) throw new Error('キャンペーングループIDが正しくありません')

    const body = await c.req.json<{ ad_code_ids: number[] }>()
    const adCodeIds = [...new Set(
      (Array.isArray(body.ad_code_ids) ? body.ad_code_ids : [])
        .map(parsePositiveInteger)
        .filter((value): value is number => value !== null)
    )]
    if (adCodeIds.length === 0) throw new Error('追加する広告コードを選択してください')

    const group = await fetchGroup(c.env.DB, id)
    if (!group) throw new Error('キャンペーングループが見つかりません')

    const placeholders = adCodeIds.map(() => '?').join(', ')
    const { results: campaigns } = await c.env.DB.prepare(
      `SELECT id, media_id
       FROM campaign_master
       WHERE id IN (${placeholders})`
    )
      .bind(...adCodeIds)
      .all<{ id: number; media_id: number }>()

    if (campaigns.length !== adCodeIds.length) {
      throw new Error('存在しない広告コードが含まれています')
    }
    if (campaigns.some((campaign) => campaign.media_id !== group.media_id)) {
      throw new Error('グループと異なる媒体の広告コードは追加できません')
    }

    await c.env.DB.batch(
      adCodeIds.map((adCodeId) =>
        c.env.DB.prepare(
          `INSERT INTO campaign_group_ad_codes
             (campaign_group_id, ad_code_id)
           VALUES (?, ?)`
        )
          .bind(id, adCodeId)
      )
    )

    return c.json<ApiResponse<{
      group: CampaignGroupView
      ad_codes: CampaignGroupAdCodeView[]
    }>>({
      success: true,
      data: {
        group: await fetchGroup(c.env.DB, id) as CampaignGroupView,
        ad_codes: await fetchGroupAdCodes(c.env.DB, id),
      },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '広告コードの追加に失敗しました' },
      400
    )
  }
})

campaignGroupRoute.delete('/:id/ad-codes/:adCodeId', async (c) => {
  const id = parsePositiveInteger(c.req.param('id'))
  const adCodeId = parsePositiveInteger(c.req.param('adCodeId'))
  if (!id || !adCodeId) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '削除対象が正しくありません' },
      400
    )
  }

  await c.env.DB.prepare(
    `DELETE FROM campaign_group_ad_codes
     WHERE campaign_group_id = ?
       AND ad_code_id = ?`
  )
    .bind(id, adCodeId)
    .run()

  return c.json<ApiResponse<null>>({ success: true })
})
