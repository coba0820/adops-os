// ============================================================
// サイトマスタ API（/api/site）
// CRUD: 一覧取得 / 追加 / 更新 / 削除
// ============================================================
import { Hono } from 'hono'
import type { Bindings, SiteMaster, ApiResponse } from '../../types'

export const siteRoute = new Hono<{ Bindings: Bindings }>()

// ------------------------------------------------------------
// 一覧取得: GET /api/site
// ------------------------------------------------------------
siteRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM site_master ORDER BY id ASC'
  ).all<SiteMaster>()

  return c.json<ApiResponse<SiteMaster[]>>({ success: true, data: results })
})

// ------------------------------------------------------------
// 新規追加: POST /api/site
// body: { site_name: string }
// ------------------------------------------------------------
siteRoute.post('/', async (c) => {
  const body = await c.req.json<{ site_name: string }>()

  if (!body.site_name || body.site_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'サイト名は必須です' },
      400
    )
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO site_master (site_name) VALUES (?)'
  )
    .bind(body.site_name.trim())
    .run()

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: result.meta.last_row_id ?? null },
  })
})

// ------------------------------------------------------------
// 更新: PUT /api/site/:id
// body: { site_name: string }
// ------------------------------------------------------------
siteRoute.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ site_name: string }>()

  if (!body.site_name || body.site_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: 'サイト名は必須です' },
      400
    )
  }

  await c.env.DB.prepare(
    'UPDATE site_master SET site_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(body.site_name.trim(), id)
    .run()

  return c.json<ApiResponse<null>>({ success: true })
})

// ------------------------------------------------------------
// 削除: DELETE /api/site/:id
// 注意: キャンペーンマスタから参照されている場合は削除不可とする
// ------------------------------------------------------------
siteRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const used = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM campaign_master WHERE site_id = ?'
  )
    .bind(id)
    .first<{ cnt: number }>()

  if (used && used.cnt > 0) {
    return c.json<ApiResponse<null>>(
      {
        success: false,
        error: `このサイトはキャンペーンマスタで使用されているため削除できません（${used.cnt}件）`,
      },
      400
    )
  }

  await c.env.DB.prepare('DELETE FROM site_master WHERE id = ?').bind(id).run()

  return c.json<ApiResponse<null>>({ success: true })
})
