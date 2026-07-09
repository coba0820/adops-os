// ============================================================
// CSVアップロード履歴 API（/api/upload）
// v1では「CSVの保存・分析・結合」は行わない。
// フロントエンドでCSVをパース・プレビューした後、
// 「いつ・どのファイルを・何件アップロードしたか」の
// メタ情報だけをこのAPIで記録する。
// ============================================================
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

export const uploadRoute = new Hono<{ Bindings: Bindings }>()

const UPLOAD_FILE_TYPE_LABELS: Record<UploadFileType, string> = {
  ad_media_csv: '広告媒体CSV',
  site_summary_csv: '媒体集計CSV',
  payment_report_csv: '決済レポートCSV',
}

const COMMON_REQUIRED_FILE_TYPES: UploadFileType[] = [
  'site_summary_csv',
  'payment_report_csv',
]

function parseUploadFileType(fileType: unknown): UploadFileType | null {
  if (
    fileType === 'ad_media_csv' ||
    fileType === 'site_summary_csv' ||
    fileType === 'payment_report_csv'
  ) {
    return fileType
  }
  return null
}

function normalizeRowCount(rowCount: unknown) {
  const value = Number(rowCount)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

// ------------------------------------------------------------
// 履歴一覧取得: GET /api/upload
// ------------------------------------------------------------
uploadRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       h.id, h.file_type, h.media_id, m.media_name,
       h.file_name, h.row_count, h.status, h.uploaded_at
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

// ------------------------------------------------------------
// 今日の取込状況取得: GET /api/upload/today
// ------------------------------------------------------------
uploadRoute.get('/today', async (c) => {
  const [{ results: activeMedia }, { results: todayUploads }, today] =
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
           h.file_name, h.row_count, h.status, h.uploaded_at
         FROM upload_history h
         LEFT JOIN media_master m ON h.media_id = m.id
         WHERE date(h.uploaded_at, '+9 hours') = date('now', '+9 hours')
           AND h.status = 'success'
         ORDER BY h.uploaded_at DESC, h.id DESC`
      ).all<UploadHistoryView>(),
      c.env.DB.prepare(
        `SELECT date('now', '+9 hours') as target_date`
      ).first<{ target_date: string }>(),
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

  const mediaItems: UploadStatusItem[] = activeMedia.map((media) => {
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

  const commonItems: UploadStatusItem[] = COMMON_REQUIRED_FILE_TYPES.map(
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

// ------------------------------------------------------------
// 履歴記録: POST /api/upload
// body: { file_type, media_id?, file_name, row_count }
// v1.1以降のCSV取込率では、media_master.status = 'active' の媒体のみを
// 取込対象として扱う（paused、および将来追加予定の archived は対象外）。
// ------------------------------------------------------------
uploadRoute.post('/', async (c) => {
  const body = await c.req.json<{
    file_type: string
    media_id?: number | null
    file_name: string
    row_count: number
  }>()

  const fileType = parseUploadFileType(body.file_type)
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''

  if (!fileType || !fileName) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'file_type と file_name は必須です' },
      400
    )
  }

  let mediaId: number | null = null

  if (fileType === 'ad_media_csv') {
    const requestedMediaId = Number(body.media_id)
    if (!Number.isInteger(requestedMediaId) || requestedMediaId <= 0) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '稼働中の媒体を選択してください' },
        400
      )
    }

    const media = await c.env.DB.prepare(
      `SELECT id FROM media_master WHERE id = ? AND status = 'active'`
    )
      .bind(requestedMediaId)
      .first<{ id: number }>()

    if (!media) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '停止中または存在しない媒体は取込対象外です' },
        400
      )
    }

    mediaId = requestedMediaId
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO upload_history
       (file_type, media_id, file_name, row_count, status)
     VALUES (?, ?, ?, ?, 'success')`
  )
    .bind(
      fileType,
      mediaId,
      fileName,
      normalizeRowCount(body.row_count)
    )
    .run()

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: result.meta.last_row_id ?? null },
  })
})
