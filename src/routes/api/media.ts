// ============================================================
// 媒体マスタ API（/api/media）
// CRUD: 一覧取得 / 追加 / 更新 / 削除
// ============================================================
import { Hono } from 'hono'
import type { Bindings, MediaMaster, ApiResponse } from '../../types'

export const mediaRoute = new Hono<{ Bindings: Bindings }>()

const SUPPORTED_MEDIA_STATUSES = ['active', 'paused'] as const
type SupportedMediaStatus = (typeof SUPPORTED_MEDIA_STATUSES)[number]

function hasStatusField(body: { status?: unknown }) {
  return Object.prototype.hasOwnProperty.call(body, 'status')
}

function parseMediaStatus(status: unknown): SupportedMediaStatus | null {
  if (
    typeof status === 'string' &&
    SUPPORTED_MEDIA_STATUSES.includes(status as SupportedMediaStatus)
  ) {
    return status as SupportedMediaStatus
  }
  return null
}

// ------------------------------------------------------------
// 一覧取得: GET /api/media
// ------------------------------------------------------------
mediaRoute.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM media_master ORDER BY id ASC'
  ).all<MediaMaster>()

  return c.json<ApiResponse<MediaMaster[]>>({ success: true, data: results })
})

// ------------------------------------------------------------
// 新規追加: POST /api/media
// body: { media_name: string, status?: 'active' | 'paused' }
// status未指定時は既存API互換のため active として登録する。
// ------------------------------------------------------------
mediaRoute.post('/', async (c) => {
  const body = await c.req.json<{ media_name: string; status?: string }>()

  if (!body.media_name || body.media_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: '媒体名は必須です' },
      400
    )
  }

  const status = hasStatusField(body) ? parseMediaStatus(body.status) : 'active'
  if (!status) {
    return c.json<ApiResponse<null>>(
      { success: false, error: '媒体の状態は active または paused を指定してください' },
      400
    )
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO media_master (media_name, status) VALUES (?, ?)'
  )
    .bind(body.media_name.trim(), status)
    .run()

  return c.json<ApiResponse<{ id: number | null }>>({
    success: true,
    data: { id: result.meta.last_row_id ?? null },
  })
})

// ------------------------------------------------------------
// 更新: PUT /api/media/:id
// body: { media_name: string, status?: 'active' | 'paused' }
// status未指定時は既存API互換のため現在の状態を維持する。
// ------------------------------------------------------------
mediaRoute.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ media_name: string; status?: string }>()

  if (!body.media_name || body.media_name.trim() === '') {
    return c.json<ApiResponse<null>>(
      { success: false, error: '媒体名は必須です' },
      400
    )
  }

  if (hasStatusField(body)) {
    const status = parseMediaStatus(body.status)
    if (!status) {
      return c.json<ApiResponse<null>>(
        { success: false, error: '媒体の状態は active または paused を指定してください' },
        400
      )
    }

    await c.env.DB.prepare(
      'UPDATE media_master SET media_name = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(body.media_name.trim(), status, id)
      .run()
  } else {
    await c.env.DB.prepare(
      'UPDATE media_master SET media_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(body.media_name.trim(), id)
      .run()
  }

  return c.json<ApiResponse<null>>({ success: true })
})

// ------------------------------------------------------------
// 削除: DELETE /api/media/:id
// 注意: キャンペーンマスタから参照されている場合は削除不可とする
// ------------------------------------------------------------
mediaRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')

  // キャンペーンマスタからの参照チェック
  const used = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM campaign_master WHERE media_id = ?'
  )
    .bind(id)
    .first<{ cnt: number }>()

  if (used && used.cnt > 0) {
    return c.json<ApiResponse<null>>(
      {
        success: false,
        error: `この媒体はキャンペーンマスタで使用されているため削除できません（${used.cnt}件）`,
      },
      400
    )
  }

  await c.env.DB.prepare('DELETE FROM media_master WHERE id = ?').bind(id).run()

  return c.json<ApiResponse<null>>({ success: true })
})
