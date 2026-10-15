// ============================================================
// Google スプレッドシート読み込み（サービスアカウント認証）
// 外部ライブラリは使わず、Web Crypto で RS256 署名した JWT から
// アクセストークンを取得して Sheets API v4 を呼ぶ。
// ============================================================

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

// タブ名 → 行データ（タブが存在しない場合は null）
export type SheetTabValues = Map<string, string[][] | null>

export function parseServiceAccountJson(json: string | undefined): ServiceAccount {
  if (!json || json.trim() === '') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません')
  }

  let parsed: Partial<ServiceAccount>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON がJSONとして読めません')
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON に client_email / private_key がありません')
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri,
  }
}

// URL を貼られても ID だけを取り出す
export function extractSpreadsheetId(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : raw
}

function base64UrlEncode(input: ArrayBuffer | string) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function createSignedJwt(account: ServiceAccount, tokenUri: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  )

  return `${unsigned}.${base64UrlEncode(signature)}`
}

export async function fetchAccessToken(account: ServiceAccount) {
  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI
  const assertion = await createSignedJwt(account, tokenUri)

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const json = await res.json<{ access_token?: string; error?: string; error_description?: string }>()
    .catch(() => ({} as { access_token?: string; error?: string; error_description?: string }))
  if (!res.ok || !json.access_token) {
    throw new Error(`Google 認証に失敗しました（${res.status} ${json.error_description || json.error || ''}）`.trim())
  }
  return json.access_token
}

async function sheetsApiGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const body = await res.json<{ error?: { message?: string } }>().catch(() => null)
    const detail = body?.error?.message ?? ''
    if (res.status === 403) {
      throw new Error(`スプレッドシートを読めません。サービスアカウントに閲覧権限を共有してください（${detail}）`)
    }
    if (res.status === 404) {
      throw new Error(`スプレッドシートが見つかりません。IDを確認してください（${detail}）`)
    }
    throw new Error(`Sheets API エラー（${res.status} ${detail}）`)
  }
  return res.json<T>()
}

function quoteSheetName(name: string) {
  return `'${name.replace(/'/g, "''")}'`
}

// Sheets API は末尾の空セルを返さないため、ヘッダーの列数に揃える
export function normalizeSheetValues(values: unknown[][] | undefined): string[][] {
  const rows = (values ?? []).map((row) => (row ?? []).map((cell) => String(cell ?? '')))
  const width = rows[0]?.length ?? 0
  return rows.map((row) => (row.length < width ? [...row, ...Array(width - row.length).fill('')] : row))
}

export async function fetchSheetTabs(
  serviceAccountJson: string | undefined,
  spreadsheetId: string,
  tabNames: string[]
): Promise<SheetTabValues> {
  const account = parseServiceAccountJson(serviceAccountJson)
  const accessToken = await fetchAccessToken(account)
  const id = encodeURIComponent(spreadsheetId)

  const meta = await sheetsApiGet<{ sheets?: Array<{ properties?: { title?: string } }> }>(
    `${SHEETS_API_BASE}/${id}?fields=sheets.properties.title`,
    accessToken
  )
  const existingTitles = new Set((meta.sheets ?? []).map((sheet) => sheet.properties?.title ?? ''))

  const result: SheetTabValues = new Map()
  const targets = [...new Set(tabNames)].filter((name) => {
    if (existingTitles.has(name)) return true
    result.set(name, null)
    return false
  })
  if (targets.length === 0) return result

  const params = new URLSearchParams({
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
  })
  targets.forEach((name) => params.append('ranges', quoteSheetName(name)))

  const data = await sheetsApiGet<{ valueRanges?: Array<{ values?: unknown[][] }> }>(
    `${SHEETS_API_BASE}/${id}/values:batchGet?${params.toString()}`,
    accessToken
  )

  targets.forEach((name, index) => {
    result.set(name, normalizeSheetValues(data.valueRanges?.[index]?.values))
  })
  return result
}
