# Operations Guide

## Required configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `MOTHERDUCK_TOKEN` | Yes | Authenticates the DuckDB client to MotherDuck |
| `MOTHERDUCK_DATABASE` | No | Target database; defaults to `chicago_crimes_2020_to_2026` |
| `CHICAGO_APP_TOKEN` | No | Raises or stabilizes Chicago API request limits |
| `PIPELINE_START_YEAR` | No | Earliest included year; defaults to `2020` |
| `OVERLAP_HOURS` | No | Watermark overlap; defaults to `24` hours |

Never commit actual secret values. GitHub secrets should contain the production token.

## First GitHub Actions run

1. Add the `MOTHERDUCK_TOKEN` repository secret.
2. Open the **Actions** tab.
3. Select **Daily Chicago Crimes Pipeline**.
4. Choose **Run workflow** on the `main` branch.
5. Verify the job completes successfully.
6. Query `pipeline_run_history` and confirm the newest row reports `SUCCESS` and five passed Gold tables.

## Daily schedule

The workflow uses `30 1 * * *`, which means 01:30 UTC or 07:00 IST. GitHub may start scheduled jobs a few minutes late.

## Verification query

```sql
SELECT
    run_id,
    started_at,
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
LIMIT 5;
```

## Common failure checks

- Authentication failure: replace the `MOTHERDUCK_TOKEN` GitHub secret.
- API rate limit: add `CHICAGO_APP_TOKEN` or wait before retrying.
- Silver gate failure: inspect `silver_quality_results` for rows marked `FAIL`.
- Gold gate failure: inspect `gold_quality_results` and identify the failing Gold table and metric.
- Schema mismatch: compare the Chicago API fields with the Bronze schema before changing production tables.

## Recovery

The transformation transaction rolls back on failure. Fix the underlying issue and manually rerun the workflow. The overlap window allows the corrected run to retrieve recent changes again without creating duplicate crime IDs.

