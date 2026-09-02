CREATE TABLE IF NOT EXISTS pipeline_run_history (
    run_id VARCHAR,
    pipeline_name VARCHAR,
    target_database VARCHAR,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds DOUBLE,
    status VARCHAR,
    batch_id VARCHAR,
    watermark_before TIMESTAMP,
    watermark_after TIMESTAMP,
    api_records_fetched BIGINT,
    stage_rows BIGINT,
    rows_inserted BIGINT,
    rows_updated BIGINT,
    overlap_rows BIGINT,
    bronze_rows_after BIGINT,
    silver_rows_after BIGINT,
    gold_tables_passed INTEGER,
    error_message VARCHAR
);

-- Latest runs
SELECT
    run_id,
    started_at,
    ended_at,
    duration_seconds,
    status,
    batch_id,
    api_records_fetched,
    rows_inserted,
    rows_updated,
    bronze_rows_after,
    silver_rows_after,
    gold_tables_passed,
    error_message
FROM pipeline_run_history
ORDER BY started_at DESC
LIMIT 10;

