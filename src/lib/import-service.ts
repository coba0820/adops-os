// ============================================================
// 取込処理（行データ → パース → マスタ補完 → 旧データ削除 → 保存）
// 手動アップロード（/api/upload）とスプレッドシート同期の両方から使う。
// ============================================================
import type { ImportMethod, UploadFileType } from '../types'
import { fetchAppSettings } from './settings'
import {
  hasDedicatedAdMediaParser,
  parseAdMediaRows,
  parseMappedAdMediaRows,
  type AdMediaColumnMapping,
} from './ad-media-parsers'

export const UPLOAD_FILE_TYPE_LABELS: Record<UploadFileType, string> = {
  ad_media_csv: '広告媒体CSV',
  site_summary_csv: '媒体集計CSV',
  payment_report_csv: '決済レポートCSV',
}

export function isUploadFileTypeEnabled(
  fileType: UploadFileType,
  settings: Awaited<ReturnType<typeof fetchAppSettings>>
) {
  const importSettings = settings.import ?? {}
  if (fileType === 'ad_media_csv') return importSettings.enable_ad_media_csv !== false
  if (fileType === 'site_summary_csv') return importSettings.enable_site_summary_csv !== false
  if (fileType === 'payment_report_csv') return importSettings.enable_payment_report_csv !== false
  return true
}

const INSERT_BATCH_SIZE = 25
const LOOKUP_BATCH_SIZE = 50

export type UploadDataSource = 'YNS' | 'INTERNAL'

export type CsvRows = string[][]

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
  siteName: string
  accessCount: number
  registrationCount: number
  provisionalRegistrationCount: number
  dataSource: UploadDataSource
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
  dataSource: UploadDataSource
  uploadHistoryId: number
}

type HeaderDefinition = {
  label: string
  aliases: string[]
}

export type TargetDateRange = {
  minDate: string
  maxDate: string
}

export type UploadWarning = {
  type: 'unregistered_ad_codes' | 'auto_registered_ad_codes'
  message: string
  count: number
  ad_codes: string[]
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
  siteName: {
    label: 'サイト',
    aliases: ['サイト', 'サイト名', 'サイト名称', 'site', 'Site', 'site_name'],
  },
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

const INTERNAL_MEDIA_SUMMARY_HEADERS: Record<string, HeaderDefinition> = {
  siteName: {
    label: 'サイト名',
    aliases: ['サイト名', 'サイト', 'site_name', 'site'],
  },
  date: {
    label: '日付',
    aliases: ['日付', '日付け', 'Date', '年月日', '対象日', '集計日', '発生日', '成果日', 'クリック日'],
  },
  adCode: {
    label: '広告コード',
    aliases: ['広告コード', 'コード', '広告CD', '広告コード名', 'Ad Code', 'ad_code', 'Campaign ID', 'campaign_id'],
  },
  accessCount: {
    label: 'LPクリック',
    aliases: ['LPクリック', 'LPクリック数', 'lp_click', 'lp_clicks', 'LP Click', 'LP Clicks'],
  },
  registrationCount: {
    label: '本登録',
    aliases: ['本登録', '本登録数', '本登録者数', '登録完了', '登録完了数', 'Registration', 'registration'],
  },
  provisionalRegistrationCount: {
    label: '仮登録',
    aliases: ['仮登録', '仮登録数', '仮登録者数', '仮会員登録', '仮会員登録数', 'Provisional Registration', 'provisional_registration'],
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

const INTERNAL_PAYMENT_REPORT_HEADERS: Record<string, HeaderDefinition> = {
  siteName: { label: 'サイト名', aliases: ['サイト名', 'サイト', 'site', 'site_name'] },
  customerId: { label: '会員ID', aliases: ['会員ID', '会員Id', '会員id', '顧客ID', 'customer_id', 'member_id', 'user_id'] },
  adCode: { label: '広告コード', aliases: ['広告コード', '広告CD', '広告コード名', 'ad_code', 'Ad Code'] },
  registrationStatus: { label: '登録状態', aliases: ['登録状態', '会員状態', 'ステータス', 'status', 'registration_status'] },
  registrationAt: { label: '本登録日', aliases: ['本登録日', '登録日時', '登録日', '登録日付', '入会日時', '入会日', 'registration_at', 'registered_at'] },
  firstPaymentAt: { label: '初回購入日時', aliases: ['初回購入日時', '初回入金日時', '初回課金日時', '初回決済日時', 'first_payment_at'] },
  paymentCount: { label: '入金回数', aliases: ['期間内入金回数', '期間内決済回数', '入金回数', '課金回数', '決済回数', 'payment_count'] },
  paymentAmount: { label: '期間内金額', aliases: ['期間内金額', '期間内入金額', '期間内売上', '入金額', '売上', '売上金額', '課金額', '決済金額', 'payment_amount'] },
  mediaType: { label: '媒体種別', aliases: ['媒体種別', '媒体タイプ', '流入元', 'media_type'] },
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

export function normalizeCsvRows(csvRows: unknown, csvText: unknown): CsvRows {
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

export function parseUploadFileType(fileType: unknown): UploadFileType | null {
  if (
    fileType === 'ad_media_csv' ||
    fileType === 'site_summary_csv' ||
    fileType === 'payment_report_csv'
  ) {
    return fileType
  }
  return null
}

export function parseUploadDataSource(value: unknown): UploadDataSource {
  const normalized = String(value ?? 'YNS').trim().toUpperCase()
  if (normalized === 'INTERNAL' || normalized === '自社システム') return 'INTERNAL'
  return 'YNS'
}

export function normalizeHeader(header: unknown) {
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

function detectMediaSummaryParser(
  fileName: string,
  headerIndex: Map<string, number>,
  dataSource: UploadDataSource
) {
  void fileName
  void headerIndex
  return dataSource === 'INTERNAL' ? 'internal' : 'yns'
}

function detectPaymentReportParser(
  fileName: string,
  headerIndex: Map<string, number>,
  dataSource: UploadDataSource
) {
  void fileName
  void headerIndex
  return dataSource === 'INTERNAL' ? 'internal' : 'yns'
}

type ParsedMediaSummaryRow = Omit<MediaSummaryDailyRow, 'mediaId'>
type ParsedPaymentReportRow = Omit<PaymentReportDailyRow, 'mediaId'>

const MediaSummaryParser = {
  ynsParser(
    headerIndex: Map<string, number>,
    bodyRows: CsvRows,
    uploadHistoryId: number,
    dataSource: UploadDataSource
  ): ParsedMediaSummaryRow[] {
    ensureHeaders(headerIndex, [
      MEDIA_SUMMARY_HEADERS.siteName,
      MEDIA_SUMMARY_HEADERS.date,
      MEDIA_SUMMARY_HEADERS.adCode,
      MEDIA_SUMMARY_HEADERS.accessCount,
      MEDIA_SUMMARY_HEADERS.registrationCount,
      MEDIA_SUMMARY_HEADERS.provisionalRegistrationCount,
    ])

    return bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
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
        siteName: getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.siteName.aliases),
        accessCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.accessCount.aliases)),
        registrationCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.registrationCount.aliases)),
        provisionalRegistrationCount: parseInteger(getCellByAliases(row, headerIndex, MEDIA_SUMMARY_HEADERS.provisionalRegistrationCount.aliases)),
        dataSource,
        uploadHistoryId,
      }
    })
  },

  internalParser(
    headerIndex: Map<string, number>,
    bodyRows: CsvRows,
    uploadHistoryId: number,
    dataSource: UploadDataSource
  ): ParsedMediaSummaryRow[] {
    ensureHeaders(headerIndex, [
      INTERNAL_MEDIA_SUMMARY_HEADERS.siteName,
      INTERNAL_MEDIA_SUMMARY_HEADERS.date,
      INTERNAL_MEDIA_SUMMARY_HEADERS.adCode,
      INTERNAL_MEDIA_SUMMARY_HEADERS.accessCount,
      INTERNAL_MEDIA_SUMMARY_HEADERS.registrationCount,
    ])

    return bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
      const targetDate = parseTargetDate(getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.date.aliases))
      if (!targetDate) {
        throw new Error(`${index + 2}行目の日付が正しくありません`)
      }

      const adCode = getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.adCode.aliases)
      if (!adCode) {
        throw new Error(`${index + 2}行目の広告コードが空です`)
      }

      return {
        targetDate,
        adCode,
        siteName: getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.siteName.aliases),
        accessCount: parseInteger(getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.accessCount.aliases)),
        registrationCount: parseInteger(getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.registrationCount.aliases)),
        provisionalRegistrationCount: parseInteger(getCellByAliases(row, headerIndex, INTERNAL_MEDIA_SUMMARY_HEADERS.provisionalRegistrationCount.aliases)),
        dataSource,
        uploadHistoryId,
      }
    })
  },
}

const PaymentReportParser = {
  ynsParser(
    headerIndex: Map<string, number>,
    bodyRows: CsvRows,
    uploadHistoryId: number,
    dataSource: UploadDataSource
  ): ParsedPaymentReportRow[] {
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

    return bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
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
        dataSource,
        uploadHistoryId,
      }
    })
  },

  internalParser(
    headerIndex: Map<string, number>,
    bodyRows: CsvRows,
    uploadHistoryId: number,
    dataSource: UploadDataSource
  ): ParsedPaymentReportRow[] {
    ensureHeaders(headerIndex, [
      INTERNAL_PAYMENT_REPORT_HEADERS.siteName,
      INTERNAL_PAYMENT_REPORT_HEADERS.customerId,
      INTERNAL_PAYMENT_REPORT_HEADERS.adCode,
      INTERNAL_PAYMENT_REPORT_HEADERS.registrationAt,
      INTERNAL_PAYMENT_REPORT_HEADERS.paymentAmount,
    ])

    return bodyRows.filter((row) => !isBlankRow(row)).map((row, index) => {
      const registrationAt = getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.registrationAt.aliases)
      const registrationDate = parseTargetDate(registrationAt)
      if (!registrationDate) {
        throw new Error(`${index + 2}行目の登録日時が正しくありません`)
      }

      const adCode = getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.adCode.aliases)
      if (!adCode) {
        throw new Error(`${index + 2}行目の広告コードが空です`)
      }

      const customerId = getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.customerId.aliases)
      if (!customerId) {
        throw new Error(`${index + 2}行目の会員IDが空です`)
      }

      const paymentAmount = parseMoney(getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.paymentAmount.aliases))
      const rawPaymentCount = getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.paymentCount.aliases)

      return {
        registrationDate,
        siteName: getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.siteName.aliases),
        customerId,
        adCode,
        registrationStatus: getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.registrationStatus.aliases),
        firstPaymentAt: normalizeDateTime(getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.firstPaymentAt.aliases)),
        paymentCount: rawPaymentCount ? parseInteger(rawPaymentCount) : paymentAmount > 0 ? 1 : 0,
        paymentAmount,
        mediaType: getCellByAliases(row, headerIndex, INTERNAL_PAYMENT_REPORT_HEADERS.mediaType.aliases),
        dataSource,
        uploadHistoryId,
      }
    })
  },
}

export function normalizeRowCount(rowCount: unknown) {
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

export function countBodyRows(rows: CsvRows) {
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
      row.dataSource,
    ].join('|')
    const current = rowsByKey.get(key)

    if (!current) {
      rowsByKey.set(key, { ...row })
      continue
    }

    current.accessCount += row.accessCount
    current.registrationCount += row.registrationCount
    current.provisionalRegistrationCount += row.provisionalRegistrationCount
    current.siteName = row.siteName || current.siteName
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
      row.dataSource,
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

async function fetchRowsByTextKey<T extends Record<string, unknown>>(
  db: D1Database,
  tableName: string,
  keyColumn: string,
  values: string[],
  selectSql: string
) {
  const uniqueValues = uniqueStrings(values)
  const rows: T[] = []

  for (let i = 0; i < uniqueValues.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = uniqueValues.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    const { results } = await db.prepare(
      `${selectSql}
       FROM ${tableName}
       WHERE ${keyColumn} IN (${placeholders})`
    )
      .bind(...chunk)
      .all<T>()

    rows.push(...results)
  }

  return rows
}

async function getOrCreateUnspecifiedMediaId(db: D1Database) {
  const existing = await db.prepare(
    `SELECT id
     FROM media_master
     WHERE media_name = '未設定'
     ORDER BY id ASC
     LIMIT 1`
  ).first<{ id: number }>()

  if (existing?.id) return existing.id

  const result = await db.prepare(
    `INSERT INTO media_master
       (media_name, status, currency)
     VALUES ('未設定', 'paused', 'JPY')`
  ).run()

  const id = result.meta.last_row_id ?? null
  if (!id) throw new Error('未設定媒体の作成に失敗しました')
  return id
}

async function ensureSitesByNames(db: D1Database, siteNames: string[]) {
  const uniqueSiteNames = uniqueStrings(siteNames)
  const siteByName = new Map<string, { id: number; site_name: string }>()

  const existingSites = await fetchRowsByTextKey<{ id: number; site_name: string }>(
    db,
    'site_master',
    'site_name',
    uniqueSiteNames,
    'SELECT id, site_name'
  )
  existingSites.forEach((site) => siteByName.set(site.site_name, site))

  for (const siteName of uniqueSiteNames) {
    if (siteByName.has(siteName)) continue

    const result = await db.prepare(
      `INSERT INTO site_master
         (site_name)
       VALUES (?)`
    )
      .bind(siteName)
      .run()

    const id = result.meta.last_row_id ?? null
    if (id) siteByName.set(siteName, { id, site_name: siteName })
  }

  return siteByName
}

async function syncAdCodesFromCampaignRows(
  db: D1Database,
  rows: Array<{ id: number; ad_code: string; media_id: number | null }>
) {
  const adCodes = new Map<string, { id: number; ad_code: string; media_id: number | null }>()
  rows.forEach((row) => {
    const adCode = row.ad_code.trim()
    if (adCode && !adCodes.has(adCode)) {
      adCodes.set(adCode, { ...row, ad_code: adCode })
    }
  })

  const targets = [...adCodes.values()]
  if (targets.length === 0) {
    return {
      syncedAdCodeCount: 0,
      adCodesSyncSkipped: false,
    }
  }

  try {
    for (let i = 0; i < targets.length; i += INSERT_BATCH_SIZE) {
      const chunk = targets.slice(i, i + INSERT_BATCH_SIZE)
      await db.batch(
        chunk.map((row) =>
          db.prepare(
            `INSERT INTO ad_codes
               (id, media_id, ad_code, is_active)
             VALUES (?, ?, ?, 1)
             ON CONFLICT(ad_code) DO UPDATE SET
               media_id = COALESCE(ad_codes.media_id, excluded.media_id),
               updated_at = CURRENT_TIMESTAMP`
          )
            .bind(row.id, row.media_id, row.ad_code)
        )
      )
    }

    return {
      syncedAdCodeCount: targets.length,
      adCodesSyncSkipped: false,
    }
  } catch (err) {
    logUploadError('ad_codes auto sync failed', {
      error: err instanceof Error ? err.message : String(err),
      targetAdCodes: targets.length,
    })

    return {
      syncedAdCodeCount: 0,
      adCodesSyncSkipped: true,
    }
  }
}

async function ensureAdCodesAndSitesFromSiteRows(
  db: D1Database,
  rows: Array<{ adCode: string; siteName: string }>
) {
  const siteRows = rows
    .map((row) => ({
      adCode: row.adCode.trim(),
      siteName: row.siteName.trim(),
    }))
    .filter((row) => row.adCode && row.siteName)

  if (siteRows.length === 0) {
    return {
      createdAdCodes: [] as string[],
      linkedPairCount: 0,
      syncedAdCodeCount: 0,
      adCodesSyncSkipped: false,
    }
  }

  const siteByName = await ensureSitesByNames(db, siteRows.map((row) => row.siteName))
  const adCodeByCode = new Map<string, { id: number; ad_code: string; media_id: number | null }>()
  const existingAdCodes = await fetchRowsByTextKey<{ id: number; ad_code: string; media_id: number | null }>(
    db,
    'campaign_master',
    'ad_code',
    siteRows.map((row) => row.adCode),
    'SELECT id, ad_code, media_id'
  )
  existingAdCodes.forEach((row) => {
    const key = row.ad_code?.trim()
    if (key && !adCodeByCode.has(key)) adCodeByCode.set(key, row)
  })

  const firstSiteByAdCode = new Map<string, number>()
  for (const row of siteRows) {
    const site = siteByName.get(row.siteName)
    if (site && !firstSiteByAdCode.has(row.adCode)) {
      firstSiteByAdCode.set(row.adCode, site.id)
    }
  }

  const createdAdCodes: string[] = []
  const missingAdCodes = uniqueStrings(siteRows.map((row) => row.adCode))
    .filter((adCode) => !adCodeByCode.has(adCode))
  let unspecifiedMediaId: number | null = null

  for (const adCode of missingAdCodes) {
    const siteId = firstSiteByAdCode.get(adCode)
    if (!siteId) continue
    if (!unspecifiedMediaId) unspecifiedMediaId = await getOrCreateUnspecifiedMediaId(db)

    const result = await db.prepare(
      `INSERT INTO campaign_master
         (campaign_name, media_id, ad_code, site_id, is_active)
       VALUES ('', ?, ?, ?, 1)`
    )
      .bind(unspecifiedMediaId, adCode, siteId)
      .run()

    const id = result.meta.last_row_id ?? null
    if (id) {
      adCodeByCode.set(adCode, { id, ad_code: adCode, media_id: unspecifiedMediaId })
      createdAdCodes.push(adCode)
    }
  }

  const adCodeSync = await syncAdCodesFromCampaignRows(db, [...adCodeByCode.values()])

  const pairKeys = new Set<string>()
  const statements: D1PreparedStatement[] = []
  for (const row of siteRows) {
    const adCode = adCodeByCode.get(row.adCode)
    const site = siteByName.get(row.siteName)
    if (!adCode || !site) continue

    const key = `${adCode.id}:${site.id}`
    if (pairKeys.has(key)) continue
    pairKeys.add(key)

    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO ad_code_sites
           (ad_code_id, site_id)
         VALUES (?, ?)`
      )
        .bind(adCode.id, site.id)
    )
  }

  for (let i = 0; i < statements.length; i += INSERT_BATCH_SIZE) {
    await db.batch(statements.slice(i, i + INSERT_BATCH_SIZE))
  }

  return {
    createdAdCodes,
    linkedPairCount: pairKeys.size,
    ...adCodeSync,
  }
}

async function ensureCampaignsFromAdMediaRows(
  db: D1Database,
  mediaId: number,
  rows: AdMediaDailyRow[]
) {
  const campaignNames = uniqueStrings(rows.map((row) => row.campaignName))
  for (let i = 0; i < campaignNames.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = campaignNames.slice(i, i + LOOKUP_BATCH_SIZE)
    await db.batch(
      chunk.map((campaignName) =>
        db.prepare(
          `INSERT OR IGNORE INTO campaigns
             (media_id, campaign_name, is_active)
           VALUES (?, ?, 1)`
        )
          .bind(mediaId, campaignName)
      )
    )
  }

  return campaignNames.length
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
  const dataSources = [...new Set(rows.map((row) => row.dataSource))]
  for (let i = 0; i < mediaIds.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = mediaIds.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    for (const dataSource of dataSources) {
      await db.prepare(
        `DELETE FROM media_summary_daily
         WHERE target_date BETWEEN ? AND ?
           AND media_id IN (${placeholders})
           AND data_source = ?
           AND upload_history_id <> ?`
      )
        .bind(range.minDate, range.maxDate, ...chunk, dataSource, uploadHistoryId)
        .run()
    }
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
    for (const dataSource of dataSources) {
      await db.prepare(
        `DELETE FROM media_summary_daily
         WHERE target_date BETWEEN ? AND ?
           AND media_id IS NULL
           AND ad_code IN (${placeholders})
           AND data_source = ?
           AND upload_history_id <> ?`
      )
        .bind(range.minDate, range.maxDate, ...chunk, dataSource, uploadHistoryId)
        .run()
    }
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

async function fetchAdMediaColumnMappings(db: D1Database, mediaId: number): Promise<AdMediaColumnMapping[]> {
  try {
    const { results } = await db.prepare(
      `SELECT field_key, source_column
       FROM media_column_mappings
       WHERE media_id = ?
         AND is_active = 1
       ORDER BY id ASC`
    )
      .bind(mediaId)
      .all<{ field_key: AdMediaColumnMapping['fieldKey']; source_column: string }>()

    return results.map((row) => ({
      fieldKey: row.field_key,
      sourceColumn: row.source_column,
    }))
  } catch (err) {
    return []
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
  const dataSources = [...new Set(rows.map((row) => row.dataSource))]
  for (let i = 0; i < mediaIds.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = mediaIds.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    for (const dataSource of dataSources) {
      const result = await db.prepare(
        `DELETE FROM payment_report_daily
         WHERE registration_date BETWEEN ? AND ?
           AND media_id IN (${placeholders})
           AND data_source = ?
           AND upload_history_id <> ?`
      )
        .bind(range.minDate, range.maxDate, ...chunk, dataSource, uploadHistoryId)
        .run()
      deletedLinkedMediaRows += Number(result.meta?.changes ?? 0)
    }
  }

  const targetAdCodes = uniqueStrings(rows.map((row) => row.adCode))
  for (let i = 0; i < targetAdCodes.length; i += LOOKUP_BATCH_SIZE) {
    const chunk = targetAdCodes.slice(i, i + LOOKUP_BATCH_SIZE)
    if (chunk.length === 0) continue

    const placeholders = chunk.map(() => '?').join(', ')
    for (const dataSource of dataSources) {
      const result = await db.prepare(
        `DELETE FROM payment_report_daily
         WHERE registration_date BETWEEN ? AND ?
           AND media_id IS NULL
           AND ad_code IN (${placeholders})
           AND data_source = ?
           AND upload_history_id <> ?`
      )
        .bind(range.minDate, range.maxDate, ...chunk, dataSource, uploadHistoryId)
        .run()
      deletedNullMediaRows += Number(result.meta?.changes ?? 0)
    }
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
  mediaCurrency: 'JPY' | 'USD',
  exchangeRates: Record<string, number>,
  uploadHistoryId: number,
  columnMappings: AdMediaColumnMapping[]
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
    parserType: hasDedicatedAdMediaParser(mediaName) ? 'dedicated' : 'mapping',
    hasColumnMappings: columnMappings.length > 0,
  })

  let commonRows: ReturnType<typeof parseAdMediaRows> | null = null
  let dedicatedParserError: string | null = null

  if (hasDedicatedAdMediaParser(mediaName)) {
    try {
      commonRows = parseAdMediaRows(rows, { mediaName, exchangeRates })
      logUploadInfo('ad_media dedicated parser completed', {
        mediaId,
        mediaName,
        parsedRows: commonRows.length,
      })
    } catch (err) {
      dedicatedParserError = err instanceof Error ? err.message : String(err)
      logUploadError('ad_media dedicated parser failed', {
        mediaId,
        mediaName,
        error: dedicatedParserError,
        hasColumnMappings: columnMappings.length > 0,
      })
    }
  }

  if (!commonRows && columnMappings.length > 0) {
    try {
      commonRows = parseMappedAdMediaRows(rows, {
        mediaName,
        exchangeRates,
        currency: mediaCurrency,
        mappings: columnMappings,
      })
      logUploadInfo('ad_media column mapping parser completed', {
        mediaId,
        mediaName,
        parsedRows: commonRows.length,
        fallbackFromDedicatedParser: Boolean(dedicatedParserError),
      })
    } catch (err) {
      const mappedParserError = err instanceof Error ? err.message : String(err)
      if (dedicatedParserError) {
        throw new Error([
          dedicatedParserError,
          `保存済みのCSV列マッピングでも解析できませんでした: ${mappedParserError}`,
        ].join('\n'))
      }
      throw err
    }
  }

  if (!commonRows) {
    if (dedicatedParserError) {
      throw new Error([
        dedicatedParserError,
        '',
        `${mediaName}のCSV列マッピングを設定してください。`,
      ].join('\n'))
    }

    commonRows = parseMappedAdMediaRows(rows, {
      mediaName,
      exchangeRates,
      currency: mediaCurrency,
      mappings: columnMappings,
    })
  }

  return commonRows.map((row): AdMediaDailyRow => ({
    ...row,
    mediaId,
    uploadHistoryId,
  }))
}

function buildAdMediaMappingRequiredError(mediaName: string) {
  return [
    `${mediaName}の列マッピングが設定されていません。`,
    '',
    '未設定項目:',
    '・日付',
    '・広告費',
    '',
    '列マッピングを設定してください。',
  ].join('\n')
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
  uploadHistoryId: number,
  fileName: string,
  dataSource: UploadDataSource
) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  const headerIndex = buildHeaderIndex(headerRow)
  const parserType = detectMediaSummaryParser(fileName, headerIndex, dataSource)
  logUploadInfo('buildMediaSummaryDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    fileName,
    dataSource,
    parserType,
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
  })

  const parsedRows = parserType === 'internal'
    ? MediaSummaryParser.internalParser(headerIndex, bodyRows, uploadHistoryId, dataSource)
    : MediaSummaryParser.ynsParser(headerIndex, bodyRows, uploadHistoryId, dataSource)

  try {
    const autoRegistration = await ensureAdCodesAndSitesFromSiteRows(db, parsedRows)
    logUploadInfo('media_summary ad_code/site auto registration completed', {
      parserType,
      createdAdCodes: autoRegistration.createdAdCodes,
      linkedPairCount: autoRegistration.linkedPairCount,
      syncedAdCodeCount: autoRegistration.syncedAdCodeCount,
      adCodesSyncSkipped: autoRegistration.adCodesSyncSkipped,
    })
  } catch (err) {
    logUploadError('media_summary ad_code/site auto registration skipped', {
      parserType,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const mediaIdsByAdCode = await resolveMediaIdsByAdCode(
    db,
    parsedRows.map((row) => row.adCode)
  )

  const summaryRows = parsedRows.map((row): MediaSummaryDailyRow => ({
    ...row,
    mediaId: mediaIdsByAdCode.get(row.adCode) ?? null,
  }))

  logUploadInfo('buildMediaSummaryDailyRows completed', {
    parserType,
    builtRows: summaryRows.length,
    linkedMediaRows: summaryRows.filter((row) => row.mediaId !== null).length,
    unlinkedMediaRows: summaryRows.filter((row) => row.mediaId === null).length,
  })

  return summaryRows
}

async function buildPaymentReportDailyRows(
  db: D1Database,
  rows: CsvRows,
  uploadHistoryId: number,
  fileName: string,
  dataSource: UploadDataSource
) {
  const [headerRow, ...bodyRows] = rows
  if (!headerRow || headerRow.length === 0) {
    throw new Error('CSVヘッダー行が見つかりません')
  }

  const headerIndex = buildHeaderIndex(headerRow)
  const parserType = detectPaymentReportParser(fileName, headerIndex, dataSource)
  logUploadInfo('buildPaymentReportDailyRows called', {
    csvRows: rows.length,
    bodyRows: countBodyRows(rows),
    fileName,
    dataSource,
    parserType,
    headers: headerRow,
    normalizedHeaders: headerRow.map((header) => normalizeHeader(header)),
    dateBasis: 'registration_date',
  })

  const parsedRows = parserType === 'internal'
    ? PaymentReportParser.internalParser(headerIndex, bodyRows, uploadHistoryId, dataSource)
    : PaymentReportParser.ynsParser(headerIndex, bodyRows, uploadHistoryId, dataSource)

  try {
    const autoRegistration = await ensureAdCodesAndSitesFromSiteRows(db, parsedRows)
    logUploadInfo('payment_report ad_code/site auto registration completed', {
      parserType,
      createdAdCodes: autoRegistration.createdAdCodes,
      linkedPairCount: autoRegistration.linkedPairCount,
      syncedAdCodeCount: autoRegistration.syncedAdCodeCount,
      adCodesSyncSkipped: autoRegistration.adCodesSyncSkipped,
    })
  } catch (err) {
    logUploadError('payment_report ad_code/site auto registration skipped', {
      parserType,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const mediaIdsByAdCode = await resolveMediaIdsByAdCode(
    db,
    parsedRows.map((row) => row.adCode)
  )

  const paymentRows = parsedRows.map((row): PaymentReportDailyRow => ({
    ...row,
    mediaId: mediaIdsByAdCode.get(row.adCode) ?? null,
  }))

  logUploadInfo('buildPaymentReportDailyRows completed', {
    parserType,
    builtRows: paymentRows.length,
    linkedMediaRows: paymentRows.filter((row) => row.mediaId !== null).length,
    unlinkedMediaRows: paymentRows.filter((row) => row.mediaId === null).length,
  })

  return paymentRows
}

export type ImportRowsInput = {
  fileType: UploadFileType
  mediaId?: number | null
  dataSource?: UploadDataSource
  rows: CsvRows
  fileName: string
  rowCount?: number
  importMethod?: ImportMethod
}

export type ImportTotals = Record<string, number>

export type ImportRowsResult = {
  uploadHistoryId: number
  rowCount: number
  dateRange: TargetDateRange | null
  totals: ImportTotals
  warnings: UploadWarning[]
}

export class ImportError extends Error {
  status: 400 | 500

  constructor(message: string, status: 400 | 500 = 400) {
    super(message)
    this.name = 'ImportError'
    this.status = status
  }
}

function sumBy<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((total, row) => total + pick(row), 0)
}

export async function importRows(db: D1Database, input: ImportRowsInput): Promise<ImportRowsResult> {
  const { fileType, fileName } = input
  const dataSource = input.dataSource ?? 'YNS'
  const csvRows = input.rows
  const rowCount = input.rowCount ?? countBodyRows(csvRows)

  const settings = await fetchAppSettings(db)
  if (!isUploadFileTypeEnabled(fileType, settings)) {
    throw new ImportError(`${UPLOAD_FILE_TYPE_LABELS[fileType]}は設定で無効化されています`)
  }

  let mediaId: number | null = null
  let mediaName = ''
  let mediaCurrency: 'JPY' | 'USD' = 'JPY'

  if (fileType === 'ad_media_csv') {
    const requestedMediaId = Number(input.mediaId)
    if (!Number.isInteger(requestedMediaId) || requestedMediaId <= 0) {
      throw new ImportError('稼働中の媒体を選択してください')
    }

    const media = await db.prepare(
      `SELECT id, media_name, currency FROM media_master WHERE id = ? AND status = 'active'`
    )
      .bind(requestedMediaId)
      .first<{ id: number; media_name: string; currency: string | null }>()

    if (!media) {
      throw new ImportError('停止中または存在しない媒体は取込対象外です')
    }

    mediaId = requestedMediaId
    mediaName = media.media_name
    mediaCurrency = String(media.currency || 'JPY').toUpperCase() === 'USD' ? 'USD' : 'JPY'
  }

  logUploadInfo('CSV detail payload received', {
    fileType,
    fileName,
    dataSource,
    rowCount,
    importMethod: input.importMethod ?? 'manual',
    csvRows: csvRows.length,
    bodyRows: countBodyRows(csvRows),
    headers: csvRows[0] ?? [],
    normalizedHeaders: csvRows[0]?.map((header) => normalizeHeader(header)) ?? [],
  })

  if (csvRows.length === 0) {
    throw new ImportError(`${UPLOAD_FILE_TYPE_LABELS[fileType]}の行データが送信されていません`)
  }

  if (countBodyRows(csvRows) === 0) {
    throw new ImportError(`${UPLOAD_FILE_TYPE_LABELS[fileType]}に保存対象の明細行がありません`)
  }

  let preparedAdMediaRows: AdMediaDailyRow[] = []
  let preparedMediaSummaryRows: MediaSummaryDailyRow[] = []
  let preparedPaymentReportRows: PaymentReportDailyRow[] = []
  let adMediaDateRange: TargetDateRange | null = null
  let mediaSummaryDateRange: TargetDateRange | null = null
  let paymentReportDateRange: TargetDateRange | null = null
  const uploadWarnings: UploadWarning[] = []
  const exchangeRates = fileType === 'ad_media_csv'
    ? await fetchExchangeRates(db)
    : {}
  const adMediaColumnMappings = fileType === 'ad_media_csv' && mediaId
    ? await fetchAdMediaColumnMappings(db, mediaId)
    : []

  try {
    if (fileType === 'ad_media_csv' && mediaId !== null) {
      if (!hasDedicatedAdMediaParser(mediaName) && adMediaColumnMappings.length === 0) {
        throw new Error(buildAdMediaMappingRequiredError(mediaName))
      }

      preparedAdMediaRows = aggregateAdMediaRows(
        buildAdMediaDailyRows(
          csvRows,
          mediaId,
          mediaName,
          mediaCurrency,
          exchangeRates,
          0,
          adMediaColumnMappings
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

      const registeredCampaignCount = await ensureCampaignsFromAdMediaRows(
        db,
        mediaId,
        preparedAdMediaRows
      )
      logUploadInfo('ad media campaigns auto registration completed', {
        mediaId,
        registeredCampaignCount,
      })
    }

    if (fileType === 'site_summary_csv') {
      preparedMediaSummaryRows = aggregateMediaSummaryRows(
        await buildMediaSummaryDailyRows(
          db,
          csvRows,
          0,
          fileName,
          dataSource
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
      const allPaymentReportRows = aggregatePaymentReportRows(
        await buildPaymentReportDailyRows(
          db,
          csvRows,
          0,
          fileName,
          dataSource
        )
      )

      if (allPaymentReportRows.length === 0) {
        throw new Error('決済レポートCSVに保存対象の明細行がありません')
      }

      const unlinkedPaymentAdCodes = uniqueStrings(
        allPaymentReportRows
          .filter((row) => row.mediaId === null)
          .map((row) => row.adCode)
      )
      if (unlinkedPaymentAdCodes.length > 0) {
        uploadWarnings.push({
          type: 'unregistered_ad_codes',
          message: [
            'アップロードは完了しました。',
            `ただし、未登録の広告コードが${unlinkedPaymentAdCodes.length}件ありました。`,
            '',
            'これらの広告コードは媒体を特定できないため取り込まれていません。',
            '広告コードマスタで媒体を設定後、再アップロードしてください。',
          ].join('\n'),
          count: unlinkedPaymentAdCodes.length,
          ad_codes: unlinkedPaymentAdCodes,
        })
      }

      preparedPaymentReportRows = allPaymentReportRows.filter((row) => row.mediaId !== null)
      paymentReportDateRange = preparedPaymentReportRows.length > 0
        ? getRegistrationDateRange(preparedPaymentReportRows)
        : null

      logUploadInfo('payment_report_daily prepared rows', {
        parsedRows: allPaymentReportRows.length,
        preparedRows: preparedPaymentReportRows.length,
        minTargetDate: paymentReportDateRange?.minDate ?? null,
        maxTargetDate: paymentReportDateRange?.maxDate ?? null,
        linkedMediaRows: preparedPaymentReportRows.length,
        unlinkedMediaRows: allPaymentReportRows.length - preparedPaymentReportRows.length,
        unregisteredAdCodes: unlinkedPaymentAdCodes,
        dateBasis: 'registration_date',
      })

      if (preparedPaymentReportRows.length === 0 && uploadWarnings.length === 0) {
        throw new Error('決済レポートCSVに保存対象の明細行がありません')
      }
    }
  } catch (err) {
    logUploadError('detail preparation failed before upload_history insert', {
      fileType,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new ImportError(
      err instanceof Error
        ? err.message
        : `${UPLOAD_FILE_TYPE_LABELS[fileType]}の明細解析に失敗しました`
    )
  }

  const result = await db.prepare(
    `INSERT INTO upload_history
       (file_type, media_id, file_name, row_count, target_date, status, import_method)
     VALUES (?, ?, ?, ?, date('now', '+9 hours'), 'success', ?)`
  )
    .bind(
      fileType,
      mediaId,
      fileName,
      rowCount,
      input.importMethod ?? 'manual'
    )
    .run()

  const uploadHistoryId = await resolveUploadHistoryId(
    db,
    result,
    fileType,
    mediaId,
    fileName,
    rowCount
  )

  if (!uploadHistoryId) {
    throw new ImportError('アップロード履歴IDを取得できませんでした', 500)
  }

  let savedRows = 0
  let dateRange: TargetDateRange | null = null
  let totals: ImportTotals = {}

  try {
    if (fileType === 'ad_media_csv' && mediaId !== null) {
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
        await db.batch(
          chunk.map((row) =>
            db.prepare(
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
          db,
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

      dateRange = adMediaDateRange
      totals = {
        spend: sumBy(preparedAdMediaRows, (row) => row.spend),
        clicks: sumBy(preparedAdMediaRows, (row) => row.clicks),
        impressions: sumBy(preparedAdMediaRows, (row) => row.impressions),
        media_cv: sumBy(preparedAdMediaRows, (row) => row.mediaCv),
      }
    }

    if (fileType === 'site_summary_csv') {
      savedRows = preparedMediaSummaryRows.length
      logUploadInfo('media_summary_daily insert target rows', {
        uploadHistoryId,
        savedRows,
        dataSource,
        linkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedMediaSummaryRows.filter((row) => row.mediaId === null).length,
      })

      if (savedRows === 0) {
        throw new Error('媒体集計CSVに保存対象の明細行がありません')
      }

      for (let i = 0; i < preparedMediaSummaryRows.length; i += INSERT_BATCH_SIZE) {
        const chunk = preparedMediaSummaryRows.slice(i, i + INSERT_BATCH_SIZE)
        await db.batch(
          chunk.map((row) =>
            db.prepare(
              `INSERT OR REPLACE INTO media_summary_daily
                 (target_date, media_id, ad_code, site_name, access_count,
                  registration_count, provisional_registration_count,
                  data_source, upload_history_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              row.targetDate,
              row.mediaId,
              row.adCode,
              row.siteName,
              row.accessCount,
              row.registrationCount,
              row.provisionalRegistrationCount,
              row.dataSource,
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
          db,
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

      dateRange = mediaSummaryDateRange
      totals = {
        access_count: sumBy(preparedMediaSummaryRows, (row) => row.accessCount),
        registration_count: sumBy(preparedMediaSummaryRows, (row) => row.registrationCount),
        provisional_registration_count: sumBy(preparedMediaSummaryRows, (row) => row.provisionalRegistrationCount),
      }
    }

    if (fileType === 'payment_report_csv') {
      savedRows = preparedPaymentReportRows.length
      logUploadInfo('payment_report_daily insert target rows', {
        uploadHistoryId,
        savedRows,
        dataSource,
        linkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId !== null).length,
        unlinkedMediaRows: preparedPaymentReportRows.filter((row) => row.mediaId === null).length,
        dateBasis: 'registration_date',
      })

      if (savedRows === 0 && uploadWarnings.length === 0) {
        throw new Error('決済レポートCSVに保存対象の明細行がありません')
      }

      if (paymentReportDateRange) {
        const cleanupResult = await deleteOldPaymentReportRowsInRange(
          db,
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
        await db.batch(
          chunk.map((row) =>
            db.prepare(
              `INSERT OR REPLACE INTO payment_report_daily
                 (registration_date, site_name, customer_id, ad_code,
                  registration_status, first_payment_at, payment_count,
                  payment_amount, media_type, media_id, data_source, upload_history_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
              row.dataSource,
              uploadHistoryId
            )
          )
        )
      }
      logUploadInfo('payment_report_daily insert completed', {
        uploadHistoryId,
        savedRows,
      })

      dateRange = paymentReportDateRange
      totals = {
        payment_count: sumBy(preparedPaymentReportRows, (row) => row.paymentCount),
        payment_amount: sumBy(preparedPaymentReportRows, (row) => row.paymentAmount),
      }
    }
  } catch (err) {
    logUploadError('detail insert failed', {
      fileType,
      uploadHistoryId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw new ImportError(
      err instanceof Error
        ? err.message
        : `${UPLOAD_FILE_TYPE_LABELS[fileType]}の明細保存に失敗しました`
    )
  }

  return {
    uploadHistoryId,
    rowCount: savedRows,
    dateRange,
    totals,
    warnings: uploadWarnings,
  }
}
