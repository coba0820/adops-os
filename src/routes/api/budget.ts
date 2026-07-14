import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'

export const budgetRoute = new Hono<{ Bindings: Bindings }>()

type BudgetScope = 'overall' | 'media' | 'site' | 'ad_code'
type BudgetAxis = 'overall' | 'media' | 'site'

type BudgetPlanView = {
  id: number
  target_month: string
  scope_type: BudgetScope
  media_id: number | null
  media_name: string | null
  site_id: number | null
  site_name: string | null
  ad_code: string | null
  monthly_budget: number
  target_cpa: number
  target_recovery_rate: number
  memo: string | null
  target_registration_count: number
  target_revenue: number
  created_at: string
  updated_at: string
}

type ActualTotals = {
  cost: number
  registrations: number
  revenue: number
  payer_count: number
}

type ActualGroupRow = ActualTotals & {
  id: number | null
  name: string
}

type DailyActualRow = ActualTotals & {
  metric_date: string
}

const SUPPORTED_SCOPES: BudgetScope[] = ['overall', 'media', 'site', 'ad_code']
const SUPPORTED_AXES: BudgetAxis[] = ['overall', 'media', 'site']

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function divideOrNull(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null
}

function parseTargetMonth(value: string | null) {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function parsePositiveId(value: string | null) {
  if (!value) return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function parseAxis(value: string | null): BudgetAxis {
  return SUPPORTED_AXES.includes(value as BudgetAxis) ? value as BudgetAxis : 'overall'
}

function parseScope(value: unknown): BudgetScope | null {
  return SUPPORTED_SCOPES.includes(value as BudgetScope) ? value as BudgetScope : null
}

function normalizeNullableId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function normalizeRate(value: unknown) {
  const rate = toNumber(value)
  if (rate > 10) return rate / 100
  return rate
}

function getMonthInfo(targetMonth: string) {
  const [year, month] = targetMonth.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const daysInMonth = end.getUTCDate()
  const isCurrentMonth =
    todayUtc.getUTCFullYear() === year &&
    todayUtc.getUTCMonth() === month - 1
  const isFutureMonth = start.getTime() > todayUtc.getTime()
  const elapsedDays = isFutureMonth
    ? 1
    : isCurrentMonth
      ? Math.max(1, Math.min(todayUtc.getUTCDate(), daysInMonth))
      : daysInMonth

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    daysInMonth,
    elapsedDays,
    elapsedRate: elapsedDays / daysInMonth,
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(targetMonth: string, months: number) {
  const [year, month] = targetMonth.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function buildTargets(plans: BudgetPlanView[]) {
  const monthlyBudget = plans.reduce((total, plan) => total + toNumber(plan.monthly_budget), 0)
  const targetRegistrations = plans.reduce(
    (total, plan) => total + (plan.target_cpa > 0 ? plan.monthly_budget / plan.target_cpa : 0),
    0
  )
  const targetRevenue = plans.reduce(
    (total, plan) => total + (plan.monthly_budget * plan.target_recovery_rate),
    0
  )

  return {
    monthlyBudget,
    targetRegistrations,
    targetRevenue,
    targetCpa: divideOrNull(monthlyBudget, targetRegistrations),
    targetRecoveryRate: divideOrNull(targetRevenue, monthlyBudget),
  }
}

function chooseProgressPlans(
  plans: BudgetPlanView[],
  axis: BudgetAxis,
  filters: { mediaId: number | null; siteId: number | null }
) {
  const filtered = plans.filter((plan) => {
    if (filters.mediaId && plan.media_id !== filters.mediaId) return false
    if (filters.siteId && plan.site_id !== filters.siteId) return false
    return true
  })

  if (axis === 'media') return filtered.filter((plan) => plan.scope_type === 'media')
  if (axis === 'site') return filtered.filter((plan) => plan.scope_type === 'site')

  const overall = filtered.filter((plan) => plan.scope_type === 'overall')
  if (overall.length > 0) return overall

  const media = filtered.filter((plan) => plan.scope_type === 'media')
  if (media.length > 0) return media

  const site = filtered.filter((plan) => plan.scope_type === 'site')
  if (site.length > 0) return site

  return filtered
}

async function paymentReportAvailable(db: D1Database) {
  const { results } = await db.prepare(`PRAGMA table_info(payment_report_daily)`)
    .all<{ name: string }>()
  const columns = new Set(results.map((row) => row.name))
  return [
    'registration_date',
    'customer_id',
    'ad_code',
    'payment_count',
    'payment_amount',
    'media_id',
  ].every((column) => columns.has(column))
}

function actualRowsCte(hasPayment: boolean) {
  const paymentRows = hasPayment
    ? `
    UNION ALL
    SELECT
      p.registration_date AS metric_date,
      p.media_id,
      COALESCE(m.media_name, '') AS media_name,
      (
        SELECT c.site_id
        FROM campaign_master c
        WHERE c.ad_code = p.ad_code
          AND (p.media_id IS NULL OR c.media_id = p.media_id)
        ORDER BY c.id ASC
        LIMIT 1
      ) AS site_id,
      (
        SELECT sm.site_name
        FROM campaign_master c
        LEFT JOIN site_master sm ON c.site_id = sm.id
        WHERE c.ad_code = p.ad_code
          AND (p.media_id IS NULL OR c.media_id = p.media_id)
        ORDER BY c.id ASC
        LIMIT 1
      ) AS site_name,
      0 AS cost,
      0 AS registrations,
      p.payment_amount AS revenue,
      CASE
        WHEN p.payment_count > 0 OR p.payment_amount > 0
        THEN COALESCE(NULLIF(TRIM(p.customer_id), ''), CAST(p.id AS TEXT))
      END AS payer_key
    FROM payment_report_daily p
    LEFT JOIN media_master m ON p.media_id = m.id
    WHERE p.registration_date BETWEEN ? AND ?`
    : ''

  return `
    WITH actual_rows AS (
      SELECT
        d.target_date AS metric_date,
        d.media_id,
        COALESCE(m.media_name, '') AS media_name,
        (
          SELECT c.site_id
          FROM campaign_master c
          WHERE c.media_id = d.media_id
            AND (c.campaign_name = d.campaign_name OR c.ad_code = d.campaign_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_id,
        (
          SELECT sm.site_name
          FROM campaign_master c
          LEFT JOIN site_master sm ON c.site_id = sm.id
          WHERE c.media_id = d.media_id
            AND (c.campaign_name = d.campaign_name OR c.ad_code = d.campaign_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_name,
        d.spend AS cost,
        0 AS registrations,
        0 AS revenue,
        NULL AS payer_key
      FROM ad_media_daily d
      LEFT JOIN media_master m ON d.media_id = m.id
      WHERE d.target_date BETWEEN ? AND ?

      UNION ALL
      SELECT
        s.target_date AS metric_date,
        s.media_id,
        COALESCE(m.media_name, '') AS media_name,
        (
          SELECT c.site_id
          FROM campaign_master c
          WHERE c.ad_code = s.ad_code
            AND (s.media_id IS NULL OR c.media_id = s.media_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_id,
        (
          SELECT sm.site_name
          FROM campaign_master c
          LEFT JOIN site_master sm ON c.site_id = sm.id
          WHERE c.ad_code = s.ad_code
            AND (s.media_id IS NULL OR c.media_id = s.media_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_name,
        0 AS cost,
        s.registration_count AS registrations,
        0 AS revenue,
        NULL AS payer_key
      FROM media_summary_daily s
      LEFT JOIN media_master m ON s.media_id = m.id
      WHERE s.target_date BETWEEN ? AND ?
      ${paymentRows}
    )`
}

function actualBindings(monthInfo: ReturnType<typeof getMonthInfo>, hasPayment: boolean) {
  const bindings = [
    monthInfo.startDate,
    monthInfo.endDate,
    monthInfo.startDate,
    monthInfo.endDate,
  ]
  if (hasPayment) {
    bindings.push(monthInfo.startDate, monthInfo.endDate)
  }
  return bindings
}

function actualWhere(filters: { mediaId: number | null; siteId: number | null }) {
  const where: string[] = []
  const bindings: Array<string | number> = []
  if (filters.mediaId) {
    where.push('media_id = ?')
    bindings.push(filters.mediaId)
  }
  if (filters.siteId) {
    where.push('site_id = ?')
    bindings.push(filters.siteId)
  }
  return {
    sql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    bindings,
  }
}

async function fetchActualTotals(
  db: D1Database,
  monthInfo: ReturnType<typeof getMonthInfo>,
  filters: { mediaId: number | null; siteId: number | null },
  hasPayment: boolean
) {
  const where = actualWhere(filters)
  const sql = `
    ${actualRowsCte(hasPayment)}
    SELECT
      COALESCE(SUM(cost), 0) AS cost,
      COALESCE(SUM(registrations), 0) AS registrations,
      COALESCE(SUM(revenue), 0) AS revenue,
      COUNT(DISTINCT payer_key) AS payer_count
    FROM actual_rows
    ${where.sql}`
  const row = await db.prepare(sql)
    .bind(...actualBindings(monthInfo, hasPayment), ...where.bindings)
    .first<ActualTotals>()
  return normalizeActual(row)
}

async function fetchActualGroups(
  db: D1Database,
  monthInfo: ReturnType<typeof getMonthInfo>,
  filters: { mediaId: number | null; siteId: number | null },
  hasPayment: boolean,
  groupBy: 'media' | 'site'
) {
  const where = actualWhere(filters)
  const idColumn = groupBy === 'media' ? 'media_id' : 'site_id'
  const nameColumn = groupBy === 'media' ? 'media_name' : 'site_name'
  const sql = `
    ${actualRowsCte(hasPayment)}
    SELECT
      ${idColumn} AS id,
      COALESCE(NULLIF(${nameColumn}, ''), '未設定') AS name,
      COALESCE(SUM(cost), 0) AS cost,
      COALESCE(SUM(registrations), 0) AS registrations,
      COALESCE(SUM(revenue), 0) AS revenue,
      COUNT(DISTINCT payer_key) AS payer_count
    FROM actual_rows
    ${where.sql}
    GROUP BY ${idColumn}, name
    ORDER BY name ASC`
  const { results } = await db.prepare(sql)
    .bind(...actualBindings(monthInfo, hasPayment), ...where.bindings)
    .all<ActualGroupRow>()
  return results.map((row) => ({ ...normalizeActual(row), id: row.id, name: row.name }))
}

async function fetchDailyActuals(
  db: D1Database,
  monthInfo: ReturnType<typeof getMonthInfo>,
  filters: { mediaId: number | null; siteId: number | null },
  hasPayment: boolean
) {
  const where = actualWhere(filters)
  const sql = `
    ${actualRowsCte(hasPayment)}
    SELECT
      metric_date,
      COALESCE(SUM(cost), 0) AS cost,
      COALESCE(SUM(registrations), 0) AS registrations,
      COALESCE(SUM(revenue), 0) AS revenue,
      COUNT(DISTINCT payer_key) AS payer_count
    FROM actual_rows
    ${where.sql}
    GROUP BY metric_date
    ORDER BY metric_date ASC`
  const { results } = await db.prepare(sql)
    .bind(...actualBindings(monthInfo, hasPayment), ...where.bindings)
    .all<DailyActualRow>()
  return results.map((row) => ({ ...normalizeActual(row), metric_date: row.metric_date }))
}

function normalizeActual(row: Partial<ActualTotals> | null | undefined): ActualTotals {
  return {
    cost: toNumber(row?.cost),
    registrations: toNumber(row?.registrations),
    revenue: toNumber(row?.revenue),
    payer_count: toNumber(row?.payer_count),
  }
}

async function fetchBudgetPlans(db: D1Database, targetMonth: string) {
  const { results } = await db.prepare(
    `SELECT
       b.id, b.target_month, b.scope_type, b.media_id, m.media_name,
       b.site_id, s.site_name, b.ad_code, b.monthly_budget,
       b.target_cpa, b.target_recovery_rate, b.memo,
       b.created_at, b.updated_at
     FROM budget_plans b
     LEFT JOIN media_master m ON b.media_id = m.id
     LEFT JOIN site_master s ON b.site_id = s.id
     WHERE b.target_month = ?
     ORDER BY b.scope_type ASC, m.media_name ASC, s.site_name ASC, b.id ASC`
  )
    .bind(targetMonth)
    .all<BudgetPlanView>()

  return results.map((plan) => ({
    ...plan,
    monthly_budget: toNumber(plan.monthly_budget),
    target_cpa: toNumber(plan.target_cpa),
    target_recovery_rate: toNumber(plan.target_recovery_rate),
    target_registration_count: plan.target_cpa > 0 ? plan.monthly_budget / plan.target_cpa : 0,
    target_revenue: plan.monthly_budget * plan.target_recovery_rate,
  }))
}

function buildProgress(
  targets: ReturnType<typeof buildTargets>,
  actual: ActualTotals,
  monthInfo: ReturnType<typeof getMonthInfo>
) {
  const remainingBudget = targets.monthlyBudget - actual.cost
  const cpa = divideOrNull(actual.cost, actual.registrations)
  const recoveryRate = divideOrNull(actual.revenue, actual.cost)

  return {
    monthly_budget: targets.monthlyBudget,
    cost: actual.cost,
    remaining_budget: remainingBudget,
    budget_spend_rate: divideOrNull(actual.cost, targets.monthlyBudget),
    target_registration_count: targets.targetRegistrations,
    registration_count: actual.registrations,
    registration_progress_rate: divideOrNull(actual.registrations, targets.targetRegistrations),
    cpa,
    target_cpa: targets.targetCpa,
    target_revenue: targets.targetRevenue,
    revenue: actual.revenue,
    revenue_progress_rate: divideOrNull(actual.revenue, targets.targetRevenue),
    recovery_rate: recoveryRate,
    target_recovery_rate: targets.targetRecoveryRate,
    elapsed_rate: monthInfo.elapsedRate,
  }
}

function buildLanding(actual: ActualTotals, monthInfo: ReturnType<typeof getMonthInfo>, monthlyBudget: number) {
  const multiplier = monthInfo.daysInMonth / monthInfo.elapsedDays
  const projectedCost = actual.cost * multiplier
  const projectedRegistrations = actual.registrations * multiplier
  const projectedRevenue = actual.revenue * multiplier

  return {
    projected_cost: projectedCost,
    budget_gap: monthlyBudget - projectedCost,
    projected_registrations: projectedRegistrations,
    projected_cpa: divideOrNull(projectedCost, projectedRegistrations),
    projected_revenue: projectedRevenue,
    projected_recovery_rate: divideOrNull(projectedRevenue, projectedCost),
  }
}

function buildRatioItems(
  plans: BudgetPlanView[],
  actuals: Array<ActualGroupRow & ActualTotals>,
  scopeType: BudgetScope
) {
  const itemsById = new Map<string, {
    id: number | null
    name: string
    budget: number
    cost: number
  }>()

  for (const plan of plans.filter((item) => item.scope_type === scopeType)) {
    const id = scopeType === 'media' ? plan.media_id : plan.site_id
    const name = scopeType === 'media' ? plan.media_name : plan.site_name
    const key = String(id ?? 'null')
    const current = itemsById.get(key) ?? {
      id,
      name: name || '未設定',
      budget: 0,
      cost: 0,
    }
    current.budget += plan.monthly_budget
    itemsById.set(key, current)
  }

  for (const actual of actuals) {
    const key = String(actual.id ?? 'null')
    const current = itemsById.get(key) ?? {
      id: actual.id,
      name: actual.name || '未設定',
      budget: 0,
      cost: 0,
    }
    current.cost += actual.cost
    itemsById.set(key, current)
  }

  const items = [...itemsById.values()]
  const totalBudget = items.reduce((total, item) => total + item.budget, 0)
  const totalCost = items.reduce((total, item) => total + item.cost, 0)
  return items
    .map((item) => ({
      ...item,
      budget_ratio: divideOrNull(item.budget, totalBudget),
      cost_ratio: divideOrNull(item.cost, totalCost),
    }))
    .sort((a, b) => b.budget - a.budget || b.cost - a.cost)
}

function getMonthWeeks(monthInfo: ReturnType<typeof getMonthInfo>) {
  const start = new Date(`${monthInfo.startDate}T00:00:00.000Z`)
  const end = new Date(`${monthInfo.endDate}T00:00:00.000Z`)
  const weeks: Array<{ startDate: string; endDate: string; days: number }> = []
  let cursor = start

  while (cursor <= end) {
    const weekday = cursor.getUTCDay()
    const daysToSunday = (7 - weekday) % 7
    const weekEnd = addDays(cursor, daysToSunday)
    const clippedEnd = weekEnd > end ? end : weekEnd
    const days = Math.round((clippedEnd.getTime() - cursor.getTime()) / 86400000) + 1
    weeks.push({
      startDate: formatDate(cursor),
      endDate: formatDate(clippedEnd),
      days,
    })
    cursor = addDays(clippedEnd, 1)
  }

  return weeks
}

function buildWeeklyProgress(
  dailyRows: DailyActualRow[],
  monthInfo: ReturnType<typeof getMonthInfo>,
  monthlyBudget: number
) {
  const dailyByDate = new Map(dailyRows.map((row) => [row.metric_date, row]))
  let cumulativeCost = 0
  let cumulativeRegistrations = 0
  let cumulativeRevenue = 0
  let daysThroughWeek = 0

  return getMonthWeeks(monthInfo).map((week) => {
    let weekCost = 0
    let weekRegistrations = 0
    let weekRevenue = 0
    const start = new Date(`${week.startDate}T00:00:00.000Z`)
    for (let i = 0; i < week.days; i++) {
      const date = formatDate(addDays(start, i))
      const actual = dailyByDate.get(date)
      weekCost += toNumber(actual?.cost)
      weekRegistrations += toNumber(actual?.registrations)
      weekRevenue += toNumber(actual?.revenue)
    }

    cumulativeCost += weekCost
    cumulativeRegistrations += weekRegistrations
    cumulativeRevenue += weekRevenue
    daysThroughWeek += week.days

    const weekBudget = (monthlyBudget / monthInfo.daysInMonth) * week.days
    const projectedCost = daysThroughWeek > 0
      ? (cumulativeCost / daysThroughWeek) * monthInfo.daysInMonth
      : 0

    return {
      week_start: week.startDate,
      week_end: week.endDate,
      week_days: week.days,
      week_budget: weekBudget,
      cost: weekCost,
      budget_spend_rate: divideOrNull(weekCost, weekBudget),
      remaining_budget: weekBudget - weekCost,
      registration_count: weekRegistrations,
      cpa: divideOrNull(weekCost, weekRegistrations),
      revenue: weekRevenue,
      recovery_rate: divideOrNull(weekRevenue, weekCost),
      cumulative_progress_rate: divideOrNull(cumulativeCost, monthlyBudget),
      projected_month_end_cost: projectedCost,
      projected_month_end_registrations:
        daysThroughWeek > 0 ? (cumulativeRegistrations / daysThroughWeek) * monthInfo.daysInMonth : 0,
      projected_month_end_revenue:
        daysThroughWeek > 0 ? (cumulativeRevenue / daysThroughWeek) * monthInfo.daysInMonth : 0,
    }
  })
}

function parseBudgetPayload(body: Record<string, unknown>) {
  const targetMonth = parseTargetMonth(typeof body.target_month === 'string' ? body.target_month : null)
  const scopeType = parseScope(body.scope_type) ?? 'media'
  const mediaId = normalizeNullableId(body.media_id)
  const siteId = normalizeNullableId(body.site_id)
  const adCode = typeof body.ad_code === 'string' && body.ad_code.trim() ? body.ad_code.trim() : null
  const monthlyBudget = toNumber(body.monthly_budget)
  const targetCpa = toNumber(body.target_cpa)
  const targetRecoveryRate = normalizeRate(body.target_recovery_rate)
  const memo = typeof body.memo === 'string' ? body.memo.trim() : null

  if (scopeType === 'media' && !mediaId) throw new Error('媒体別予算では媒体を選択してください')
  if (scopeType === 'site' && !siteId) throw new Error('サイト別予算ではサイトを選択してください')
  if (scopeType === 'ad_code' && !adCode) throw new Error('広告コード別予算では広告コードが必要です')
  if (monthlyBudget < 0 || targetCpa < 0 || targetRecoveryRate < 0) {
    throw new Error('予算・目標値は0以上で入力してください')
  }

  return {
    targetMonth,
    scopeType,
    mediaId: scopeType === 'media' ? mediaId : null,
    siteId: scopeType === 'site' ? siteId : null,
    adCode: scopeType === 'ad_code' ? adCode : null,
    monthlyBudget,
    targetCpa,
    targetRecoveryRate,
    memo,
  }
}

budgetRoute.get('/', async (c) => {
  const targetMonth = parseTargetMonth(c.req.query('target_month') ?? null)
  const mediaId = parsePositiveId(c.req.query('media_id') ?? null)
  const siteId = parsePositiveId(c.req.query('site_id') ?? null)
  const axis = parseAxis(c.req.query('view_axis') ?? null)
  const monthInfo = getMonthInfo(targetMonth)
  const filters = { mediaId, siteId }

  const [
    plans,
    hasPayment,
  ] = await Promise.all([
    fetchBudgetPlans(c.env.DB, targetMonth),
    paymentReportAvailable(c.env.DB),
  ])
  const [actual, mediaActuals, siteActuals, dailyActuals] = await Promise.all([
    fetchActualTotals(c.env.DB, monthInfo, filters, hasPayment),
    fetchActualGroups(c.env.DB, monthInfo, filters, hasPayment, 'media'),
    fetchActualGroups(c.env.DB, monthInfo, filters, hasPayment, 'site'),
    fetchDailyActuals(c.env.DB, monthInfo, filters, hasPayment),
  ])

  const progressPlans = chooseProgressPlans(plans, axis, filters)
  const targets = buildTargets(progressPlans)
  const progress = buildProgress(targets, actual, monthInfo)

  return c.json<ApiResponse<Record<string, unknown>>>({
    success: true,
    data: {
      filters: {
        target_month: targetMonth,
        media_id: mediaId,
        site_id: siteId,
        view_axis: axis,
      },
      month: monthInfo,
      budget_settings: plans,
      progress,
      landing: buildLanding(actual, monthInfo, targets.monthlyBudget),
      media_ratios: buildRatioItems(plans, mediaActuals, 'media'),
      site_ratios: buildRatioItems(plans, siteActuals, 'site'),
      weekly_progress: buildWeeklyProgress(dailyActuals, monthInfo, targets.monthlyBudget),
    },
  })
})

budgetRoute.post('/settings', async (c) => {
  try {
    const payload = parseBudgetPayload(await c.req.json<Record<string, unknown>>())
    const result = await c.env.DB.prepare(
      `INSERT INTO budget_plans
         (target_month, scope_type, media_id, site_id, ad_code,
          monthly_budget, target_cpa, target_recovery_rate, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        payload.targetMonth,
        payload.scopeType,
        payload.mediaId,
        payload.siteId,
        payload.adCode,
        payload.monthlyBudget,
        payload.targetCpa,
        payload.targetRecoveryRate,
        payload.memo
      )
      .run()

    return c.json<ApiResponse<{ id: number | null }>>({
      success: true,
      data: { id: result.meta.last_row_id ?? null },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '予算設定の保存に失敗しました' },
      400
    )
  }
})

budgetRoute.put('/settings/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) throw new Error('予算設定IDが正しくありません')
    const payload = parseBudgetPayload(await c.req.json<Record<string, unknown>>())
    await c.env.DB.prepare(
      `UPDATE budget_plans
       SET target_month = ?, scope_type = ?, media_id = ?, site_id = ?,
           ad_code = ?, monthly_budget = ?, target_cpa = ?,
           target_recovery_rate = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(
        payload.targetMonth,
        payload.scopeType,
        payload.mediaId,
        payload.siteId,
        payload.adCode,
        payload.monthlyBudget,
        payload.targetCpa,
        payload.targetRecoveryRate,
        payload.memo,
        id
      )
      .run()

    return c.json<ApiResponse<null>>({ success: true })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '予算設定の更新に失敗しました' },
      400
    )
  }
})

budgetRoute.delete('/settings/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json<ApiResponse<null>>({ success: false, error: '予算設定IDが正しくありません' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM budget_plans WHERE id = ?')
    .bind(id)
    .run()

  return c.json<ApiResponse<null>>({ success: true })
})

budgetRoute.post('/copy-previous', async (c) => {
  const body = await c.req.json<{ target_month?: string; overwrite?: boolean }>()
  const targetMonth = parseTargetMonth(body.target_month ?? null)
  const previousMonth = addMonths(targetMonth, -1)
  const existing = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM budget_plans WHERE target_month = ?`
  )
    .bind(targetMonth)
    .first<{ count: number }>()

  if ((existing?.count ?? 0) > 0 && !body.overwrite) {
    return c.json<ApiResponse<{ exists: true; target_month: string }>>(
      { success: false, error: `${targetMonth}の予算設定は既に存在します。上書きしますか？`, data: { exists: true, target_month: targetMonth } },
      409
    )
  }

  const { results: previousPlans } = await c.env.DB.prepare(
    `SELECT scope_type, media_id, site_id, ad_code, monthly_budget,
            target_cpa, target_recovery_rate, memo
     FROM budget_plans
     WHERE target_month = ?
     ORDER BY id ASC`
  )
    .bind(previousMonth)
    .all<BudgetPlanView>()

  if (previousPlans.length === 0) {
    return c.json<ApiResponse<null>>(
      { success: false, error: `${previousMonth}の予算設定がありません` },
      400
    )
  }

  const statements = []
  if (body.overwrite) {
    statements.push(
      c.env.DB.prepare('DELETE FROM budget_plans WHERE target_month = ?').bind(targetMonth)
    )
  }
  statements.push(
    ...previousPlans.map((plan) =>
      c.env.DB.prepare(
        `INSERT INTO budget_plans
           (target_month, scope_type, media_id, site_id, ad_code,
            monthly_budget, target_cpa, target_recovery_rate, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          targetMonth,
          plan.scope_type,
          plan.media_id,
          plan.site_id,
          plan.ad_code,
          plan.monthly_budget,
          plan.target_cpa,
          plan.target_recovery_rate,
          plan.memo
        )
    )
  )

  await c.env.DB.batch(statements)
  const copiedPlans = await fetchBudgetPlans(c.env.DB, targetMonth)

  return c.json<ApiResponse<{ copied_count: number; settings: BudgetPlanView[] }>>({
    success: true,
    data: {
      copied_count: previousPlans.length,
      settings: copiedPlans,
    },
  })
})
