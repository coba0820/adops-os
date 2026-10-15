import { Hono } from 'hono'
import type { ApiResponse, Bindings, UploadFileType } from '../../types'
import { fetchAppSettings } from '../../lib/settings'
import { parseUploadDataSource, parseUploadFileType, type CsvRows } from '../../lib/import-service'
import { normalizeSheetValues, type SheetTabValues } from '../../lib/google-sheets'
import {
  SITE_SYNC_SOURCES,
  computeSyncDateRange,
  fetchSyncSources,
  getSheetSyncSettings,
  runSheetSync,
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
    `SELECT r.id, r.run_id, r.source_id, r.tab_name, r.status, r.row_count,
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

  return c.json<ApiResponse<unknown>>({
    success: true,
    data: {
      enabled: config.enabled,
      spreadsheet_id: config.spreadsheetId,
      months_to_sync: config.monthsToSync,
      min_row_ratio: config.minRowRatio,
      has_credentials: Boolean(c.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      test_mode: isTestMode(c.env),
      sync_range: computeSyncDateRange(new Date(), config.monthsToSync),
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
// SHEET_SYNC_TEST_MODE=true のときだけ、body.tabs でタブの中身を直接渡せる
// ------------------------------------------------------------
sheetSyncRoute.post('/run', async (c) => {
  let fetchTabs: SheetTabFetcher | undefined

  if (isTestMode(c.env)) {
    const body = await c.req.json<{ tabs?: Record<string, CsvRows | null> }>().catch(() => ({} as { tabs?: Record<string, CsvRows | null> }))
    if (body.tabs) {
      const tabs = body.tabs
      fetchTabs = async (_spreadsheetId, tabNames) => {
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
