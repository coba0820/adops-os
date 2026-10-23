import { Hono } from 'hono'
import type { ApiResponse, Bindings, UploadFileType } from '../../types'
import { fetchAppSettings } from '../../lib/settings'
import { parseUploadDataSource, parseUploadFileType, type CsvRows } from '../../lib/import-service'
import {
  extractSpreadsheetId,
  fetchSpreadsheetOverview,
  normalizeSheetValues,
  type SheetTabValues,
  type SpreadsheetOverview,
} from '../../lib/google-sheets'
import {
  SITE_SYNC_SOURCES,
  TARGET_MONTH_PATTERN,
  buildConnectionReport,
  computeSyncDateRange,
  currentJstMonth,
  fetchMonthlySpreadsheets,
  fetchSyncSources,
  getSheetSyncSettings,
  runSheetSync,
  selectTargetSources,
  splitRangeByMonth,
  type SheetTabFetcher,
} from '../../lib/sheet-sync'

export const sheetSyncRoute = new Hono<{ Bindings: Bindings }>()

type RunRow = {
  id: number
  trigger: string
  status: string
  date_from: string | null
  date_to: string | null
  started_at: string
  finished_at: string | null
  error_message: string | null
}

type TabResultRow = {
  id: number
  run_id: number
  source_id: number | null
  target_month: string | null
  tab_name: string
  status: string
  row_count: number
  date_from: string | null
  date_to: string | null
  reason: string | null
  upload_history_id: number | null
  source_type: string | null
  data_source: string | null
  media_id: number | null
  media_name: string | null
}

const RUN_COLUMNS = 'id, trigger, status, date_from, date_to, started_at, finished_at, error_message'

function isTestMode(env: Bindings) {
  return env.SHEET_SYNC_TEST_MODE === 'true'
}

async function fetchTabResults(db: D1Database, runId: number) {
  const { results } = await db.prepare(
    `SELECT r.id, r.run_id, r.source_id, r.target_month, r.tab_name, r.status, r.row_count,
            r.date_from, r.date_to, r.reason, r.upload_history_id,
            s.source_type, s.data_source, s.media_id, m.media_name
     FROM sheet_sync_tab_results r
     LEFT JOIN sheet_sync_sources s ON r.source_id = s.id
     LEFT JOIN media_master m ON s.media_id = m.id
     WHERE r.run_id = ?
     ORDER BY r.id ASC`
  )
    .bind(runId)
    .all<TabResultRow>()
  return results
}

// ------------------------------------------------------------
// GET /api/sheet-sync/status : 最新の run とタブ別結果、設定の有効状態
// ------------------------------------------------------------
sheetSyncRoute.get('/status', async (c) => {
  const settings = await fetchAppSettings(c.env.DB)
  const config = getSheetSyncSettings(settings)
  const latestRun = await c.env.DB.prepare(
    `SELECT ${RUN_COLUMNS}
     FROM sheet_sync_runs
     ORDER BY id DESC
     LIMIT 1`
  ).first<RunRow>()
  const lastSuccess = await c.env.DB.prepare(
    `SELECT ${RUN_COLUMNS}
     FROM sheet_sync_runs
     WHERE status IN ('success', 'partial')
     ORDER BY id DESC
     LIMIT 1`
  ).first<RunRow>()
  const syncRange = computeSyncDateRange(new Date(), config.monthsToSync)
  const spreadsheets = await fetchMonthlySpreadsheets(c.env.DB)

  return c.json<ApiResponse<unknown>>({
    success: true,
    data: {
      enabled: config.enabled,
      months_to_sync: config.monthsToSync,
      min_row_ratio: config.minRowRatio,
      has_credentials: Boolean(c.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      test_mode: isTestMode(c.env),
      sync_range: syncRange,
      current_month: currentJstMonth(),
      // 同期対象の各月に、スプレッドシートが登録されているか
      sync_months: splitRangeByMonth(syncRange).map((part) => {
        const sheet = spreadsheets.find((row) => row.target_month === part.month)
        return {
          month: part.month,
          from: part.from,
          to: part.to,
          registered: Boolean(sheet),
          spreadsheet_url: sheet?.spreadsheet_url || null,
        }
      }),
      latest_run: latestRun ?? null,
      last_success_run: lastSuccess ?? null,
      tab_results: latestRun ? await fetchTabResults(c.env.DB, latestRun.id) : [],
    },
  })
})

// ------------------------------------------------------------
// GET /api/sheet-sync/runs : 直近の実行履歴
// ------------------------------------------------------------
sheetSyncRoute.get('/runs', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 1), 100)
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.trigger, r.status, r.date_from, r.date_to, r.started_at, r.finished_at, r.error_message,
            SUM(CASE WHEN t.status = 'imported' THEN 1 ELSE 0 END) AS imported_count,
            SUM(CASE WHEN t.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
            SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
            COALESCE(SUM(t.row_count), 0) AS row_count
     FROM sheet_sync_runs r
     LEFT JOIN sheet_sync_tab_results t ON t.run_id = r.id
     GROUP BY r.id
     ORDER BY r.id DESC
     LIMIT ?`
  )
    .bind(limit)
    .all()

  return c.json<ApiResponse<unknown>>({ success: true, data: results })
})

// ------------------------------------------------------------
// GET /api/sheet-sync/runs/:id : 指定 run のタブ別結果
// ------------------------------------------------------------
sheetSyncRoute.get('/runs/:id', async (c) => {
  const runId = Number(c.req.param('id'))
  const run = await c.env.DB.prepare(
    `SELECT ${RUN_COLUMNS} FROM sheet_sync_runs WHERE id = ?`
  )
    .bind(runId)
    .first<RunRow>()
  if (!run) {
    return c.json<ApiResponse<null>>({ success: false, error: '同期履歴が見つかりません' }, 404)
  }

  return c.json<ApiResponse<unknown>>({
    success: true,
    data: { ...run, tab_results: await fetchTabResults(c.env.DB, runId) },
  })
})

// ------------------------------------------------------------
// POST /api/sheet-sync/run : 手動同期
// SHEET_SYNC_TEST_MODE=true のときだけ、タブの中身を直接渡せる
//   body.tabs_by_month : { 'YYYY-MM': { タブ名: 行データ } }（月ごとのシートの中身）
//   body.tabs          : { タブ名: 行データ }（登録済みの全月で同じ中身を使う）
// ------------------------------------------------------------
type TestTabs = Record<string, CsvRows | null>

sheetSyncRoute.post('/run', async (c) => {
  let fetchTabs: SheetTabFetcher | undefined

  if (isTestMode(c.env)) {
    const body = await c.req.json<{ tabs?: TestTabs; tabs_by_month?: Record<string, TestTabs> }>()
      .catch(() => ({} as { tabs?: TestTabs; tabs_by_month?: Record<string, TestTabs> }))
    if (body.tabs || body.tabs_by_month) {
      fetchTabs = async (_spreadsheetId, tabNames, targetMonth) => {
        const tabs = body.tabs_by_month ? (body.tabs_by_month[targetMonth] ?? {}) : (body.tabs ?? {})
        const values: SheetTabValues = new Map()
        tabNames.forEach((name) => {
          const rows = tabs[name]
          values.set(name, Array.isArray(rows) ? normalizeSheetValues(rows) : null)
        })
        return values
      }
    }
  }

  const outcome = await runSheetSync(c.env, 'manual', { fetchTabs })
  if (!outcome.started) {
    return c.json<ApiResponse<typeof outcome>>({ success: false, error: outcome.message ?? '同期を開始できませんでした', data: outcome }, 400)
  }

  return c.json<ApiResponse<typeof outcome>>({ success: true, data: outcome })
})

// ------------------------------------------------------------
// GET /api/sheet-sync/sources : タブ定義（広告媒体＋サイト側4種）
// ------------------------------------------------------------
sheetSyncRoute.get('/sources', async (c) => {
  const [sources, { results: media }] = await Promise.all([
    fetchSyncSources(c.env.DB),
    c.env.DB.prepare(
      `SELECT id, media_name, status
       FROM media_master
       WHERE status <> 'archived'
       ORDER BY media_name ASC`
    ).all<{ id: number; media_name: string; status: string }>(),
  ])

  const adMedia = media.map((item) => {
    const source = sources.find((row) => row.source_type === 'ad_media_csv' && row.media_id === item.id)
    return {
      source_id: source?.id ?? null,
      source_type: 'ad_media_csv',
      media_id: item.id,
      media_name: item.media_name,
      media_status: item.status,
      tab_name: source?.tab_name ?? '',
      is_active: source ? Boolean(source.is_active) : true,
    }
  })

  const site = SITE_SYNC_SOURCES.map((item) => {
    const source = sources.find((row) => row.source_type === item.source_type && row.data_source === item.data_source)
    return {
      source_id: source?.id ?? null,
      source_type: item.source_type,
      data_source: item.data_source,
      label: item.label,
      tab_name: source?.tab_name ?? '',
      is_active: source ? Boolean(source.is_active) : true,
    }
  })

  return c.json<ApiResponse<unknown>>({ success: true, data: { ad_media: adMedia, site } })
})

// ------------------------------------------------------------
// PUT /api/sheet-sync/sources : タブ定義の更新（指定されたものだけ upsert）
// body: { sources: [{ source_type, media_id?, data_source?, tab_name, is_active? }] }
// ------------------------------------------------------------
sheetSyncRoute.put('/sources', async (c) => {
  const body = await c.req.json<{
    sources?: Array<{
      source_type?: string
      media_id?: number | null
      data_source?: string | null
      tab_name?: string
      is_active?: boolean | number
    }>
  }>()

  if (!Array.isArray(body.sources)) {
    return c.json<ApiResponse<null>>({ success: false, error: 'sources を配列で指定してください' }, 400)
  }

  const statements: D1PreparedStatement[] = []

  for (const item of body.sources) {
    const sourceType = parseUploadFileType(item.source_type) as UploadFileType | null
    if (!sourceType) {
      return c.json<ApiResponse<null>>({ success: false, error: 'source_type が正しくありません' }, 400)
    }
    const tabName = String(item.tab_name ?? '').trim()
    const isActive = item.is_active === false || item.is_active === 0 ? 0 : 1

    let existing: { id: number } | null
    let mediaId: number | null = null
    let dataSource: string | null = null

    if (sourceType === 'ad_media_csv') {
      mediaId = Number(item.media_id)
      const media = Number.isInteger(mediaId) && mediaId > 0
        ? await c.env.DB.prepare('SELECT id FROM media_master WHERE id = ?').bind(mediaId).first<{ id: number }>()
        : null
      if (!media) {
        return c.json<ApiResponse<null>>({ success: false, error: '媒体が見つかりません' }, 400)
      }
      existing = await c.env.DB.prepare(
        `SELECT id FROM sheet_sync_sources WHERE source_type = 'ad_media_csv' AND media_id = ?`
      )
        .bind(mediaId)
        .first<{ id: number }>()
    } else {
      const rawSource = String(item.data_source ?? '').trim().toUpperCase()
      if (rawSource !== 'YNS' && rawSource !== 'INTERNAL') {
        return c.json<ApiResponse<null>>({ success: false, error: 'data_source は YNS または INTERNAL を指定してください' }, 400)
      }
      dataSource = parseUploadDataSource(rawSource)
      existing = await c.env.DB.prepare(
        `SELECT id FROM sheet_sync_sources WHERE source_type = ? AND data_source = ?`
      )
        .bind(sourceType, dataSource)
        .first<{ id: number }>()
    }

    statements.push(
      existing
        ? c.env.DB.prepare(
          `UPDATE sheet_sync_sources
           SET tab_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(tabName, isActive, existing.id)
        : c.env.DB.prepare(
          `INSERT INTO sheet_sync_sources (source_type, media_id, data_source, tab_name, is_active)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(sourceType, mediaId, dataSource, tabName, isActive)
    )
  }

  if (statements.length > 0) await c.env.DB.batch(statements)

  return c.json<ApiResponse<{ updated: number }>>({ success: true, data: { updated: statements.length } })
})

// ------------------------------------------------------------
// 月ごとのスプレッドシート
// GET    /api/sheet-sync/spreadsheets        : 登録一覧（新しい月から）
// PUT    /api/sheet-sync/spreadsheets        : 登録・更新 body: { target_month: 'YYYY-MM', url }
// DELETE /api/sheet-sync/spreadsheets/:month : 登録の削除
// POST   /api/sheet-sync/spreadsheets/test   : 接続テスト body: { url }
// ------------------------------------------------------------
sheetSyncRoute.get('/spreadsheets', async (c) => {
  return c.json<ApiResponse<unknown>>({
    success: true,
    data: {
      current_month: currentJstMonth(),
      spreadsheets: await fetchMonthlySpreadsheets(c.env.DB),
    },
  })
})

function parseSpreadsheetInput(value: unknown) {
  const url = String(value ?? '').trim()
  const spreadsheetId = extractSpreadsheetId(url)
  if (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) return null
  return { url, spreadsheetId }
}

sheetSyncRoute.put('/spreadsheets', async (c) => {
  const body = await c.req.json<{ target_month?: string; url?: string }>().catch(() => ({} as { target_month?: string; url?: string }))
  const targetMonth = String(body.target_month ?? '').trim()
  if (!TARGET_MONTH_PATTERN.test(targetMonth)) {
    return c.json<ApiResponse<null>>({ success: false, error: '対象月は YYYY-MM 形式で指定してください' }, 400)
  }
  const input = parseSpreadsheetInput(body.url)
  if (!input) {
    return c.json<ApiResponse<null>>({ success: false, error: 'スプレッドシートのURL（またはID）を入力してください' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO sheet_sync_spreadsheets (target_month, spreadsheet_id, spreadsheet_url)
     VALUES (?, ?, ?)
     ON CONFLICT(target_month) DO UPDATE SET
       spreadsheet_id = excluded.spreadsheet_id,
       spreadsheet_url = excluded.spreadsheet_url,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(targetMonth, input.spreadsheetId, input.url)
    .run()

  return c.json<ApiResponse<{ target_month: string; spreadsheet_id: string }>>({
    success: true,
    data: { target_month: targetMonth, spreadsheet_id: input.spreadsheetId },
  })
})

sheetSyncRoute.delete('/spreadsheets/:month', async (c) => {
  const targetMonth = c.req.param('month')
  if (!TARGET_MONTH_PATTERN.test(targetMonth)) {
    return c.json<ApiResponse<null>>({ success: false, error: '対象月は YYYY-MM 形式で指定してください' }, 400)
  }
  const result = await c.env.DB.prepare('DELETE FROM sheet_sync_spreadsheets WHERE target_month = ?')
    .bind(targetMonth)
    .run()
  return c.json<ApiResponse<{ deleted: number }>>({ success: true, data: { deleted: Number(result.meta?.changes ?? 0) } })
})

// 接続テスト：シートが読めるか、媒体マスタ・設定画面のタブ名がすべてあり1行目が入っているか
// SHEET_SYNC_TEST_MODE=true のときだけ、body.sheet_titles / body.headers でシートの内容を直接渡せる
sheetSyncRoute.post('/spreadsheets/test', async (c) => {
  const body = await c.req.json<{
    url?: string
    sheet_titles?: string[]
    headers?: Record<string, string[]>
  }>().catch(() => ({} as { url?: string; sheet_titles?: string[]; headers?: Record<string, string[]> }))
  const input = parseSpreadsheetInput(body.url)
  if (!input) {
    return c.json<ApiResponse<null>>({ success: false, error: 'スプレッドシートのURL（またはID）を入力してください' }, 400)
  }

  const settings = await fetchAppSettings(c.env.DB)
  const sources = selectTargetSources(await fetchSyncSources(c.env.DB), settings)

  let overview: SpreadsheetOverview
  try {
    overview = isTestMode(c.env) && Array.isArray(body.sheet_titles)
      ? {
        title: '(test)',
        sheetTitles: body.sheet_titles,
        headers: new Map(Object.entries(body.headers ?? {})),
      }
      : await fetchSpreadsheetOverview(
        c.env.GOOGLE_SERVICE_ACCOUNT_JSON,
        input.spreadsheetId,
        sources.map((source) => source.tab_name)
      )
  } catch (err) {
    // 認証・権限・ID の誤りは「読めなかった」結果として返す（画面にそのまま表示する）
    return c.json<ApiResponse<unknown>>({
      success: true,
      data: {
        ok: false,
        spreadsheet_title: '',
        message: err instanceof Error ? err.message : String(err),
        tabs: [],
      },
    })
  }

  return c.json<ApiResponse<unknown>>({ success: true, data: buildConnectionReport(sources, overview) })
})
