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
type CampaignSearchMatch = 'partial' | 'exact'

type CampaignBulkRow = {
  row_number: number
  campaign_names: string[]
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
  campaignName: ['使用キャンペーン', 'キャンペーン名', 'campaign_name', 'campaign name', 'campaigns'],
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

function buildAdCodeKey(adCode: string) {
  return normalizeAdCodeKey(adCode)
}

function parseBulkMode(value: unknown): CampaignBulkMode {
  if (value === 'create_only' || value === 'update_only') return value
  return 'upsert'
}

function parseCampaignSearchMatch(value: unknown): CampaignSearchMatch {
  return value === 'exact' ? 'exact' : 'partial'
}

function parseCampaignStatusFilter(value: unknown) {
  if (value === 'active' || value === '1') return 1
  if (value === 'inactive' || value === '0') return 0
  return null
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

function splitCampaignNames(value: string) {
  return [...new Set(
    String(value ?? '')
      .split(/[,、;\n\r]+/)
      .map((campaignName) => campaignName.trim())
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

async function ensureCampaignsByNames(db: D1Database, mediaId: number, campaignNames: string[]) {
  const names = [...new Set(campaignNames.map((name) => name.trim()).filter(Boolean))]
  if (names.length === 0) return []

  for (const name of names) {
    await db.prepare(
      `INSERT OR IGNORE INTO campaigns
         (media_id, campaign_name, is_active)
       VALUES (?, ?, 1)`
    )
      .bind(mediaId, name)
      .run()
  }

  const campaignIds: number[] = []
  for (const name of names) {
    const campaign = await db.prepare(
      `SELECT id
       FROM campaigns
       WHERE media_id = ?
         AND campaign_name = ?
       LIMIT 1`
    )
      .bind(mediaId, name)
      .first<{ id: number }>()

    if (campaign?.id) campaignIds.push(campaign.id)
  }

  return campaignIds
}

async function ensureAdCodeIsUnique(db: D1Database, adCode: string, excludeId?: number) {
  const normalizedAdCode = adCode.trim()
  if (!normalizedAdCode) return

  const bindings: Array<string | number> = [normalizedAdCode]
  const excludeSql = excludeId ? 'AND id <> ?' : ''
  if (excludeId) bindings.push(excludeId)

  const existing = await db.prepare(
    `SELECT id
     FROM campaign_master
     WHERE NULLIF(TRIM(ad_code), '') = ?
       ${excludeSql}
     LIMIT 1`
  )
    .bind(...bindings)
    .first<{ id: number }>()

  if (existing) {
    throw new Error('同じ広告コードが既に登録されています')
  }
}

async function fetchCampaignsByIds(db: D1Database, mediaId: number, campaignIds: number[]) {
  const ids = [...new Set(campaignIds.map(parsePositiveInteger).filter((id): id is number => id !== null))]
  if (ids.length === 0) return []

  const campaigns: Array<{ id: number; campaign_name: string }> = []
  for (let index = 0; index < ids.length; index += CAMPAIGN_BULK_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CAMPAIGN_BULK_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    const { results } = await db.prepare(
      `SELECT id, campaign_name
       FROM campaigns
       WHERE media_id = ?
         AND id IN (${placeholders})
         AND is_active = 1
       ORDER BY campaign_name ASC`
    )
      .bind(mediaId, ...chunk)
      .all<{ id: number; campaign_name: string }>()

    campaigns.push(...results)
  }

  return campaigns
}

async function replaceAdCodeCampaigns(db: D1Database, adCodeId: number, campaignIds: number[]) {
  const ids = [...new Set(campaignIds.map(parsePositiveInteger).filter((id): id is number => id !== null))]
  const statements = [
    db.prepare('DELETE FROM ad_code_campaigns WHERE ad_code_id = ?').bind(adCodeId),
    ...ids.map((campaignId) =>
      db.prepare(
        `INSERT OR IGNORE INTO ad_code_campaigns
           (ad_code_id, campaign_id)
         VALUES (?, ?)`
      )
        .bind(adCodeId, campaignId)
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
  const adCodeIdsByKey = new Map<string, number[]>()

  campaignResult.results.forEach((campaign) => {
    const adCode = campaign.ad_code?.trim()
    if (!adCode) return

    const key = buildAdCodeKey(adCode)
    adCodeIdsByKey.set(key, [...(adCodeIdsByKey.get(key) || []), campaign.id])
  })

  const previewRows: CampaignBulkRow[] = []
  const fileRowsByKey = new Map<string, CampaignBulkRow[]>()
  const headerColumnCount = rows[0].length

  bodyRows.forEach((row, index) => {
    const mediaName = row[headerIndex.media] || ''
    const adCode = row[headerIndex.adCode] || ''
    const campaignNames = headerIndex.campaignName >= 0
      ? splitCampaignNames(row[headerIndex.campaignName] || '')
      : []
    const extraCellCount = Math.max(row.length - headerColumnCount, 0)
    const statusIndex = headerIndex.status >= 0
      ? Math.min(headerIndex.status + extraCellCount, row.length - 1)
      : -1
    const nextIndexes = [statusIndex, headerIndex.campaignName]
      .filter((columnIndex) => columnIndex > headerIndex.sites)
    const sitesEndIndex = nextIndexes.length > 0 ? Math.min(...nextIndexes) : row.length
    const sites = row.slice(headerIndex.sites, sitesEndIndex).join(',').trim()
    const statusText = statusIndex >= 0 ? row[statusIndex] || '' : ''
    const errors: string[] = []

    const media = mediaByName.get(normalizeLookupText(mediaName))
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

    const existingIds = adCode
      ? adCodeIdsByKey.get(buildAdCodeKey(adCode)) || []
      : []
    if (existingIds.length > 1) {
      errors.push('同じ広告コードの既存データが複数あるため更新できません')
    }

    const previewRow: CampaignBulkRow = {
      row_number: index + 2,
      campaign_names: campaignNames,
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

    if (adCode) {
      const key = buildAdCodeKey(adCode)
      fileRowsByKey.set(key, [...(fileRowsByKey.get(key) || []), previewRow])
    }

    previewRows.push(previewRow)
  })

  fileRowsByKey.forEach((sameKeyRows) => {
    if (sameKeyRows.length <= 1) return
    const rowNumbers = sameKeyRows.map((row) => `${row.row_number}行目`).join('、')
    sameKeyRows.forEach((row) => {
      row.errors.push(`ファイル内で広告コードが重複しています（${rowNumbers}）`)
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
        const linkedCampaignIds = row.media_id
          ? await ensureCampaignsByNames(db, row.media_id, row.campaign_names)
          : []
        const legacyCampaignName = row.campaign_names[0] ?? ''

        if (row.judgement === '更新' && row.existing_id) {
          await db.prepare(
            `UPDATE campaign_master
             SET campaign_name = ?, media_id = ?, ad_code = ?, site_id = ?,
                 is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`
          )
            .bind(
              legacyCampaignName,
              row.media_id,
              row.ad_code.trim(),
              row.site_ids[0],
              row.status_value,
              row.existing_id
            )
            .run()

          await replaceAdCodeSites(db, row.existing_id, row.site_ids)
          await replaceAdCodeCampaigns(db, row.existing_id, linkedCampaignIds)
          updated += 1
        } else {
          const result = await db.prepare(
            `INSERT INTO campaign_master
               (campaign_name, media_id, ad_code, site_id, is_active)
            VALUES (?, ?, ?, ?, ?)`
          )
            .bind(
              legacyCampaignName,
              row.media_id,
              row.ad_code.trim(),
              row.site_ids[0],
              row.status_value
            )
            .run()

          createdCampaignId = result.meta.last_row_id ?? null
          if (!createdCampaignId) throw new Error('広告コードの作成に失敗しました')

          await replaceAdCodeSites(db, createdCampaignId, row.site_ids)
          await replaceAdCodeCampaigns(db, createdCampaignId, linkedCampaignIds)
          created += 1
        }

        await backfillMediaSummaryMediaId(db, row.ad_code)
      } catch (err) {
        if (createdCampaignId) {
          await db.batch([
            db.prepare('DELETE FROM ad_code_campaigns WHERE ad_code_id = ?').bind(createdCampaignId),
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
  const keyword = normalizeLookupText(c.req.query('query') ?? c.req.query('q') ?? '')
  const searchMatch = parseCampaignSearchMatch(c.req.query('match') ?? null)
  const mediaId = parsePositiveInteger(c.req.query('media_id') ?? null)
  const status = parseCampaignStatusFilter(c.req.query('status') ?? null)
  const where: string[] = []
  const bindings: Array<string | number> = []

  if (mediaId) {
    where.push('c.media_id = ?')
    bindings.push(mediaId)
  }

  if (status !== null) {
    where.push('c.is_active = ?')
    bindings.push(status)
  }

  if (keyword) {
    const operator = searchMatch === 'exact' ? '=' : 'LIKE'
    const searchValue = searchMatch === 'exact' ? keyword : `%${keyword}%`
    where.push(
      `(LOWER(COALESCE(c.ad_code, '')) ${operator} ?
        OR EXISTS (
          SELECT 1
          FROM ad_code_sites acs_search
          INNER JOIN site_master s_search ON acs_search.site_id = s_search.id
          WHERE acs_search.ad_code_id = c.id
            AND LOWER(COALESCE(s_search.site_name, '')) ${operator} ?
        )
        OR EXISTS (
          SELECT 1
          FROM ad_code_campaigns acc_search
          INNER JOIN campaigns cp_search ON acc_search.campaign_id = cp_search.id
          WHERE acc_search.ad_code_id = c.id
            AND LOWER(COALESCE(cp_search.campaign_name, '')) ${operator} ?
        ))`
    )
    bindings.push(searchValue, searchValue, searchValue)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const { results } = await c.env.DB.prepare(
    `SELECT
       c.id, c.campaign_name, c.media_id, c.ad_code, c.site_id,
       c.is_active, c.created_at, c.updated_at,
       m.media_name,
       COALESCE(GROUP_CONCAT(DISTINCT s.site_name), '') AS site_names,
       COUNT(DISTINCT acs.site_id) AS site_count,
       COALESCE(GROUP_CONCAT(DISTINCT cp.campaign_name), '') AS campaign_names,
       COUNT(DISTINCT cp.id) AS campaign_count,
       COALESCE(GROUP_CONCAT(DISTINCT cp.id), '') AS campaign_ids,
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
     LEFT JOIN ad_code_campaigns acc ON c.id = acc.ad_code_id
     LEFT JOIN campaigns cp ON acc.campaign_id = cp.id
     ${whereSql}
     GROUP BY c.id
     ORDER BY c.ad_code ASC, c.id ASC`
  )
    .bind(...bindings)
    .all<CampaignMasterView>()

  return c.json<ApiResponse<CampaignMasterView[]>>({
    success: true,
    data: results.map((campaign) => ({
      ...campaign,
      site_ids: String((campaign as unknown as { site_ids?: string }).site_ids ?? '')
        .split(',')
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
      campaign_ids: String((campaign as unknown as { campaign_ids?: string }).campaign_ids ?? '')
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
    ['広告コード', '媒体', 'サイト', '使用キャンペーン', '状態'],
    ['tabb002', 'Taboola', 'ヒットザマーク、競艇ナビ', 'ヒットザマーク_記事202607', '有効'],
    ['app395lp', 'Facebook', '馬スポ', 'app395系_LP', '有効'],
  ])

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="campaign_master_template.csv"')
  return c.body(csv)
})

// ------------------------------------------------------------
// 媒体キャンペーン候補: GET /api/campaign/campaigns?media_id=...
// ------------------------------------------------------------
campaignRoute.get('/campaigns', async (c) => {
  const mediaId = parsePositiveInteger(c.req.query('media_id') ?? null)
  const keyword = normalizeLookupText(c.req.query('q') ?? '')
  const where: string[] = ['cp.is_active = 1']
  const bindings: Array<string | number> = []

  if (mediaId) {
    where.push('cp.media_id = ?')
    bindings.push(mediaId)
  }

  if (keyword) {
    where.push('LOWER(cp.campaign_name) LIKE ?')
    bindings.push(`%${keyword}%`)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       cp.id, cp.media_id, m.media_name, cp.campaign_name,
       cp.is_active, cp.created_at, cp.updated_at
     FROM campaigns cp
     LEFT JOIN media_master m ON cp.media_id = m.id
     WHERE ${where.join(' AND ')}
     ORDER BY cp.campaign_name ASC
     LIMIT 300`
  )
    .bind(...bindings)
    .all<{
      id: number
      media_id: number
      media_name: string
      campaign_name: string
      is_active: number
      created_at: string
      updated_at: string
    }>()

  return c.json<ApiResponse<typeof results>>({
    success: true,
    data: results,
  })
})

// ------------------------------------------------------------
// 媒体キャンペーン手動追加: POST /api/campaign/campaigns
// ------------------------------------------------------------
campaignRoute.post('/campaigns', async (c) => {
  try {
    const body = await c.req.json<{ media_id?: number; campaign_name?: string }>()
    const mediaId = parsePositiveInteger(body.media_id)
    const campaignName = body.campaign_name?.trim()

    if (!mediaId) throw new Error('媒体を選択してください')
    if (!campaignName) throw new Error('キャンペーン名を入力してください')

    const ids = await ensureCampaignsByNames(c.env.DB, mediaId, [campaignName])
    const id = ids[0]
    if (!id) throw new Error('キャンペーンの保存に失敗しました')

    const campaign = await c.env.DB.prepare(
      `SELECT
         cp.id, cp.media_id, m.media_name, cp.campaign_name,
         cp.is_active, cp.created_at, cp.updated_at
       FROM campaigns cp
       LEFT JOIN media_master m ON cp.media_id = m.id
       WHERE cp.id = ?`
    )
      .bind(id)
      .first<{
        id: number
        media_id: number
        media_name: string
        campaign_name: string
        is_active: number
        created_at: string
        updated_at: string
      }>()

    return c.json<ApiResponse<typeof campaign>>({
      success: true,
      data: campaign,
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : 'キャンペーンの保存に失敗しました' },
      400
    )
  }
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
// body: { media_id, ad_code, site_ids, campaign_ids, campaign_names, is_active }
// ------------------------------------------------------------
campaignRoute.post('/', async (c) => {
  let createdCampaignId: number | null = null

  try {
    const body = await c.req.json<{
      campaign_name?: string
      media_id: number
      ad_code?: string
      site_id?: number
      site_ids?: number[]
      campaign_ids?: number[]
      campaign_names?: string[]
      is_active?: number
    }>()
    const siteIds = normalizeSiteIds(body.site_ids ?? body.site_id)
    const campaignIdsFromBody = Array.isArray(body.campaign_ids)
      ? body.campaign_ids.map(parsePositiveInteger).filter((id): id is number => id !== null)
      : []
    const campaignNamesFromBody = Array.isArray(body.campaign_names)
      ? body.campaign_names.map((name) => String(name ?? '').trim()).filter(Boolean)
      : splitCampaignNames(body.campaign_name ?? '')

    if (!body.media_id) {
      throw new Error('媒体の選択は必須です')
    }
    if (!body.ad_code || body.ad_code.trim() === '') {
      throw new Error('広告コードは必須です')
    }
    await ensureAdCodeIsUnique(c.env.DB, body.ad_code)
    await ensureSitesExist(c.env.DB, siteIds)

    const existingCampaigns = await fetchCampaignsByIds(c.env.DB, body.media_id, campaignIdsFromBody)
    const campaignNames = [
      ...campaignNamesFromBody,
      ...existingCampaigns.map((campaign) => campaign.campaign_name),
    ]
    const createdCampaignIds = await ensureCampaignsByNames(c.env.DB, body.media_id, campaignNames)
    const campaignIds = [...new Set([...existingCampaigns.map((campaign) => campaign.id), ...createdCampaignIds])]
    const legacyCampaignName = campaignNames[0] ?? ''

    const result = await c.env.DB.prepare(
      `INSERT INTO campaign_master
         (campaign_name, media_id, ad_code, site_id, is_active)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        legacyCampaignName,
        body.media_id,
        body.ad_code?.trim() ?? null,
        siteIds[0],
        body.is_active ?? 1
      )
      .run()

    createdCampaignId = result.meta.last_row_id ?? null
    if (!createdCampaignId) throw new Error('広告コードの作成に失敗しました')

    await replaceAdCodeSites(c.env.DB, createdCampaignId, siteIds)
    await replaceAdCodeCampaigns(c.env.DB, createdCampaignId, campaignIds)
    await backfillMediaSummaryMediaId(c.env.DB, body.ad_code)

    return c.json<ApiResponse<{ id: number | null }>>({
      success: true,
      data: { id: createdCampaignId },
    })
  } catch (err) {
    if (createdCampaignId) {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM ad_code_campaigns WHERE ad_code_id = ?').bind(createdCampaignId),
        c.env.DB.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(createdCampaignId),
        c.env.DB.prepare('DELETE FROM campaign_group_ad_codes WHERE ad_code_id = ?').bind(createdCampaignId),
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
      campaign_name?: string
      media_id: number
      ad_code?: string
      site_id?: number
      site_ids?: number[]
      campaign_ids?: number[]
      campaign_names?: string[]
      is_active?: number
    }>()
    const siteIds = normalizeSiteIds(body.site_ids ?? body.site_id)
    const campaignIdsFromBody = Array.isArray(body.campaign_ids)
      ? body.campaign_ids.map(parsePositiveInteger).filter((campaignId): campaignId is number => campaignId !== null)
      : []
    const campaignNamesFromBody = Array.isArray(body.campaign_names)
      ? body.campaign_names.map((name) => String(name ?? '').trim()).filter(Boolean)
      : splitCampaignNames(body.campaign_name ?? '')

    if (!body.media_id) {
      throw new Error('媒体の選択は必須です')
    }
    if (!body.ad_code || body.ad_code.trim() === '') {
      throw new Error('広告コードは必須です')
    }
    await ensureAdCodeIsUnique(c.env.DB, body.ad_code, id)
    await ensureSitesExist(c.env.DB, siteIds)

    const existingCampaigns = await fetchCampaignsByIds(c.env.DB, body.media_id, campaignIdsFromBody)
    const campaignNames = [
      ...campaignNamesFromBody,
      ...existingCampaigns.map((campaign) => campaign.campaign_name),
    ]
    const createdCampaignIds = await ensureCampaignsByNames(c.env.DB, body.media_id, campaignNames)
    const campaignIds = [...new Set([...existingCampaigns.map((campaign) => campaign.id), ...createdCampaignIds])]
    const legacyCampaignName = campaignNames[0] ?? ''

    await c.env.DB.prepare(
      `UPDATE campaign_master
       SET campaign_name = ?, media_id = ?, ad_code = ?, site_id = ?,
           is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(
        legacyCampaignName,
        body.media_id,
        body.ad_code?.trim() ?? null,
        siteIds[0],
        body.is_active ?? 1,
        id
      )
      .run()

    await replaceAdCodeSites(c.env.DB, id, siteIds)
    await replaceAdCodeCampaigns(c.env.DB, id, campaignIds)
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
    c.env.DB.prepare('DELETE FROM ad_code_campaigns WHERE ad_code_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ad_code_sites WHERE ad_code_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaign_group_ad_codes WHERE ad_code_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaign_master WHERE id = ?').bind(id),
  ])

  return c.json<ApiResponse<null>>({ success: true })
})
