-- v1.10: payment reports no longer use unlinked media rows.
-- Keep upload_history as an audit trail, but remove detail rows that can
-- duplicate later imports once ad codes resolve to a media_id.

DELETE FROM payment_report_daily
WHERE media_id IS NULL;
