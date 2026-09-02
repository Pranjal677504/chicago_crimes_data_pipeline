CREATE OR REPLACE TABLE silver_quality_results AS
WITH checks AS (
    SELECT
        'bronze_to_silver_row_reconciliation' AS test_name,
        ABS(
            (SELECT COUNT(DISTINCT TRY_CAST(id AS BIGINT)) FROM bronze_crimes)
            -
            (SELECT COUNT(*) FROM silver_crimes)
        ) AS failed_rows

    UNION ALL

    SELECT
        'duplicate_crime_ids',
        COUNT(*) - COUNT(DISTINCT crime_id)
    FROM silver_crimes

    UNION ALL

    SELECT
        'null_required_fields',
        COUNT(*) FILTER (
            WHERE crime_id IS NULL
               OR date IS NULL
               OR primary_type IS NULL
               OR arrest IS NULL
               OR domestic IS NULL
               OR year IS NULL
        )
    FROM silver_crimes

    UNION ALL

    SELECT
        'invalid_year_or_date',
        COUNT(*) FILTER (
            WHERE year NOT BETWEEN 2020 AND 2026
               OR year <> EXTRACT(YEAR FROM date)
        )
    FROM silver_crimes

    UNION ALL

    SELECT
        'incomplete_coordinate_pairs',
        COUNT(*) FILTER (
            WHERE (x_coordinate IS NULL) <> (y_coordinate IS NULL)
               OR (latitude IS NULL) <> (longitude IS NULL)
        )
    FROM silver_crimes

    UNION ALL

    SELECT
        'invalid_coordinates_not_corrected',
        COUNT(*) FILTER (
            WHERE crime_id IN (12848210, 12852880)
              AND (
                    x_coordinate IS NOT NULL
                 OR y_coordinate IS NOT NULL
                 OR latitude IS NOT NULL
                 OR longitude IS NOT NULL
              )
        )
    FROM silver_crimes

    UNION ALL

    SELECT
        'invalid_geographic_code_format',
        COUNT(*) FILTER (
            WHERE (beat IS NOT NULL AND NOT REGEXP_FULL_MATCH(beat, '[0-9]{4}'))
               OR (district IS NOT NULL AND NOT REGEXP_FULL_MATCH(district, '[0-9]{3}'))
               OR (ward IS NOT NULL AND NOT REGEXP_FULL_MATCH(ward, '[0-9]{2}'))
               OR (
                    community_area IS NOT NULL
                    AND NOT REGEXP_FULL_MATCH(community_area, '[0-9]{2}')
               )
        )
    FROM silver_crimes

    UNION ALL

    SELECT
        'null_ingestion_lineage',
        COUNT(*) FILTER (
            WHERE ingested_at IS NULL
               OR source_file IS NULL
               OR batch_id IS NULL
        )
    FROM silver_crimes
)
SELECT
    test_name,
    failed_rows,
    CASE WHEN failed_rows = 0 THEN 'PASS' ELSE 'FAIL' END AS validation_status
FROM checks
ORDER BY test_name;

SELECT CASE
    WHEN COUNT(*) FILTER (WHERE validation_status = 'FAIL') = 0
    THEN 'SILVER QUALITY GATE PASSED'
    ELSE ERROR('SILVER QUALITY GATE FAILED — GOLD BUILD BLOCKED')
END AS pipeline_status
FROM silver_quality_results;
