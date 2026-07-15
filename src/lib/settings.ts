export type SettingValueType = 'boolean' | 'number' | 'string'

export type SettingDefinition = {
  group: string
  key: string
  defaultValue: boolean | number | string
  valueType: SettingValueType
  description: string
  min?: number
  max?: number
  options?: string[]
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  { group: 'alerts', key: 'cpa_warning_rate', defaultValue: 1.1, valueType: 'number', description: 'CPA注意判定。目標CPAに対する倍率', min: 1, max: 10 },
  { group: 'alerts', key: 'cpa_critical_rate', defaultValue: 1.2, valueType: 'number', description: 'CPA要対応判定。目標CPAに対する倍率', min: 1, max: 10 },
  { group: 'alerts', key: 'registration_warning_rate', defaultValue: 0.9, valueType: 'number', description: '登録数注意判定。目標登録数に対する下限倍率', min: 0, max: 1 },
  { group: 'alerts', key: 'registration_critical_rate', defaultValue: 0.8, valueType: 'number', description: '登録数要対応判定。目標登録数に対する下限倍率', min: 0, max: 1 },
  { group: 'alerts', key: 'budget_warning_rate', defaultValue: 1.05, valueType: 'number', description: '予算注意判定。月予算に対する倍率', min: 1, max: 10 },
  { group: 'alerts', key: 'budget_critical_rate', defaultValue: 1.1, valueType: 'number', description: '予算要対応判定。月予算に対する倍率', min: 1, max: 10 },
  { group: 'alerts', key: 'warn_missing_ad_media_csv', defaultValue: true, valueType: 'boolean', description: '広告媒体CSV未取込警告' },
  { group: 'alerts', key: 'warn_missing_site_summary_csv', defaultValue: true, valueType: 'boolean', description: '媒体集計CSV未取込警告' },
  { group: 'alerts', key: 'warn_missing_payment_report_csv', defaultValue: true, valueType: 'boolean', description: '決済レポートCSV未取込警告' },
  { group: 'alerts', key: 'warn_zero_revenue', defaultValue: false, valueType: 'boolean', description: '売上0件警告' },
  { group: 'alerts', key: 'warn_zero_payer', defaultValue: false, valueType: 'boolean', description: '入金者0件警告' },
  { group: 'alerts', key: 'warn_recovery_drop', defaultValue: false, valueType: 'boolean', description: '回収率低下警告' },

  { group: 'dashboard', key: 'show_today_kpi', defaultValue: true, valueType: 'boolean', description: '今日のKPIを表示' },
  { group: 'dashboard', key: 'show_alerts', defaultValue: true, valueType: 'boolean', description: '要対応アラートを表示' },
  { group: 'dashboard', key: 'show_forecast_summary', defaultValue: true, valueType: 'boolean', description: '着地予測サマリーを表示' },
  { group: 'dashboard', key: 'show_monthly_summary', defaultValue: true, valueType: 'boolean', description: '月間サマリーを表示' },
  { group: 'dashboard', key: 'show_monthly_progress', defaultValue: true, valueType: 'boolean', description: '月間進捗を表示' },
  { group: 'dashboard', key: 'show_media_summary', defaultValue: true, valueType: 'boolean', description: '媒体別サマリーを表示' },
  { group: 'dashboard', key: 'show_site_summary', defaultValue: true, valueType: 'boolean', description: 'サイト別サマリーを表示' },
  { group: 'dashboard', key: 'show_todos', defaultValue: true, valueType: 'boolean', description: '今日やることを表示' },
  { group: 'dashboard', key: 'show_csv_status', defaultValue: true, valueType: 'boolean', description: 'CSV取込状況を表示' },

  { group: 'display', key: 'default_group_by', defaultValue: 'daily', valueType: 'string', description: '実績分析のデフォルト集計単位', options: ['daily', 'weekly', 'monthly'] },
  { group: 'display', key: 'week_start_day', defaultValue: 'monday', valueType: 'string', description: '週の開始曜日', options: ['monday'] },
  { group: 'display', key: 'money_decimal_digits', defaultValue: 0, valueType: 'number', description: '金額の小数点桁数', min: 0, max: 4 },
  { group: 'display', key: 'percent_decimal_digits', defaultValue: 1, valueType: 'number', description: '割合の小数点桁数', min: 0, max: 4 },
  { group: 'display', key: 'count_decimal_digits', defaultValue: 0, valueType: 'number', description: '件数の小数点桁数', min: 0, max: 4 },
  { group: 'display', key: 'default_target_month', defaultValue: 'current', valueType: 'string', description: 'デフォルト対象月', options: ['current', 'previous'] },

  { group: 'import', key: 'enable_ad_media_csv', defaultValue: true, valueType: 'boolean', description: '広告媒体CSV取込を有効化' },
  { group: 'import', key: 'enable_site_summary_csv', defaultValue: true, valueType: 'boolean', description: '媒体集計CSV取込を有効化' },
  { group: 'import', key: 'enable_payment_report_csv', defaultValue: true, valueType: 'boolean', description: '決済レポートCSV取込を有効化' },
]

export type AppSettings = Record<string, Record<string, boolean | number | string>>

export function getDefaultSettings(): AppSettings {
  return SETTING_DEFINITIONS.reduce<AppSettings>((settings, definition) => {
    settings[definition.group] ??= {}
    settings[definition.group][definition.key] = definition.defaultValue
    return settings
  }, {})
}

export function getSettingDefinition(group: string, key: string) {
  return SETTING_DEFINITIONS.find((definition) => definition.group === group && definition.key === key) ?? null
}

export function coerceSettingValue(definition: SettingDefinition, value: unknown) {
  if (definition.valueType === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === '1' || value === 1) return true
    if (value === 'false' || value === '0' || value === 0) return false
    throw new Error(`${definition.key} はON/OFFで指定してください`)
  }

  if (definition.valueType === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error(`${definition.key} は数値で指定してください`)
    if (definition.min !== undefined && number < definition.min) {
      throw new Error(`${definition.key} は ${definition.min} 以上で指定してください`)
    }
    if (definition.max !== undefined && number > definition.max) {
      throw new Error(`${definition.key} は ${definition.max} 以下で指定してください`)
    }
    return number
  }

  const stringValue = String(value ?? '')
  if (definition.options && !definition.options.includes(stringValue)) {
    throw new Error(`${definition.key} の値が正しくありません`)
  }
  return stringValue
}

export function serializeSettingValue(value: boolean | number | string) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function parseStoredValue(definition: SettingDefinition, value: string | null | undefined) {
  if (value === null || value === undefined) return definition.defaultValue
  return coerceSettingValue(definition, value)
}

export async function fetchAppSettings(db: D1Database): Promise<AppSettings> {
  const settings = getDefaultSettings()

  try {
    const { results } = await db.prepare(
      `SELECT setting_group, setting_key, setting_value
       FROM app_settings`
    ).all<{ setting_group: string; setting_key: string; setting_value: string }>()

    for (const row of results) {
      const definition = getSettingDefinition(row.setting_group, row.setting_key)
      if (!definition) continue
      settings[row.setting_group] ??= {}
      settings[row.setting_group][row.setting_key] = parseStoredValue(definition, row.setting_value)
    }
  } catch (err) {
    // app_settings migration 未適用でも既存画面を壊さない。
  }

  return settings
}

export async function upsertSetting(
  db: D1Database,
  definition: SettingDefinition,
  value: boolean | number | string
) {
  await db.prepare(
    `INSERT INTO app_settings
       (setting_group, setting_key, setting_value, value_type, description, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(setting_group, setting_key) DO UPDATE SET
       setting_value = excluded.setting_value,
       value_type = excluded.value_type,
       description = excluded.description,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      definition.group,
      definition.key,
      serializeSettingValue(value),
      definition.valueType,
      definition.description
    )
    .run()
}
