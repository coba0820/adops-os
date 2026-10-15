import { Hono } from 'hono'
import type {
  ApiResponse,
  Bindings,
  MediaMaster,
  TodayUploadStatus,
  UploadFileType,
  UploadHistoryView,
  UploadStatusItem,
} from '../../types'
import { fetchAppSettings } from '../../lib/settings'
import {
  ImportError,
  UPLOAD_FILE_TYPE_LABELS,
  importRows,
  isUploadFileTypeEnabled,
  normalizeCsvRows,
  normalizeRowCount,
  parseUploadDataSource,
  parseUploadFileType,
  type CsvRows,
  type UploadWarning,
} from '../../lib/import-service'

export const uploadRoute = new Hono<{ Bindings: Bindings }>()

const COMMON_REQUIRED_FILE_TYPES: UploadFileType[] = [
  'site_summary_csv',
  'payment_report_csv',
]

function logUploadError(message: string, details: Record<string, unknown>) {
  console.error(`[api/upload] ${message}`, details)
}

const UPLOAD_DETAIL_TABLES = [
  'ad_media_daily',
  'media_summary_daily',
  'payment_report_daily',
] as const

async function getExistingUploadDetailTables(db: D1Database) {
  const placeholders = UPLOAD_DETAIL_TABLES.map(() => '?').join(', ')
  const { results } = await db.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name IN (${placeholders})`
  )
    .bind(...UPLOAD_DETAIL_TABLES)
    .all<{ name: string }>()

  const existingNames = new Set(results.map((row) => row.name))
  return UPLOAD_DETAIL_TABLES.filter((tableName) => existingNames.has(tableName))
}

uploadRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       h.id, h.file_type, h.media_id, m.media_name,
       h.file_name, h.row_count, h.target_date, h.status, h.import_method, h.uploaded_at
     FROM upload_history h
     LEFT JOIN media_master m ON h.media_id = m.id
     ORDER BY h.uploaded_at DESC, h.id DESC
     LIMIT 50`
  ).all<UploadHistoryView>()

  return c.json<ApiResponse<UploadHistoryView[]>>({
    success: true,
    data: results,
  })
})

uploadRoute.get('/today', async (c) => {
  const [{ results: activeMedia }, { results: todayUploads }, today, settings] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT id, media_name, status, created_at, updated_at
         FROM media_master
         WHERE status = 'active'
         ORDER BY id ASC`
      ).all<MediaMaster>(),
      c.env.DB.prepare(
        `SELECT
           h.id, h.file_type, h.media_id, m.media_name,
           h.file_name, h.row_count, h.target_date, h.status, h.import_method, h.uploaded_at
         FROM upload_history h
         LEFT JOIN media_master m ON h.media_id = m.id
         WHERE h.target_date = date('now', '+9 hours')
           AND h.status = 'success'
         ORDER BY h.uploaded_at DESC, h.id DESC`
      ).all<UploadHistoryView>(),
      c.env.DB.prepare(
        `SELECT date('now', '+9 hours') as target_date`
      ).first<{ target_date: string }>(),
      fetchAppSettings(c.env.DB),
    ])

  const latestAdMediaUploads = new Map<number, UploadHistoryView>()
  const latestCommonUploads = new Map<UploadFileType, UploadHistoryView>()

  for (const upload of todayUploads) {
    const fileType = parseUploadFileType(upload.file_type)
    if (!fileType) continue

    if (
      fileType === 'ad_media_csv' &&
      upload.media_id !== null &&
      !latestAdMediaUploads.has(upload.media_id)
    ) {
      latestAdMediaUploads.set(upload.media_id, upload)
    }

    if (
      COMMON_REQUIRED_FILE_TYPES.includes(fileType) &&
      !latestCommonUploads.has(fileType)
    ) {
      latestCommonUploads.set(fileType, upload)
    }
  }

  const mediaItems: UploadStatusItem[] = isUploadFileTypeEnabled('ad_media_csv', settings)
    ? activeMedia.map((media) => {
      const latestUpload = latestAdMediaUploads.get(media.id) ?? null
      return {
        file_type: 'ad_media_csv',
        label: UPLOAD_FILE_TYPE_LABELS.ad_media_csv,
        media_id: media.id,
        media_name: media.media_name,
        uploaded: latestUpload !== null,
        latest_upload: latestUpload,
      }
    })
    : []

  const commonItems: UploadStatusItem[] = COMMON_REQUIRED_FILE_TYPES.filter(
    (fileType) => isUploadFileTypeEnabled(fileType, settings)
  ).map(
    (fileType) => {
      const latestUpload = latestCommonUploads.get(fileType) ?? null
      return {
        file_type: fileType,
        label: UPLOAD_FILE_TYPE_LABELS[fileType],
        media_id: null,
        media_name: null,
        uploaded: latestUpload !== null,
        latest_upload: latestUpload,
      }
    }
  )

  const items = [...mediaItems, ...commonItems]
  const requiredCount = items.length
  const uploadedCount = items.filter((item) => item.uploaded).length
  const completionRate =
    requiredCount === 0
      ? 100
      : Math.round((uploadedCount / requiredCount) * 100)

  return c.json<ApiResponse<TodayUploadStatus>>({
    success: true,
    data: {
      target_date: today?.target_date ?? '',
      active_media_count: activeMedia.length,
      uploaded_count: uploadedCount,
      required_count: requiredCount,
      completion_rate: completionRate,
      items,
    },
  })
})

uploadRoute.delete('/:id', async (c) => {
  const uploadHistoryId = Number(c.req.param('id'))
  if (!Number.isInteger(uploadHistoryId) || uploadHistoryId <= 0) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '削除対象の取込履歴IDが正しくありません' },
      400
    )
  }

  const upload = await c.env.DB.prepare(
    `SELECT id, file_type, media_id, file_name, row_count, target_date, status, import_method, uploaded_at
     FROM upload_history
     WHERE id = ?`
  )
    .bind(uploadHistoryId)
    .first<UploadHistoryView>()

  if (!upload) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '削除対象の取込履歴が見つかりません' },
      404
    )
  }

  try {
    const detailTables = await getExistingUploadDetailTables(c.env.DB)
    const statements = [
      ...detailTables.map((tableName) =>
        c.env.DB.prepare(`DELETE FROM ${tableName} WHERE upload_history_id = ?`)
          .bind(uploadHistoryId)
      ),
      c.env.DB.prepare(`DELETE FROM upload_history WHERE id = ?`)
        .bind(uploadHistoryId),
    ]

    const results = await c.env.DB.batch(statements)
    const deletedCounts = detailTables.reduce<Record<string, number>>(
      (counts, tableName, index) => {
        counts[tableName] = Number(results[index]?.meta?.changes ?? 0)
        return counts
      },
      {}
    )
    deletedCounts.upload_history = Number(results[detailTables.length]?.meta?.changes ?? 0)

    return c.json<ApiResponse<{
      id: number
      file_name: string
      deleted_counts: Record<string, number>
    }>>({
      success: true,
      data: {
        id: uploadHistoryId,
        file_name: upload.file_name,
        deleted_counts: deletedCounts,
      },
    })
  } catch (err) {
    logUploadError('upload delete failed', {
      uploadHistoryId,
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json<ApiResponse<null>>(
      { success: false, error: '取込履歴の削除に失敗しました' },
      500
    )
  }
})

uploadRoute.post('/', async (c) => {
  const body = await c.req.json<{
    file_type: string
    media_id?: number | null
    file_name: string
    row_count: number
    data_source?: string
    dataSource?: string
    csv_rows?: CsvRows
    csv_text?: string
  }>()

  const fileType = parseUploadFileType(body.file_type)
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''
  const rowCount = normalizeRowCount(body.row_count)
  const dataSource = parseUploadDataSource(body.data_source ?? body.dataSource)

  if (!fileType || !fileName) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'file_type と file_name は必須です' },
      400
    )
  }

  try {
    const result = await importRows(c.env.DB, {
      fileType,
      mediaId: body.media_id ?? null,
      dataSource,
      rows: normalizeCsvRows(body.csv_rows, body.csv_text),
      fileName,
      rowCount,
      importMethod: 'manual',
    })

    return c.json<ApiResponse<{ id: number; saved_rows: number; warnings: UploadWarning[] }>>({
      success: true,
      data: { id: result.uploadHistoryId, saved_rows: result.rowCount, warnings: result.warnings },
    })
  } catch (err) {
    if (err instanceof ImportError) {
      return c.json<ApiResponse<null>>(
        { success: false, error: err.message },
        err.status
      )
    }
    throw err
  }
})
