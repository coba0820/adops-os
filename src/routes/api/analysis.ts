// ============================================================
// 実績分析 API（/api/analysis）
// v1.2では広告媒体CSV由来の ad_media_daily を日付×媒体で集計する。
// 将来、媒体集計CSV・決済レポートCSVの集計を同じ行へ追加していく。
// ============================================================
import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'

export const analysisRoute = new Hono<{ Bindings: Bindings }>()

type AnalysisRow = {
  period: string
  period_start: string
  period_end: string
  media_id: number
  media_name: string
  ad_code: string | null
  cost: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cpm: number
}

type AnalysisSummary = {
  cost: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cpm: number
}

type AnalysisResponse = {
  filters: {
    start_date: string | null
    end_date: string | null
    media_id: number | null
    ad_code: string | null
    group_by: AnalysisGroupBy
  }
  summary: AnalysisSummary
  rows: AnalysisRow[]
}

type AnalysisGroupBy = 'daily' | 'weekly' | 'monthly'

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

function buildMetrics(cost: number, impressions: number, clicks: number) {
  return {
    cost,
    impressions,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cpm: impressions > 0 ? (cost / impressions) * 1000 : 0,
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

function getPeriodSql(groupBy: AnalysisGroupBy) {
  if (groupBy === 'weekly') {
    const periodStart =
      "date(d.target_date, '-' || ((CAST(strftime('%w', d.target_date) AS INTEGER) + 6) % 7) || ' days')"
    return {
      period: `${periodStart} || '〜' || date(${periodStart}, '+6 days')`,
      periodStart,
      periodEnd: `date(${periodStart}, '+6 days')`,
    }
  }

  if (groupBy === 'monthly') {
    return {
      period: "strftime('%Y-%m', d.target_date)",
      periodStart: "date(d.target_date, 'start of month')",
      periodEnd: "date(d.target_date, 'start of month', '+1 month', '-1 day')",
    }
  }

  return {
    period: 'd.target_date',
    periodStart: 'd.target_date',
    periodEnd: 'd.target_date',
  }
}

analysisRoute.get('/summary', async (c) => {
  const startDate = parseDateParam(c.req.query('start_date') ?? null)
  const endDate = parseDateParam(c.req.query('end_date') ?? null)
  const mediaId = parseMediaIdParam(c.req.query('media_id') ?? null)
  const adCode = parseAdCodeParam(c.req.query('ad_code') ?? null)
  const groupBy = parseGroupByParam(c.req.query('group_by') ?? null)
  const periodSql = getPeriodSql(groupBy)

  const where: string[] = []
  const bindings: Array<string | number> = []

  if (startDate) {
    where.push('d.target_date >= ?')
    bindings.push(startDate)
  }
  if (endDate) {
    where.push('d.target_date <= ?')
    bindings.push(endDate)
  }
  if (mediaId) {
    where.push('d.media_id = ?')
    bindings.push(mediaId)
  }
  if (adCode) {
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
    bindings.push(adCode)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const detailSql = `
    SELECT
      ${periodSql.period} AS period,
      ${periodSql.periodStart} AS period_start,
      ${periodSql.periodEnd} AS period_end,
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
      SUM(d.clicks) AS clicks
    FROM ad_media_daily d
    LEFT JOIN media_master m ON d.media_id = m.id
    ${whereSql}
    GROUP BY period, period_start, period_end, d.media_id, m.media_name, ad_code
    ORDER BY period_start ASC, m.media_name ASC, ad_code ASC
  `

  const summarySql = `
    SELECT
      SUM(d.spend) AS cost,
      SUM(d.impressions) AS impressions,
      SUM(d.clicks) AS clicks
    FROM ad_media_daily d
    ${whereSql}
  `

  const [{ results }, summaryResult] = await Promise.all([
    prepareWithBindings(c.env.DB, detailSql, bindings).all<{
      period: string
      period_start: string
      period_end: string
      media_id: number
      media_name: string
      ad_code: string | null
      cost: number
      impressions: number
      clicks: number
    }>(),
    prepareWithBindings(c.env.DB, summarySql, bindings).first<{
      cost: number | null
      impressions: number | null
      clicks: number | null
    }>(),
  ])

  const rows = results.map((row) => ({
    period: row.period,
    period_start: row.period_start,
    period_end: row.period_end,
    media_id: row.media_id,
    media_name: row.media_name,
    ad_code: row.ad_code,
    ...buildMetrics(
      toNumber(row.cost),
      toNumber(row.impressions),
      toNumber(row.clicks)
    ),
  }))

  const summary = buildMetrics(
    toNumber(summaryResult?.cost),
    toNumber(summaryResult?.impressions),
    toNumber(summaryResult?.clicks)
  )

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
