// ============================================================
// ダッシュボード API（/api/dashboard）
// v1では分析ロジックは未実装のため、固定のダミーデータを返す。
// 将来的には D1 に蓄積された実績データから
// 「要対応アラート」「今日のKPI」「月末着地予測」「今日やること」
// を算出するロジックに置き換える想定（TODOコメント参照）。
// ============================================================
import { Hono } from 'hono'
import type { Bindings, ApiResponse } from '../../types'

export const dashboardRoute = new Hono<{ Bindings: Bindings }>()

dashboardRoute.get('/summary', async (c) => {
  // TODO(v2以降): 実績データ・予算データが蓄積された後、
  // ここで D1 から実データを集計してダミーデータを置き換える。
  const dummy = {
    // 要対応アラート（異常検知・急なCPA悪化など）
    alerts: [
      {
        level: 'critical',
        title: 'CPAが目標値を大幅に超過',
        detail: 'Meta広告『リターゲティング』のCPAが目標比+42%',
      },
      {
        level: 'warning',
        title: '予算消化ペースが速い',
        detail: 'Google広告『新規獲得_検索広告』が月間予算の80%を消化(残り12日)',
      },
      {
        level: 'info',
        title: '新規キャンペーンのデータ未取込',
        detail: '季節キャンペーンのCSVが3日間未アップロード',
      },
    ],
    // 今日のKPI（ダミー）
    kpi: {
      spend: 1_284_000,
      spend_diff_pct: 8.2,
      conversions: 312,
      conversions_diff_pct: -3.1,
      cpa: 4115,
      cpa_diff_pct: 11.6,
      revenue: 5_640_000,
      revenue_diff_pct: 2.4,
    },
    // 月末着地予測（ダミー）
    forecast: {
      budget: 40_000_000,
      forecast_spend: 42_800_000,
      forecast_diff_pct: 7.0,
      days_remaining: 12,
      status: 'over', // 'over' | 'under' | 'on_track'
    },
    // 今日やること（ダミー）
    todo: [
      { done: false, text: 'Meta広告『リターゲティング』の入札調整を確認する' },
      { done: false, text: 'Google広告の予算消化ペースをチームに共有する' },
      { done: true, text: '媒体集計CSVを取込済みか確認する' },
      { done: false, text: '季節キャンペーンのCSV提出を担当者へ催促する' },
    ],
  }

  return c.json<ApiResponse<typeof dummy>>({ success: true, data: dummy })
})
