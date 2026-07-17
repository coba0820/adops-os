import { Hono } from 'hono'
import type { ApiResponse, Bindings } from '../../types'
import {
  SETTING_DEFINITIONS,
  coerceSettingValue,
  fetchAppSettings,
  getDefaultSettings,
  getSettingDefinition,
  serializeSettingValue,
} from '../../lib/settings'

export const settingsRoute = new Hono<{ Bindings: Bindings }>()

type SettingRow = {
  setting_group: string
  setting_key: string
  setting_value: string
  value_type: string
  description: string | null
  updated_at: string | null
}

type ExchangeRateRow = {
  id: number
  target_month: string
  currency: string
  rate: number
  updated_at: string | null
}

async function fetchSystemInfo(db: D1Database) {
  const latestMigration = '0012_ad_media_import_foundation'
  const [media, sites, campaigns, uploads] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM media_master').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM site_master').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM campaign_master').first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) AS count FROM upload_history').first<{ count: number }>(),
  ])

  return {
    app_name: 'AdOps OS',
    version: 'v1.9',
    cloudflare_environment: 'Cloudflare Pages / Workers',
    d1_database_name: 'adops-os-db',
    latest_migration: latestMigration,
    media_count: Number(media?.count ?? 0),
    site_count: Number(sites?.count ?? 0),
    campaign_count: Number(campaigns?.count ?? 0),
    upload_history_count: Number(uploads?.count ?? 0),
  }
}

async function fetchSettingRows(db: D1Database) {
  try {
    const { results } = await db.prepare(
      `SELECT setting_group, setting_key, setting_value, value_type, description, updated_at
       FROM app_settings
       ORDER BY setting_group ASC, setting_key ASC`
    ).all<SettingRow>()
    return results
  } catch (err) {
    return []
  }
}

async function fetchExchangeRates(db: D1Database) {
  try {
    const { results } = await db.prepare(
      `SELECT id, target_month, currency, rate, updated_at
       FROM exchange_rates
       ORDER BY target_month DESC, currency ASC`
    ).all<ExchangeRateRow>()
    return results
  } catch (err) {
    return []
  }
}

function buildDefinitionList() {
  return SETTING_DEFINITIONS.map((definition) => ({
    group: definition.group,
    key: definition.key,
    value_type: definition.valueType,
    default_value: definition.defaultValue,
    description: definition.description,
    min: definition.min ?? null,
    max: definition.max ?? null,
    options: definition.options ?? null,
  }))
}

settingsRoute.get('/', async (c) => {
  const [settings, rows, system] = await Promise.all([
    fetchAppSettings(c.env.DB),
    fetchSettingRows(c.env.DB),
    fetchSystemInfo(c.env.DB),
  ])
  const exchangeRates = await fetchExchangeRates(c.env.DB)

  return c.json<ApiResponse<Record<string, unknown>>>({
    success: true,
    data: {
      settings,
      defaults: getDefaultSettings(),
      definitions: buildDefinitionList(),
      stored_rows: rows,
      exchange_rates: exchangeRates,
      system,
      import_policies: {
        ad_media_csv: '対象期間＋媒体単位で既存明細を置き換え',
        site_summary_csv: '対象期間＋媒体、または媒体未特定時は対象期間＋広告コード単位で置き換え',
        payment_report_csv: '登録日＋媒体＋広告コード＋顧客ID単位で重複を防止し、登録日基準で集計',
      },
    },
  })
})

settingsRoute.get('/exchange-rates', async (c) => {
  return c.json<ApiResponse<ExchangeRateRow[]>>({
    success: true,
    data: await fetchExchangeRates(c.env.DB),
  })
})

settingsRoute.post('/exchange-rates', async (c) => {
  try {
    const body = await c.req.json<{
      target_month: string
      currency: string
      rate: number
    }>()
    const targetMonth = String(body.target_month ?? '').trim()
    const currency = String(body.currency ?? '').trim().toUpperCase()
    const rate = Number(body.rate)

    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new Error('対象月は YYYY-MM 形式で指定してください')
    }
    if (currency !== 'USD') {
      throw new Error('現在登録できる通貨は USD です')
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('レートは0より大きい数値で指定してください')
    }

    await c.env.DB.prepare(
      `INSERT INTO exchange_rates
         (target_month, currency, rate, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(target_month, currency) DO UPDATE SET
         rate = excluded.rate,
         updated_at = CURRENT_TIMESTAMP`
    )
      .bind(targetMonth, currency, rate)
      .run()

    return c.json<ApiResponse<ExchangeRateRow[]>>({
      success: true,
      data: await fetchExchangeRates(c.env.DB),
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '為替レートの保存に失敗しました' },
      400
    )
  }
})

settingsRoute.delete('/exchange-rates/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '削除対象の為替レートIDが正しくありません' },
      400
    )
  }

  await c.env.DB.prepare('DELETE FROM exchange_rates WHERE id = ?').bind(id).run()
  return c.json<ApiResponse<ExchangeRateRow[]>>({
    success: true,
    data: await fetchExchangeRates(c.env.DB),
  })
})

settingsRoute.put('/', async (c) => {
  try {
    const body = await c.req.json<Record<string, Record<string, unknown>>>()
    const updates: Array<{
      definition: NonNullable<ReturnType<typeof getSettingDefinition>>
      value: boolean | number | string
    }> = []

    for (const [group, values] of Object.entries(body)) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(`${group} の設定形式が正しくありません`)
      }

      for (const [key, rawValue] of Object.entries(values)) {
        const definition = getSettingDefinition(group, key)
        if (!definition) throw new Error(`不正な設定キーです: ${group}.${key}`)
        updates.push({
          definition,
          value: coerceSettingValue(definition, rawValue),
        })
      }
    }

    if (updates.length === 0) throw new Error('更新対象の設定がありません')

    await c.env.DB.batch(
      updates.map(({ definition, value }) =>
        c.env.DB.prepare(
          `INSERT INTO app_settings
             (setting_group, setting_key, setting_value, value_type, description, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_group, setting_key) DO UPDATE SET
             setting_value = excluded.setting_value,
             value_type = excluded.value_type,
             description = excluded.description,
             updated_at = CURRENT_TIMESTAMP`
        ).bind(
          definition.group,
          definition.key,
          serializeSettingValue(value),
          definition.valueType,
          definition.description
        )
      )
    )

    return c.json<ApiResponse<Record<string, unknown>>>({
      success: true,
      data: { settings: await fetchAppSettings(c.env.DB) },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '設定の保存に失敗しました' },
      400
    )
  }
})

settingsRoute.post('/reset', async (c) => {
  try {
    const defaults = getDefaultSettings()
    const statements = SETTING_DEFINITIONS.map((definition) => {
      const value = defaults[definition.group][definition.key]
      return c.env.DB.prepare(
        `INSERT INTO app_settings
           (setting_group, setting_key, setting_value, value_type, description, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(setting_group, setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           value_type = excluded.value_type,
           description = excluded.description,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        definition.group,
        definition.key,
        serializeSettingValue(value),
        definition.valueType,
        definition.description
      )
    })

    await c.env.DB.batch(statements)

    return c.json<ApiResponse<Record<string, unknown>>>({
      success: true,
      data: { settings: await fetchAppSettings(c.env.DB) },
    })
  } catch (err) {
    return c.json<ApiResponse<null>>(
      { success: false, error: err instanceof Error ? err.message : '設定の初期化に失敗しました' },
      400
    )
  }
})
