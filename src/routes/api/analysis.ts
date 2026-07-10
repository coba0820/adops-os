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
  ctr: number | null
  cpc: number | null
  cpm: number | null
  media_cpa: number | null
  media_cvr: number | null
  cpf: number | null
  cpa: number | null
  cvr: number | null
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
    ctr: divideOrNull(values.clicks, values.impressions),
    cpc: divideOrNull(values.cost, values.clicks),
    cpm: values.impressions > 0 ? (values.cost / values.impressions) * 1000 : null,
    media_cpa: divideOrNull(values.cost, values.mediaCv),
    media_cvr: divideOrNull(values.mediaCv, values.clicks),
    cpf: divideOrNull(values.cost, cvCount),
    cpa: divideOrNull(values.cost, values.registrationCount),
    cvr: divideOrNull(values.registrationCount, values.mediaCv),
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

function getPeriodSql(groupBy: AnalysisGroupBy, alias: string) {
  if (groupBy === 'weekly') {
    const periodStart =
      `date(${alias}.target_date, '-' || ((CAST(strftime('%w', ${alias}.target_date) AS INTEGER) + 6) % 7) || ' days')`
    return {
      period: `${periodStart} || '〜' || date(${periodStart}, '+6 days')`,
      periodStart,
      periodEnd: `date(${periodStart}, '+6 days')`,
    }
  }

  if (groupBy === 'monthly') {
    return {
      period: `strftime('%Y-%m', ${alias}.target_date)`,
      periodStart: `date(${alias}.target_date, 'start of month')`,
      periodEnd: `date(${alias}.target_date, 'start of month', '+1 month', '-1 day')`,
    }
  }

  return {
    period: `${alias}.target_date`,
    periodStart: `${alias}.target_date`,
    periodEnd: `${alias}.target_date`,
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

function buildMediaSummaryWhere(filters: {
  startDate: string | null
  endDate: string | null
  mediaId: number | null
  adCode: string | null
}) {
  const where: string[] = []
  const bindings: Array<string | number> = []

  if (filters.startDate) {
    where.push('s.target_date >= ?')
    bindings.push(filters.startDate)
  }
  if (filters.endDate) {
    where.push('s.target_date <= ?')
    bindings.push(filters.endDate)
  }
  if (filters.mediaId) {
    where.push('s.media_id = ?')
    bindings.push(filters.mediaId)
  }
  if (filters.adCode) {
    where.push('s.ad_code = ?')
    bindings.push(filters.adCode)
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

function rowKey(row: Pick<AggregateRow, 'period_start' | 'period_end' | 'media_id' | 'ad_code'>) {
  return [
    row.period_start,
    row.period_end,
    row.media_id ?? 'null',
    row.ad_code || 'null',
  ].join('|')
}

function createEmptyRow(row: AggregateRow): AnalysisRow {
  return {
    period: row.period,
    period_start: row.period_start,
    period_end: row.period_end,
    media_id: row.media_id,
    media_name: row.media_name,
    ad_code: row.ad_code,
    ...buildMetrics({
      cost: 0,
      impressions: 0,
      clicks: 0,
      mediaCv: 0,
      accessCount: 0,
      registrationCount: 0,
      provisionalRegistrationCount: 0,
    }),
  }
}

function applyMetrics(row: AnalysisRow, aggregate: AggregateRow) {
  const values = {
    cost: row.cost + toNumber(aggregate.cost),
    impressions: row.impressions + toNumber(aggregate.impressions),
    clicks: row.clicks + toNumber(aggregate.clicks),
    mediaCv: row.media_cv + toNumber(aggregate.media_cv),
    accessCount: row.access_count + toNumber(aggregate.access_count),
    registrationCount: row.registration_count + toNumber(aggregate.registration_count),
    provisionalRegistrationCount:
      row.provisional_registration_count + toNumber(aggregate.provisional_registration_count),
  }

  Object.assign(row, buildMetrics(values))
}

function sortRows(rows: AnalysisRow[]) {
  return rows.sort((a, b) => {
    const periodCompare = a.period_start.localeCompare(b.period_start)
    if (periodCompare !== 0) return periodCompare

    const mediaCompare = (a.media_name || '').localeCompare(b.media_name || '', 'ja')
    if (mediaCompare !== 0) return mediaCompare

    return (a.ad_code || '').localeCompare(b.ad_code || '', 'ja')
  })
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
    }),
    {
      cost: 0,
      impressions: 0,
      clicks: 0,
      mediaCv: 0,
      accessCount: 0,
      registrationCount: 0,
      provisionalRegistrationCount: 0,
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
  const adWhere = buildAdMediaWhere(filters)
  const mediaSummaryWhere = buildMediaSummaryWhere(filters)

  const adDetailSql = `
    SELECT
      ${adPeriodSql.period} AS period,
      ${adPeriodSql.periodStart} AS period_start,
      ${adPeriodSql.periodEnd} AS period_end,
      d.media_id,
      COALESCE(m.media_name, '') AS media_name,
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
      SUM(d.spend) AS cost,
      SUM(d.impressions) AS impressions,
      SUM(d.clicks) AS clicks,
      SUM(COALESCE(d.media_cv, 0)) AS media_cv
    FROM ad_media_daily d
    LEFT JOIN media_master m ON d.media_id = m.id
    ${adWhere.whereSql}
    GROUP BY period, period_start, period_end, d.media_id, m.media_name, ad_code
  `

  const mediaSummarySql = `
    SELECT
      ${summaryPeriodSql.period} AS period,
      ${summaryPeriodSql.periodStart} AS period_start,
      ${summaryPeriodSql.periodEnd} AS period_end,
      s.media_id,
      COALESCE(m.media_name, '') AS media_name,
      NULLIF(TRIM(s.ad_code), '') AS ad_code,
      SUM(s.access_count) AS access_count,
      SUM(s.registration_count) AS registration_count,
      SUM(s.provisional_registration_count) AS provisional_registration_count
    FROM media_summary_daily s
    LEFT JOIN media_master m ON s.media_id = m.id
    ${mediaSummaryWhere.whereSql}
    GROUP BY period, period_start, period_end, s.media_id, m.media_name, ad_code
  `

  const [{ results: adRows }, { results: mediaSummaryRows }] = await Promise.all([
    prepareWithBindings(c.env.DB, adDetailSql, adWhere.bindings).all<AggregateRow>(),
    prepareWithBindings(c.env.DB, mediaSummarySql, mediaSummaryWhere.bindings).all<AggregateRow>(),
  ])

  const rowsByKey = new Map<string, AnalysisRow>()

  for (const aggregate of [...adRows, ...mediaSummaryRows]) {
    const key = rowKey(aggregate)
    const row = rowsByKey.get(key) ?? createEmptyRow(aggregate)
    applyMetrics(row, aggregate)
    rowsByKey.set(key, row)
  }

  const rows = sortRows([...rowsByKey.values()])
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
