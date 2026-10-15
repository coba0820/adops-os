// ============================================================
// スプレッドシート同期の定時実行 Worker
// 処理本体は Pages と共有する src/lib/sheet-sync.ts
// ============================================================
import { runSheetSync, type SheetSyncEnv } from '../../../src/lib/sheet-sync'

export default {
  async scheduled(_controller: ScheduledController, env: SheetSyncEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      runSheetSync(env, 'cron').then((outcome) => {
        console.info('[sheet-sync worker] finished', {
          started: outcome.started,
          runId: outcome.run_id,
          status: outcome.status,
          message: outcome.message,
        })
      })
    )
  },
}
