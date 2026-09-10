CREATE OR REPLACE TABLE gold_area_crime_summary AS
WITH normalized_crimes AS (
    SELECT
        crime_id,
        year,
        arrest,
        CASE
            WHEN district IN (
                '001', '002', '003', '004', '005', '006',
                '007', '008', '009', '010', '011', '012',
                '014', '015', '016', '017', '018', '019',
                '020', '022', '024', '025'
            )
            THEN district
            ELSE 'UNASSIGNED'
        END AS district
    FROM silver_crimes
)
SELECT
    year,
    district,
    COUNT(crime_id) AS total_crimes,
    COUNT(crime_id) FILTER (
        WHERE arrest = TRUE
    ) AS total_arrests,
    ROUND(
        100.0 * COUNT(crime_id) FILTER (
            WHERE arrest = TRUE
        ) / NULLIF(COUNT(crime_id), 0),
        2
    ) AS arrest_rate
FROM normalized_crimes
GROUP BY
    year,
    district;
