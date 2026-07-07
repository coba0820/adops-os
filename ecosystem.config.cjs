// ============================================================
// PM2設定（サンドボックス開発環境用）
// wrangler pages dev をデーモンとして起動する。
// D1データベース（ローカルSQLite）はwrangler.jsoncのd1_databases設定を
// 自動的に参照するため、--d1オプションは不要。
// ============================================================
module.exports = {
  apps: [
    {
      name: 'webapp',
      script: 'npx',
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
