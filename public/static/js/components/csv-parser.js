// ============================================================
// 簡易CSVパーサー
// v1では「プレビュー表示」のみが目的のため、
// ライブラリを使わず最小限のパース処理を自前実装する。
// ダブルクオート囲み・カンマ区切りの一般的なCSVに対応。
// ============================================================

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
