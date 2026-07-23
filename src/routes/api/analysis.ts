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
  payment_count: number
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
  payment_cvr: number | null
  recovery_rate: number | null
}

type AnalysisRow = AnalysisMetrics & {
  period: string
  period_start: string
  period_end: string
  media_id: number | null
  media_name: string
  campaign_group_id: number | null
  campaign_group_name: string
}

type AnalysisResponse = {
  filters: {
    start_date: string | null
    end_date: string | null
    media_id: number | null
    campaign_group_id: number | null
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
  campaign_group_id: number | null
  campaign_group_name: string
  cost?: number | null
  impressions?: number | null
  clicks?: number | null
  media_cv?: number | null
  access_count?: number | null
  registration_count?: number | null
  provisional_registration_count?: number | null
  payer_count?: number | null
  payment_count?: number | null
  revenue?: number | null
}

function parseDateParam(value: string | null) {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function parsePositiveIntegerParam(value: string | null) {
  if (!value) return null
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function parseGroupByParam(value: string | null): AnalysisGroupBy {
  if (value === 'weekly' || value === 'monthly') return value
  return 'daily'
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
  paymentCount: number
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
    payment_count: values.paymentCount,
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
    payment_cvr: divideOrNull(values.paymentCount, values.registrationCount),
    recovery_rate: divideOrNull(values.revenue, values.cost),
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
      paymentCount: total.paymentCount + row.payment_count,
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
      paymentCount: 0,
      revenue: 0,
    }
  ))
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

function buildDateWhere(alias: string, filters: {
  startDate: string | null
  endDate: string | null
}, dateColumn = 'target_date') {
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

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

function buildGroupWhere(filters: {
  mediaId: number | null
  campaignGroupId: number | null
}) {
  const where = ['g.is_active = 1']
  const bindings: Array<string | number> = []

  if (filters.mediaId) {
    where.push('g.media_id = ?')
    bindings.push(filters.mediaId)
  }
  if (filters.campaignGroupId) {
    where.push('g.id = ?')
    bindings.push(filters.campaignGroupId)
  }

  return {
    whereSql: `WHERE ${where.join(' AND ')}`,
    bindings,
  }
}

analysisRoute.get('/summary', async (c) => {
  try {
    const startDate = parseDateParam(c.req.query('start_date') ?? null)
    const endDate = parseDateParam(c.req.query('end_date') ?? null)
    const mediaId = parsePositiveIntegerParam(c.req.query('media_id') ?? null)
    const campaignGroupId = parsePositiveIntegerParam(c.req.query('campaign_group_id') ?? null)
    const groupBy = parseGroupByParam(c.req.query('group_by') ?? null)

    const groupWhere = buildGroupWhere({ mediaId, campaignGroupId })
    const adWhere = buildDateWhere('d', { startDate, endDate })
    const summaryWhere = buildDateWhere('s', { startDate, endDate })
    const paymentWhereBase = buildDateWhere('p', { startDate, endDate }, 'registration_date')
    const adPeriodSql = getPeriodSql(groupBy, 'd')
    const summaryPeriodSql = getPeriodSql(groupBy, 's')
    const paymentPeriodSql = getPeriodSql(groupBy, 'p', 'registration_date')
    const hasPaymentReportTable = await tableHasColumns(c.env.DB, 'payment_report_daily', [
      'registration_date',
      'customer_id',
      'ad_code',
      'payment_count',
      'payment_amount',
      'media_id',
    ])

    const paymentAggSql = hasPaymentReportTable
      ? `
      payment_by_ad_code AS (
        SELECT
          ${paymentPeriodSql.period} AS period,
          ${paymentPeriodSql.periodStart} AS period_start,
          ${paymentPeriodSql.periodEnd} AS period_end,
          NULLIF(TRIM(p.ad_code), '') AS ad_code,
          COUNT(DISTINCT CASE
            WHEN p.payment_count > 0 OR p.payment_amount > 0
            THEN COALESCE(NULLIF(TRIM(p.customer_id), ''), CAST(p.id AS TEXT))
          END) AS payer_count,
          SUM(COALESCE(p.payment_count, 0)) AS payment_count,
          SUM(COALESCE(p.payment_amount, 0)) AS revenue
        FROM payment_report_daily p
        ${paymentWhereBase.whereSql}
        GROUP BY
          period,
          period_start,
          period_end,
          ad_code
      ),
      payment_agg AS (
        SELECT
          p.period,
          p.period_start,
          p.period_end,
          gc.group_id AS campaign_group_id,
          gc.group_name AS campaign_group_name,
          gc.media_id,
          SUM(p.payer_count) AS payer_count,
          SUM(p.payment_count) AS payment_count,
          SUM(p.revenue) AS revenue
        FROM payment_by_ad_code p
        INNER JOIN unique_group_ad_codes gc ON p.ad_code = gc.ad_code
        GROUP BY
          p.period,
          p.period_start,
          p.period_end,
          gc.group_id,
          gc.group_name,
          gc.media_id
      )`
      : `
      payment_agg AS (
        SELECT
          '' AS period,
          '' AS period_start,
          '' AS period_end,
          NULL AS campaign_group_id,
          '' AS campaign_group_name,
          NULL AS media_id,
          0 AS payer_count,
          0 AS payment_count,
          0 AS revenue
        WHERE 0
      )`

    const detailSql = `
      WITH
      group_campaigns AS (
        SELECT DISTINCT
          g.id AS group_id,
          g.group_name,
          g.media_id,
          c.campaign_name,
          NULLIF(TRIM(c.ad_code), '') AS ad_code
        FROM campaign_groups g
        INNER JOIN campaign_group_ad_codes l ON g.id = l.campaign_group_id
        INNER JOIN campaign_master c ON l.ad_code_id = c.id
        ${groupWhere.whereSql}
      ),
      group_ad_codes AS (
        SELECT DISTINCT
          group_id,
          group_name,
          media_id,
          ad_code
        FROM group_campaigns
        WHERE ad_code IS NOT NULL
      ),
      unique_group_ad_codes AS (
        SELECT
          gac.ad_code,
          MIN(gac.group_id) AS group_id,
          MIN(gac.group_name) AS group_name,
          MIN(gac.media_id) AS media_id
        FROM group_ad_codes gac
        GROUP BY gac.ad_code
        HAVING COUNT(DISTINCT CAST(gac.group_id AS TEXT) || ':' || CAST(gac.media_id AS TEXT)) = 1
      ),
      ad_matches AS (
        SELECT DISTINCT
          d.id,
          ${adPeriodSql.period} AS period,
          ${adPeriodSql.periodStart} AS period_start,
          ${adPeriodSql.periodEnd} AS period_end,
          gc.group_id AS campaign_group_id,
          gc.group_name AS campaign_group_name,
          gc.media_id,
          d.spend,
          d.impressions,
          d.clicks,
          COALESCE(d.media_cv, 0) AS media_cv
        FROM ad_media_daily d
        INNER JOIN group_campaigns gc
          ON gc.media_id = d.media_id
         AND (
           gc.campaign_name = d.campaign_name
           OR (gc.ad_code IS NOT NULL AND gc.ad_code = d.campaign_id)
         )
        ${adWhere.whereSql}
      ),
      ad_agg AS (
        SELECT
          period,
          period_start,
          period_end,
          campaign_group_id,
          campaign_group_name,
          media_id,
          SUM(spend) AS cost,
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          SUM(media_cv) AS media_cv
        FROM ad_matches
        GROUP BY
          period,
          period_start,
          period_end,
          campaign_group_id,
          campaign_group_name,
          media_id
      ),
      summary_agg AS (
        SELECT
          ${summaryPeriodSql.period} AS period,
          ${summaryPeriodSql.periodStart} AS period_start,
          ${summaryPeriodSql.periodEnd} AS period_end,
          gc.group_id AS campaign_group_id,
          gc.group_name AS campaign_group_name,
          gc.media_id,
          SUM(s.access_count) AS access_count,
          SUM(s.registration_count) AS registration_count,
          SUM(s.provisional_registration_count) AS provisional_registration_count
        FROM media_summary_daily s
        INNER JOIN unique_group_ad_codes gc
          ON NULLIF(TRIM(s.ad_code), '') = gc.ad_code
        ${summaryWhere.whereSql}
        GROUP BY
          period,
          period_start,
          period_end,
          campaign_group_id,
          campaign_group_name,
          gc.media_id
      ),
      ${paymentAggSql},
      base_keys AS (
        SELECT period, period_start, period_end, campaign_group_id, campaign_group_name, media_id FROM ad_agg
        UNION
        SELECT period, period_start, period_end, campaign_group_id, campaign_group_name, media_id FROM summary_agg
        UNION
        SELECT period, period_start, period_end, campaign_group_id, campaign_group_name, media_id FROM payment_agg
      )
      SELECT
        k.period,
        k.period_start,
        k.period_end,
        k.media_id,
        COALESCE(m.media_name, '') AS media_name,
        k.campaign_group_id,
        k.campaign_group_name,
        COALESCE(a.cost, 0) AS cost,
        COALESCE(a.impressions, 0) AS impressions,
        COALESCE(a.clicks, 0) AS clicks,
        COALESCE(a.media_cv, 0) AS media_cv,
        COALESCE(s.access_count, 0) AS access_count,
        COALESCE(s.registration_count, 0) AS registration_count,
        COALESCE(s.provisional_registration_count, 0) AS provisional_registration_count,
        COALESCE(p.payer_count, 0) AS payer_count,
        COALESCE(p.payment_count, 0) AS payment_count,
        COALESCE(p.revenue, 0) AS revenue
      FROM base_keys k
      LEFT JOIN media_master m ON k.media_id = m.id
      LEFT JOIN ad_agg a
        ON a.period_start = k.period_start
       AND a.period_end = k.period_end
       AND a.campaign_group_id = k.campaign_group_id
       AND a.media_id = k.media_id
      LEFT JOIN summary_agg s
        ON s.period_start = k.period_start
       AND s.period_end = k.period_end
       AND s.campaign_group_id = k.campaign_group_id
       AND s.media_id = k.media_id
      LEFT JOIN payment_agg p
        ON p.period_start = k.period_start
       AND p.period_end = k.period_end
       AND p.campaign_group_id = k.campaign_group_id
       AND p.media_id = k.media_id
      ORDER BY k.period_start ASC, media_name ASC, k.campaign_group_name ASC
    `

    const { results } = await prepareWithBindings(
      c.env.DB,
      detailSql,
      [
        ...groupWhere.bindings,
        ...adWhere.bindings,
        ...summaryWhere.bindings,
        ...(hasPaymentReportTable ? paymentWhereBase.bindings : []),
      ]
    ).all<AggregateRow>()

    const rows = results.map((row) => ({
      period: row.period,
      period_start: row.period_start,
      period_end: row.period_end,
      media_id: row.media_id,
      media_name: row.media_name,
      campaign_group_id: row.campaign_group_id,
      campaign_group_name: row.campaign_group_name,
      ...buildMetrics({
        cost: toNumber(row.cost),
        impressions: toNumber(row.impressions),
        clicks: toNumber(row.clicks),
        mediaCv: toNumber(row.media_cv),
        accessCount: toNumber(row.access_count),
        registrationCount: toNumber(row.registration_count),
        provisionalRegistrationCount: toNumber(row.provisional_registration_count),
        payerCount: toNumber(row.payer_count),
        paymentCount: toNumber(row.payment_count),
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
          campaign_group_id: campaignGroupId,
          group_by: groupBy,
        },
        summary,
        rows,
      },
    })
  } catch (err) {
    console.error('[api/analysis/summary] failed', err)
    const error = err instanceof Error ? err : new Error(String(err))
    return c.json<ApiResponse<null> & { stack?: string }>(
      {
        success: false,
        error: error.message,
        stack: error.stack,
      },
      500
    )
  }
})
