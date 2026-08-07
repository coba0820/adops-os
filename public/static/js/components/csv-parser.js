// ============================================================
// 簡易CSVパーサー
// v1では「プレビュー表示」のみが目的のため、
// ライブラリを使わず最小限のパース処理を自前実装する。
// ダブルクオート囲み・カンマ区切りの一般的なCSVに対応。
// ============================================================

/**
 * CSVファイルを文字コード判定して読み込む
 * 対応: UTF-8 / UTF-8 BOM / Shift_JIS(CP932)
 * @param {File} file CSVファイル
 * @returns {Promise<{text:string, encoding:string}>}
 */
export async function decodeCsvFile(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  if (hasUtf8Bom(bytes)) {
    return {
      text: decodeText(buffer, 'utf-8').replace(/^\uFEFF/, ''),
      encoding: 'UTF-8 BOM',
    }
  }

  const utf8Strict = tryDecodeText(buffer, 'utf-8', true)
  if (utf8Strict.ok) {
    return {
      text: utf8Strict.text.replace(/^\uFEFF/, ''),
      encoding: 'UTF-8',
    }
  }

  const cp932 = tryDecodeText(buffer, 'shift_jis', false)
  if (cp932.ok) {
    return {
      text: cp932.text.replace(/^\uFEFF/, ''),
      encoding: 'Shift_JIS(CP932)',
    }
  }

  return {
    text: decodeText(buffer, 'utf-8').replace(/^\uFEFF/, ''),
    encoding: 'UTF-8',
  }
}

function hasUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function tryDecodeText(buffer, encoding, fatal) {
  try {
    return {
      ok: true,
      text: new TextDecoder(encoding, { fatal }).decode(buffer),
    }
  } catch (_) {
    return {
      ok: false,
      text: '',
    }
  }
}

function decodeText(buffer, encoding) {
  return new TextDecoder(encoding).decode(buffer)
}

/**
 * CSV文字列を2次元配列にパースする
 * @param {string} text CSVファイルの内容（文字列）
 * @returns {string[][]} 行×列の2次元配列（1行目はヘッダー想定）
 */
export function parseCsv(text) {
  // 改行コードの差異（CRLF/LF）を統一
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim() !== '')

  return lines.map((line) => parseCsvLine(line))
}

/**
 * CSVの1行をパースする（ダブルクオート内のカンマに対応）
 */
function parseCsvLine(line) {
  const result = []
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
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  result.push(current)
  return result.map((v) => v.trim())
}
