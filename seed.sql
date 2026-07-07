-- ============================================================
-- AdOps OS 開発用シードデータ
-- マスタ管理画面の動作確認用に最低限のダミーデータを投入する
-- ============================================================

-- 媒体マスタ
INSERT OR IGNORE INTO media_master (id, media_name) VALUES
  (1, 'Google広告'),
  (2, 'Yahoo!広告'),
  (3, 'Meta広告'),
  (4, 'LINE広告');

-- サイトマスタ
INSERT OR IGNORE INTO site_master (id, site_name) VALUES
  (1, 'SVC公式サイト'),
  (2, 'SVC LP-A'),
  (3, 'SVC LP-B');

-- キャンペーンマスタ（媒体→広告コード→サイトの紐付け例）
INSERT OR IGNORE INTO campaign_master (id, campaign_name, media_id, ad_code, site_id, is_active) VALUES
  (1, '新規獲得_検索広告', 1, 'GAD-001', 1, 1),
  (2, 'リターゲティング', 3, 'META-RTG-01', 2, 1),
  (3, '季節キャンペーン(終了)', 2, 'YHD-009', 3, 0);
