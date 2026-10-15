// ============================================================
// 読み込み用スプレッドシートからの同期
// 定時実行（Worker の Cron）と画面の「今すぐ同期」の両方から呼ばれる。
// タブごとに安全チェック → importRows で期間を置き換え、結果を記録する。
// ============================================================
import type { UploadFileType } from '../types'
import { fetchAppSettings, type AppSettings } from './settings'
import { extractSpreadsheetId, fetchSheetTabs, type SheetTabValues } from './google-sheets'
import {
  ImportError,
  importRows,
  isUploadFileTypeEnabled,
  type CsvRows,
  type ImportDateRange,
  type UploadDataSource,
} from './import-service'

export type SheetSyncTrigger = 'cron' | 'manual'
export type SheetSyncRunStatus = 'running' | 'success' | 'partial' | 'failed'
export type SheetSyncTabStatus = 'imported' | 'skipped' | 'failed'

export type SheetSyncEnv = {
  DB: D1Database
  GOOGLE_SERVICE_ACCOUNT_JSON?: string
}

// 取得済みの行データを渡せるようにしておく（ローカル検証・テスト用）
export type SheetTabFetcher = (spreadsheetId: string, tabNames: string[]) => Promise<SheetTabValues>

export type SheetSyncSource = {
  id: number
  source_type: UploadFileType
  media_id: number | null
  data_source: UploadDataSource | null
  tab_name: string
  is_active: number
  media_name: string | null
  media_status: string | null
}

export type SheetSyncTabResult = {
  source_id: number
  tab_name: string
  status: SheetSyncTabStatus
  row_count: number
  date_from: string | null
  date_to: string | null
  reason: string | null
  upload_history_id: number | null
}

export type SheetSyncOutcome = {
  started: boolean
  run_id: number | null
  status: SheetSyncRunStatus | null
  date_from: string | null
  date_to: string | null
  message: string | null
  results: SheetSyncTabResult[]
}

// 実行中のまま残った run をこの時間で打ち切る（Worker が途中で落ちた場合の救済）
const STALE_RUN_MINUTES = 15

const SHEET_ERROR_VALUES = ['#REF!', '#N/A', '#ERROR!', '#VALUE!', '#NAME?', 'Loading...']

export const SITE_SYNC_SOURCES: Array<{ source_type: UploadFileType; data_source: UploadDataSource; label: string }> = [
  { source_type: 'site_summary_csv', data_source: 'YNS', label: 'YNS 媒体集計' },
  { source_type: 'payment_report_csv', data_source: 'YNS', label: 'YNS 決済レポート' },
  { source_type: 'site_summary_csv', data_source: 'INTERNAL', label: '自社 媒体集計' },
  { source_type: 'payment_report_csv', data_source: 'INTERNAL', label: '自社 決済レポート' },
]

function logSyncInfo(message: string, details: Record<string, unknown>) {
  console.info(`[sheet-sync] ${message}`, details)
}

function logSyncError(message: string, details: Record<string, unknown>) {
  console.error(`[sheet-sync] ${message}`, details)
}

function toYmd(date: Date) {
  return date.toISOString().slice(0, 10)
}

// JST で「(months - 1) か月前の1日〜今日」
export function computeSyncDateRange(now: Date, months: number): ImportDateRange {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const monthCount = Math.max(1, Math.floor(months) || 1)
  const from = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - (monthCount - 1), 1))
  return { from: toYmd(from), to: toYmd(jst) }
}

export function getSheetSyncSettings(settings: AppSettings) {
  const group = settings.sheet_sync ?? {}
  return {
    enabled: group.enabled === true,
    spreadsheetId: extractSpreadsheetId(group.spreadsheet_id),
    monthsToSync: Number(group.months_to_sync) || 2,
    minRowRatio: Number(group.min_row_ratio ?? 0.5),
  }
}

export function findSheetErrorValue(rows: CsvRows) {
  for (const row of rows) {
    for (const cell of row) {
      const value = String(cell ?? '').trim()
      const found = SHEET_ERROR_VALUES.find((token) => value === token || value.startsWith(token))
      if (found) return found
    }
  }
  return null
}

function isBlankRow(row: string[] | undefined) {
  return !row || row.every((cell) => String(cell ?? '').trim() === '')
}

export async function fetchSyncSources(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT s.id, s.source_type, s.media_id, s.data_source, s.tab_name, s.is_active,
            m.media_name, m.status AS media_status
     FROM sheet_sync_sources s
     LEFT JOIN media_master m ON s.media_id = m.id
     ORDER BY s.source_type = 'ad_media_csv' DESC, m.media_name ASC, s.source_type ASC, s.data_source ASC`
  ).all<SheetSyncSource>()
  return results
}

// 同期対象：タブ名あり・有効・（広告媒体は稼働中）・取込種別が設定で有効
function selectTargetSources(sources: SheetSyncSource[], settings: AppSettings) {
  return sources.filter((source) => {
    if (!source.is_active || !source.tab_name.trim()) return false
    if (!isUploadFileTypeEnabled(source.source_type, settings)) return false
    if (source.source_type === 'ad_media_csv') {
      return source.media_id !== null && source.media_status === 'active'
    }
    return source.data_source !== null
  })
}

function sourceLabel(source: SheetSyncSource) {
  if (source.source_type === 'ad_media_csv') return source.media_name ?? `媒体#${source.media_id}`
  return SITE_SYNC_SOURCES.find(
    (item) => item.source_type === source.source_type && item.data_source === source.data_source
  )?.label ?? source.source_type
}

async function startRun(db: D1Database, trigger: SheetSyncTrigger, range: ImportDateRange) {
  await db.prepare(
    `UPDATE sheet_sync_runs
     SET status = 'failed',
         finished_at = CURRENT_TIMESTAMP,
         error_message = ?
     WHERE status = 'running'
       AND started_at < datetime('now', ?)`
  )
    .bind(`${STALE_RUN_MINUTES}分以上終了しなかったため打ち切りました`, `-${STALE_RUN_MINUTES} minutes`)
    .run()

  // 実行中の run がなければ開始する（判定と登録を1文で行い、同時実行を防ぐ）
  const result = await db.prepare(
    `INSERT INTO sheet_sync_runs (trigger, status, date_from, date_to)
     SELECT ?, 'running', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM sheet_sync_runs WHERE status = 'running')`
  )
    .bind(trigger, range.from, range.to)
    .run()

  if (Number(result.meta?.changes ?? 0) === 0) return null
  const id = Number(result.meta?.last_row_id)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function finishRun(db: D1Database, runId: number, status: SheetSyncRunStatus, errorMessage: string | null) {
  await db.prepare(
    `UPDATE sheet_sync_runs
     SET status = ?, finished_at = CURRENT_TIMESTAMP, error_message = ?
     WHERE id = ?`
  )
    .bind(status, errorMessage, runId)
    .run()
}

async function saveTabResult(db: D1Database, runId: number, result: SheetSyncTabResult) {
  await db.prepare(
    `INSERT INTO sheet_sync_tab_results
       (run_id, source_id, tab_name, status, row_count, date_from, date_to, reason, upload_history_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      runId,
      result.source_id,
      result.tab_name,
      result.status,
      result.row_count,
      result.date_from,
      result.date_to,
      result.reason,
      result.upload_history_id
    )
    .run()
}

async function syncTab(
  db: D1Database,
  source: SheetSyncSource,
  rows: CsvRows | null | undefined,
  range: ImportDateRange,
  minRowRatio: number
): Promise<SheetSyncTabResult> {
  const base = {
    source_id: source.id,
    tab_name: source.tab_name,
    row_count: 0,
    date_from: null,
    date_to: null,
    upload_history_id: null,
  }
  const skip = (reason: string): SheetSyncTabResult => ({ ...base, status: 'skipped', reason })

  if (!rows) return skip('タブが見つかりません')
  if (rows.length === 0 || isBlankRow(rows[0])) return skip('1行目（ヘッダー）が空です')

  const errorValue = findSheetErrorValue(rows)
  if (errorValue) {
    return skip(`「${errorValue}」を含むセルがあります（IMPORTRANGE の更新中または失敗）`)
  }

  try {
    const imported = await importRows(db, {
      fileType: source.source_type,
      mediaId: source.media_id,
      dataSource: source.data_source ?? 'YNS',
      rows,
      fileName: `sheet:${source.tab_name}`,
      importMethod: 'sheet_sync',
      dateRange: range,
      minRowRatio,
    })

    const warning = imported.warnings
      .map((item) => item.type === 'unregistered_ad_codes'
        ? `未登録の広告コード ${item.count}件は取り込んでいません（${item.ad_codes.slice(0, 5).join(', ')}${item.count > 5 ? ' ほか' : ''}）`
        : item.message)
      .join(' / ')

    return {
      ...base,
      status: 'imported',
      row_count: imported.rowCount,
      date_from: imported.dateRange?.minDate ?? null,
      date_to: imported.dateRange?.maxDate ?? null,
      reason: warning || null,
      upload_history_id: imported.uploadHistoryId,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ImportError && err.stage === 'validate') return skip(message)
    logSyncError('tab import failed', { tab: source.tab_name, error: message })
    return { ...base, status: 'failed', reason: message }
  }
}

export async function runSheetSync(
  env: SheetSyncEnv,
  trigger: SheetSyncTrigger,
  options: { fetchTabs?: SheetTabFetcher; now?: Date } = {}
): Promise<SheetSyncOutcome> {
  const db = env.DB
  const settings = await fetchAppSettings(db)
  const config = getSheetSyncSettings(settings)
  const range = computeSyncDateRange(options.now ?? new Date(), config.monthsToSync)
  const notStarted = (message: string): SheetSyncOutcome => ({
    started: false,
    run_id: null,
    status: null,
    date_from: range.from,
    date_to: range.to,
    message,
    results: [],
  })

  if (!config.enabled) return notStarted('スプレッドシート同期が無効になっています（設定画面で有効にしてください）')
  if (!config.spreadsheetId) return notStarted('スプレッドシートIDが設定されていません')

  const runId = await startRun(db, trigger, range)
  if (!runId) return notStarted('別の同期が実行中です。終了してからもう一度お試しください')

  logSyncInfo('run started', { runId, trigger, ...range })

  const results: SheetSyncTabResult[] = []
  let status: SheetSyncRunStatus = 'failed'
  let errorMessage: string | null = null

  try {
    const sources = selectTargetSources(await fetchSyncSources(db), settings)
    if (sources.length === 0) {
      throw new Error('読み込むタブが設定されていません（媒体マスタ・設定画面でタブ名を設定してください）')
    }

    const fetchTabs: SheetTabFetcher = options.fetchTabs
      ?? ((spreadsheetId, tabNames) => fetchSheetTabs(env.GOOGLE_SERVICE_ACCOUNT_JSON, spreadsheetId, tabNames))
    const tabValues = await fetchTabs(config.spreadsheetId, sources.map((source) => source.tab_name))

    // 1タブの失敗が他のタブに影響しないよう、タブごとに完結させる
    for (const source of sources) {
      const result = await syncTab(db, source, tabValues.get(source.tab_name), range, config.minRowRatio)
      results.push(result)
      await saveTabResult(db, runId, result)
      logSyncInfo('tab finished', {
        runId,
        source: sourceLabel(source),
        tab: result.tab_name,
        status: result.status,
        rows: result.row_count,
        reason: result.reason,
      })
    }

    const importedCount = results.filter((result) => result.status === 'imported').length
    status = importedCount === results.length ? 'success' : importedCount === 0 ? 'failed' : 'partial'
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    status = 'failed'
    logSyncError('run failed', { runId, error: errorMessage })
  } finally {
    await finishRun(db, runId, status, errorMessage)
  }

  logSyncInfo('run finished', { runId, status })

  return {
    started: true,
    run_id: runId,
    status,
    date_from: range.from,
    date_to: range.to,
    message: errorMessage,
    results,
  }
}
