import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'
import {
  getAdMediaMappingFields,
  hasDedicatedAdMediaParser,
  inferAdMediaColumnMappings,
  parseMappedAdMediaRows,
  type AdMediaColumnMapping,
  type AdMediaFieldKey,
} from '../../lib/ad-media-parsers'

export const mediaColumnMappingsRoute = new Hono<{ Bindings: Bindings }>()

type MappingRecord = {
  media_id: number
  field_key: AdMediaFieldKey
  source_column: string
}

const FIELD_KEYS = new Set(getAdMediaMappingFields().map((field) => field.key))

function parseMediaId(value: unknown) {
  const mediaId = Number(value)
  return Number.isInteger(mediaId) && mediaId > 0 ? mediaId : null
}

function normalizeRows(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
}

function isBlankRow(row: string[]) {
  return row.every((cell) => cell.trim() === '')
}

function normalizeMappings(value: unknown): AdMediaColumnMapping[] {
  if (!Array.isArray(value)) return []
  const mappings: AdMediaColumnMapping[] = []

  value.forEach((item) => {
    const record = item as { field_key?: unknown; fieldKey?: unknown; source_column?: unknown; sourceColumn?: unknown }
    const fieldKey = String(record.field_key ?? record.fieldKey ?? '') as AdMediaFieldKey
    if (!FIELD_KEYS.has(fieldKey)) return
    mappings.push({
      fieldKey,
      sourceColumn: String(record.source_column ?? record.sourceColumn ?? '').trim(),
    })
  })

  return mappings
}

async function fetchMedia(db: D1Database, mediaId: number) {
  const media = await db.prepare(
    `SELECT id, media_name, currency
     FROM media_master
     WHERE id = ?`
  )
    .bind(mediaId)
    .first<{ id: number; media_name: string; currency: string | null }>()

  if (!media) throw new Error('媒体が見つかりません')
  return {
    ...media,
    currency: (String(media.currency || 'JPY').toUpperCase() === 'USD' ? 'USD' : 'JPY') as 'JPY' | 'USD',
  }
}

async function fetchMappings(db: D1Database, mediaId: number): Promise<AdMediaColumnMapping[]> {
  try {
    const { results } = await db.prepare(
      `SELECT field_key, source_column
       FROM media_column_mappings
       WHERE media_id = ?
         AND is_active = 1
       ORDER BY id ASC`
    )
      .bind(mediaId)
      .all<Pick<MappingRecord, 'field_key' | 'source_column'>>()

    return results.map((row) => ({
      fieldKey: row.field_key,
      sourceColumn: row.source_column,
    }))
  } catch (err) {
    return []
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

function buildMissingRequired(mappings: AdMediaColumnMapping[]) {
  const sourceByField = new Map(mappings.map((mapping) => [mapping.fieldKey, mapping.sourceColumn]))
  return getAdMediaMappingFields()
    .filter((field) => field.required && !sourceByField.get(field.key))
    .map((field) => field.label)
}

function buildPreviewRows(
  rows: string[][],
  mediaName: string,
  currency: 'JPY' | 'USD',
  exchangeRates: Record<string, number>,
  mappings: AdMediaColumnMapping[]
) {
  const previewRows = rows.length > 1
    ? [rows[0], ...rows.slice(1).filter((row) => !isBlankRow(row)).slice(0, 20)]
    : rows

  return parseMappedAdMediaRows(previewRows, {
    mediaName,
    currency,
    exchangeRates,
    mappings,
  })
}

mediaColumnMappingsRoute.get('/', async (c) => {
  try {
    const mediaId = parseMediaId(c.req.query('media_id'))
    if (!mediaId) throw new Error('media_id は必須です')

    const media = await fetchMedia(c.env.DB, mediaId)
    const mappings = await fetchMappings(c.env.DB, mediaId)

    return c.json<ApiResponse<{
      media: typeof media
      has_dedicated_parser: boolean
      fields: ReturnType<typeof getAdMediaMappingFields>
      mappings: AdMediaColumnMapping[]
      missing_required: string[]
    }>>({
      success: true,
      data: {
        media,
        has_dedicated_parser: hasDedicatedAdMediaParser(media.media_name),
        fields: getAdMediaMappingFields(),
        mappings,
        missing_required: buildMissingRequired(mappings),
      },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '列マッピングの取得に失敗しました' },
      400
    )
  }
})

mediaColumnMappingsRoute.post('/preview', async (c) => {
  try {
    const body = await c.req.json<{ media_id?: unknown; rows?: unknown; mappings?: unknown }>()
    const mediaId = parseMediaId(body.media_id)
    if (!mediaId) throw new Error('media_id は必須です')

    const media = await fetchMedia(c.env.DB, mediaId)
    const rows = normalizeRows(body.rows)
    const headers = rows[0] || []
    if (headers.length === 0) throw new Error('ヘッダー行が見つかりません')

    const savedMappings = await fetchMappings(c.env.DB, mediaId)
    const inputMappings = normalizeMappings(body.mappings)
    const mappings = inputMappings.length > 0 ? inputMappings : savedMappings
    const suggestedMappings = inferAdMediaColumnMappings(headers)
    const hasDedicatedParser = hasDedicatedAdMediaParser(media.media_name)
    const missingRequired = buildMissingRequired(mappings)
    const exchangeRates = await fetchExchangeRates(c.env.DB)
    let previewRows: ReturnType<typeof buildPreviewRows> = []
    let previewError: string | null = null

    if (missingRequired.length === 0) {
      try {
        previewRows = buildPreviewRows(rows, media.media_name, media.currency, exchangeRates, mappings)
      } catch (err) {
        previewError = err instanceof Error ? err.message : '変換プレビューに失敗しました'
      }
    }
    const ready = missingRequired.length === 0 && previewError === null

    return c.json<ApiResponse<{
      media: typeof media
      has_dedicated_parser: boolean
      fields: ReturnType<typeof getAdMediaMappingFields>
      headers: string[]
      mappings: AdMediaColumnMapping[]
      suggested_mappings: AdMediaColumnMapping[]
      missing_required: string[]
      ready: boolean
      preview_rows: ReturnType<typeof buildPreviewRows>
      preview_error: string | null
    }>>({
      success: true,
      data: {
        media,
        has_dedicated_parser: hasDedicatedParser,
        fields: getAdMediaMappingFields(),
        headers,
        mappings,
        suggested_mappings: suggestedMappings,
        missing_required: missingRequired,
        ready,
        preview_rows: previewRows,
        preview_error: previewError,
      },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '列マッピングプレビューに失敗しました' },
      400
    )
  }
})

mediaColumnMappingsRoute.post('/', async (c) => {
  try {
    const body = await c.req.json<{ media_id?: unknown; mappings?: unknown }>()
    const mediaId = parseMediaId(body.media_id)
    if (!mediaId) throw new Error('media_id は必須です')

    await fetchMedia(c.env.DB, mediaId)
    const mappings = normalizeMappings(body.mappings)
    const missingRequired = buildMissingRequired(mappings)
    if (missingRequired.length > 0) {
      throw new Error(`列マッピングが不足しています。未設定項目: ${missingRequired.join(', ')}`)
    }

    const statements = [
      c.env.DB.prepare('DELETE FROM media_column_mappings WHERE media_id = ?').bind(mediaId),
      ...mappings
        .filter((mapping) => mapping.sourceColumn)
        .map((mapping) =>
          c.env.DB.prepare(
            `INSERT INTO media_column_mappings
               (media_id, field_key, source_column, is_active)
             VALUES (?, ?, ?, 1)`
          )
            .bind(mediaId, mapping.fieldKey, mapping.sourceColumn)
        ),
    ]

    await c.env.DB.batch(statements)

    return c.json<ApiResponse<{ saved_count: number }>>({
      success: true,
      data: { saved_count: statements.length - 1 },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '列マッピングの保存に失敗しました' },
      400
    )
  }
})
