CREATE OR REPLACE TABLE gold_quality_results AS
WITH silver_totals AS (
    SELECT
        COUNT(*) AS all_crimes,
        COUNT(*) FILTER (WHERE arrest = TRUE) AS all_arrests,
        COUNT(*) FILTER (
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        ) AS hotspot_crimes,
        COUNT(*) FILTER (
            WHERE latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND arrest = TRUE
        ) AS hotspot_arrests,
        FLOOR(MIN(latitude) * 1000) / 1000.0 AS minimum_lat_bin,
        FLOOR(MAX(latitude) * 1000) / 1000.0 AS maximum_lat_bin,
        FLOOR(MIN(longitude) * 1000) / 1000.0 AS minimum_long_bin,
        FLOOR(MAX(longitude) * 1000) / 1000.0 AS maximum_long_bin
    FROM silver_crimes
),
monthly AS (
    SELECT
        'gold_monthly_crime_trends' AS gold_table,
        ABS(SUM(total_crimes) - (SELECT all_crimes FROM silver_totals))
        + ABS(SUM(total_arrests) - (SELECT all_arrests FROM silver_totals))
            AS reconciliation_difference,
        COUNT(*) - COUNT(DISTINCT (year, month, primary_type)) AS duplicate_rows,
        COUNT(*) FILTER (
            WHERE year IS NULL OR month IS NULL OR primary_type IS NULL
               OR total_crimes IS NULL OR total_arrests IS NULL OR arrest_rate IS NULL
        ) AS null_rows,
        COUNT(*) FILTER (
            WHERE total_crimes <= 0 OR total_arrests < 0
               OR total_arrests > total_crimes OR arrest_rate NOT BETWEEN 0 AND 100
               OR ABS(
                    arrest_rate - ROUND(
                        total_arrests * 100.0 / NULLIF(total_crimes, 0), 2
                    )
               ) > 0.01
        ) AS invalid_measure_rows,
        COUNT(*) FILTER (
            WHERE year NOT BETWEEN 2020 AND 2026
               OR month NOT BETWEEN 1 AND 12
               OR TRIM(primary_type) = ''
        ) AS invalid_domain_rows
    FROM gold_monthly_crime_trends
),
area AS (
    SELECT
        'gold_area_crime_summary' AS gold_table,
        ABS(SUM(total_crimes) - (SELECT all_crimes FROM silver_totals))
        + ABS(SUM(total_arrests) - (SELECT all_arrests FROM silver_totals))
            AS reconciliation_difference,
        COUNT(*) - COUNT(DISTINCT (year, district)) AS duplicate_rows,
        COUNT(*) FILTER (
            WHERE year IS NULL OR district IS NULL OR total_crimes IS NULL
               OR total_arrests IS NULL OR arrest_rate IS NULL
        ) AS null_rows,
        COUNT(*) FILTER (
            WHERE total_crimes <= 0 OR total_arrests < 0
               OR total_arrests > total_crimes OR arrest_rate NOT BETWEEN 0 AND 100
               OR ABS(
                    arrest_rate - ROUND(
                        total_arrests * 100.0 / NULLIF(total_crimes, 0), 2
                    )
               ) > 0.01
        ) AS invalid_measure_rows,
        COUNT(*) FILTER (
            WHERE year NOT BETWEEN 2020 AND 2026
               OR district NOT IN (
                    '001', '002', '003', '004', '005', '006', '007', '008',
                    '009', '010', '011', '012', '014', '015', '016', '017',
                    '018', '019', '020', '022', '024', '025', 'UNASSIGNED'
               )
        ) AS invalid_domain_rows
    FROM gold_area_crime_summary
),
arrest_analysis AS (
    SELECT
        'gold_arrest_analysis' AS gold_table,
        ABS(SUM(total_crimes) - (SELECT all_crimes FROM silver_totals))
        + ABS(SUM(total_arrests) - (SELECT all_arrests FROM silver_totals))
            AS reconciliation_difference,
        COUNT(*) - COUNT(DISTINCT (year, primary_type, domestic)) AS duplicate_rows,
        COUNT(*) FILTER (
            WHERE year IS NULL OR primary_type IS NULL OR domestic IS NULL
               OR total_crimes IS NULL OR total_arrests IS NULL OR arrest_rate IS NULL
        ) AS null_rows,
        COUNT(*) FILTER (
            WHERE total_crimes <= 0 OR total_arrests < 0
               OR total_arrests > total_crimes OR arrest_rate NOT BETWEEN 0 AND 100
               OR ABS(
                    arrest_rate - ROUND(
                        total_arrests * 100.0 / NULLIF(total_crimes, 0), 2
                    )
               ) > 0.01
        ) AS invalid_measure_rows,
        COUNT(*) FILTER (
            WHERE year NOT BETWEEN 2020 AND 2026
               OR TRIM(primary_type) = ''
               OR domestic NOT IN (TRUE, FALSE)
        ) AS invalid_domain_rows
    FROM gold_arrest_analysis
),
time_patterns AS (
    SELECT
        'gold_time_patterns' AS gold_table,
        ABS(SUM(total_crimes) - (SELECT all_crimes FROM silver_totals))
        + ABS(SUM(total_arrests) - (SELECT all_arrests FROM silver_totals))
            AS reconciliation_difference,
        COUNT(*) - COUNT(DISTINCT (
            day_of_week_number, day_of_week, hour_of_day
        )) AS duplicate_rows,
        COUNT(*) FILTER (
            WHERE day_of_week_number IS NULL OR day_of_week IS NULL
               OR hour_of_day IS NULL OR total_crimes IS NULL
               OR total_arrests IS NULL OR arrest_rate IS NULL
        ) AS null_rows,
        COUNT(*) FILTER (
            WHERE total_crimes <= 0 OR total_arrests < 0
               OR total_arrests > total_crimes OR arrest_rate NOT BETWEEN 0 AND 100
               OR ABS(
                    arrest_rate - ROUND(
                        total_arrests * 100.0 / NULLIF(total_crimes, 0), 2
                    )
               ) > 0.01
        ) AS invalid_measure_rows,
        COUNT(*) FILTER (
            WHERE day_of_week_number NOT BETWEEN 1 AND 7
               OR hour_of_day NOT BETWEEN 0 AND 23
               OR day_of_week <> CASE day_of_week_number
                    WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
                    WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday'
                    WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday'
                    WHEN 7 THEN 'Sunday'
               END
        ) AS invalid_domain_rows
    FROM gold_time_patterns
),
hotspots AS (
    SELECT
        'gold_crime_hotspots' AS gold_table,
        ABS(SUM(total_crimes) - (SELECT hotspot_crimes FROM silver_totals))
        + ABS(SUM(total_arrests) - (SELECT hotspot_arrests FROM silver_totals))
            AS reconciliation_difference,
        COUNT(*) - COUNT(DISTINCT (lat_bin, long_bin)) AS duplicate_rows,
        COUNT(*) FILTER (
            WHERE lat_bin IS NULL OR long_bin IS NULL OR total_crimes IS NULL
               OR total_arrests IS NULL OR arrest_rate IS NULL
        ) AS null_rows,
        COUNT(*) FILTER (
            WHERE total_crimes <= 0 OR total_arrests < 0
               OR total_arrests > total_crimes OR arrest_rate NOT BETWEEN 0 AND 100
               OR ABS(
                    arrest_rate - ROUND(
                        total_arrests * 100.0 / NULLIF(total_crimes, 0), 2
                    )
               ) > 0.01
        ) AS invalid_measure_rows,
        COUNT(*) FILTER (
            WHERE lat_bin < (SELECT minimum_lat_bin FROM silver_totals)
               OR lat_bin > (SELECT maximum_lat_bin FROM silver_totals)
               OR long_bin < (SELECT minimum_long_bin FROM silver_totals)
               OR long_bin > (SELECT maximum_long_bin FROM silver_totals)
        ) AS invalid_domain_rows
    FROM gold_crime_hotspots
),
all_results AS (
    SELECT * FROM monthly
    UNION ALL SELECT * FROM area
    UNION ALL SELECT * FROM arrest_analysis
    UNION ALL SELECT * FROM time_patterns
    UNION ALL SELECT * FROM hotspots
)
SELECT
    *,
    CASE
        WHEN reconciliation_difference = 0
         AND duplicate_rows = 0
         AND null_rows = 0
         AND invalid_measure_rows = 0
         AND invalid_domain_rows = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END AS validation_status
FROM all_results
ORDER BY gold_table;

SELECT CASE
    WHEN COUNT(*) = 5
     AND COUNT(*) FILTER (WHERE validation_status = 'FAIL') = 0
    THEN 'GOLD QUALITY GATE PASSED'
    ELSE ERROR('GOLD QUALITY GATE FAILED — PIPELINE REJECTED')
END AS pipeline_status
FROM gold_quality_results;
