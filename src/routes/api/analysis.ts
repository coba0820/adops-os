import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'

export const analysisRoute = new Hono<{ Bindings: Bindings }>()

type AnalysisGroupBy = 'daily' | 'weekly' | 'monthly'

type AnalysisMetrics = {
  cost: number
  impressions: number
  clicks: number
  media_cv: number
  access_count: number
  registration_count: number
  provisional_registration_count: number
  payer_count: number
  revenue: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  media_cpa: number | null
  media_cvr: number | null
  cpf: number | null
  cpa: number | null
  cvr: number | null
  payment_rate: number | null
  recovery_rate: number | null
}

type AnalysisRow = AnalysisMetrics & {
  period: string
  period_start: string
  period_end: string
  media_id: number | null
  media_name: string
  ad_code: string | null
}

type AnalysisResponse = {
  filters: {
    start_date: string | null
    end_date: string | null
    media_id: number | null
    ad_code: string | null
    group_by: AnalysisGroupBy
  }
  summary: AnalysisMetrics
  rows: AnalysisRow[]
}

type AggregateRow = {
  period: string
  period_start: string
  period_end: string
  media_id: number | null
  media_name: string
  ad_code: string | null
  cost?: number | null
  impressions?: number | null
  clicks?: number | null
  media_cv?: number | null
  access_count?: number | null
  registration_count?: number | null
  provisional_registration_count?: number | null
  payer_count?: number | null
  revenue?: number | null
}

function parseDateParam(value: string | null) {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function parseMediaIdParam(value: string | null) {
  if (!value) return null
  const mediaId = Number(value)
  return Number.isInteger(mediaId) && mediaId > 0 ? mediaId : null
}

function parseGroupByParam(value: string | null): AnalysisGroupBy {
  if (value === 'weekly' || value === 'monthly') return value
  return 'daily'
}

function parseAdCodeParam(value: string | null) {
  const adCode = value?.trim()
  return adCode ? adCode : null
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function divideOrNull(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null
}

function buildMetrics(values: {
  cost: number
  impressions: number
  clicks: number
  mediaCv: number
  accessCount: number
  registrationCount: number
  provisionalRegistrationCount: number
  payerCount: number
  revenue: number
}): AnalysisMetrics {
  const cvCount = values.registrationCount + values.provisionalRegistrationCount

  return {
    cost: values.cost,
    impressions: values.impressions,
    clicks: values.clicks,
    media_cv: values.mediaCv,
    access_count: values.accessCount,
    registration_count: values.registrationCount,
    provisional_registration_count: values.provisionalRegistrationCount,
    payer_count: values.payerCount,
    revenue: values.revenue,
    ctr: divideOrNull(values.clicks, values.impressions),
    cpc: divideOrNull(values.cost, values.clicks),
    cpm: values.impressions > 0 ? (values.cost / values.impressions) * 1000 : null,
    media_cpa: divideOrNull(values.cost, values.mediaCv),
    media_cvr: divideOrNull(values.mediaCv, values.clicks),
    cpf: divideOrNull(values.cost, cvCount),
    cpa: divideOrNull(values.cost, values.registrationCount),
    cvr: divideOrNull(values.registrationCount, values.mediaCv),
    payment_rate: divideOrNull(values.payerCount, values.registrationCount),
    recovery_rate: divideOrNull(values.revenue, values.cost),
  }
}

function prepareWithBindings(
  db: D1Database,
  sql: string,
  bindings: Array<string | number>
) {
  const statement = db.prepare(sql)
  return bindings.length > 0 ? statement.bind(...bindings) : statement
}

async function tableHasColumns(
  db: D1Database,
  tableName: string,
  requiredColumns: string[]
) {
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return false

  const { results } = await db.prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>()

  const columnNames = new Set(results.map((row) => row.name))
  return requiredColumns.every((columnName) => columnNames.has(columnName))
}

function getPeriodSql(groupBy: AnalysisGroupBy, alias: string, dateColumn = 'target_date') {
  const dateExpression = `${alias}.${dateColumn}`

  if (groupBy === 'weekly') {
    const periodStart =
      `date(${dateExpression}, '-' || ((CAST(strftime('%w', ${dateExpression}) AS INTEGER) + 6) % 7) || ' days')`
    return {
      period: `${periodStart} || '〜' || date(${periodStart}, '+6 days')`,
      periodStart,
      periodEnd: `date(${periodStart}, '+6 days')`,
    }
  }

  if (groupBy === 'monthly') {
    return {
      period: `strftime('%Y-%m', ${dateExpression})`,
      periodStart: `date(${dateExpression}, 'start of month')`,
      periodEnd: `date(${dateExpression}, 'start of month', '+1 month', '-1 day')`,
    }
  }

  return {
    period: dateExpression,
    periodStart: dateExpression,
    periodEnd: dateExpression,
  }
}

function buildAdMediaWhere(filters: {
  startDate: string | null
  endDate: string | null
  mediaId: number | null
  adCode: string | null
}) {
  const where: string[] = []
  const bindings: Array<string | number> = []

  if (filters.startDate) {
    where.push('d.target_date >= ?')
    bindings.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('d.target_date <= ?')
    bindings.push(filters.endDate)
  }
  if (filters.mediaId) {
    where.push('d.media_id = ?')
    bindings.push(filters.mediaId)
  }
  if (filters.adCode) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM campaign_master c
        WHERE c.media_id = d.media_id
          AND c.ad_code = ?
          AND (
            c.campaign_name = d.campaign_name
            OR c.ad_code = d.campaign_id
          )
      )`
    )
    bindings.push(filters.adCode)
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

function buildSimpleDailyWhere(
  alias: string,
  filters: {
    startDate: string | null
    endDate: string | null
    mediaId: number | null
    adCode: string | null
  },
  dateColumn = 'target_date'
) {
  const where: string[] = []
  const bindings: Array<string | number> = []
  const dateExpression = `${alias}.${dateColumn}`

  if (filters.startDate) {
    where.push(`${dateExpression} >= ?`)
    bindings.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push(`${dateExpression} <= ?`)
    bindings.push(filters.endDate)
  }
  if (filters.mediaId) {
    where.push(`${alias}.media_id = ?`)
    bindings.push(filters.mediaId)
  }
  if (filters.adCode) {
    where.push(`${alias}.ad_code = ?`)
    bindings.push(filters.adCode)
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

function buildResolvedDailyWhere(
  alias: string,
  filters: {
    startDate: string | null
    endDate: string | null
    mediaId: number | null
    adCode: string | null
  },
  mediaExpression: string,
  dateColumn = 'target_date'
) {
  const where: string[] = []
  const bindings: Array<string | number> = []
  const dateExpression = `${alias}.${dateColumn}`

  if (filters.startDate) {
    where.push(`${dateExpression} >= ?`)
    bindings.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push(`${dateExpression} <= ?`)
    bindings.push(filters.endDate)
  }
  if (filters.mediaId) {
    where.push(`${mediaExpression} = ?`)
    bindings.push(filters.mediaId)
  }
  if (filters.adCode) {
    where.push(`NULLIF(TRIM(${alias}.ad_code), '') = ?`)
    bindings.push(filters.adCode)
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

function buildSummary(rows: AnalysisRow[]) {
  return buildMetrics(rows.reduce(
    (total, row) => ({
      cost: total.cost + row.cost,
      impressions: total.impressions + row.impressions,
      clicks: total.clicks + row.clicks,
      mediaCv: total.mediaCv + row.media_cv,
      accessCount: total.accessCount + row.access_count,
      registrationCount: total.registrationCount + row.registration_count,
      provisionalRegistrationCount:
        total.provisionalRegistrationCount + row.provisional_registration_count,
      payerCount: total.payerCount + row.payer_count,
      revenue: total.revenue + row.revenue,
    }),
    {
      cost: 0,
      impressions: 0,
      clicks: 0,
      mediaCv: 0,
      accessCount: 0,
      registrationCount: 0,
      provisionalRegistrationCount: 0,
      payerCount: 0,
      revenue: 0,
    }
  ))
}

analysisRoute.get('/summary', async (c) => {
  const startDate = parseDateParam(c.req.query('start_date') ?? null)
  const endDate = parseDateParam(c.req.query('end_date') ?? null)
  const mediaId = parseMediaIdParam(c.req.query('media_id') ?? null)
  const adCode = parseAdCodeParam(c.req.query('ad_code') ?? null)
  const groupBy = parseGroupByParam(c.req.query('group_by') ?? null)

  const filters = { startDate, endDate, mediaId, adCode }
  const adPeriodSql = getPeriodSql(groupBy, 'd')
  const summaryPeriodSql = getPeriodSql(groupBy, 's')
  const paymentPeriodSql = getPeriodSql(groupBy, 'p', 'registration_date')
  const adWhere = buildAdMediaWhere(filters)
  const mediaSummaryWhere = buildResolvedDailyWhere(
    's',
    filters,
    'COALESCE(s.media_id, sm_unique.media_id)'
  )
  const hasPaymentReportTable = await tableHasColumns(c.env.DB, 'payment_report_daily', [
    'registration_date',
    'customer_id',
    'ad_code',
    'payment_count',
    'payment_amount',
    'media_id',
  ])
  const paymentWhere = hasPaymentReportTable
    ? buildResolvedDailyWhere(
      'p',
      filters,
      'COALESCE(p.media_id, pm_unique.media_id)',
      'registration_date'
    )
    : { whereSql: '', bindings: [] as Array<string | number> }
  const paymentAggSql = hasPaymentReportTable
    ? `
    payment_agg AS (
      SELECT
        ${paymentPeriodSql.period} AS period,
        ${paymentPeriodSql.periodStart} AS period_start,
        ${paymentPeriodSql.periodEnd} AS period_end,
        COALESCE(p.media_id, pm_unique.media_id) AS media_id,
        NULLIF(TRIM(p.ad_code), '') AS ad_code,
        COUNT(DISTINCT CASE
          WHEN p.payment_count > 0 OR p.payment_amount > 0
          THEN COALESCE(NULLIF(TRIM(p.customer_id), ''), CAST(p.id AS TEXT))
        END) AS payer_count,
        SUM(p.payment_amount) AS revenue
      FROM payment_report_daily p
      LEFT JOIN unique_campaign_media pm_unique
        ON NULLIF(TRIM(p.ad_code), '') = pm_unique.ad_code
      ${paymentWhere.whereSql}
      GROUP BY period, period_start, period_end, media_id, ad_code
    )`
    : `
    payment_agg AS (
      SELECT
        '' AS period,
        '' AS period_start,
        '' AS period_end,
        NULL AS media_id,
        '' AS media_name,
        NULL AS ad_code,
        0 AS payer_count,
        0 AS revenue
      WHERE 0
    )`

  const detailSql = `
    WITH
    campaign_media_candidates AS (
      SELECT
        NULLIF(TRIM(ad_code), '') AS ad_code,
        MIN(media_id) AS media_id,
        COUNT(DISTINCT media_id) AS media_count
      FROM campaign_master
      WHERE NULLIF(TRIM(ad_code), '') IS NOT NULL
      GROUP BY NULLIF(TRIM(ad_code), '')
    ),
    unique_campaign_media AS (
      SELECT ad_code, media_id
      FROM campaign_media_candidates
      WHERE media_count = 1
    ),
    ad_base AS (
      SELECT
        ${adPeriodSql.period} AS period,
        ${adPeriodSql.periodStart} AS period_start,
        ${adPeriodSql.periodEnd} AS period_end,
        d.media_id,
        (
          SELECT c.ad_code
          FROM campaign_master c
          WHERE c.media_id = d.media_id
            AND (
              c.campaign_name = d.campaign_name
              OR c.ad_code = d.campaign_id
            )
          ORDER BY c.id ASC
          LIMIT 1
        ) AS ad_code,
        d.spend,
        d.impressions,
        d.clicks,
        COALESCE(d.media_cv, 0) AS media_cv
      FROM ad_media_daily d
      ${adWhere.whereSql}
    ),
    ad_agg AS (
      SELECT
        period,
        period_start,
        period_end,
        media_id,
        ad_code,
        SUM(spend) AS cost,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(media_cv) AS media_cv
      FROM ad_base
      GROUP BY period, period_start, period_end, media_id, ad_code
    ),
    summary_agg AS (
      SELECT
        ${summaryPeriodSql.period} AS period,
        ${summaryPeriodSql.periodStart} AS period_start,
        ${summaryPeriodSql.periodEnd} AS period_end,
        COALESCE(s.media_id, sm_unique.media_id) AS media_id,
        NULLIF(TRIM(s.ad_code), '') AS ad_code,
        SUM(s.access_count) AS access_count,
        SUM(s.registration_count) AS registration_count,
        SUM(s.provisional_registration_count) AS provisional_registration_count
      FROM media_summary_daily s
      LEFT JOIN unique_campaign_media sm_unique
        ON NULLIF(TRIM(s.ad_code), '') = sm_unique.ad_code
      ${mediaSummaryWhere.whereSql}
      GROUP BY period, period_start, period_end, media_id, ad_code
    ),
    ${paymentAggSql},
    base_keys AS (
      SELECT period, period_start, period_end, media_id, ad_code FROM ad_agg
      UNION
      SELECT period, period_start, period_end, media_id, ad_code FROM summary_agg
      UNION
      SELECT period, period_start, period_end, media_id, ad_code FROM payment_agg
    )
    SELECT
      k.period,
      k.period_start,
      k.period_end,
      k.media_id,
      COALESCE(m.media_name, '') AS media_name,
      k.ad_code,
      COALESCE(a.cost, 0) AS cost,
      COALESCE(a.impressions, 0) AS impressions,
      COALESCE(a.clicks, 0) AS clicks,
      COALESCE(a.media_cv, 0) AS media_cv,
      COALESCE(s.access_count, 0) AS access_count,
      COALESCE(s.registration_count, 0) AS registration_count,
      COALESCE(s.provisional_registration_count, 0) AS provisional_registration_count,
      COALESCE(p.payer_count, 0) AS payer_count,
      COALESCE(p.revenue, 0) AS revenue
    FROM base_keys k
    LEFT JOIN media_master m ON k.media_id = m.id
    LEFT JOIN ad_agg a
      ON a.period_start = k.period_start
     AND a.period_end = k.period_end
     AND COALESCE(a.media_id, -1) = COALESCE(k.media_id, -1)
     AND COALESCE(a.ad_code, '') = COALESCE(k.ad_code, '')
    LEFT JOIN summary_agg s
      ON s.period_start = k.period_start
     AND s.period_end = k.period_end
     AND COALESCE(s.media_id, -1) = COALESCE(k.media_id, -1)
     AND COALESCE(s.ad_code, '') = COALESCE(k.ad_code, '')
    LEFT JOIN payment_agg p
      ON p.period_start = k.period_start
     AND p.period_end = k.period_end
     AND COALESCE(p.media_id, -1) = COALESCE(k.media_id, -1)
     AND COALESCE(p.ad_code, '') = COALESCE(k.ad_code, '')
    ORDER BY k.period_start ASC, media_name ASC, k.ad_code ASC
  `

  const { results } = await prepareWithBindings(
    c.env.DB,
    detailSql,
    [
      ...adWhere.bindings,
      ...mediaSummaryWhere.bindings,
      ...paymentWhere.bindings,
    ]
  ).all<AggregateRow>()

  const rows = results.map((row) => ({
    period: row.period,
    period_start: row.period_start,
    period_end: row.period_end,
    media_id: row.media_id,
    media_name: row.media_name,
    ad_code: row.ad_code,
    ...buildMetrics({
      cost: toNumber(row.cost),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      mediaCv: toNumber(row.media_cv),
      accessCount: toNumber(row.access_count),
      registrationCount: toNumber(row.registration_count),
      provisionalRegistrationCount: toNumber(row.provisional_registration_count),
      payerCount: toNumber(row.payer_count),
      revenue: toNumber(row.revenue),
    }),
  }))
  const summary = buildSummary(rows)

  return c.json<ApiResponse<AnalysisResponse>>({
    success: true,
    data: {
      filters: {
        start_date: startDate,
        end_date: endDate,
        media_id: mediaId,
        ad_code: adCode,
        group_by: groupBy,
      },
      summary,
      rows,
    },
  })
})
