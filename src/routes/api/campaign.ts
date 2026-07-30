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

type CampaignBulkMode = 'create_only' | 'update_only' | 'upsert'

type CampaignBulkRow = {
  row_number: number
  campaign_name: string
  media: string
  ad_code: string
  sites: string
  status: string
  status_value: number
  media_id: number | null
  site_ids: number[]
  site_names: string[]
  existing_id: number | null
  judgement: '新規' | '更新' | 'スキップ' | 'エラー'
  errors: string[]
}

type CampaignBulkSummary = {
  total: number
  create: number
  update: number
  skip: number
  error: number
}

type CampaignBulkResponse = {
  mode: CampaignBulkMode
  summary: CampaignBulkSummary
  rows: CampaignBulkRow[]
}

const CAMPAIGN_BULK_MAX_ROWS = 5000
const CAMPAIGN_BULK_CHUNK_SIZE = 100

const CAMPAIGN_BULK_HEADERS = {
  campaignName: ['キャンペーン名', 'campaign_name', 'campaign name'],
  media: ['媒体', 'media', '媒体名', 'media_name'],
  adCode: ['広告コード', 'ad_code', 'ad code', '広告cd'],
  sites: ['サイト', 'sites', 'site', 'site_name', 'サイト名'],
  status: ['状態', 'status', 'ステータス'],
}

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

function normalizeLookupText(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeHeaderName(value: unknown) {
  return normalizeLookupText(value)
    .replace(/^\uFEFF/, '')
    .replace(/[\s_＿\-－()\[\]（）［］{}｛｝:：\/／・.．]/g, '')
}

function normalizeAdCodeKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function buildCampaignKey(mediaId: number, adCode: string) {
  return `${mediaId}|${normalizeAdCodeKey(adCode)}`
}

function parseBulkMode(value: unknown): CampaignBulkMode {
  if (value === 'create_only' || value === 'update_only') return value
  return 'upsert'
}

function buildHeaderIndex(headerRow: unknown[]) {
  const indexByHeader = new Map<string, number>()
  headerRow.forEach((header, index) => {
    const normalized = normalizeHeaderName(header)
    if (normalized) indexByHeader.set(normalized, index)
  })

  const pick = (aliases: string[]) => {
    for (const alias of aliases) {
      const index = indexByHeader.get(normalizeHeaderName(alias))
      if (index !== undefined) return index
    }
    return -1
  }

  return {
    campaignName: pick(CAMPAIGN_BULK_HEADERS.campaignName),
    media: pick(CAMPAIGN_BULK_HEADERS.media),
    adCode: pick(CAMPAIGN_BULK_HEADERS.adCode),
    sites: pick(CAMPAIGN_BULK_HEADERS.sites),
    status: pick(CAMPAIGN_BULK_HEADERS.status),
  }
}

function normalizeBulkRows(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
}

function isBlankBulkRow(row: string[]) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

function splitSiteNames(value: string) {
  return [...new Set(
    String(value ?? '')
      .split(/[,、;\n\r]+/)
      .map((siteName) => siteName.trim())
      .filter(Boolean)
  )]
}

function parseStatusValue(value: string) {
  const normalized = normalizeLookupText(value)
  if (!normalized) return 1
  if (['有効', 'active', 'true', '1'].includes(normalized)) return 1
  if (['無効', 'inactive', 'false', '0'].includes(normalized)) return 0
  return null
}

function buildBulkSummary(rows: CampaignBulkRow[]): CampaignBulkSummary {
  return rows.reduce(
    (summary, row) => ({
      total: summary.total + 1,
      create: summary.create + (row.judgement === '新規' ? 1 : 0),
      update: summary.update + (row.judgement === '更新' ? 1 : 0),
      skip: summary.skip + (row.judgement === 'スキップ' ? 1 : 0),
      error: summary.error + (row.judgement === 'エラー' ? 1 : 0),
    }),
    { total: 0, create: 0, update: 0, skip: 0, error: 0 }
  )
}

function makeCsvValue(value: unknown) {
  const text = String(value ?? '')
  const escaped = text.replace(/"/g, '""')
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped
}

function buildCsv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(makeCsvValue).join(',')).join('\r\n')}\r\n`
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

async function buildCampaignBulkPreview(
  db: D1Database,
  inputRows: unknown,
  mode: CampaignBulkMode
): Promise<CampaignBulkResponse> {
  const rows = normalizeBulkRows(inputRows)
  if (rows.length === 0) {
    throw new Error('取込ファイルにデータがありません')
  }

  const bodyRows = rows.slice(1).filter((row) => !isBlankBulkRow(row))
  if (bodyRows.length > CAMPAIGN_BULK_MAX_ROWS) {
    throw new Error(`一度に取り込める行数は${CAMPAIGN_BULK_MAX_ROWS.toLocaleString('ja-JP')}行までです`)
  }

  const headerIndex = buildHeaderIndex(rows[0])
  const missingHeaders = [
    headerIndex.campaignName < 0 ? 'キャンペーン名' : '',
    headerIndex.media < 0 ? '媒体' : '',
    headerIndex.adCode < 0 ? '広告コード' : '',
    headerIndex.sites < 0 ? 'サイト' : '',
  ].filter(Boolean)

  if (missingHeaders.length > 0) {
    throw new Error(`必須列が不足しています: ${missingHeaders.join('、')}`)
  }

  const [mediaResult, siteResult, campaignResult] = await Promise.all([
    db.prepare('SELECT id, media_name FROM media_master').all<{ id: number; media_name: string }>(),
    db.prepare('SELECT id, site_name FROM site_master').all<{ id: number; site_name: string }>(),
    db.prepare('SELECT id, media_id, ad_code FROM campaign_master').all<{ id: number; media_id: number; ad_code: string | null }>(),
  ])

  const mediaByName = new Map(
    mediaResult.results.map((media) => [normalizeLookupText(media.media_name), media])
  )
  const siteByName = new Map(
    siteResult.results.map((site) => [normalizeLookupText(site.site_name), site])
  )
  const campaignIdsByKey = new Map<string, number[]>()

  campaignResult.results.forEach((campaign) => {
    const adCode = campaign.ad_code?.trim()
    if (!campaign.media_id || !adCode) return

    const key = buildCampaignKey(campaign.media_id, adCode)
    campaignIdsByKey.set(key, [...(campaignIdsByKey.get(key) || []), campaign.id])
  })

  const previewRows: CampaignBulkRow[] = []
  const fileRowsByKey = new Map<string, CampaignBulkRow[]>()
  const headerColumnCount = rows[0].length

  bodyRows.forEach((row, index) => {
    const mediaName = row[headerIndex.media] || ''
    const adCode = row[headerIndex.adCode] || ''
    const campaignName = row[headerIndex.campaignName] || ''
    const extraCellCount = Math.max(row.length - headerColumnCount, 0)
    const statusIndex = headerIndex.status >= 0
      ? Math.min(headerIndex.status + extraCellCount, row.length - 1)
      : -1
    const sitesEndIndex = statusIndex > headerIndex.sites ? statusIndex : row.length
    const sites = row.slice(headerIndex.sites, sitesEndIndex).join(',').trim()
    const statusText = statusIndex >= 0 ? row[statusIndex] || '' : ''
    const errors: string[] = []

    const media = mediaByName.get(normalizeLookupText(mediaName))
    if (!campaignName) errors.push('キャンペーン名は必須です')
    if (!mediaName) errors.push('媒体は必須です')
    if (mediaName && !media) errors.push(`媒体「${mediaName}」が登録されていません`)
    if (!adCode) errors.push('広告コードは必須です')

    const siteNames = splitSiteNames(sites)
    const siteIds: number[] = []
    const resolvedSiteNames: string[] = []
    if (siteNames.length === 0) {
      errors.push('サイトは必須です')
    } else {
      siteNames.forEach((siteName) => {
        const site = siteByName.get(normalizeLookupText(siteName))
        if (!site) {
          errors.push(`サイト「${siteName}」が登録されていません`)
        } else if (!siteIds.includes(site.id)) {
          siteIds.push(site.id)
          resolvedSiteNames.push(site.site_name)
        }
      })
    }

    const statusValue = parseStatusValue(statusText)
    if (statusValue === null) {
      errors.push('状態は「有効」または「無効」で指定してください')
    }

    const existingIds = media && adCode
      ? campaignIdsByKey.get(buildCampaignKey(media.id, adCode)) || []
      : []
    if (existingIds.length > 1) {
      errors.push('同じ媒体＋広告コードの既存データが複数あるため更新できません')
    }

    const previewRow: CampaignBulkRow = {
      row_number: index + 2,
      campaign_name: campaignName,
      media: mediaName,
      ad_code: adCode,
      sites,
      status: statusText || '有効',
      status_value: statusValue ?? 1,
      media_id: media?.id ?? null,
      site_ids: siteIds,
      site_names: resolvedSiteNames,
      existing_id: existingIds[0] ?? null,
      judgement: 'エラー',
      errors,
    }

    if (media && adCode) {
      const key = buildCampaignKey(media.id, adCode)
      fileRowsByKey.set(key, [...(fileRowsByKey.get(key) || []), previewRow])
    }

    previewRows.push(previewRow)
  })

  fileRowsByKey.forEach((sameKeyRows) => {
    if (sameKeyRows.length <= 1) return
    const rowNumbers = sameKeyRows.map((row) => `${row.row_number}行目`).join('、')
    sameKeyRows.forEach((row) => {
      row.errors.push(`ファイル内で媒体＋広告コードが重複しています（${rowNumbers}）`)
    })
  })

  previewRows.forEach((row) => {
    if (row.errors.length > 0) {
      row.judgement = 'エラー'
      return
    }

    if (mode === 'create_only' && row.existing_id) {
      row.judgement = 'スキップ'
      row.errors.push('既存のためスキップ')
      return
    }

    if (mode === 'update_only' && !row.existing_id) {
      row.judgement = 'スキップ'
      row.errors.push('未登録のためスキップ')
      return
    }

    row.judgement = row.existing_id ? '更新' : '新規'
  })

  return {
    mode,
    summary: buildBulkSummary(previewRows),
    rows: previewRows,
  }
}

async function applyCampaignBulkRows(db: D1Database, rows: CampaignBulkRow[]) {
  const targetRows = rows.filter((row) => row.judgement === '新規' || row.judgement === '更新')
  let created = 0
  let updated = 0

  for (let index = 0; index < targetRows.length; index += CAMPAIGN_BULK_CHUNK_SIZE) {
    const chunk = targetRows.slice(index, index + CAMPAIGN_BULK_CHUNK_SIZE)

    for (const row of chunk) {
      let createdCampaignId: number | null = null
      try {
        if (row.judgement === '更新' && row.existing_id) {
          await db.prepare(
            `UPDATE campaign_master
             SET campaign_name = ?, media_id = ?, ad_code = ?, site_id = ?,
                 is_active = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
            .bind(
              row.campaign_name.trim(),
              row.media_id,
              row.ad_code.trim(),
              row.site_ids[0],
              row.status_value,
              row.existing_id
            )
            .run()

          await replaceAdCodeSites(db, row.existing_id, row.site_ids)
          updated += 1
        } else {
          const result = await db.prepare(
            `INSERT INTO campaign_master
               (campaign_name, media_id, ad_code, site_id, is_active)
             VALUES (?, ?, ?, ?, ?)`
          )
            .bind(
              row.campaign_name.trim(),
              row.media_id,
              row.ad_code.trim(),
              row.site_ids[0],
              row.status_value
            )
            .run()

          createdCampaignId = result.meta.last_row_id ?? null
          if (!createdCampaignId) throw new Error('広告コードの作成に失敗しました')

          await replaceAdCodeSites(db, createdCampaignId, row.site_ids)
          created += 1
        }

        await backfillMediaSummaryMediaId(db, row.ad_code)
      } catch (err) {
        if (createdCampaignId) {
          await db.batch([
            db.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(createdCampaignId),
            db.prepare('DELETE FROM campaign_master WHERE id = ?').bind(createdCampaignId),
          ])
        }

        row.judgement = 'エラー'
        row.errors.push(err instanceof Error ? err.message : '保存に失敗しました')
      }
    }
  }

  return {
    created,
    updated,
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
// テンプレートDL: GET /api/campaign/template
// ------------------------------------------------------------
campaignRoute.get('/template', async (c) => {
  const csv = buildCsv([
    ['キャンペーン名', '媒体', '広告コード', 'サイト', '状態'],
    ['ヒットザマーク_記事202607', 'Taboola', 'tabb002', 'ヒットザマーク、競艇ナビ', '有効'],
    ['app395系_LP', 'Facebook', 'app395lp', '馬スポ', '有効'],
  ])

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="campaign_master_template.csv"')
  return c.body(csv)
})

// ------------------------------------------------------------
// 一括取込プレビュー: POST /api/campaign/bulk-preview
// ------------------------------------------------------------
campaignRoute.post('/bulk-preview', async (c) => {
  try {
    const body = await c.req.json<{ rows?: unknown; mode?: unknown }>()
    const data = await buildCampaignBulkPreview(c.env.DB, body.rows, parseBulkMode(body.mode))

    return c.json<ApiResponse<CampaignBulkResponse>>({
      success: true,
      data,
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '一括取込プレビューに失敗しました' },
      400
    )
  }
})

// ------------------------------------------------------------
// 一括取込実行: POST /api/campaign/bulk-import
// ------------------------------------------------------------
campaignRoute.post('/bulk-import', async (c) => {
  try {
    const body = await c.req.json<{ rows?: unknown; mode?: unknown }>()
    const data = await buildCampaignBulkPreview(c.env.DB, body.rows, parseBulkMode(body.mode))
    const result = await applyCampaignBulkRows(c.env.DB, data.rows)

    const refreshedData: CampaignBulkResponse = {
      ...data,
      summary: buildBulkSummary(data.rows),
    }

    return c.json<ApiResponse<CampaignBulkResponse & {
      created_count: number
      updated_count: number
      skipped_count: number
      error_count: number
    }>>({
      success: true,
      data: {
        ...refreshedData,
        created_count: result.created,
        updated_count: result.updated,
        skipped_count: refreshedData.summary.skip,
        error_count: refreshedData.summary.error,
      },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '一括取込に失敗しました' },
      400
    )
  }
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
