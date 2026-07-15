const XLSX_SCRIPT_SRC = '/static/vendor/xlsx.full.min.js'

let xlsxLoadPromise = null

export async function parseXlsxFile(file) {
  const buffer = await file.arrayBuffer()
  ensureXlsxSignature(buffer)

  const XLSX = await loadXlsxLibrary()
  let workbook
  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      WTF: false,
    })
  } catch (err) {
    throw new Error('XLSXの解析に失敗しました。ファイルが壊れている可能性があります。')
  }

  const sheetName = workbook.SheetNames?.[0]
  if (!sheetName) throw new Error('XLSXにワークシートがありません。')

  const sheet = workbook.Sheets[sheetName]
  if (!sheet || !sheet['!ref']) throw new Error('1枚目のワークシートが空です。')

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const rows = []

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    const row = []
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
      row.push(normalizeCellValue(sheet[address], XLSX))
    }
    if (!isBlankRow(row)) rows.push(trimTrailingBlankCells(row))
  }

  if (rows.length === 0) throw new Error('1枚目のワークシートが空です。')
  if (!rows[0] || isBlankRow(rows[0])) throw new Error('XLSXのヘッダー行がありません。')
  if (rows.length < 2) throw new Error('XLSXに行データがありません。')

  return {
    rows,
    sheetName,
  }
}

function loadXlsxLibrary() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (xlsxLoadPromise) return xlsxLoadPromise

  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = XLSX_SCRIPT_SRC
    script.async = true
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX)
      else reject(new Error('XLSX解析ライブラリを読み込めませんでした。'))
    }
    script.onerror = () => reject(new Error('XLSX解析ライブラリを読み込めませんでした。'))
    document.head.appendChild(script)
  })

  return xlsxLoadPromise
}

function ensureXlsxSignature(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) {
    throw new Error('XLSXとして読み込めません。拡張子だけでなく、Excelファイル本体を確認してください。')
  }
}

function normalizeCellValue(cell, XLSX) {
  if (!cell || cell.v === null || cell.v === undefined) return ''

  if (cell.t === 'd' || cell.v instanceof Date) {
    return formatDateOrDateTime(cell.v)
  }

  if (cell.t === 'n' && cell.z && XLSX.SSF?.is_date?.(cell.z)) {
    const parsed = XLSX.SSF.parse_date_code(cell.v)
    if (parsed) return formatParsedDate(parsed)
  }

  if (cell.t === 'n') return normalizeNumberLike(cell.v)
  if (cell.t === 'b') return cell.v ? 'true' : 'false'

  return normalizeText(cell.w ?? cell.v)
}

function normalizeNumberLike(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return normalizeText(value)
  return String(number)
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDateOrDateTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return normalizeText(value)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()
  return formatDateParts(year, month, day, hour, minute, second)
}

function formatParsedDate(parsed) {
  return formatDateParts(parsed.y, parsed.m, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0))
}

function formatDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const datePart = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (hour || minute || second) {
    return `${datePart} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
  }
  return datePart
}

function isBlankRow(row) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

function trimTrailingBlankCells(row) {
  const next = [...row]
  while (next.length > 0 && String(next[next.length - 1] ?? '').trim() === '') {
    next.pop()
  }
  return next
}
