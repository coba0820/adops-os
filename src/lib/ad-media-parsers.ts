export type AdMediaParserKey =
  | 'taboola'
  | 'facebook'
  | 'moloco'
  | 'popin'
  | 'logly'
  | 'uzou'
  | 'bigo'
  | 'mintegral'
  | 'unity'

export type AdMediaCommonRow = {
  targetDate: string
  accountName: string
  accountId: string
  campaignName: string
  campaignId: string
  impressions: number
  clicks: number
  servedAds: number
  spend: number
  mediaCv: number
  currency: string
}

type CsvRows = string[][]

type HeaderDefinition = {
  label: string
  aliases: string[]
  required?: boolean
}

type ParserDefinition = {
  key: AdMediaParserKey
  mediaNames: string[]
  displayName: string
  headerRowIndex?: number
  skipRow?: (row: string[], headerIndex: Map<string, number>) => boolean
  currency: 'JPY' | 'USD'
  fields: {
    targetDate: HeaderDefinition
    accountName?: HeaderDefinition
    accountId?: HeaderDefinition
    campaignName: HeaderDefinition
    campaignId?: HeaderDefinition
    impressions: HeaderDefinition
    clicks: HeaderDefinition
    spend: HeaderDefinition
    mediaCv?: HeaderDefinition
    servedAds?: HeaderDefinition
  }
}

export type ParseAdMediaOptions = {
  mediaName: string
  exchangeRates: Record<string, number>
}

const PARSERS: ParserDefinition[] = [
  {
    key: 'taboola',
    mediaNames: ['taboola'],
    displayName: 'Taboola',
    currency: 'JPY',
    fields: {
      targetDate: { label: 'Date', aliases: ['Date', '日付', '年月日'] },
      accountName: { label: 'Account Name', aliases: ['Account Name', 'アカウント名'] },
      accountId: { label: 'Account ID', aliases: ['Account ID', 'アカウントID'] },
      campaignName: { label: 'Campaign Name', aliases: ['Campaign Name', 'キャンペーン名'] },
      campaignId: { label: 'Campaign ID', aliases: ['Campaign ID', 'キャンペーンID', '広告コード'] },
      impressions: { label: 'Impressions', aliases: ['Impressions', 'Imp', 'インプレッション', '表示回数'] },
      clicks: { label: 'Clicks', aliases: ['Clicks', 'Click', 'クリック', 'クリック数'] },
      servedAds: { label: 'Served Ads', aliases: ['Served Ads', '配信数'] },
      spend: { label: 'Spent', aliases: ['Spent', 'Spend', 'Cost', '費用', '広告費'] },
      mediaCv: { label: '媒体CV', aliases: ['媒体CV', 'CV', 'CV数', 'CVs', 'Conversions', 'Conversion', 'Results'] },
    },
  },
  {
    key: 'facebook',
    mediaNames: ['facebook', 'meta'],
    displayName: 'Facebook',
    currency: 'JPY',
    fields: {
      targetDate: { label: '日付', aliases: ['日付', 'Date'] },
      campaignName: { label: '先頭列', aliases: ['', 'Unnamed: 0', 'Campaign', 'Campaign Name', 'キャンペーン名'] },
      impressions: { label: 'Imp', aliases: ['Imp', 'Impressions'] },
      clicks: { label: 'Click', aliases: ['Click', 'Clicks'] },
      spend: { label: 'Cost', aliases: ['Cost', '広告費', 'Spend', 'Spent'] },
      mediaCv: { label: 'CV', aliases: ['CV', '媒体CV', 'Conversions'] },
    },
  },
  {
    key: 'moloco',
    mediaNames: ['moloco'],
    displayName: 'Moloco',
    currency: 'JPY',
    fields: {
      targetDate: { label: 'Daily (UTC)', aliases: ['Daily (UTC)', 'Daily', 'Date'] },
      campaignName: { label: 'Unnamed: 0', aliases: ['Unnamed: 0', '', 'Campaign', 'Campaign Name'] },
      impressions: { label: 'Impression', aliases: ['Impression', 'Impressions'] },
      clicks: { label: 'Click', aliases: ['Click', 'Clicks'] },
      spend: { label: 'Spend, ¥', aliases: ['Spend, ¥', 'Spend ¥', 'Spend', 'Cost'] },
      mediaCv: { label: 'Install', aliases: ['Install', 'Installs'] },
    },
  },
  {
    key: 'popin',
    mediaNames: ['popin', 'popin'],
    displayName: 'PopIn',
    currency: 'JPY',
    fields: {
      targetDate: { label: 'Time', aliases: ['Time', 'Date', '日付'] },
      accountName: { label: 'Account Name', aliases: ['Account Name'] },
      campaignName: { label: 'Account Name', aliases: ['Campaign Name', 'Campaign', 'Account Name'], required: false },
      impressions: { label: 'Impression', aliases: ['Impression', 'Impressions'] },
      clicks: { label: 'Click', aliases: ['Click', 'Clicks'] },
      spend: { label: 'Spend', aliases: ['Spend', 'Cost'] },
      mediaCv: { label: 'Cv', aliases: ['Cv', 'CV', 'Conversions'] },
    },
  },
  {
    key: 'logly',
    mediaNames: ['logly'],
    displayName: 'LOGLY',
    currency: 'JPY',
    fields: {
      targetDate: { label: '日付', aliases: ['日付', 'Date'] },
      campaignName: { label: 'キャンペーン名', aliases: ['キャンペーン名', 'Campaign Name'] },
      impressions: { label: 'Imp', aliases: ['Imp', 'Impressions'] },
      clicks: { label: 'Click', aliases: ['Click', 'Clicks'] },
      spend: { label: 'コスト', aliases: ['コスト', 'Cost', 'Spend'] },
      mediaCv: { label: 'Conv.(CT)', aliases: ['Conv.(CT)', 'Conv CT', 'CV'] },
    },
  },
  {
    key: 'uzou',
    mediaNames: ['uzou'],
    displayName: 'UZOU',
    currency: 'JPY',
    fields: {
      targetDate: { label: '集計日', aliases: ['集計日', 'Date'] },
      accountId: { label: 'advertiser_id', aliases: ['advertiser_id'] },
      accountName: { label: 'advertiser_name', aliases: ['advertiser_name'] },
      campaignId: { label: 'campaign_id', aliases: ['campaign_id'] },
      campaignName: { label: 'campaign_name', aliases: ['campaign_name'] },
      impressions: { label: 'imp', aliases: ['imp', 'Imp'] },
      clicks: { label: 'click', aliases: ['click', 'Click'] },
      spend: { label: 'コスト', aliases: ['コスト', 'cost', 'Cost'] },
      mediaCv: { label: 'CTCV', aliases: ['CTCV'] },
    },
  },
  {
    key: 'bigo',
    mediaNames: ['bigo'],
    displayName: 'BIGO',
    headerRowIndex: 1,
    currency: 'USD',
    fields: {
      targetDate: { label: 'aggregateTime', aliases: ['aggregateTime'] },
      campaignName: { label: 'キャンペーン名', aliases: ['キャンペーン名', 'Campaign Name'] },
      impressions: { label: 'インプレッション数', aliases: ['インプレッション数', 'Impressions'] },
      clicks: { label: 'クリック数', aliases: ['クリック数', 'Clicks'] },
      spend: { label: '費用(USD)', aliases: ['費用(USD)', 'Cost(USD)', 'Spend(USD)'] },
      mediaCv: { label: 'コンバージョン数', aliases: ['コンバージョン数', 'Conversions'] },
    },
  },
  {
    key: 'mintegral',
    mediaNames: ['mintegral'],
    displayName: 'Mintegral',
    currency: 'USD',
    skipRow: (row, headerIndex) => getCell(row, headerIndex, ['Day']).toLowerCase() === 'sum',
    fields: {
      targetDate: { label: 'Day', aliases: ['Day'] },
      campaignName: { label: 'Offer', aliases: ['Offer'] },
      impressions: { label: 'Impression', aliases: ['Impression', 'Impressions'] },
      clicks: { label: 'Clicks', aliases: ['Clicks', 'Click'] },
      spend: { label: 'Spend', aliases: ['Spend', 'Cost'] },
      mediaCv: { label: 'Conversions', aliases: ['Conversions', 'Conversion'] },
    },
  },
  {
    key: 'unity',
    mediaNames: ['unity'],
    displayName: 'Unity',
    currency: 'USD',
    fields: {
      targetDate: { label: 'timestamp', aliases: ['timestamp'] },
      campaignName: { label: 'advertiserAppNameWithPlatform', aliases: ['advertiserAppNameWithPlatform'] },
      impressions: { label: 'acquisition/starts', aliases: ['acquisition/starts'] },
      clicks: { label: 'acquisition/clicks', aliases: ['acquisition/clicks'] },
      spend: { label: 'acquisition/spend', aliases: ['acquisition/spend'] },
      mediaCv: { label: 'acquisition/installs', aliases: ['acquisition/installs'] },
    },
  },
]

export function parseAdMediaRows(
  rows: CsvRows,
  options: ParseAdMediaOptions
): AdMediaCommonRow[] {
  const parser = resolveParser(options.mediaName)
  const headerRowIndex = parser.headerRowIndex ?? 0
  const headerRow = rows[headerRowIndex] ?? []
  if (headerRow.length === 0) {
    throw new Error(`${parser.displayName}: ヘッダー行が見つかりません`)
  }

  const headerIndex = buildHeaderIndex(headerRow)
  ensureParserHeaders(parser, headerIndex)

  return rows
    .slice(headerRowIndex + 1)
    .filter((row) => !isBlankRow(row))
    .filter((row) => !parser.skipRow?.(row, headerIndex))
    .map((row, index) => {
      const targetDate = parseTargetDate(getCell(row, headerIndex, parser.fields.targetDate.aliases))
      if (!targetDate) {
        throw new Error(`${parser.displayName}: ${index + headerRowIndex + 2}行目の日付が正しくありません`)
      }

      const sourceCurrency = parser.currency
      const spendSource = parseMoney(getCell(row, headerIndex, parser.fields.spend.aliases))
      const spend = convertSpendToJpy(spendSource, sourceCurrency, targetDate, options.exchangeRates)
      const campaignName = getOptionalCell(row, headerIndex, parser.fields.campaignName) ||
        getOptionalCell(row, headerIndex, parser.fields.accountName) ||
        ''
      const campaignId = getOptionalCell(row, headerIndex, parser.fields.campaignId) || campaignName
      const impressions = parseInteger(getCell(row, headerIndex, parser.fields.impressions.aliases))

      return {
        targetDate,
        accountName: getOptionalCell(row, headerIndex, parser.fields.accountName),
        accountId: getOptionalCell(row, headerIndex, parser.fields.accountId),
        campaignName,
        campaignId,
        impressions,
        clicks: parseInteger(getCell(row, headerIndex, parser.fields.clicks.aliases)),
        servedAds: parser.fields.servedAds
          ? parseInteger(getCell(row, headerIndex, parser.fields.servedAds.aliases))
          : impressions,
        spend,
        mediaCv: parseInteger(getOptionalCell(row, headerIndex, parser.fields.mediaCv)),
        currency: sourceCurrency,
      }
    })
}

export function getSupportedAdMediaParsers() {
  return PARSERS.map((parser) => ({
    key: parser.key,
    displayName: parser.displayName,
    mediaNames: parser.mediaNames,
    currency: parser.currency,
  }))
}

function resolveParser(mediaName: string) {
  const normalized = normalizeMediaName(mediaName)
  const parser = PARSERS.find((item) =>
    item.mediaNames.some((name) => normalized.includes(normalizeMediaName(name)))
  )
  if (!parser) {
    throw new Error(`未対応の広告媒体です: ${mediaName}`)
  }
  return parser
}

function ensureParserHeaders(parser: ParserDefinition, headerIndex: Map<string, number>) {
  const definitions = Object.values(parser.fields).filter(
    (definition): definition is HeaderDefinition => Boolean(definition) && definition.required !== false
  )
  const missing = definitions
    .filter((definition) => !hasHeader(headerIndex, definition.aliases))
    .map((definition) => definition.label)

  if (missing.length > 0) {
    throw new Error(`${parser.displayName}: 不足列 ${missing.join(', ')}`)
  }
}

function normalizeHeader(header: unknown) {
  return String(header ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeMediaName(name: string) {
  return String(name ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
}

function buildHeaderIndex(headerRow: string[]) {
  const index = new Map<string, number>()
  headerRow.forEach((header, i) => {
    const normalized = normalizeHeader(header)
    if (!index.has(normalized)) index.set(normalized, i)
  })
  return index
}

function hasHeader(headerIndex: Map<string, number>, aliases: string[]) {
  return aliases.some((alias) => headerIndex.has(normalizeHeader(alias)))
}

function getCell(row: string[], headerIndex: Map<string, number>, aliases: string[]) {
  for (const alias of aliases) {
    const index = headerIndex.get(normalizeHeader(alias))
    if (index !== undefined) return String(row[index] ?? '').trim()
  }
  return ''
}

function getOptionalCell(
  row: string[],
  headerIndex: Map<string, number>,
  definition?: HeaderDefinition
) {
  if (!definition) return ''
  return getCell(row, headerIndex, definition.aliases)
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
    .replace(/[,\s¥￥$]/g, '')
    .replace(/[^\d.-]/g, '')
  if (normalized === '') return 0
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

function parseTargetDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const ymdWithTime = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2})?)?/)
  if (ymdWithTime) {
    const [, year, month, day] = ymdWithTime
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

function convertSpendToJpy(
  spend: number,
  currency: 'JPY' | 'USD',
  targetDate: string,
  exchangeRates: Record<string, number>
) {
  if (currency === 'JPY') return spend
  const targetMonth = targetDate.slice(0, 7)
  const rate = exchangeRates[`${targetMonth}:USD`]
  if (!rate || rate <= 0) {
    throw new Error(`${targetMonth} のUSD為替レートが未設定です`)
  }
  return spend * rate
}

function isBlankRow(row: string[]) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}
