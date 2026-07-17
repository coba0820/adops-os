import { showToast } from '../components/toast.js'

const FIELD_GROUPS = [
  {
    title: 'アラート設定',
    icon: 'fa-bell',
    group: 'alerts',
    fields: [
      { key: 'cpa_warning_rate', label: 'CPA注意判定', type: 'number', suffix: '%超過', transform: 'overPercent' },
      { key: 'cpa_critical_rate', label: 'CPA要対応判定', type: 'number', suffix: '%超過', transform: 'overPercent' },
      { key: 'registration_warning_rate', label: '登録数注意判定', type: 'number', suffix: '%未満', transform: 'percent' },
      { key: 'registration_critical_rate', label: '登録数要対応判定', type: 'number', suffix: '%未満', transform: 'percent' },
      { key: 'budget_warning_rate', label: '予算注意判定', type: 'number', suffix: '%超過', transform: 'ratioPercent' },
      { key: 'budget_critical_rate', label: '予算要対応判定', type: 'number', suffix: '%超過', transform: 'ratioPercent' },
      { key: 'warn_missing_ad_media_csv', label: '広告媒体CSV未取込警告', type: 'boolean' },
      { key: 'warn_missing_site_summary_csv', label: '媒体集計CSV未取込警告', type: 'boolean' },
      { key: 'warn_missing_payment_report_csv', label: '決済レポートCSV未取込警告', type: 'boolean' },
      { key: 'warn_zero_revenue', label: '売上0件警告', type: 'boolean' },
      { key: 'warn_zero_payer', label: '入金者0件警告', type: 'boolean' },
      { key: 'warn_recovery_drop', label: '回収率低下警告', type: 'boolean' },
    ],
  },
  {
    title: 'ダッシュボード設定',
    icon: 'fa-gauge-high',
    group: 'dashboard',
    fields: [
      { key: 'show_today_kpi', label: '今日のKPI', type: 'boolean' },
      { key: 'show_alerts', label: '要対応アラート', type: 'boolean' },
      { key: 'show_forecast_summary', label: '着地予測サマリー', type: 'boolean' },
      { key: 'show_monthly_summary', label: '月間サマリー', type: 'boolean' },
      { key: 'show_monthly_progress', label: '月間進捗', type: 'boolean' },
      { key: 'show_media_summary', label: '媒体別サマリー', type: 'boolean' },
      { key: 'show_site_summary', label: 'サイト別サマリー', type: 'boolean' },
      { key: 'show_todos', label: '今日やること', type: 'boolean' },
      { key: 'show_csv_status', label: 'CSV取込状況', type: 'boolean' },
    ],
  },
  {
    title: '表示設定',
    icon: 'fa-sliders',
    group: 'display',
    fields: [
      { key: 'default_group_by', label: 'デフォルト集計単位', type: 'select', options: [['daily', '日別'], ['weekly', '週別'], ['monthly', '月別']] },
      { key: 'week_start_day', label: '週の開始曜日', type: 'select', options: [['monday', '月曜日']] },
      { key: 'money_decimal_digits', label: '金額の小数点桁数', type: 'number', suffix: '桁' },
      { key: 'percent_decimal_digits', label: '割合の小数点桁数', type: 'number', suffix: '桁' },
      { key: 'count_decimal_digits', label: '件数の小数点桁数', type: 'number', suffix: '桁' },
      { key: 'default_target_month', label: 'デフォルト対象月', type: 'select', options: [['current', '現在月'], ['previous', '前月']] },
    ],
  },
  {
    title: 'データ取込設定',
    icon: 'fa-file-arrow-up',
    group: 'import',
    fields: [
      { key: 'enable_ad_media_csv', label: '広告媒体CSV取込', type: 'boolean' },
      { key: 'enable_site_summary_csv', label: '媒体集計CSV取込', type: 'boolean' },
      { key: 'enable_payment_report_csv', label: '決済レポートCSV取込', type: 'boolean' },
    ],
  },
]

let settingsSnapshot = null

export async function renderSettingsPage(container) {
  container.innerHTML = `<div class="card"><div class="empty-state">読み込み中...</div></div>`

  try {
    const res = await axios.get('/api/settings')
    const data = res.data.data
    settingsSnapshot = data
    container.innerHTML = `
      <div class="settings-stack">
        ${FIELD_GROUPS.map((section) => renderSettingsSection(section, data.settings)).join('')}
        ${renderExchangeRates(data.exchange_rates)}
        ${renderImportPolicy(data.import_policies)}
        ${renderSystemInfo(data.system)}
        <div class="settings-actions">
          <button class="btn btn-primary" id="settings-save"><i class="fa-solid fa-floppy-disk"></i>保存</button>
          <button class="btn btn-secondary" id="settings-reset"><i class="fa-solid fa-rotate-left"></i>初期値へ戻す</button>
        </div>
      </div>
    `
    bindSettingsEvents(container)
  } catch (err) {
    console.error(err)
    container.innerHTML = `<div class="card"><div class="empty-state">設定データの取得に失敗しました</div></div>`
  }
}

function renderExchangeRates(rates = []) {
  const rows = rates.length === 0
    ? `<tr><td colspan="4">為替レートはまだ登録されていません</td></tr>`
    : rates.map((rate) => `
      <tr>
        <td>${escapeHtml(rate.target_month)}</td>
        <td>${escapeHtml(rate.currency)}</td>
        <td>${Number(rate.rate).toLocaleString('ja-JP', { maximumFractionDigits: 4 })}</td>
        <td>
          <button class="icon-btn danger" data-action="delete-exchange-rate" data-id="${rate.id}" title="削除">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('')

  const defaultMonth = new Date().toISOString().slice(0, 7)

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-yen-sign"></i>為替レート管理</div>
          <div class="card-subtitle">USD媒体の広告費を保存時に円換算する月別固定レートです。</div>
        </div>
      </div>
      <div class="settings-grid">
        <label class="settings-field">
          <span>対象月</span>
          <input id="exchange-target-month" type="month" class="form-input" value="${defaultMonth}" />
        </label>
        <label class="settings-field">
          <span>通貨</span>
          <select id="exchange-currency" class="form-select">
            <option value="USD">USD</option>
          </select>
        </label>
        <label class="settings-field">
          <span>レート</span>
          <input id="exchange-rate" type="number" step="0.0001" min="0" class="form-input" placeholder="147.23" />
        </label>
        <label class="settings-field">
          <span>&nbsp;</span>
          <button class="btn btn-secondary" id="exchange-save" type="button"><i class="fa-solid fa-floppy-disk"></i>保存</button>
        </label>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>対象月</th><th>通貨</th><th>レート</th><th style="width:80px">操作</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `
}

function renderSettingsSection(section, settings) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid ${section.icon}"></i>${section.title}</div>
          <div class="card-subtitle">変更後は保存ボタンを押してください</div>
        </div>
      </div>
      <div class="settings-grid">
        ${section.fields.map((field) => renderField(section.group, field, settings?.[section.group]?.[field.key])).join('')}
      </div>
    </div>
  `
}

function renderField(group, field, value) {
  const inputId = `setting-${group}-${field.key}`
  const attrs = `data-setting-group="${group}" data-setting-key="${field.key}" data-setting-type="${field.type}" data-transform="${field.transform || ''}"`

  if (field.type === 'boolean') {
    return `
      <label class="settings-toggle-row" for="${inputId}">
        <span>${field.label}</span>
        <input id="${inputId}" type="checkbox" class="settings-input" ${attrs} ${value ? 'checked' : ''} />
      </label>
    `
  }

  if (field.type === 'select') {
    return `
      <label class="settings-field" for="${inputId}">
        <span>${field.label}</span>
        <select id="${inputId}" class="form-select settings-input" ${attrs}>
          ${field.options.map(([optionValue, optionLabel]) =>
            `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`
          ).join('')}
        </select>
      </label>
    `
  }

  return `
    <label class="settings-field" for="${inputId}">
      <span>${field.label}</span>
      <div class="settings-number-wrap">
        <input id="${inputId}" type="number" step="0.1" class="form-input settings-input" ${attrs} value="${formatDisplayValue(value, field.transform)}" />
        ${field.suffix ? `<em>${field.suffix}</em>` : ''}
      </div>
    </label>
  `
}

function renderImportPolicy(policies) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-shield-halved"></i>重複取込方式</div>
          <div class="card-subtitle">現在実装済みの方式。今回は読み取り専用です。</div>
        </div>
      </div>
      <div class="settings-policy-list">
        ${Object.entries(policies || {}).map(([key, value]) => `
          <div class="settings-policy-item">
            <strong>${fileTypeLabel(key)}</strong>
            <span>${escapeHtml(value)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function renderSystemInfo(system) {
  const rows = [
    ['アプリ名', system?.app_name],
    ['現在のバージョン', system?.version],
    ['Cloudflare環境', system?.cloudflare_environment],
    ['D1データベース名', system?.d1_database_name],
    ['最新migration番号', system?.latest_migration],
    ['登録媒体数', system?.media_count],
    ['登録サイト数', system?.site_count],
    ['登録キャンペーン数', system?.campaign_count],
    ['upload_history件数', system?.upload_history_count],
  ]

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-circle-info"></i>システム情報</div>
          <div class="card-subtitle">読み取り専用です。秘密情報やdatabase_idは表示しません。</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table settings-system-table">
          <tbody>
            ${rows.map(([label, value]) => `
              <tr>
                <th>${escapeHtml(label)}</th>
                <td>${escapeHtml(value ?? '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function bindSettingsEvents(container) {
  container.querySelector('#exchange-save')?.addEventListener('click', async () => {
    try {
      const targetMonth = container.querySelector('#exchange-target-month')?.value
      const currency = container.querySelector('#exchange-currency')?.value
      const rate = Number(container.querySelector('#exchange-rate')?.value)
      await axios.post('/api/settings/exchange-rates', {
        target_month: targetMonth,
        currency,
        rate,
      })
      showToast('為替レートを保存しました', 'success')
      renderSettingsPage(container)
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || '為替レートの保存に失敗しました', 'error')
    }
  })

  container.querySelectorAll('[data-action="delete-exchange-rate"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('この為替レートを削除しますか？')) return
      try {
        await axios.delete(`/api/settings/exchange-rates/${btn.dataset.id}`)
        showToast('為替レートを削除しました', 'success')
        renderSettingsPage(container)
      } catch (err) {
        console.error(err)
        showToast(err.response?.data?.error || '為替レートの削除に失敗しました', 'error')
      }
    })
  })

  container.querySelector('#settings-save')?.addEventListener('click', async () => {
    try {
      const payload = collectSettings(container)
      await axios.put('/api/settings', payload)
      showToast('設定を保存しました', 'success')
      window.dispatchEvent(new CustomEvent('adops:settings-updated'))
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || err.message || '設定の保存に失敗しました', 'error')
    }
  })

  container.querySelector('#settings-reset')?.addEventListener('click', async () => {
    const confirmed = window.confirm('設定値だけを初期値へ戻します。マスタ、CSV、予算、実績データは削除されません。よろしいですか？')
    if (!confirmed) return

    try {
      await axios.post('/api/settings/reset')
      showToast('設定を初期値へ戻しました', 'success')
      renderSettingsPage(container)
      window.dispatchEvent(new CustomEvent('adops:settings-updated'))
    } catch (err) {
      console.error(err)
      showToast(err.response?.data?.error || '設定の初期化に失敗しました', 'error')
    }
  })
}

function collectSettings(container) {
  const payload = {}
  container.querySelectorAll('.settings-input').forEach((input) => {
    const group = input.dataset.settingGroup
    const key = input.dataset.settingKey
    if (!group || !key) return

    payload[group] ??= {}
    if (input.dataset.settingType === 'boolean') {
      payload[group][key] = input.checked
      return
    }

    if (input.dataset.settingType === 'number') {
      payload[group][key] = parseInputValue(input.value, input.dataset.transform)
      return
    }

    payload[group][key] = input.value
  })
  return payload
}

function formatDisplayValue(value, transform) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value ?? ''
  if (transform === 'overPercent') return ((number - 1) * 100).toFixed(1).replace(/\.0$/, '')
  if (transform === 'ratioPercent' || transform === 'percent') return (number * 100).toFixed(1).replace(/\.0$/, '')
  return String(number)
}

function parseInputValue(value, transform) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('数値入力に不正な値があります')
  if (transform === 'overPercent') return 1 + number / 100
  if (transform === 'ratioPercent' || transform === 'percent') return number / 100
  return number
}

function fileTypeLabel(key) {
  const labels = {
    ad_media_csv: '広告媒体CSV',
    site_summary_csv: '媒体集計CSV',
    payment_report_csv: '決済レポートCSV',
  }
  return labels[key] || key
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
