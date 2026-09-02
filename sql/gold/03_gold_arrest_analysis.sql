CREATE OR REPLACE TABLE gold_arrest_analysis AS
SELECT
    year,
    primary_type,
    domestic,
    COUNT(crime_id) AS total_crimes,
    COUNT(crime_id) FILTER (WHERE arrest = TRUE) AS total_arrests,
    ROUND(
        100.0 * COUNT(crime_id) FILTER (WHERE arrest = TRUE)
        / NULLIF(COUNT(crime_id), 0),
        2
    ) AS arrest_rate
FROM silver_crimes
GROUP BY year, primary_type, domestic;

