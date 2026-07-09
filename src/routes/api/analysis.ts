// ============================================================
// 実績分析 API（/api/analysis）
// v1.2では広告媒体CSV由来の ad_media_daily を日付×媒体で集計する。
// 将来、媒体集計CSV・決済レポートCSVの集計を同じ行へ追加していく。
// ============================================================
import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'

export const analysisRoute = new Hono<{ Bindings: Bindings }>()

type AnalysisRow = {
  target_date: string
  media_id: number
  media_name: string
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
  }
  summary: AnalysisSummary
  rows: AnalysisRow[]
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

analysisRoute.get('/summary', async (c) => {
  const startDate = parseDateParam(c.req.query('start_date') ?? null)
  const endDate = parseDateParam(c.req.query('end_date') ?? null)
  const mediaId = parseMediaIdParam(c.req.query('media_id') ?? null)

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

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const detailSql = `
    SELECT
      d.target_date,
      d.media_id,
      COALESCE(m.media_name, '') AS media_name,
      SUM(d.spend) AS cost,
      SUM(d.impressions) AS impressions,
      SUM(d.clicks) AS clicks
    FROM ad_media_daily d
    LEFT JOIN media_master m ON d.media_id = m.id
    ${whereSql}
    GROUP BY d.target_date, d.media_id, m.media_name
    ORDER BY d.target_date ASC, m.media_name ASC
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
      target_date: string
      media_id: number
      media_name: string
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
    target_date: row.target_date,
    media_id: row.media_id,
    media_name: row.media_name,
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
      },
      summary,
      rows,
    },
  })
})
