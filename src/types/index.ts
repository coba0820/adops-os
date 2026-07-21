// ============================================================
// AdOps OS 共通型定義
// フロントエンド・バックエンドで共有する型はこのファイルに集約する。
// 将来テーブルが増えても、ここに型を追加していく方針。
// ============================================================

/**
 * Cloudflare Bindings（D1データベースなど）
 * Hono の Env として利用する
 */
export type Bindings = {
  DB: D1Database
}

/**
 * 媒体マスタ（media_master）
 */
export type MediaStatus = 'active' | 'paused' | 'archived'

export interface MediaMaster {
  id: number
  media_name: string
  currency: 'JPY' | 'USD'
  status: MediaStatus
  created_at: string
  updated_at: string
}

/**
 * サイトマスタ（site_master）
 */
export interface SiteMaster {
  id: number
  site_name: string
  created_at: string
  updated_at: string
}

/**
 * キャンペーンマスタ（campaign_master）
 * 媒体 → 広告コード → サイト の紐付けを保持する
 */
export interface CampaignMaster {
  id: number
  campaign_name: string
  media_id: number
  ad_code: string | null
  site_id: number
  is_active: number // 1=有効, 0=無効
  created_at: string
  updated_at: string
}

/**
 * キャンペーンマスタ一覧表示用（媒体名・サイト名をJOINしたビュー用の型）
 */
export interface CampaignMasterView extends CampaignMaster {
  media_name: string
  site_name: string
}

export interface CampaignGroup {
  id: number
  media_id: number
  group_name: string
  description: string | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface CampaignGroupView extends CampaignGroup {
  media_name: string
  ad_code_count: number
}

export interface CampaignGroupAdCode {
  id: number
  campaign_group_id: number
  ad_code_id: number
  created_at: string
}

/**
 * CSVアップロード履歴（upload_history）
 * v1ではCSVの実データは保存せず、メタ情報のみ記録する
 */
export type UploadFileType =
  | 'ad_media_csv'
  | 'site_summary_csv'
  | 'payment_report_csv'

export type UploadStatus = 'success'

export interface UploadHistory {
  id: number
  file_type: UploadFileType
  media_id: number | null
  file_name: string
  row_count: number
  target_date: string | null
  status: UploadStatus
  uploaded_at: string
}

export interface UploadHistoryView extends UploadHistory {
  media_name: string | null
}

export interface UploadStatusItem {
  file_type: UploadFileType
  label: string
  media_id: number | null
  media_name: string | null
  uploaded: boolean
  latest_upload: UploadHistoryView | null
}

export interface TodayUploadStatus {
  target_date: string
  active_media_count: number
  uploaded_count: number
  required_count: number
  completion_rate: number
  items: UploadStatusItem[]
}

/**
 * API共通レスポンス形式
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
