import { Hono } from 'hono'
import type { ApiResponse, Bindings, MediaStatus } from '../../types'

export const forecastRoute = new Hono<{ Bindings: Bindings }>()

type ScopeType = 'overall' | 'media' | 'site' | 'ad_code'
type ForecastMode = 'current_month' | 'past_month' | 'future_month' | 'no_actual'
type ForecastStatus = 'good' | 'bad' | 'neutral' | 'target_missing'

type BudgetPlan = {
  id: number
  target_month: string
  scope_type: ScopeType
  media_id: number | null
  site_id: number | null
  ad_code: string | null
  monthly_budget: number
  target_cpa: number
}

type MediaMasterRow = {
  id: number
  media_name: string
  status: MediaStatus
}

type SiteMasterRow = {
  id: number
  site_name: string
}

type ActualTotals = {
  cost: number
  registrations: number
}

type GroupActual = ActualTotals & {
  id: number | null
}

type ForecastTargets = {
  monthlyBudget: number | null
  targetRegistrations: number | null
  targetCpa: number | null
  source: 'overall' | 'media' | 'site' | 'none'
}

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function divideOrNull(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return numerator / denominator
}

function parseYear(value: string | null) {
  const year = Number(value)
  const currentYear = new Date().getFullYear()
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : currentYear
}

function parseMonth(value: string | null) {
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getTargetMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getMonthInfo(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  const daysInMonth = end.getUTCDate()
  const targetMonth = getTargetMonth(year, month)
  const currentMonth = getTargetMonth(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + 1)
  const mode = targetMonth < currentMonth
    ? 'past_month'
    : targetMonth > currentMonth
      ? 'future_month'
      : 'current_month'

  return {
    targetMonth,
    startDate: formatDate(start),
    endDate: formatDate(end),
    daysInMonth,
    today: formatDate(todayUtc),
    mode: mode as ForecastMode,
  }
}

function dayOfMonth(date: string | null) {
  if (!date) return null
  const day = Number(date.slice(8, 10))
  return Number.isInteger(day) ? day : null
}

async function tableHasColumns(db: D1Database, tableName: string, requiredColumns: string[]) {
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return false
  const { results } = await db.prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>()
  const columns = new Set(results.map((row) => row.name))
  return requiredColumns.every((column) => columns.has(column))
}

async function fetchBudgetPlans(db: D1Database, targetMonth: string) {
  const hasBudgetTable = await tableHasColumns(db, 'budget_plans', [
    'target_month',
    'scope_type',
    'monthly_budget',
    'target_cpa',
  ])
  if (!hasBudgetTable) return []

  const { results } = await db.prepare(
    `SELECT id, target_month, scope_type, media_id, site_id, ad_code,
            monthly_budget, target_cpa
     FROM budget_plans
     WHERE target_month = ?`
  )
    .bind(targetMonth)
    .all<BudgetPlan>()

  return results.map((plan) => ({
    ...plan,
    monthly_budget: toNumber(plan.monthly_budget),
    target_cpa: toNumber(plan.target_cpa),
  }))
}

async function fetchMasters(db: D1Database) {
  const [{ results: media }, { results: sites }] = await Promise.all([
    db.prepare(
      `SELECT id, media_name, status
       FROM media_master
       ORDER BY id ASC`
    ).all<MediaMasterRow>(),
    db.prepare(
      `SELECT id, site_name
       FROM site_master
       ORDER BY id ASC`
    ).all<SiteMasterRow>(),
  ])

  return { media, sites }
}

function actualRowsCte(endColumn = '?') {
  return `
    WITH actual_rows AS (
      SELECT
        d.target_date AS metric_date,
        d.media_id,
        (
          SELECT c.site_id
          FROM campaign_master c
          WHERE c.media_id = d.media_id
            AND (c.campaign_name = d.campaign_name OR c.ad_code = d.campaign_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_id,
        d.spend AS cost,
        0 AS registrations
      FROM ad_media_daily d
      WHERE d.target_date BETWEEN ? AND ${endColumn}

      UNION ALL

      SELECT
        s.target_date AS metric_date,
        s.media_id,
        (
          SELECT c.site_id
          FROM campaign_master c
          WHERE c.ad_code = s.ad_code
            AND (s.media_id IS NULL OR c.media_id = s.media_id)
          ORDER BY c.id ASC
          LIMIT 1
        ) AS site_id,
        0 AS cost,
        s.registration_count AS registrations
      FROM media_summary_daily s
      WHERE s.target_date BETWEEN ? AND ${endColumn}
    )`
}

async function fetchLatestActualDate(db: D1Database, startDate: string, endDate: string) {
  const row = await db.prepare(
    `SELECT MAX(metric_date) AS latest_actual_date
     FROM (
       SELECT MAX(target_date) AS metric_date
       FROM ad_media_daily
       WHERE target_date BETWEEN ? AND ?
       UNION ALL
       SELECT MAX(target_date) AS metric_date
       FROM media_summary_daily
       WHERE target_date BETWEEN ? AND ?
     )`
  )
    .bind(startDate, endDate, startDate, endDate)
    .first<{ latest_actual_date: string | null }>()

  return row?.latest_actual_date ?? null
}

async function fetchActualTotals(db: D1Database, startDate: string, cutoffDate: string) {
  const row = await db.prepare(
    `${actualRowsCte()}
     SELECT
       COALESCE(SUM(cost), 0) AS cost,
       COALESCE(SUM(registrations), 0) AS registrations
     FROM actual_rows`
  )
    .bind(startDate, cutoffDate, startDate, cutoffDate)
    .first<ActualTotals>()

  return normalizeActual(row)
}

async function fetchGroupActuals(
  db: D1Database,
  startDate: string,
  cutoffDate: string,
  groupBy: 'media' | 'site'
) {
  const idColumn = groupBy === 'media' ? 'media_id' : 'site_id'
  const { results } = await db.prepare(
    `${actualRowsCte()}
     SELECT
       ${idColumn} AS id,
       COALESCE(SUM(cost), 0) AS cost,
       COALESCE(SUM(registrations), 0) AS registrations
     FROM actual_rows
     WHERE ${idColumn} IS NOT NULL
     GROUP BY ${idColumn}`
  )
    .bind(startDate, cutoffDate, startDate, cutoffDate)
    .all<GroupActual>()

  return results.map((row) => ({
    id: row.id,
    ...normalizeActual(row),
  }))
}

function normalizeActual(row: Partial<ActualTotals> | null | undefined): ActualTotals {
  return {
    cost: toNumber(row?.cost),
    registrations: toNumber(row?.registrations),
  }
}

function buildTargetsFromPlans(plans: BudgetPlan[], source: ForecastTargets['source']): ForecastTargets {
  if (plans.length === 0) {
    return {
      monthlyBudget: null,
      targetRegistrations: null,
      targetCpa: null,
      source: 'none',
    }
  }

  const monthlyBudget = plans.reduce((total, plan) => total + toNumber(plan.monthly_budget), 0)
  const targetRegistrations = plans.reduce(
    (total, plan) => total + (plan.target_cpa > 0 ? plan.monthly_budget / plan.target_cpa : 0),
    0
  )
  const targetCpa = targetRegistrations > 0 ? monthlyBudget / targetRegistrations : null

  return {
    monthlyBudget: monthlyBudget > 0 ? monthlyBudget : null,
    targetRegistrations: targetRegistrations > 0 ? targetRegistrations : null,
    targetCpa,
    source,
  }
}

function getOverallTargets(plans: BudgetPlan[]) {
  const overallPlans = plans.filter((plan) => plan.scope_type === 'overall')
  if (overallPlans.length > 0) return buildTargetsFromPlans(overallPlans, 'overall')

  const mediaPlans = plans.filter((plan) => plan.scope_type === 'media')
  if (mediaPlans.length > 0) return buildTargetsFromPlans(mediaPlans, 'media')

  const sitePlans = plans.filter((plan) => plan.scope_type === 'site')
  if (sitePlans.length > 0) return buildTargetsFromPlans(sitePlans, 'site')

  return buildTargetsFromPlans([], 'none')
}

function getEntityTargets(plans: BudgetPlan[], scopeType: 'media' | 'site', id: number) {
  const idKey = scopeType === 'media' ? 'media_id' : 'site_id'
  return buildTargetsFromPlans(
    plans.filter((plan) => plan.scope_type === scopeType && plan[idKey] === id),
    scopeType
  )
}

function makeMetric(
  current: number | null,
  forecast: number | null,
  target: number | null,
  metricType: 'cost' | 'registrations' | 'cpa'
) {
  const targetMissing = target === null || target <= 0
  const diff = !targetMissing && forecast !== null ? forecast - target : null
  const forecastRatio = !targetMissing && forecast !== null ? forecast / target : null
  const currentRatio = !targetMissing && current !== null ? current / target : null
  const status: ForecastStatus = targetMissing
    ? 'target_missing'
    : forecast === null
      ? 'neutral'
      : metricType === 'registrations'
        ? forecast >= target ? 'good' : 'bad'
        : forecast <= target ? 'good' : 'bad'

  return {
    current,
    forecast,
    target,
    diff,
    current_ratio: currentRatio,
    forecast_ratio: forecastRatio,
    target_ratio: targetMissing ? null : 1,
    status,
    target_missing: targetMissing,
  }
}

function buildForecastBlock(
  actual: ActualTotals,
  targets: ForecastTargets,
  forecastMultiplier: number | null
) {
  const currentCost = actual.cost
  const currentRegistrations = actual.registrations
  const currentCpa = divideOrNull(currentCost, currentRegistrations)
  const forecastCost = forecastMultiplier === null ? null : currentCost * forecastMultiplier
  const forecastRegistrations = forecastMultiplier === null
    ? null
    : Math.round(currentRegistrations * forecastMultiplier)
  const forecastCpa = divideOrNull(forecastCost, forecastRegistrations)

  return {
    target_source: targets.source,
    cost: makeMetric(currentCost, forecastCost, targets.monthlyBudget, 'cost'),
    registrations: makeMetric(currentRegistrations, forecastRegistrations, targets.targetRegistrations, 'registrations'),
    cpa: makeMetric(currentCpa, forecastCpa, targets.targetCpa, 'cpa'),
  }
}

function getForecastContext(
  monthInfo: ReturnType<typeof getMonthInfo>,
  latestActualDate: string | null
) {
  if (monthInfo.mode === 'future_month') {
    return {
      mode: 'future_month' as ForecastMode,
      cutoffDate: null,
      elapsedDays: 0,
      multiplier: null,
      elapsedBasis: 'future_month',
    }
  }

  if (monthInfo.mode === 'past_month') {
    return {
      mode: 'past_month' as ForecastMode,
      cutoffDate: monthInfo.endDate,
      elapsedDays: monthInfo.daysInMonth,
      multiplier: 1,
      elapsedBasis: 'full_month',
    }
  }

  if (!latestActualDate) {
    return {
      mode: 'no_actual' as ForecastMode,
      cutoffDate: null,
      elapsedDays: 0,
      multiplier: null,
      elapsedBasis: 'no_actual',
    }
  }

  const cutoffDate = latestActualDate < monthInfo.today ? latestActualDate : monthInfo.today
  const elapsedDays = Math.max(1, dayOfMonth(cutoffDate) ?? 1)

  return {
    mode: 'current_month' as ForecastMode,
    cutoffDate,
    elapsedDays,
    multiplier: monthInfo.daysInMonth / elapsedDays,
    elapsedBasis: latestActualDate < monthInfo.today ? 'latest_actual_date' : 'today',
  }
}

forecastRoute.get('/', async (c) => {
  const year = parseYear(c.req.query('year') ?? null)
  const month = parseMonth(c.req.query('month') ?? null)
  const monthInfo = getMonthInfo(year, month)
  const [plans, masters, latestActualDate] = await Promise.all([
    fetchBudgetPlans(c.env.DB, monthInfo.targetMonth),
    fetchMasters(c.env.DB),
    fetchLatestActualDate(c.env.DB, monthInfo.startDate, monthInfo.endDate),
  ])
  const context = getForecastContext(monthInfo, latestActualDate)

  const emptyActual: ActualTotals = { cost: 0, registrations: 0 }
  const [overallActual, mediaActuals, siteActuals] = context.cutoffDate
    ? await Promise.all([
      fetchActualTotals(c.env.DB, monthInfo.startDate, context.cutoffDate),
      fetchGroupActuals(c.env.DB, monthInfo.startDate, context.cutoffDate, 'media'),
      fetchGroupActuals(c.env.DB, monthInfo.startDate, context.cutoffDate, 'site'),
    ])
    : [emptyActual, [], []]

  const mediaActualMap = new Map(mediaActuals.map((row) => [row.id, row]))
  const siteActualMap = new Map(siteActuals.map((row) => [row.id, row]))
  const mediaPlansWithBudget = new Set(
    plans
      .filter((plan) => plan.scope_type === 'media' && plan.media_id !== null)
      .map((plan) => plan.media_id)
  )
  const sitePlansWithBudget = new Set(
    plans
      .filter((plan) => plan.scope_type === 'site' && plan.site_id !== null)
      .map((plan) => plan.site_id)
  )

  const mediaForecasts = masters.media
    .filter((media) => {
      const actual = mediaActualMap.get(media.id)
      const hasActual = Boolean(actual && (actual.cost > 0 || actual.registrations > 0))
      const hasBudget = mediaPlansWithBudget.has(media.id)
      return media.status === 'active' || hasActual || hasBudget
    })
    .map((media) => ({
      media_id: media.id,
      media_name: media.media_name,
      media_status: media.status,
      ...buildForecastBlock(
        mediaActualMap.get(media.id) ?? emptyActual,
        getEntityTargets(plans, 'media', media.id),
        context.multiplier
      ),
    }))

  const siteForecasts = masters.sites.map((site) => ({
    site_id: site.id,
    site_name: site.site_name,
    ...buildForecastBlock(
      siteActualMap.get(site.id) ?? emptyActual,
      getEntityTargets(plans, 'site', site.id),
      context.multiplier
    ),
  })).filter((site) => {
    const actual = siteActualMap.get(site.site_id)
    return Boolean(actual && (actual.cost > 0 || actual.registrations > 0)) ||
      sitePlansWithBudget.has(site.site_id)
  })

  return c.json<ApiResponse<Record<string, unknown>>>({
    success: true,
    data: {
      target_year: year,
      target_month_number: month,
      target_month: monthInfo.targetMonth,
      days_in_month: monthInfo.daysInMonth,
      elapsed_days: context.elapsedDays,
      elapsed_basis: context.elapsedBasis,
      latest_actual_date: latestActualDate,
      cutoff_date: context.cutoffDate,
      mode: context.mode,
      overall: buildForecastBlock(
        overallActual,
        getOverallTargets(plans),
        context.multiplier
      ),
      media_forecasts: mediaForecasts,
      site_forecasts: siteForecasts,
      notes: {
        overall_target_source: getOverallTargets(plans).source,
        unlinked_site_policy: 'site_idを特定できない実績は全体には含め、サイト別には配賦しません',
      },
    },
  })
})
