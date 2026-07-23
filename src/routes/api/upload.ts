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
import { parseAdMediaRows } from '../../lib/ad-media-parsers'

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

function isUploadFileTypeEnabled(
  fileType: UploadFileType,
  settings: Awaited<ReturnType<typeof fetchAppSettings>>
) {
  const importSettings = settings.import ?? {}
  if (fileType === 'ad_media_csv') return importSettings.enable_ad_media_csv !== false
  if (fileType === 'site_summary_csv') return importSettings.enable_site_summary_csv !== false
  if (fileType === 'payment_report_csv') return importSettings.enable_payment_report_csv !== false
  return true
}

const UPLOAD_DETAIL_TABLES = [
  'ad_media_daily',
  'media_summary_daily',
  'payment_report_daily',
] as const

const INSERT_BATCH_SIZE = 25
const LOOKUP_BATCH_SIZE = 50

type CsvRows = string[][]

type AdMediaDailyRow = {
  targetDate: string
  mediaId: number
  accountName: string
  accountId: string
  campaignName: string
  campaignId: string
  clicks: number
  servedAds: number
  impressions: number
  spend: number
  mediaCv: number
  currency: string
  uploadHistoryId: number
}

type MediaSummaryDailyRow = {
  targetDate: string
  mediaId: number | null
  adCode: string
  accessCount: number
  registrationCount: number
  provisionalRegistrationCount: number
  uploadHistoryId: number
}

type PaymentReportDailyRow = {
  registrationDate: string
  siteName: string
  customerId: string
  adCode: string
  registrationStatus: string
  firstPaymentAt: string | null
  paymentCount: number
  paymentAmount: number
  mediaType: string
  mediaId: number | null
  uploadHistoryId: number
}

type HeaderDefinition = {
  label: string
  aliases: string[]
}

type TargetDateRange = {
  minDate: string
  maxDate: string
}

const AD_MEDIA_HEADERS: Record<string, HeaderDefinition> = {
  date: { label: 'Date', aliases: ['Date', '日付', '年月日'] },
  accountName: { label: 'Account Name', aliases: ['Account Name', 'アカウント名'] },
  accountId: { label: 'Account ID', aliases: ['Account ID', 'アカウントID'] },
  campaignName: { label: 'Campaign Name', aliases: ['Campaign Name', 'キャンペーン名'] },
  campaignId: { label: 'Campaign ID', aliases: ['Campaign ID', 'キャンペーンID', '広告コード'] },
  clicks: { label: 'Clicks', aliases: ['Clicks', 'Click', 'クリック', 'クリック数'] },
  servedAds: { label: 'Served Ads', aliases: ['Served Ads', '配信数'] },
  impressions: { label: 'Impressions', aliases: ['Impressions', 'Imp', 'インプレッション', '表示回数'] },
  spend: { label: 'Spent', aliases: ['Spent', 'Spend', 'Cost', '費用', '広告費'] },
  mediaCv: {
    label: '媒体CV',
    aliases: [
      '媒体CV',
      'CV',
      'CV数',
      'CVs',
      'CV Count',
      'Conversions',
      'Conversion',
      'Total Conversions',
      'Website Conversions',
      'コンバージョン',
      'コンバージョン数',
      '成果',
      '成果数',
      '獲得',
      '獲得数',
      'Results',
      '結果',
    ],
  },
}

const MEDIA_SUMMARY_HEADERS: Record<string, HeaderDefinition> = {
  date: {
    label: '日付',
    aliases: ['日付け', '日付', 'Date', '年月日', '対象日', '集計日'],
  },
  adCode: { label: '広告コード', aliases: ['広告コード', '広告CD', '広告コード名', 'Ad Code', 'ad_code', 'Campaign ID', 'campaign_id'] },
  accessCount: { label: 'アクセス数', aliases: ['アクセス数', 'アクセス', 'Access', 'access', 'access_count', '流入数'] },
  registrationCount: { label: '登録者数', aliases: ['登録者数', '登録数', '登録', 'Registration', 'Registrations', 'registration', 'registration_count'] },
  provisionalRegistrationCount: {
    label: '仮登録者数',
    aliases: ['仮登録者数', '仮登録数', '仮登録', 'Provisional Registration', 'Provisional Registrations', 'provisional_registration', 'provisional_registration_count'],
  },
}

const PAYMENT_REPORT_HEADERS: Record<string, HeaderDefinition> = {
  siteName: { label: 'サイト', aliases: ['サイト', 'site', 'Site', 'site_name'] },
  customerId: { label: '顧客ID', aliases: ['顧客ID', '顧客Id', '顧客id', 'customer_id', 'Customer ID'] },
  adCode: { label: '広告コード', aliases: ['広告コード', '広告CD', '広告コード名', 'ad_code', 'Ad Code'] },
  registrationStatus: { label: '登録状態', aliases: ['登録状態', 'registration_status', 'Registration Status'] },
  registrationAt: { label: '登録日時', aliases: ['登録日時', '登録日', 'registration_at', 'registered_at', 'Registration Date'] },
  firstPaymentAt: { label: '初回購入日時', aliases: ['初回購入日時', '初回課金日時', '初回決済日時', 'first_payment_at', 'First Payment At'] },
  elapsedToFirstPayment: { label: '登録〜初回購入経過日時', aliases: ['登録〜初回購入経過日時', '登録～初回購入経過日時', '登録-初回購入経過日時', 'elapsed_to_first_payment'] },
  paymentCount: { label: '入金回数', aliases: ['入金回数', '課金回数', '決済回数', 'payment_count', 'Payment Count'] },
  paymentAmount: { label: '入金額', aliases: ['入金額', '売上', '売上金額', '課金額', '決済金額', 'payment_amount', 'Payment Amount'] },
  mediaType: { label: '媒体種別', aliases: ['媒体種別', '媒体タイプ', 'media_type', 'Media Type'] },
}

function parseCsvText(text: string): CsvRows {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim() !== '')
  return lines.map((line) => parseCsvLine(line))
}

function parseCsvLine(line: string) {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result.map((value) => value.trim())
}

function normalizeCsvRows(csvRows: unknown, csvText: unknown): CsvRows {
  if (
    Array.isArray(csvRows) &&
    csvRows.every((row) => Array.isArray(row))
  ) {
    return csvRows.map((row) => row.map((cell) => String(cell ?? '')))
  }

  if (typeof csvText === 'string' && csvText.trim() !== '') {
    return parseCsvText(csvText)
  }

  return []
}

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

function hasHeader(headerIndex: Map<string, number>, aliases: string[]) {
  return aliases.some((alias) => headerIndex.has(normalizeHeader(alias)))
}

function getCellByAliases(row: string[], headerIndex: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const index = headerIndex.get(normalizeHeader(alias))
    if (index !== undefined) return String(row[index] ?? '').trim()
  }
  return ''
}

function findHeaderIndex(headerRow: string[], aliases: string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeHeader(alias)))
  return headerRow.findIndex((header) => normalizedAliases.has(normalizeHeader(header)))
}

function compactHeader(header: unknown) {
  return normalizeHeader(header)
    .replace(/[\s_＿\-－()\[\]（）［］{}｛｝:：\/／・.．]/g, '')
}

function findMediaCvHeaderIndex(headerRow: string[]) {
  const exactIndex = findHeaderIndex(headerRow, AD_MEDIA_HEADERS.mediaCv.aliases)
  if (exactIndex !== -1) return exactIndex

  return headerRow.findIndex((header) => {
    const compact = compactHeader(header)
    if (!compact) return false
    if (compact.includes('cvr') || compact.includes('cpc') || compact.includes('cpm')) return false
    if (compact.includes('率') || compact.includes('rate') || compact.includes('単価')) return false
    if (compact === 'cv' || compact === 'cvs' || compact === 'cv数') return true
    if (compact.includes('媒体cv')) return true
    if (compact.includes('コンバージョン')) return true
    if (compact === '成果' || compact === '成果数') return true
    if (compact === '獲得' || compact === '獲得数') return true
    if (compact === 'results' || compact === 'result') return true
    return false
  })
}

function getMediaCvCell(row: string[], headerRow: string[]) {
  const index = findMediaCvHeaderIndex(headerRow)
  if (index === -1) return ''
  return String(row[index] ?? '').trim()
}

function getMediaCvHeaderName(headerRow: string[]) {
  const index = findMediaCvHeaderIndex(headerRow)
  if (index === -1) return null
  return headerRow[index] ?? null
}

function ensureHeaders(headerIndex: Map<string, number>, definitions: HeaderDefinition[]) {
  const missingHeaders = definitions
    .filter((definition) => !hasHeader(headerIndex, definition.aliases))
    .map((definition) => definition.label)

  if (missingHeaders.length > 0) {
    throw new Error(`ファイルに必要な列がありません: ${missingHeaders.join(', ')}`)
  }
}

function normalizeRowCount(rowCount: unknown) {
  const value = Number(rowCount)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

async function resolveUploadHistoryId(
  db: D1Database,
  result: D1Result,
  fileType: UploadFileType,
  mediaId: number | null,
  fileName: string,
  rowCount: number
) {
  const metaId = Number(result.meta.last_row_id)
  if (Number.isInteger(metaId) && metaId > 0) return metaId

  const latest = await db.prepare(
    `SELECT id
     FROM upload_history
     WHERE file_type = ?
       AND media_id IS ?
       AND file_name = ?
       AND row_count = ?
       AND target_date = date('now', '+9 hours')
       AND status = 'success'
     ORDER BY id DESC
     LIMIT 1`
  )
    .bind(fileType, mediaId, fileName, rowCount)
    .first<{ id: number }>()

  return latest?.id ?? null
}

function parseInteger(value: unknown) {
  const normalized = String(value ?? '')
    .replace(/[,\s]/g, '')
    .replace(/[^\d.-]/g, '')
  if (normalized === '') return 0
  const number = Number(normalized)
  if (!Number.isFinite(number)) return 0
  return Math.trunc(number)
}

function parseMoney(value: unknown) {
  const normalized = String(value ?? '')
    .replace(/[,\s￥¥円$]/g, '')
    .replace(/[^\d.-]/g, '')
  if (normalized === '') return 0
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function parseTargetDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const ymdWithTime = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/)
  if (ymdWithTime) {
    const [, year, month, day] = ymdWithTime
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (ymd) {
    const [, year, month, day] = ymd
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const ymdJapanese = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/)
  if (ymdJapanese) {
    const [, year, month, day] = ymdJapanese
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

function normalizeDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const ymdWithTime = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (ymdWithTime) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = ymdWithTime
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

function isBlankRow(row: string[]) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

function countBodyRows(rows: CsvRows) {
  return rows.slice(1).filter((row) => !isBlankRow(row)).length
}

function logUploadInfo(message: string, details: Record<string, unknown>) {
  console.info(`[api/upload] ${message}`, details)
}

function logUploadError(message: string, details: Record<string, unknown>) {
  console.error(`[api/upload] ${message}`, details)
}

function aggregateAdMediaRows(rows: AdMediaDailyRow[]) {
  const rowsByKey = new Map<string, AdMediaDailyRow>()

  for (const row of rows) {
    const key = [
      row.targetDate,
      row.mediaId,
      row.campaignId || '',
    ].join('|')
    const current = rowsByKey.get(key)

    if (!current) {
      rowsByKey.set(key, { ...row })
      continue
    }

    current.clicks += row.clicks
    current.servedAds += row.servedAds
    current.impressions += row.impressions
    current.spend += row.spend
    current.mediaCv += row.mediaCv
    current.accountName = row.accountName || current.accountName
    current.accountId = row.accountId || current.accountId
    current.campaignName = row.campaignName || current.campaignName
  }

  return [...rowsByKey.values()]
}

function aggregateMediaSummaryRows(rows: MediaSummaryDailyRow[]) {
  const rowsByKey = new Map<string, MediaSummaryDailyRow>()

  for (const row of rows) {
    const key = [
      row.targetDate,
      row.mediaId ?? 'null',
      row.adCode || '',
    ].join('|')
    const current = rowsByKey.get(key)

    if (!current) {
      rowsByKey.set(key, { ...row })
      continue
    }

    current.accessCount += row.accessCount
    current.registrationCount += row.registrationCount
    current.provisionalRegistrationCount += row.provisionalRegistrationCount
  }

  return [...rowsByKey.values()]
}

function aggregatePaymentReportRows(rows: PaymentReportDailyRow[]) {
  const rowsByKey = new Map<string, PaymentReportDailyRow>()

  for (const row of rows) {
    const key = [
      row.registrationDate,
      row.mediaId ?? 'null',
      row.adCode || '',
      row.customerId || '',
    ].join('|')
    const current = rowsByKey.get(key)

    if (!current) {
      rowsByKey.set(key, { ...row })
      continue
    }

    current.paymentCount += row.paymentCount
    current.paymentAmount += row.paymentAmount
    current.siteName = row.siteName || current.siteName
    current.registrationStatus = row.registrationStatus || current.registrationStatus
    current.firstPaymentAt = row.firstPaymentAt || current.firstPaymentAt
    current.mediaType = row.mediaType || current.mediaType
  }

  return [...rowsByKey.values()]
}

function getTargetDateRange(rows: Array<{ targetDate: string }>): TargetDateRange {
  if (rows.length === 0) {
    throw new Error('保存対象の明細行がありません')
  }

  return rows.reduce<TargetDateRange>(
    (range, row) => ({
      minDate: row.targetDate < range.minDate ? row.targetDate : range.minDate,
      maxDate: row.targetDate > range.maxDate ? row.targetDate : range.maxDate,
    }),
    {
      minDate: rows[0].targetDate,
      maxDate: rows[0].targetDate,
    }
  )
}

function getRegistrationDateRange(rows: PaymentReportDailyRow[]) {
  return getTargetDateRange(rows.map((row) => ({ targetDate: row.registrationDate })))
}

function uniqueNumbers(values: Array<number | null>) {
  return [...new Set(values.filter((value): value is number => value !== null))]
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

async function deleteOldAdMediaRowsInRange(
  db: D1Database,
  mediaId: number,
  range: TargetDateRange,
  uploadHistoryId: number
) {
  await db.prepare(
    `DELETE FROM ad_media_daily
     WHERE media_id = ?
       AND target_date BETWEEN ? AND ?
       AND upload_history_id <> ?`
  )
    .bind(mediaId, range.minDate, range.maxDate, uploadHistoryId)
    .run()
}

async function deleteOldMediaSummaryRowsInRange(
  db: D1Database,
  rows: MediaSummaryDailyRow[],
  range: TargetDateRange,
  uploadHistoryId: number
) {
  const mediaIds = uniqueNumbers(rows.map((row) => row.mediaId))
  for (let i = 0; i < mediaIds.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = mediaIds.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    await db.prepare(
      `DELETE FROM media_summary_daily
       WHERE target_date BETWEEN ? AND ?
         AND media_id IN (${placeholders})
         AND upload_history_id <> ?`
    )
      .bind(range.minDate, range.maxDate, ...chunk, uploadHistoryId)
      .run()
  }

  const unlinkedAdCodes = uniqueStrings(
    rows
      .filter((row) => row.mediaId === null)
      .map((row) => row.adCode)
  )
  for (let i = 0; i < unlinkedAdCodes.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = unlinkedAdCodes.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    await db.prepare(
      `DELETE FROM media_summary_daily
       WHERE target_date BETWEEN ? AND ?
         AND media_id IS NULL
         AND ad_code IN (${placeholders})
         AND upload_history_id <> ?`
    )
      .bind(range.minDate, range.maxDate, ...chunk, uploadHistoryId)
      .run()
  }
}

async function fetchExchangeRates(db: D1Database) {
  try {
    const { results } = await db.prepare(
      `SELECT target_month, currency, rate
       FROM exchange_rates`
    ).all<{ target_month: string; currency: string; rate: number }>()

    return results.reduce<Record<string, number>>((rates, row) => {
      rates[`${row.target_month}:${String(row.currency).toUpperCase()}`] = Number(row.rate)
      return rates
    }, {})
  } catch (err) {
    return {}
  }
}

async function deleteOldPaymentReportRowsInRange(
  db: D1Database,
  rows: PaymentReportDailyRow[],
  range: TargetDateRange,
  uploadHistoryId: number
) {
  let deletedLinkedMediaRows = 0
  let deletedNullMediaRows = 0
  const mediaIds = uniqueNumbers(rows.map((row) => row.mediaId))
  for (let i = 0; i < mediaIds.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = mediaIds.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    const result = await db.prepare(
      `DELETE FROM payment_report_daily
       WHERE registration_date BETWEEN ? AND ?
         AND media_id IN (${placeholders})
         AND upload_history_id <> ?`
    )
      .bind(range.minDate, range.maxDate, ...chunk, uploadHistoryId)
      .run()
    deletedLinkedMediaRows += Number(result.meta?.changes ?? 0)
  }

  const targetAdCodes = uniqueStrings(rows.map((row) => row.adCode))
  for (let i = 0; i < targetAdCodes.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = targetAdCodes.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    const result = await db.prepare(
      `DELETE FROM payment_report_daily
       WHERE registration_date BETWEEN ? AND ?
         AND media_id IS NULL
         AND ad_code IN (${placeholders})
         AND upload_history_id <> ?`
    )
      .bind(range.minDate, range.maxDate, ...chunk, uploadHistoryId)
      .run()
    deletedNullMediaRows += Number(result.meta?.changes ?? 0)
  }

  return {
    deletedLinkedMediaRows,
    deletedNullMediaRows,
  }
}

function buildAdMediaDailyRows(
  rows: CsvRows,
  mediaId: number,
  mediaName: string,
  exchangeRates: Record<string, number>,
  uploadHistoryId: number
) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  logUploadInfo('buildAdMediaDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
    mediaName,
  })

  return parseAdMediaRows(rows, { mediaName, exchangeRates }).map((row): AdMediaDailyRow => ({
    ...row,
    mediaId,
    uploadHistoryId,
  }))

  const headerIndex = buildHeaderIndex(headerRow)
  ensureHeaders(headerIndex, [
    AD_MEDIA_HEADERS.date,
    AD_MEDIA_HEADERS.accountName,
    AD_MEDIA_HEADERS.accountId,
    AD_MEDIA_HEADERS.campaignName,
    AD_MEDIA_HEADERS.campaignId,
    AD_MEDIA_HEADERS.clicks,
    AD_MEDIA_HEADERS.servedAds,
    AD_MEDIA_HEADERS.impressions,
    AD_MEDIA_HEADERS.spend,
  ])

  const mediaCvHeader = getMediaCvHeaderName(headerRow)
  logUploadInfo('buildAdMediaDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
    mediaCvHeader,
    mediaName,
  })

  return parseAdMediaRows(rows, { mediaName, exchangeRates }).map((row): AdMediaDailyRow => ({
    ...row,
    mediaId,
    uploadHistoryId,
  }))

  return bodyRows.filter((row) => !isBlankRow(row)).map((row, index): AdMediaDailyRow => {
    const targetDate = parseTargetDate(getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.date.aliases))
    if (!targetDate) {
      throw new Error(`${index + 2}行目のDateが正しくありません`)
    }

    return {
      targetDate,
      mediaId,
      accountName: getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.accountName.aliases),
      accountId: getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.accountId.aliases),
      campaignName: getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.campaignName.aliases),
      campaignId: getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.campaignId.aliases),
      clicks: parseInteger(getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.clicks.aliases)),
      servedAds: parseInteger(getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.servedAds.aliases)),
      impressions: parseInteger(getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.impressions.aliases)),
      spend: parseMoney(getCellByAliases(row, headerIndex, AD_MEDIA_HEADERS.spend.aliases)),
      mediaCv: parseInteger(getMediaCvCell(row, headerRow)),
      uploadHistoryId,
    }
  })
}

async function resolveMediaIdsByAdCode(db: D1Database, adCodes: string[]) {
  const uniqueAdCodes = [...new Set(adCodes.map((adCode) => adCode.trim()).filter(Boolean))]
  const mediaIdSets = new Map<string, Set<number>>()

  for (let i = 0; i < uniqueAdCodes.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = uniqueAdCodes.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    const { results } = await db.prepare(
      `SELECT c.ad_code, c.media_id
       FROM campaign_master c
       INNER JOIN media_master m ON c.media_id = m.id
       WHERE m.status = 'active'
         AND c.ad_code IN (${placeholders})`
    )
      .bind(...chunk)
      .all<{ ad_code: string; media_id: number }>()

    for (const row of results) {
      const adCode = String(row.ad_code ?? '').trim()
      if (!adCode) continue
      const set = mediaIdSets.get(adCode) ?? new Set<number>()
      set.add(row.media_id)
      mediaIdSets.set(adCode, set)
    }
  }

  const mediaIds = new Map<string, number | null>()
  uniqueAdCodes.forEach((adCode) => {
    const set = mediaIdSets.get(adCode)
    mediaIds.set(adCode, set && set.size === 1 ? [...set][0] : null)
  })

  return mediaIds
}

async function buildMediaSummaryDailyRows(
  db: D1Database,
  rows: CsvRows,
  uploadHistoryId: number
) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  const headerIndex = buildHeaderIndex(headerRow)
  logUploadInfo('buildMediaSummaryDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
  })

  ensureHeaders(headerIndex, [
    MEDIA_SUMMARY_HEADERS.date,
    MEDIA_SUMMARY_HEADERS.adCode,
    MEDIA_SUMMARY_HEADERS.accessCount,
    MEDIA_SUMMARY_HEADERS.registrationCount,
    MEDIA_SUMMARY_HEADERS.provisionalRegistrationCount,
  ])

  const parsedRows = bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
    const targetDate = parseTargetDate(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.date.aliases))
    if (!targetDate) {
      throw new Error(`${index + 2}行目の日付が正しくありません`)
    }

    const adCode = getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.adCode.aliases)
    if (!adCode) {
      throw new Error(`${index + 2}行目の広告コードが空です`)
    }

    return {
      targetDate,
      adCode,
      accessCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.accessCount.aliases)),
      registrationCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.registrationCount.aliases)),
      provisionalRegistrationCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.provisionalRegistrationCount.aliases)),
      uploadHistoryId,
    }
  })

  const mediaIdsByAdCode = await resolveMediaIdsByAdCode(
    db,
    parsedRows.map((row) => row.adCode)
  )

  const summaryRows = parsedRows.map((row): MediaSummaryDailyRow => ({
    ...row,
    mediaId: mediaIdsByAdCode.get(row.adCode) ?? null,
  }))

  logUploadInfo('buildMediaSummaryDailyRows completed', {
    builtRows: summaryRows.length,
    linkedMediaRows: summaryRows.filter((row) => row.mediaId !== null).length,
    unlinkedMediaRows: summaryRows.filter((row) => row.mediaId === null).length,
  })

  return summaryRows
}

async function buildPaymentReportDailyRows(
  db: D1Database,
  rows: CsvRows,
  uploadHistoryId: number
) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  const headerIndex = buildHeaderIndex(headerRow)
  logUploadInfo('buildPaymentReportDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
    dateBasis: 'registration_date',
  })

  ensureHeaders(headerIndex, [
    PAYMENT_REPORT_HEADERS.siteName,
    PAYMENT_REPORT_HEADERS.customerId,
    PAYMENT_REPORT_HEADERS.adCode,
    PAYMENT_REPORT_HEADERS.registrationStatus,
    PAYMENT_REPORT_HEADERS.registrationAt,
    PAYMENT_REPORT_HEADERS.firstPaymentAt,
    PAYMENT_REPORT_HEADERS.paymentCount,
    PAYMENT_REPORT_HEADERS.paymentAmount,
    PAYMENT_REPORT_HEADERS.mediaType,
  ])

  const parsedRows = bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
    const registrationAt = getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.registrationAt.aliases)
    const registrationDate = parseTargetDate(registrationAt)
    if (!registrationDate) {
      throw new Error(`${index + 2}行目の登録日時が正しくありません`)
    }

    const adCode = getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.adCode.aliases)
    if (!adCode) {
      throw new Error(`${index + 2}行目の広告コードが空です`)
    }

    const customerId = getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.customerId.aliases)
    if (!customerId) {
      throw new Error(`${index + 2}行目の顧客IDが空です`)
    }

    return {
      registrationDate,
      siteName: getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.siteName.aliases),
      customerId,
      adCode,
      registrationStatus: getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.registrationStatus.aliases),
      firstPaymentAt: normalizeDateTime(getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.firstPaymentAt.aliases)),
      paymentCount: parseInteger(getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.paymentCount.aliases)),
      paymentAmount: parseMoney(getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.paymentAmount.aliases)),
      mediaType: getCellByAliases(row, headerIndex, PAYMENT_REPORT_HEADERS.mediaType.aliases),
      uploadHistoryId,
    }
  })

  const mediaIdsByAdCode = await resolveMediaIdsByAdCode(
    db,
    parsedRows.map((row) => row.adCode)
  )

  const paymentRows = parsedRows.map((row): PaymentReportDailyRow => ({
    ...row,
    mediaId: mediaIdsByAdCode.get(row.adCode) ?? null,
  }))

  logUploadInfo('buildPaymentReportDailyRows completed', {
    builtRows: paymentRows.length,
    linkedMediaRows: paymentRows.filter((row) => row.mediaId !== null).length,
    unlinkedMediaRows: paymentRows.filter((row) => row.mediaId === null).length,
  })

  return paymentRows
}

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
    `SELECT id, file_type, media_id, file_name, row_count, target_date, status, uploaded_at
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
    csv_rows?: CsvRows
    csv_text?: string
  }>()

  const fileType = parseUploadFileType(body.file_type)
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''
  const rowCount = normalizeRowCount(body.row_count)

  if (!fileType || !fileName) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'file_type と file_name は必須です' },
      400
    )
  }

  const settings = await fetchAppSettings(c.env.DB)
  if (!isUploadFileTypeEnabled(fileType, settings)) {
    return c.json<ApiResponse<null>>(
      { success: false, error: `${UPLOAD_FILE_TYPE_LABELS[fileType]}は設定で無効化されています` },
      400
    )
  }

  let mediaId: number | null = null
  let mediaName = ''

  if (fileType === 'ad_media_csv') {
    const requestedMediaId = Number(body.media_id)
    if (!Number.isInteger(requestedMediaId) || requestedMediaId <= 0) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '稼働中の媒体を選択してください' },
        400
      )
    }

    const media = await c.env.DB.prepare(
      `SELECT id, media_name FROM media_master WHERE id = ? AND status = 'active'`
    )
      .bind(requestedMediaId)
      .first<{ id: number; media_name: string }>()

    if (!media) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '停止中または存在しない媒体は取込対象外です' },
        400
      )
    }

    mediaId = requestedMediaId
    mediaName = media.media_name
  }

  const csvRows =
    fileType === 'ad_media_csv' ||
    fileType === 'site_summary_csv' ||
    fileType === 'payment_report_csv'
      ? normalizeCsvRows(body.csv_rows, body.csv_text)
      : []

  if (
    fileType === 'ad_media_csv' ||
    fileType === 'site_summary_csv' ||
    fileType === 'payment_report_csv'
  ) {
    logUploadInfo('CSV detail payload received', {
      fileType,
      fileName,
      rowCount,
      csvRows: csvRows.length,
      bodyRows: countBodyRows(csvRows),
      hasCsvRows: Array.isArray(body.csv_rows),
      csvTextLength: typeof body.csv_text === 'string' ? body.csv_text.length : 0,
      headers: csvRows[0] ?? [],
      normalizedHeaders: csvRows[0]?.map((header) => normalizeHeader(header)) ?? [],
    })
  }

  if (
    (
      fileType === 'ad_media_csv' ||
      fileType === 'site_summary_csv' ||
      fileType === 'payment_report_csv'
    ) &&
    csvRows.length === 0
  ) {
    return c.json<ApiResponse<null>>(
      { success: false, error: `${UPLOAD_FILE_TYPE_LABELS[fileType]}の行データが送信されていません` },
      400
    )
  }

  if (
    (
      fileType === 'ad_media_csv' ||
      fileType === 'site_summary_csv' ||
      fileType === 'payment_report_csv'
    ) &&
    countBodyRows(csvRows) === 0
  ) {
    return c.json<ApiResponse<null>>(
      { success: false, error: `${UPLOAD_FILE_TYPE_LABELS[fileType]}に保存対象の明細行がありません` },
      400
    )
  }

  let preparedAdMediaRows: AdMediaDailyRow[] = []
  let preparedMediaSummaryRows: MediaSummaryDailyRow[] = []
  let preparedPaymentReportRows: PaymentReportDailyRow[] = []
  let adMediaDateRange: TargetDateRange | null = null
  let mediaSummaryDateRange: TargetDateRange | null = null
  let paymentReportDateRange: TargetDateRange | null = null
  const exchangeRates = fileType === 'ad_media_csv'
    ? await fetchExchangeRates(c.env.DB)
    : {}

  try {
    if (fileType === 'ad_media_csv') {
      preparedAdMediaRows = aggregateAdMediaRows(
        buildAdMediaDailyRows(
          csvRows,
          mediaId,
          mediaName,
          exchangeRates,
          0
        )
      )
      adMediaDateRange = getTargetDateRange(preparedAdMediaRows)

      logUploadInfo('ad_media_daily prepared rows', {
        preparedRows: preparedAdMediaRows.length,
        minTargetDate: adMediaDateRange.minDate,
        maxTargetDate: adMediaDateRange.maxDate,
      })

      if (preparedAdMediaRows.length === 0) {
        throw new Error('広告媒体CSVに保存対象の明細行がありません')
      }
    }

    if (fileType === 'site_summary_csv') {
      preparedMediaSummaryRows = aggregateMediaSummaryRows(
        await buildMediaSummaryDailyRows(
          c.env.DB,
          csvRows,
          0
        )
      )
      mediaSummaryDateRange = getTargetDateRange(preparedMediaSummaryRows)

      logUploadInfo('media_summary_daily prepared rows', {
        preparedRows: preparedMediaSummaryRows.length,
        minTargetDate: mediaSummaryDateRange.minDate,
        maxTargetDate: mediaSummaryDateRange.maxDate,
        linkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId === null).length,
      })

      if (preparedMediaSummaryRows.length === 0) {
        throw new Error('媒体集計CSVに保存対象の明細行がありません')
      }
    }

    if (fileType === 'payment_report_csv') {
      preparedPaymentReportRows = aggregatePaymentReportRows(
        await buildPaymentReportDailyRows(
          c.env.DB,
          csvRows,
          0
        )
      )
      paymentReportDateRange = getRegistrationDateRange(preparedPaymentReportRows)

      logUploadInfo('payment_report_daily prepared rows', {
        preparedRows: preparedPaymentReportRows.length,
        minTargetDate: paymentReportDateRange.minDate,
        maxTargetDate: paymentReportDateRange.maxDate,
        linkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId === null).length,
        dateBasis: 'registration_date',
      })

      if (preparedPaymentReportRows.length === 0) {
        throw new Error('決済レポートCSVに保存対象の明細行がありません')
      }

      const unlinkedPaymentAdCodes = uniqueStrings(
        preparedPaymentReportRows
          .filter((row) => row.mediaId === null)
          .map((row) => row.adCode)
      )
      if (unlinkedPaymentAdCodes.length > 0) {
        const examples = unlinkedPaymentAdCodes.slice(0, 10).join(', ')
        const suffix = unlinkedPaymentAdCodes.length > 10 ? ' ほか' : ''
        throw new Error(
          `決済レポートに媒体を特定できない広告コードがあります。キャンペーンマスタを確認してください: ${examples}${suffix}`
        )
      }
    }
  } catch (err) {
    logUploadError('detail preparation failed before upload_history insert', {
      fileType,
      error: err instanceof Error ? err.message : String(err),
    })
    const message = err instanceof Error
      ? err.message
      : `${UPLOAD_FILE_TYPE_LABELS[fileType]}の明細解析に失敗しました`
    return c.json<ApiResponse<null>>(
      { success: false, error: message },
      400
    )
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
      rowCount
    )
    .run()

  const uploadHistoryId = await resolveUploadHistoryId(
    c.env.DB,
    result,
    fileType,
    mediaId,
    fileName,
    rowCount
  )

  if (!uploadHistoryId) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'アップロード履歴IDを取得できませんでした' },
      500
    )
  }

  let savedRows = 0

  try {
    if (fileType === 'ad_media_csv') {
      savedRows = preparedAdMediaRows.length
      logUploadInfo('ad_media_daily insert target rows', {
        uploadHistoryId,
        savedRows,
      })

      if (savedRows === 0) {
        throw new Error('広告媒体CSVに保存対象の明細行がありません')
      }

      for (let i = 0; i < preparedAdMediaRows.length; i += INSERT_BATCH_SIZE) {
        const chunk = preparedAdMediaRows.slice(i, i + INSERT_BATCH_SIZE)
        await c.env.DB.batch(
          chunk.map((row) =>
            c.env.DB.prepare(
              `INSERT OR REPLACE INTO ad_media_daily
                 (target_date, media_id, account_name, account_id,
                  campaign_name, campaign_id, clicks, served_ads,
                  impressions, spend, media_cv, currency, upload_history_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
              row.mediaCv,
              row.currency,
              uploadHistoryId
            )
          )
        )
      }
      logUploadInfo('ad_media_daily insert completed', {
        uploadHistoryId,
        savedRows,
      })

      if (adMediaDateRange) {
        await deleteOldAdMediaRowsInRange(
          c.env.DB,
          mediaId,
          adMediaDateRange,
          uploadHistoryId
        )
        logUploadInfo('ad_media_daily old rows cleaned', {
          uploadHistoryId,
          mediaId,
          minTargetDate: adMediaDateRange.minDate,
          maxTargetDate: adMediaDateRange.maxDate,
        })
      }
    }

    if (fileType === 'site_summary_csv') {
      savedRows = preparedMediaSummaryRows.length
      logUploadInfo('media_summary_daily insert target rows', {
        uploadHistoryId,
        savedRows,
        linkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId === null).length,
      })

      if (savedRows === 0) {
        throw new Error('媒体集計CSVに保存対象の明細行がありません')
      }

      for (let i = 0; i < preparedMediaSummaryRows.length; i += INSERT_BATCH_SIZE) {
        const chunk = preparedMediaSummaryRows.slice(i, i + INSERT_BATCH_SIZE)
        await c.env.DB.batch(
          chunk.map((row) =>
            c.env.DB.prepare(
              `INSERT OR REPLACE INTO media_summary_daily
                 (target_date, media_id, ad_code, access_count,
                  registration_count, provisional_registration_count,
                  upload_history_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              row.targetDate,
              row.mediaId,
              row.adCode,
              row.accessCount,
              row.registrationCount,
              row.provisionalRegistrationCount,
              uploadHistoryId
            )
          )
        )
      }
      logUploadInfo('media_summary_daily insert completed', {
        uploadHistoryId,
        savedRows,
      })

      if (mediaSummaryDateRange) {
        await deleteOldMediaSummaryRowsInRange(
          c.env.DB,
          preparedMediaSummaryRows,
          mediaSummaryDateRange,
          uploadHistoryId
        )
        logUploadInfo('media_summary_daily old rows cleaned', {
          uploadHistoryId,
          minTargetDate: mediaSummaryDateRange.minDate,
          maxTargetDate: mediaSummaryDateRange.maxDate,
          mediaIds: uniqueNumbers(preparedMediaSummaryRows.map((row) => row.mediaId)).length,
          unlinkedAdCodes: uniqueStrings(
            preparedMediaSummaryRows
              .filter((row) => row.mediaId === null)
              .map((row) => row.adCode)
          ).length,
        })
      }
    }

    if (fileType === 'payment_report_csv') {
      savedRows = preparedPaymentReportRows.length
      logUploadInfo('payment_report_daily insert target rows', {
        uploadHistoryId,
        savedRows,
        linkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId === null).length,
        dateBasis: 'registration_date',
      })

      if (savedRows === 0) {
        throw new Error('決済レポートCSVに保存対象の明細行がありません')
      }

      if (paymentReportDateRange) {
        const cleanupResult = await deleteOldPaymentReportRowsInRange(
          c.env.DB,
          preparedPaymentReportRows,
          paymentReportDateRange,
          uploadHistoryId
        )
        logUploadInfo('payment_report_daily old rows cleaned before insert', {
          uploadHistoryId,
          minTargetDate: paymentReportDateRange.minDate,
          maxTargetDate: paymentReportDateRange.maxDate,
          mediaIds: uniqueNumbers(preparedPaymentReportRows.map((row) => row.mediaId)).length,
          targetAdCodes: uniqueStrings(preparedPaymentReportRows.map((row) => row.adCode)).length,
          deletedLinkedMediaRows: cleanupResult.deletedLinkedMediaRows,
          deletedNullMediaRows: cleanupResult.deletedNullMediaRows,
        })
      }

      for (let i = 0; i < preparedPaymentReportRows.length; i += INSERT_BATCH_SIZE) {
        const chunk = preparedPaymentReportRows.slice(i, i + INSERT_BATCH_SIZE)
        await c.env.DB.batch(
          chunk.map((row) =>
            c.env.DB.prepare(
              `INSERT OR REPLACE INTO payment_report_daily
                 (registration_date, site_name, customer_id, ad_code,
                  registration_status, first_payment_at, payment_count,
                  payment_amount, media_type, media_id, upload_history_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              row.registrationDate,
              row.siteName,
              row.customerId,
              row.adCode,
              row.registrationStatus,
              row.firstPaymentAt,
              row.paymentCount,
              row.paymentAmount,
              row.mediaType,
              row.mediaId,
              uploadHistoryId
            )
          )
        )
      }
      logUploadInfo('payment_report_daily insert completed', {
        uploadHistoryId,
        savedRows,
      })
    }
  } catch (err) {
    logUploadError('detail insert failed', {
      fileType,
      uploadHistoryId,
      error: err instanceof Error ? err.message : String(err),
    })
    const message = err instanceof Error
      ? err.message
      : `${UPLOAD_FILE_TYPE_LABELS[fileType]}の明細保存に失敗しました`
    return c.json<ApiResponse<null>>(
      { success: false, error: message },
      400
    )
  }

  return c.json<ApiResponse<{ id: number; saved_rows: number }>>({
    success: true,
    data: { id: uploadHistoryId, saved_rows: savedRows },
  })
})
