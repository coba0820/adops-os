import { showModal, closeModal, confirmDelete } from '../components/modal.js'
import { showToast } from '../components/toast.js'

const AXIS_LABELS = {
  overall: '全体',
  media: '媒体別',
  site: 'サイト別',
}

const SCOPE_LABELS = {
  overall: '全体',
  media: '媒体別',
  site: 'サイト別',
  ad_code: '広告コード別',
}

let budgetState = {
  targetMonth: getCurrentMonth(),
  mediaId: '',
  siteId: '',
  viewAxis: 'overall',
}

export async function renderBudgetPage(container) {
  container.innerHTML = `<div class="card"><div class="empty-state">読み込み中...</div></div>`
  const [mediaList, siteList] = await Promise.all([
    fetchOptions('/api/media'),
    fetchOptions('/api/site'),
  ])

  async function draw() {
    try {
      const params = new URLSearchParams()
      params.set('target_month', budgetState.targetMonth)
      params.set('view_axis', budgetState.viewAxis)
      if (budgetState.mediaId) params.set('media_id', budgetState.mediaId)
      if (budgetState.siteId) params.set('site_id', budgetState.siteId)

      const res = await axios.get(`/api/budget?${params.toString()}`)
      const data = res.data.data
      container.innerHTML = `
        ${renderFilters(mediaList, siteList)}
        ${renderBudgetSettings(data.budget_settings, mediaList, siteList)}
        ${renderProgress(data.progress)}
        ${renderLanding(data.landing)}
        <div class="budget-ratio-grid">
          ${renderRatioCard('媒体別予算比率', data.media_ratios)}
          ${renderRatioCard('サイト別予算比率', data.site_ratios)}
        </div>
        ${renderWeeklyProgress(data.weekly_progress)}
      `
      bindEvents(container, draw, mediaList, siteList, data)
    } catch (err) {
      console.error(err)
      container.innerHTML = `<div class="card"><div class="empty-state">予算管理データの取得に失敗しました</div></div>`
    }
  }

  await draw()
}

function renderFilters(mediaList, siteList) {
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${String(media.id) === budgetState.mediaId ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')
  const siteOptions = siteList
    .map((site) => `<option value="${site.id}" ${String(site.id) === budgetState.siteId ? 'selected' : ''}>${escapeHtml(site.site_name)}</option>`)
    .join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-wallet"></i>予算管理</div>
          <div class="card-subtitle">月予算、進捗、月末着地想定を確認します</div>
        </div>
        <div class="budget-header-actions">
          <button class="btn btn-secondary" id="budget-copy-previous"><i class="fa-solid fa-copy"></i>前月をコピー</button>
          <button class="btn btn-primary" id="budget-add-setting"><i class="fa-solid fa-plus"></i>予算を追加</button>
        </div>
      </div>
      <div class="budget-filter-bar">
        <div class="form-row">
          <label class="form-label">対象年月</label>
          <input type="month" id="budget-target-month" class="form-input" value="${escapeHtml(budgetState.targetMonth)}" />
        </div>
        <div class="form-row">
          <label class="form-label">媒体</label>
          <select id="budget-media-id" class="form-select">
            <option value="">すべて</option>
            ${mediaOptions}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">サイト</label>
          <select id="budget-site-id" class="form-select">
            <option value="">すべて</option>
            ${siteOptions}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">表示軸</label>
          <select id="budget-view-axis" class="form-select">
            <option value="overall" ${budgetState.viewAxis === 'overall' ? 'selected' : ''}>全体</option>
            <option value="media" ${budgetState.viewAxis === 'media' ? 'selected' : ''}>媒体別</option>
            <option value="site" ${budgetState.viewAxis === 'site' ? 'selected' : ''}>サイト別</option>
          </select>
        </div>
        <div class="budget-filter-actions">
          <button class="btn btn-primary" id="budget-apply"><i class="fa-solid fa-filter"></i>適用</button>
        </div>
      </div>
    </div>
  `
}

function renderBudgetSettings(settings, mediaList, siteList) {
  const rows = settings.length === 0
    ? `<tr><td colspan="10" class="text-center">予算設定がありません</td></tr>`
    : settings.map((item) => `
      <tr>
        <td>${escapeHtml(item.target_month)}</td>
        <td>${escapeHtml(SCOPE_LABELS[item.scope_type] || item.scope_type)}</td>
        <td>${escapeHtml(item.media_name || '-')}</td>
        <td>${escapeHtml(item.site_name || '-')}</td>
        <td class="text-right">${formatCurrency(item.monthly_budget)}</td>
        <td class="text-right">${formatCurrencyNoDecimal(item.target_cpa)}</td>
        <td class="text-right">${formatPercent(item.target_recovery_rate)}</td>
        <td class="text-right">${formatInteger(item.target_registration_count)}</td>
        <td class="text-right">${formatCurrency(item.target_revenue)}</td>
        <td>
          <div class="action-btn-group">
            <button class="icon-btn" data-action="edit-budget" data-id="${item.id}" title="編集"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" data-action="delete-budget" data-id="${item.id}" title="削除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('')

  window.__budgetSettings = settings
  window.__budgetMediaList = mediaList
  window.__budgetSiteList = siteList

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-sliders"></i>予算設定</div>
          <div class="card-subtitle">媒体別・サイト別の月予算と目標値</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>対象年月</th>
              <th>軸</th>
              <th>媒体</th>
              <th>サイト</th>
              <th class="text-right">月予算</th>
              <th class="text-right">目標CPA</th>
              <th class="text-right">目標回収率</th>
              <th class="text-right">目標登録数</th>
              <th class="text-right">目標売上</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `
}

function renderProgress(progress) {
  const items = [
    ['月予算', progress.monthly_budget, formatCurrency, 1],
    ['広告費', progress.cost, formatCurrency, progress.budget_spend_rate],
    ['残予算', progress.remaining_budget, formatCurrency, progress.monthly_budget ? progress.remaining_budget / progress.monthly_budget : null],
    ['予算消化率', progress.budget_spend_rate, formatPercent, progress.budget_spend_rate],
    ['目標登録数', progress.target_registration_count, formatInteger, 1],
    ['登録数', progress.registration_count, formatInteger, progress.registration_progress_rate],
    ['登録進捗率', progress.registration_progress_rate, formatPercent, progress.registration_progress_rate],
    ['CPA', progress.cpa, formatCurrencyNoDecimal, progress.target_cpa ? progress.cpa / progress.target_cpa : null],
    ['目標CPA', progress.target_cpa, formatCurrencyNoDecimal, 1],
    ['目標売上', progress.target_revenue, formatCurrency, 1],
    ['売上', progress.revenue, formatCurrency, progress.revenue_progress_rate],
    ['売上進捗率', progress.revenue_progress_rate, formatPercent, progress.revenue_progress_rate],
    ['回収率', progress.recovery_rate, formatPercent, progress.target_recovery_rate ? progress.recovery_rate / progress.target_recovery_rate : null],
    ['目標回収率', progress.target_recovery_rate, formatPercent, 1],
    ['経過率', progress.elapsed_rate, formatPercent, progress.elapsed_rate],
  ]

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-bars-progress"></i>月間進捗</div>
          <div class="card-subtitle">予算、登録、売上、経過率</div>
        </div>
      </div>
      <div class="budget-progress-grid">
        ${items.map(([label, value, formatter, rate]) => renderProgressItem(label, formatter(value), rate)).join('')}
      </div>
    </div>
  `
}

function renderProgressItem(label, value, rate) {
  const width = clampPercent(rate)
  return `
    <div class="budget-progress-item">
      <div class="budget-progress-head">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
      </div>
      <div class="budget-progress-track">
        <div class="budget-progress-fill" style="width:${width}%"></div>
      </div>
    </div>
  `
}

function renderLanding(landing) {
  const cards = [
    ['広告費着地', landing.projected_cost, formatCurrency, 'fa-yen-sign'],
    ['予算差額', landing.budget_gap, formatCurrency, 'fa-scale-balanced'],
    ['登録着地', landing.projected_registrations, formatInteger, 'fa-user-check'],
    ['CPA着地', landing.projected_cpa, formatCurrencyNoDecimal, 'fa-receipt'],
    ['売上着地', landing.projected_revenue, formatCurrency, 'fa-sack-dollar'],
    ['回収率着地', landing.projected_recovery_rate, formatPercent, 'fa-chart-pie'],
  ]
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-chart-simple"></i>月末着地想定</div>
          <div class="card-subtitle">現在値 ÷ 経過日数 × 月の日数</div>
        </div>
      </div>
      <div class="budget-landing-grid">
        ${cards.map(([label, value, formatter, icon]) => `
          <div class="analysis-summary-card">
            <div class="analysis-summary-label"><i class="fa-solid ${icon}"></i>${label}</div>
            <div class="analysis-summary-value">${formatter(value)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function renderRatioCard(title, items) {
  const rows = items.length === 0
    ? `<div class="empty-state">表示できるデータがありません</div>`
    : items.map((item, index) => {
      const color = chartColor(index)
      return `
        <div class="budget-ratio-row">
          <span class="budget-ratio-dot" style="background:${color}"></span>
          <span class="budget-ratio-name">${escapeHtml(item.name)}</span>
          <span>${formatPercent(item.budget_ratio)}</span>
          <span>${formatPercent(item.cost_ratio)}</span>
        </div>
      `
    }).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-chart-pie"></i>${title}</div>
          <div class="card-subtitle">予算比率 / 広告費比率</div>
        </div>
      </div>
      <div class="budget-donut-wrap">
        ${renderDonut(items, 'budget_ratio')}
        ${renderDonut(items, 'cost_ratio')}
      </div>
      <div class="budget-ratio-head">
        <span></span><span></span><span>予算</span><span>広告費</span>
      </div>
      ${rows}
    </div>
  `
}

function renderDonut(items, key) {
  let cursor = 0
  const segments = items
    .filter((item) => Number(item[key]) > 0)
    .map((item, index) => {
      const start = cursor
      const end = cursor + Number(item[key]) * 100
      cursor = end
      return `${chartColor(index)} ${start}% ${end}%`
    })
  const background = segments.length > 0 ? `conic-gradient(${segments.join(', ')})` : 'var(--color-border)'
  return `
    <div class="budget-donut" style="background:${background}">
      <span>${key === 'budget_ratio' ? '予算' : '広告費'}</span>
    </div>
  `
}

function renderWeeklyProgress(rows) {
  const body = rows.map((row) => `
    <tr>
      <td>${formatSlashDate(row.week_start)}〜${formatSlashDate(row.week_end)}</td>
      <td class="text-right">${formatCurrency(row.week_budget)}</td>
      <td class="text-right">${formatCurrency(row.cost)}</td>
      <td class="text-right">${formatPercent(row.budget_spend_rate)}</td>
      <td class="text-right">${formatCurrency(row.remaining_budget)}</td>
      <td class="text-right">${formatInteger(row.registration_count)}</td>
      <td class="text-right">${formatCurrencyNoDecimal(row.cpa)}</td>
      <td class="text-right">${formatCurrency(row.revenue)}</td>
      <td class="text-right">${formatPercent(row.recovery_rate)}</td>
      <td class="text-right">${formatPercent(row.cumulative_progress_rate)}</td>
      <td class="text-right">${formatCurrency(row.projected_month_end_cost)}</td>
    </tr>
  `).join('')

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title"><i class="fa-solid fa-calendar-week"></i>週別進捗</div>
          <div class="card-subtitle">月曜〜日曜。週予算は月予算を日数按分します</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>週</th>
              <th class="text-right">週予算</th>
              <th class="text-right">広告費</th>
              <th class="text-right">予算消化率</th>
              <th class="text-right">残予算</th>
              <th class="text-right">登録数</th>
              <th class="text-right">CPA</th>
              <th class="text-right">売上</th>
              <th class="text-right">回収率</th>
              <th class="text-right">週終了時点累計進捗</th>
              <th class="text-right">月末着地想定</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `
}

function bindEvents(container, redraw, mediaList, siteList, data) {
  container.querySelector('#budget-apply')?.addEventListener('click', () => {
    budgetState.targetMonth = container.querySelector('#budget-target-month')?.value || getCurrentMonth()
    budgetState.mediaId = container.querySelector('#budget-media-id')?.value || ''
    budgetState.siteId = container.querySelector('#budget-site-id')?.value || ''
    budgetState.viewAxis = container.querySelector('#budget-view-axis')?.value || 'overall'
    redraw()
  })

  container.querySelector('#budget-add-setting')?.addEventListener('click', () => {
    openBudgetModal(null, mediaList, siteList, redraw)
  })

  container.querySelector('#budget-copy-previous')?.addEventListener('click', async () => {
    await copyPreviousMonth(redraw, mediaList, siteList)
  })

  container.querySelectorAll('[data-action="edit-budget"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = data.budget_settings.find((setting) => setting.id === Number(btn.dataset.id))
      if (item) openBudgetModal(item, mediaList, siteList, redraw)
    })
  })

  container.querySelectorAll('[data-action="delete-budget"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirmDelete('この予算設定を削除しますか？')) return
      try {
        await axios.delete(`/api/budget/settings/${btn.dataset.id}`)
        showToast('削除しました', 'success')
        redraw()
      } catch (err) {
        showToast(err.response?.data?.error || '削除に失敗しました', 'error')
      }
    })
  })
}

function openBudgetModal(item, mediaList, siteList, redraw) {
  const isEdit = Boolean(item)
  const scopeType = item?.scope_type || 'media'
  const mediaOptions = mediaList
    .map((media) => `<option value="${media.id}" ${item?.media_id === media.id ? 'selected' : ''}>${escapeHtml(media.media_name)}</option>`)
    .join('')
  const siteOptions = siteList
    .map((site) => `<option value="${site.id}" ${item?.site_id === site.id ? 'selected' : ''}>${escapeHtml(site.site_name)}</option>`)
    .join('')

  showModal({
    title: isEdit ? '予算設定を編集' : '予算設定を追加',
    confirmLabel: '保存',
    bodyHtml: `
      <div class="budget-modal-grid">
        <div class="form-row">
          <label class="form-label">対象年月</label>
          <input type="month" id="budget-modal-month" class="form-input" value="${escapeHtml(item?.target_month || budgetState.targetMonth)}" />
        </div>
        <div class="form-row">
          <label class="form-label">表示軸</label>
          <select id="budget-modal-scope" class="form-select">
            <option value="overall" ${scopeType === 'overall' ? 'selected' : ''}>全体</option>
            <option value="media" ${scopeType === 'media' ? 'selected' : ''}>媒体別</option>
            <option value="site" ${scopeType === 'site' ? 'selected' : ''}>サイト別</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">媒体</label>
          <select id="budget-modal-media" class="form-select">
            <option value="">-- 選択なし --</option>
            ${mediaOptions}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">サイト</label>
          <select id="budget-modal-site" class="form-select">
            <option value="">-- 選択なし --</option>
            ${siteOptions}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">月予算</label>
          <input type="number" id="budget-modal-budget" class="form-input" value="${Number(item?.monthly_budget || 0)}" min="0" />
        </div>
        <div class="form-row">
          <label class="form-label">目標CPA</label>
          <input type="number" id="budget-modal-cpa" class="form-input" value="${Number(item?.target_cpa || 0)}" min="0" />
        </div>
        <div class="form-row">
          <label class="form-label">目標回収率（%）</label>
          <input type="number" id="budget-modal-recovery" class="form-input" value="${Number((item?.target_recovery_rate || 0) * 100).toFixed(2)}" min="0" step="0.01" />
        </div>
        <div class="form-row">
          <label class="form-label">メモ</label>
          <input type="text" id="budget-modal-memo" class="form-input" value="${escapeHtml(item?.memo || '')}" />
        </div>
      </div>
      <div class="budget-auto-values">
        <span>目標登録数: <strong id="budget-modal-target-reg">-</strong></span>
        <span>目標売上: <strong id="budget-modal-target-revenue">-</strong></span>
      </div>
    `,
    onConfirm: async () => {
      const payload = readBudgetModalPayload()
      try {
        if (isEdit) {
          await axios.put(`/api/budget/settings/${item.id}`, payload)
        } else {
          await axios.post('/api/budget/settings', payload)
        }
        closeModal()
        showToast(isEdit ? '更新しました' : '追加しました', 'success')
        redraw()
      } catch (err) {
        showToast(err.response?.data?.error || '保存に失敗しました', 'error')
      }
    },
  })

  const updateAutoValues = () => {
    const budget = Number(document.getElementById('budget-modal-budget')?.value || 0)
    const cpa = Number(document.getElementById('budget-modal-cpa')?.value || 0)
    const recovery = Number(document.getElementById('budget-modal-recovery')?.value || 0) / 100
    const regEl = document.getElementById('budget-modal-target-reg')
    const revenueEl = document.getElementById('budget-modal-target-revenue')
    if (regEl) regEl.textContent = cpa > 0 ? formatInteger(budget / cpa) : '-'
    if (revenueEl) revenueEl.textContent = formatCurrency(budget * recovery)
  }
  document.getElementById('budget-modal-budget')?.addEventListener('input', updateAutoValues)
  document.getElementById('budget-modal-cpa')?.addEventListener('input', updateAutoValues)
  document.getElementById('budget-modal-recovery')?.addEventListener('input', updateAutoValues)
  updateAutoValues()
}

function readBudgetModalPayload() {
  return {
    target_month: document.getElementById('budget-modal-month')?.value || budgetState.targetMonth,
    scope_type: document.getElementById('budget-modal-scope')?.value || 'media',
    media_id: document.getElementById('budget-modal-media')?.value || null,
    site_id: document.getElementById('budget-modal-site')?.value || null,
    monthly_budget: Number(document.getElementById('budget-modal-budget')?.value || 0),
    target_cpa: Number(document.getElementById('budget-modal-cpa')?.value || 0),
    target_recovery_rate: Number(document.getElementById('budget-modal-recovery')?.value || 0) / 100,
    memo: document.getElementById('budget-modal-memo')?.value || '',
  }
}

async function copyPreviousMonth(redraw, mediaList, siteList) {
  try {
    const res = await axios.post('/api/budget/copy-previous', {
      target_month: budgetState.targetMonth,
      overwrite: false,
    })
    showToast('前月の予算設定をコピーしました', 'success')
    await redraw()
    const first = res.data.data?.settings?.[0]
    if (first) openBudgetModal(first, mediaList, siteList, redraw)
  } catch (err) {
    if (err.response?.status === 409) {
      const ok = window.confirm(`${budgetState.targetMonth}の予算設定は既に存在します。\n上書きしますか？`)
      if (!ok) return
      const res = await axios.post('/api/budget/copy-previous', {
        target_month: budgetState.targetMonth,
        overwrite: true,
      })
      showToast('前月の予算設定で上書きしました', 'success')
      await redraw()
      const first = res.data.data?.settings?.[0]
      if (first) openBudgetModal(first, mediaList, siteList, redraw)
      return
    }
    showToast(err.response?.data?.error || '前月コピーに失敗しました', 'error')
  }
}

async function fetchOptions(url) {
  try {
    const res = await axios.get(url)
    return res.data.data || []
  } catch (err) {
    console.error(err)
    return []
  }
}

function clampPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0
  return Math.max(0, Math.min(100, Number(value) * 100))
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function formatCurrency(value) {
  if (!isNumber(value)) return '-'
  return '¥' + Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatCurrencyNoDecimal(value) {
  return formatCurrency(value)
}

function formatInteger(value) {
  if (!isNumber(value)) return '-'
  return Math.round(Number(value)).toLocaleString('ja-JP')
}

function formatPercent(value) {
  if (!isNumber(value)) return '-'
  return `${(Number(value) * 100).toFixed(2)}%`
}

function formatSlashDate(value) {
  const [year, month, day] = String(value || '').split('-')
  if (!year || !month || !day) return String(value || '-')
  return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`
}

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function chartColor(index) {
  return ['#4f46e5', '#059669', '#d97706', '#2563eb', '#dc2626', '#7c3aed', '#0891b2', '#65a30d'][index % 8]
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
