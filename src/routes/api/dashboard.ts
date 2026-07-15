// ============================================================
// ダッシュボード API（/api/dashboard）
// 毎朝最初に見る「今日やること」用に、実データを1APIで集約する。
// ============================================================
import { Hono } from 'hono'
import type { ApiResponse, Bindings, MediaStatus } from '../../types'
import { fetchAppSettings } from '../../lib/settings'

export const dashboardRoute = new Hono<{ Bindings: Bindings }>()

type BudgetScope = 'overall' | 'media' | 'site' | 'ad_code'

type BudgetPlan = {
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

type MediaMasterRow = {
  id: number
  media_name: string
  status: MediaStatus
}

type SiteMasterRow = {
  id: number
  site_name: string
}

type TargetTotals = {
  monthlyBudget: number | null
  targetRegistrations: number | null
  targetCpa: number | null
  targetRevenue: number | null
  targetRecoveryRate: number | null
}

type ForecastMetric = {
  current: number | null
  forecast: number | null
  target: number | null
  achievement_rate: number | null
  status: 'good' | 'bad' | 'neutral' | 'target_missing'
}

type DashboardAlert = {
  level: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  route: string
}

type DashboardTodo = {
  text: string
  route: string
  level: 'critical' | 'warning' | 'info'
}

const DAY_MS = 86400000

function toNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function divideOrNull(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) return null
  return numerator / denominator
}

function tableNameSafe(tableName: string) {
  return /^[a-zA-Z0-9_]+$/.test(tableName)
}

async function tableHasColumns(db: D1Database, tableName: string, requiredColumns: string[]) {
  if (!tableNameSafe(tableName)) return false
  const { results } = await db.prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>()
  const columns = new Set(results.map((row) => row.name))
  return requiredColumns.every((column) => columns.has(column))
}

function getTokyoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

function getMonthInfo() {
  const todayParts = getTokyoDateParts()
  const start = new Date(Date.UTC(todayParts.year, todayParts.month - 1, 1))
  const end = new Date(Date.UTC(todayParts.year, todayParts.month, 0))
  const today = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
  const daysInMonth = end.getUTCDate()

  return {
    targetMonth: `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}`,
    startDate: formatDate(start),
    endDate: formatDate(end),
    today,
    yesterday: shiftDate(today, -1),
    daysInMonth,
    elapsedDays: Math.max(1, todayParts.day),
    daysRemaining: Math.max(0, daysInMonth - todayParts.day),
  }
}

async function fetchBudgetPlans(db: D1Database, targetMonth: string) {
  const hasBudgetTable = await tableHasColumns(db, 'budget_plans', [
    'target_month',
    'scope_type',
    'monthly_budget',
    'target_cpa',
    'target_recovery_rate',
  ])
  if (!hasBudgetTable) return []

  const { results } = await db.prepare(
    `SELECT
       b.id, b.target_month, b.scope_type, b.media_id, m.media_name,
       b.site_id, s.site_name, b.ad_code, b.monthly_budget,
       b.target_cpa, b.target_recovery_rate
     FROM budget_plans b
     LEFT JOIN media_master m ON b.media_id = m.id
     LEFT JOIN site_master s ON b.site_id = s.id
     WHERE b.target_month = ?`
  )
    .bind(targetMonth)
    .all<BudgetPlan>()

  return results.map((plan) => ({
    ...plan,
    monthly_budget: toNumber(plan.monthly_budget),
    target_cpa: toNumber(plan.target_cpa),
    target_recovery_rate: toNumber(plan.target_recovery_rate),
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

async function paymentReportAvailable(db: D1Database) {
  return tableHasColumns(db, 'payment_report_daily', [
    'registration_date',
    'customer_id',
    'ad_code',
    'payment_count',
    'payment_amount',
    'media_id',
  ])
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
        COALESCE((
          SELECT sm.site_name
          FROM campaign_master c
          LEFT JOIN site_master sm ON c.site_id = sm.id
          WHERE c.ad_code = p.ad_code
            AND (p.media_id IS NULL OR c.media_id = p.media_id)
          ORDER BY c.id ASC
          LIMIT 1
        ), p.site_name, '') AS site_name,
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

function actualBindings(startDate: string, endDate: string, hasPayment: boolean) {
  const bindings = [startDate, endDate, startDate, endDate]
  if (hasPayment) bindings.push(startDate, endDate)
  return bindings
}

function normalizeActual(row: Partial<ActualTotals> | null | undefined): ActualTotals {
  return {
    cost: toNumber(row?.cost),
    registrations: toNumber(row?.registrations),
    revenue: toNumber(row?.revenue),
    payer_count: toNumber(row?.payer_count),
  }
}

async function fetchActualTotals(
  db: D1Database,
  startDate: string,
  endDate: string,
  hasPayment: boolean
) {
  const row = await db.prepare(
    `${actualRowsCte(hasPayment)}
     SELECT
       COALESCE(SUM(cost), 0) AS cost,
       COALESCE(SUM(registrations), 0) AS registrations,
       COALESCE(SUM(revenue), 0) AS revenue,
       COUNT(DISTINCT payer_key) AS payer_count
     FROM actual_rows`
  )
    .bind(...actualBindings(startDate, endDate, hasPayment))
    .first<ActualTotals>()

  return normalizeActual(row)
}

async function fetchActualGroups(
  db: D1Database,
  startDate: string,
  endDate: string,
  hasPayment: boolean,
  groupBy: 'media' | 'site'
) {
  const idColumn = groupBy === 'media' ? 'media_id' : 'site_id'
  const nameColumn = groupBy === 'media' ? 'media_name' : 'site_name'
  const { results } = await db.prepare(
    `${actualRowsCte(hasPayment)}
     SELECT
       ${idColumn} AS id,
       COALESCE(NULLIF(${nameColumn}, ''), '未設定') AS name,
       COALESCE(SUM(cost), 0) AS cost,
       COALESCE(SUM(registrations), 0) AS registrations,
       COALESCE(SUM(revenue), 0) AS revenue,
       COUNT(DISTINCT payer_key) AS payer_count
     FROM actual_rows
     WHERE ${idColumn} IS NOT NULL
     GROUP BY ${idColumn}, name`
  )
    .bind(...actualBindings(startDate, endDate, hasPayment))
    .all<ActualGroupRow>()

  return results.map((row) => ({ ...normalizeActual(row), id: row.id, name: row.name }))
}

async function fetchUploadStatus(db: D1Database, today: string) {
  const [activeMediaResult, uploadsResult] = await Promise.all([
    db.prepare(
      `SELECT id, media_name, status
       FROM media_master
       WHERE status = 'active'
       ORDER BY id ASC`
    ).all<MediaMasterRow>(),
    db.prepare(
      `SELECT file_type, media_id, COUNT(*) AS count
       FROM upload_history
       WHERE target_date = ?
         AND status = 'success'
       GROUP BY file_type, media_id`
    )
      .bind(today)
      .all<{ file_type: string; media_id: number | null; count: number }>(),
  ])

  const uploadKeys = new Set(
    uploadsResult.results.map((row) => `${row.file_type}:${row.media_id ?? 'common'}`)
  )
  const activeMedia = activeMediaResult.results
  const missingAdMedia = activeMedia.filter(
    (media) => !uploadKeys.has(`ad_media_csv:${media.id}`)
  )

  return {
    activeMediaCount: activeMedia.length,
    missingAdMedia,
    hasSiteSummary: uploadKeys.has('site_summary_csv:common'),
    hasPaymentReport: uploadKeys.has('payment_report_csv:common'),
  }
}

function buildTargets(plans: BudgetPlan[]): TargetTotals {
  if (plans.length === 0) {
    return {
      monthlyBudget: null,
      targetRegistrations: null,
      targetCpa: null,
      targetRevenue: null,
      targetRecoveryRate: null,
    }
  }

  const monthlyBudget = plans.reduce((total, plan) => total + plan.monthly_budget, 0)
  const targetRegistrations = plans.reduce(
    (total, plan) => total + (plan.target_cpa > 0 ? plan.monthly_budget / plan.target_cpa : 0),
    0
  )
  const targetRevenue = plans.reduce(
    (total, plan) => total + plan.monthly_budget * plan.target_recovery_rate,
    0
  )

  return {
    monthlyBudget: monthlyBudget > 0 ? monthlyBudget : null,
    targetRegistrations: targetRegistrations > 0 ? targetRegistrations : null,
    targetCpa: divideOrNull(monthlyBudget, targetRegistrations),
    targetRevenue: targetRevenue > 0 ? targetRevenue : null,
    targetRecoveryRate: divideOrNull(targetRevenue, monthlyBudget),
  }
}

function chooseOverallPlans(plans: BudgetPlan[]) {
  const overall = plans.filter((plan) => plan.scope_type === 'overall')
  if (overall.length > 0) return overall
  const media = plans.filter((plan) => plan.scope_type === 'media')
  if (media.length > 0) return media
  const site = plans.filter((plan) => plan.scope_type === 'site')
  if (site.length > 0) return site
  return plans
}

function targetPlansForEntity(plans: BudgetPlan[], scopeType: 'media' | 'site', id: number) {
  const key = scopeType === 'media' ? 'media_id' : 'site_id'
  return plans.filter((plan) => plan.scope_type === scopeType && plan[key] === id)
}

function diffRate(today: number | null, yesterday: number | null) {
  if (today === null || yesterday === null || yesterday === 0) return null
  return (today - yesterday) / Math.abs(yesterday)
}

function metricStatus(
  value: number | null,
  target: number | null,
  metricType: 'cost' | 'registrations' | 'cpa' | 'recovery'
) {
  if (target === null || target <= 0) return 'target_missing' as const
  if (value === null) return 'neutral' as const
  if (metricType === 'registrations' || metricType === 'recovery') {
    return value >= target ? 'good' as const : 'bad' as const
  }
  return value <= target ? 'good' as const : 'bad' as const
}

function buildForecastMetric(
  current: number | null,
  forecast: number | null,
  target: number | null,
  metricType: 'cost' | 'registrations' | 'cpa'
): ForecastMetric {
  return {
    current,
    forecast,
    target,
    achievement_rate: divideOrNull(forecast, target),
    status: metricStatus(forecast, target, metricType),
  }
}

function buildForecastSummary(actual: ActualTotals, targets: TargetTotals, multiplier: number) {
  const currentCpa = divideOrNull(actual.cost, actual.registrations)
  const forecastCost = actual.cost * multiplier
  const forecastRegistrations = actual.registrations * multiplier
  const forecastCpa = divideOrNull(forecastCost, forecastRegistrations)

  return {
    cost: buildForecastMetric(actual.cost, forecastCost, targets.monthlyBudget, 'cost'),
    registrations: buildForecastMetric(
      actual.registrations,
      forecastRegistrations,
      targets.targetRegistrations,
      'registrations'
    ),
    cpa: buildForecastMetric(currentCpa, forecastCpa, targets.targetCpa, 'cpa'),
  }
}

function buildKpis(today: ActualTotals, yesterday: ActualTotals) {
  const todayCpa = divideOrNull(today.cost, today.registrations)
  const yesterdayCpa = divideOrNull(yesterday.cost, yesterday.registrations)
  const todayRecovery = divideOrNull(today.revenue, today.cost)
  const yesterdayRecovery = divideOrNull(yesterday.revenue, yesterday.cost)

  return [
    { key: 'cost', label: '広告費', today: today.cost, yesterday: yesterday.cost, diff_rate: diffRate(today.cost, yesterday.cost), route: 'analysis' },
    { key: 'registrations', label: '登録数', today: today.registrations, yesterday: yesterday.registrations, diff_rate: diffRate(today.registrations, yesterday.registrations), route: 'analysis' },
    { key: 'cpa', label: 'CPA', today: todayCpa, yesterday: yesterdayCpa, diff_rate: diffRate(todayCpa, yesterdayCpa), route: 'analysis' },
    { key: 'payer_count', label: '入金者数', today: today.payer_count, yesterday: yesterday.payer_count, diff_rate: diffRate(today.payer_count, yesterday.payer_count), route: 'analysis' },
    { key: 'revenue', label: '売上', today: today.revenue, yesterday: yesterday.revenue, diff_rate: diffRate(today.revenue, yesterday.revenue), route: 'analysis' },
    { key: 'recovery_rate', label: '回収率', today: todayRecovery, yesterday: yesterdayRecovery, diff_rate: diffRate(todayRecovery, yesterdayRecovery), route: 'analysis' },
  ]
}

function buildMonthlySummary(actual: ActualTotals, targets: TargetTotals) {
  const cpa = divideOrNull(actual.cost, actual.registrations)
  const recoveryRate = divideOrNull(actual.revenue, actual.cost)
  return [
    { key: 'cost', label: '広告費', actual: actual.cost, target: targets.monthlyBudget, achievement_rate: divideOrNull(actual.cost, targets.monthlyBudget) },
    { key: 'registrations', label: '登録数', actual: actual.registrations, target: targets.targetRegistrations, achievement_rate: divideOrNull(actual.registrations, targets.targetRegistrations) },
    { key: 'cpa', label: 'CPA', actual: cpa, target: targets.targetCpa, achievement_rate: divideOrNull(cpa, targets.targetCpa) },
    { key: 'payer_count', label: '入金者数', actual: actual.payer_count, target: null, achievement_rate: null },
    { key: 'revenue', label: '売上', actual: actual.revenue, target: targets.targetRevenue, achievement_rate: divideOrNull(actual.revenue, targets.targetRevenue) },
    { key: 'recovery_rate', label: '回収率', actual: recoveryRate, target: targets.targetRecoveryRate, achievement_rate: divideOrNull(recoveryRate, targets.targetRecoveryRate) },
  ]
}

function buildMonthlyProgress(actual: ActualTotals, targets: TargetTotals) {
  const cpa = divideOrNull(actual.cost, actual.registrations)
  return [
    { key: 'cost', label: '広告費', current: actual.cost, target: targets.monthlyBudget, achievement_rate: divideOrNull(actual.cost, targets.monthlyBudget), status: metricStatus(actual.cost, targets.monthlyBudget, 'cost') },
    { key: 'registrations', label: '登録数', current: actual.registrations, target: targets.targetRegistrations, achievement_rate: divideOrNull(actual.registrations, targets.targetRegistrations), status: metricStatus(actual.registrations, targets.targetRegistrations, 'registrations') },
    { key: 'cpa', label: 'CPA', current: cpa, target: targets.targetCpa, achievement_rate: divideOrNull(cpa, targets.targetCpa), status: metricStatus(cpa, targets.targetCpa, 'cpa') },
  ]
}

function buildEntitySummaries(
  masters: Array<{ id: number; name: string }>,
  actuals: ActualGroupRow[],
  plans: BudgetPlan[],
  scopeType: 'media' | 'site',
  multiplier: number
) {
  const actualById = new Map(actuals.map((row) => [row.id, row]))

  return masters
    .map((master) => {
      const actual = actualById.get(master.id) ?? {
        id: master.id,
        name: master.name,
        cost: 0,
        registrations: 0,
        revenue: 0,
        payer_count: 0,
      }
      const targets = buildTargets(targetPlansForEntity(plans, scopeType, master.id))
      const currentCpa = divideOrNull(actual.cost, actual.registrations)
      const forecastCpa = divideOrNull(actual.cost * multiplier, actual.registrations * multiplier)
      const judgement = judgeEntity(actual, targets, forecastCpa)

      return {
        id: master.id,
        name: master.name,
        cost: actual.cost,
        registrations: actual.registrations,
        current_cpa: currentCpa,
        target_cpa: targets.targetCpa,
        forecast_cpa: forecastCpa,
        judgement: judgement.label,
        judgement_level: judgement.level,
      }
    })
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'ja'))
}

function judgeEntity(actual: ActualTotals, targets: TargetTotals, forecastCpa: number | null) {
  if (actual.registrations === 0 && actual.cost > 0) {
    return { label: '要確認', level: 'critical' }
  }
  if (targets.monthlyBudget && actual.cost > targets.monthlyBudget) {
    return { label: '注意', level: 'warning' }
  }
  if (targets.targetCpa && forecastCpa && forecastCpa > targets.targetCpa) {
    return { label: '要確認', level: 'warning' }
  }
  if (targets.targetCpa && forecastCpa && forecastCpa <= targets.targetCpa) {
    return { label: '順調', level: 'good' }
  }
  return { label: '確認', level: 'neutral' }
}

function buildAlerts(
  actual: ActualTotals,
  targets: TargetTotals,
  forecast: ReturnType<typeof buildForecastSummary>,
  uploadStatus: Awaited<ReturnType<typeof fetchUploadStatus>>,
  settings: Awaited<ReturnType<typeof fetchAppSettings>>
) {
  const alerts: DashboardAlert[] = []
  const currentCpa = divideOrNull(actual.cost, actual.registrations)
  const alertSettings = settings.alerts ?? {}
  const cpaWarningRate = toNumber(alertSettings.cpa_warning_rate) || 1.1
  const cpaCriticalRate = toNumber(alertSettings.cpa_critical_rate) || 1.2
  const registrationWarningRate = toNumber(alertSettings.registration_warning_rate) || 0.9
  const registrationCriticalRate = toNumber(alertSettings.registration_critical_rate) || 0.8
  const budgetWarningRate = toNumber(alertSettings.budget_warning_rate) || 1.05
  const budgetCriticalRate = toNumber(alertSettings.budget_critical_rate) || 1.1

  if (targets.targetCpa && currentCpa && currentCpa > targets.targetCpa * cpaWarningRate) {
    alerts.push({
      level: currentCpa > targets.targetCpa * cpaCriticalRate ? 'critical' : 'warning',
      title: 'CPA超過',
      detail: `月間CPAが設定閾値を超えています`,
      route: 'analysis',
    })
  }
  if (
    targets.targetRegistrations &&
    forecast.registrations.forecast !== null &&
    forecast.registrations.forecast < targets.targetRegistrations * registrationWarningRate
  ) {
    alerts.push({
      level: forecast.registrations.forecast < targets.targetRegistrations * registrationCriticalRate ? 'critical' : 'warning',
      title: '登録不足',
      detail: '現在のペースでは登録数が目標未達見込みです',
      route: 'forecast',
    })
  }
  if (
    targets.monthlyBudget &&
    forecast.cost.forecast !== null &&
    forecast.cost.forecast > targets.monthlyBudget * budgetWarningRate
  ) {
    alerts.push({
      level: forecast.cost.forecast > targets.monthlyBudget * budgetCriticalRate ? 'critical' : 'warning',
      title: '予算超過見込み',
      detail: '月末着地が設定した予算閾値を超える見込みです',
      route: 'forecast',
    })
  }
  if (
    (alertSettings.warn_missing_ad_media_csv !== false && uploadStatus.missingAdMedia.length > 0) ||
    (alertSettings.warn_missing_site_summary_csv !== false && !uploadStatus.hasSiteSummary)
  ) {
    alerts.push({
      level: 'warning',
      title: 'CSV未取込',
      detail: `本日未取込のCSVがあります`,
      route: 'data-import',
    })
  }
  if (alertSettings.warn_missing_payment_report_csv !== false && !uploadStatus.hasPaymentReport) {
    alerts.push({
      level: 'info',
      title: '決済CSV未取込',
      detail: '本日の決済レポートCSVが未取込です',
      route: 'data-import',
    })
  }

  return alerts.slice(0, 5)
}

function buildTodos(
  mediaSummaries: ReturnType<typeof buildEntitySummaries>,
  uploadStatus: Awaited<ReturnType<typeof fetchUploadStatus>>,
  alerts: DashboardAlert[]
) {
  const todos: DashboardTodo[] = []
  const problemMedia = mediaSummaries
    .filter((row) => row.judgement_level === 'critical' || row.judgement_level === 'warning')
    .slice(0, 3)

  for (const row of problemMedia) {
    todos.push({
      text: `${row.name} CPA確認`,
      route: 'analysis',
      level: row.judgement_level === 'critical' ? 'critical' : 'warning',
    })
  }

  if (uploadStatus.missingAdMedia.length > 0) {
    todos.push({
      text: `${uploadStatus.missingAdMedia[0].media_name} 広告媒体CSVアップロード`,
      route: 'data-import',
      level: 'warning',
    })
  }
  if (!uploadStatus.hasSiteSummary) {
    todos.push({
      text: '媒体集計CSV未更新',
      route: 'data-import',
      level: 'warning',
    })
  }
  if (!uploadStatus.hasPaymentReport) {
    todos.push({
      text: '決済CSVアップロード',
      route: 'data-import',
      level: 'info',
    })
  }
  if (todos.length === 0 && alerts.length === 0) {
    todos.push({
      text: '主要KPIと着地予測を確認',
      route: 'forecast',
      level: 'info',
    })
  }

  return todos.slice(0, 6)
}

dashboardRoute.get('/summary', async (c) => {
  const monthInfo = getMonthInfo()
  const hasPayment = await paymentReportAvailable(c.env.DB)
  const [settings, plans, masters, todayActual, yesterdayActual, monthlyActual, mediaActuals, siteActuals, uploadStatus] =
    await Promise.all([
      fetchAppSettings(c.env.DB),
      fetchBudgetPlans(c.env.DB, monthInfo.targetMonth),
      fetchMasters(c.env.DB),
      fetchActualTotals(c.env.DB, monthInfo.today, monthInfo.today, hasPayment),
      fetchActualTotals(c.env.DB, monthInfo.yesterday, monthInfo.yesterday, hasPayment),
      fetchActualTotals(c.env.DB, monthInfo.startDate, monthInfo.today, hasPayment),
      fetchActualGroups(c.env.DB, monthInfo.startDate, monthInfo.today, hasPayment, 'media'),
      fetchActualGroups(c.env.DB, monthInfo.startDate, monthInfo.today, hasPayment, 'site'),
      fetchUploadStatus(c.env.DB, monthInfo.today),
    ])

  const targets = buildTargets(chooseOverallPlans(plans))
  const multiplier = monthInfo.daysInMonth / monthInfo.elapsedDays
  const forecast = buildForecastSummary(monthlyActual, targets, multiplier)
  const mediaSummaries = buildEntitySummaries(
    masters.media.map((media) => ({ id: media.id, name: media.media_name })),
    mediaActuals,
    plans,
    'media',
    multiplier
  )
  const siteSummaries = buildEntitySummaries(
    masters.sites.map((site) => ({ id: site.id, name: site.site_name })),
    siteActuals,
    plans,
    'site',
    multiplier
  )
  const alerts = buildAlerts(monthlyActual, targets, forecast, uploadStatus, settings)

  const data = {
    generated_at: new Date().toISOString(),
    target_month: monthInfo.targetMonth,
    today: monthInfo.today,
    yesterday: monthInfo.yesterday,
    days_in_month: monthInfo.daysInMonth,
    elapsed_days: monthInfo.elapsedDays,
    days_remaining: monthInfo.daysRemaining,
    kpis: buildKpis(todayActual, yesterdayActual),
    monthly_summary: buildMonthlySummary(monthlyActual, targets),
    forecast_summary: forecast,
    alerts,
    todos: buildTodos(mediaSummaries, uploadStatus, alerts),
    monthly_progress: buildMonthlyProgress(monthlyActual, targets),
    media_summary: mediaSummaries,
    site_summary: siteSummaries,
    data_status: {
      payment_report_available: hasPayment,
      active_media_count: uploadStatus.activeMediaCount,
      missing_ad_media_count: uploadStatus.missingAdMedia.length,
      site_summary_uploaded_today: uploadStatus.hasSiteSummary,
      payment_report_uploaded_today: uploadStatus.hasPaymentReport,
    },
    settings: {
      dashboard: settings.dashboard,
    },
  }

  return c.json<ApiResponse<typeof data>>({ success: true, data })
})
