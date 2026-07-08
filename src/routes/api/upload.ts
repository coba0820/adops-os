// ============================================================
// CSVアップロード履歴 API（/api/upload）
// v1では「CSVの保存・分析・結合」は行わない。
// フロントエンドでCSVをパース・プレビューした後、
// 「いつ・どのファイルを・何件アップロードしたか」の
// メタ情報だけをこのAPIで記録する。
// ============================================================
import { Hono } from 'hono'
import type { Bindings, UploadHistory, ApiResponse } from '../../types'

export const uploadRoute = new Hono<{ Bindings: Bindings }>()

// ------------------------------------------------------------
// 履歴一覧取得: GET /api/upload
// ------------------------------------------------------------
uploadRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT 50`
  ).all<UploadHistory>()

  return c.json<ApiResponse<UploadHistory[]>>({ success: true, data: results })
})

// ------------------------------------------------------------
// 履歴記録: POST /api/upload
// body: { file_type, media_id?, file_name, row_count }
// v1.1以降のCSV取込率では、media_master.status = 'active' の媒体のみを
// 取込対象として扱う（paused、および将来追加予定の archived は対象外）。
// ------------------------------------------------------------
uploadRoute.post('/', async (c) => {
  const body = await c.req.json<{
    file_type: string
    media_id?: number | null
    file_name: string
    row_count: number
  }>()

  if (!body.file_type || !body.file_name) {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'file_type と file_name は必須です' },
      400
    )
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO upload_history (file_type, media_id, file_name, row_count)
     VALUES (?, ?, ?, ?)`
  )
    .bind(
      body.file_type,
      body.media_id ?? null,
      body.file_name,
      body.row_count ?? 0
    )
    .run()

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: result.meta.last_row_id ?? null },
  })
})
