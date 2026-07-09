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

const AD_MEDIA_DAILY_INSERT_BATCH_SIZE = 100

type CsvRows = string[][]

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

function normalizeHeader(header: unknown) {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildHeaderIndex(headerRow: string[]) {
  const index = new Map<string, number>()
  headerRow.forEach((header, i) => {
    index.set(normalizeHeader(header), i)
  })
  return index
}

function getCell(row: string[], headerIndex: Map<string, number>, header: string) {
  const index = headerIndex.get(normalizeHeader(header))
  if (index === undefined) return ''
  return String(row[index] ?? '').trim()
}

function normalizeRowCount(rowCount: unknown) {
  const value = Number(rowCount)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function parseInteger(value: unknown) {
  const normalized = String(value ?? '').replace(/[,\s]/g, '')
  if (normalized === '') return 0
  const number = Number(normalized)
  if (!Number.isFinite(number)) return 0
  return Math.trunc(number)
}

function parseMoney(value: unknown) {
  const normalized = String(value ?? '').replace(/[,\s¥￥$]/g, '')
  if (normalized === '') return 0
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function parseTargetDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const ymd = raw.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/)
  if (ymd) {
    const [, year, month, day] = ymd
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const mdy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (mdy) {
    const [, month, day, year] = mdy
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function isBlankRow(row: string[]) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

function buildAdMediaDailyRows(rows: CsvRows, mediaId: number, uploadHistoryId: number) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  const headerIndex = buildHeaderIndex(headerRow)
  const requiredHeaders = [
    'Date',
    'Account Name',
    'Account ID',
    'Campaign Name',
    'Campaign ID',
    'Clicks',
    'Served Ads',
    'Impressions',
    'Spent',
  ]
  const missingHeaders = requiredHeaders.filter(
    (header) => !headerIndex.has(normalizeHeader(header))
  )

  if (missingHeaders.length > 0) {
    throw new Error(`CSVに必要な列がありません: ${missingHeaders.join(', ')}`)
  }

  return bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
    const targetDate = parseTargetDate(getCell(row, headerIndex, 'Date'))
    if (!targetDate) {
      throw new Error(`${index + 2}行目のDateが正しくありません`)
    }

    return {
      targetDate,
      mediaId,
      accountName: getCell(row, headerIndex, 'Account Name'),
      accountId: getCell(row, headerIndex, 'Account ID'),
      campaignName: getCell(row, headerIndex, 'Campaign Name'),
      campaignId: getCell(row, headerIndex, 'Campaign ID'),
      clicks: parseInteger(getCell(row, headerIndex, 'Clicks')),
      servedAds: parseInteger(getCell(row, headerIndex, 'Served Ads')),
      impressions: parseInteger(getCell(row, headerIndex, 'Impressions')),
      spend: parseMoney(getCell(row, headerIndex, 'Spent')),
      uploadHistoryId,
    }
  })
}

// ------------------------------------------------------------
// 履歴一覧取得: GET /api/upload
// ------------------------------------------------------------
uploadRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       h.id, h.file_type, h.media_id, m.media_name,
       h.file_name, h.row_count, h.target_date, h.status, h.uploaded_at
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
           h.file_name, h.row_count, h.target_date, h.status, h.uploaded_at
         FROM upload_history h
         LEFT JOIN media_master m ON h.media_id = m.id
         WHERE h.target_date = date('now', '+9 hours')
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
    csv_rows?: CsvRows
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
       (file_type, media_id, file_name, row_count, target_date, status)
     VALUES (?, ?, ?, ?, date('now', '+9 hours'), 'success')`
  )
    .bind(
      fileType,
      mediaId,
      fileName,
      normalizeRowCount(body.row_count)
    )
    .run()

  const uploadHistoryId = result.meta.last_row_id ?? null

  if (fileType === 'ad_media_csv') {
    if (!uploadHistoryId) {
      return c.json<ApiResponse<null>>(
        { success: false, error: 'アップロード履歴IDを取得できませんでした' },
        500
      )
    }

    if (!Array.isArray(body.csv_rows)) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '広告媒体CSVの行データが送信されていません' },
        400
      )
    }

    try {
      const dailyRows = buildAdMediaDailyRows(
        body.csv_rows,
        mediaId,
        uploadHistoryId
      )

      if (dailyRows.length > 0) {
        for (let i = 0; i < dailyRows.length; i += AD_MEDIA_DAILY_INSERT_BATCH_SIZE) {
          const chunk = dailyRows.slice(i, i + AD_MEDIA_DAILY_INSERT_BATCH_SIZE)
          await c.env.DB.batch(
            chunk.map((row) =>
              c.env.DB.prepare(
                `INSERT INTO ad_media_daily
                   (target_date, media_id, account_name, account_id,
                    campaign_name, campaign_id, clicks, served_ads,
                    impressions, spend, upload_history_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                row.targetDate,
                row.mediaId,
                row.accountName,
                row.accountId,
                row.campaignName,
                row.campaignId,
                row.clicks,
                row.servedAds,
                row.impressions,
                row.spend,
                row.uploadHistoryId
              )
            )
          )
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '広告媒体CSVの実績保存に失敗しました'
      return c.json<ApiResponse<null>>(
        { success: false, error: message },
        400
      )
    }
  }

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: uploadHistoryId },
  })
})
