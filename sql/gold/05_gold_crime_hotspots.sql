CREATE OR REPLACE TABLE gold_crime_hotspots AS
SELECT
    FLOOR(latitude * 1000) / 1000.0 AS lat_bin,
    FLOOR(longitude * 1000) / 1000.0 AS long_bin,
    COUNT(crime_id) AS total_crimes,
    COUNT(crime_id) FILTER (WHERE arrest = TRUE) AS total_arrests,
    ROUND(
        100.0 * COUNT(crime_id) FILTER (WHERE arrest = TRUE)
        / NULLIF(COUNT(crime_id), 0),
        2
    ) AS arrest_rate
FROM silver_crimes
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
GROUP BY lat_bin, long_bin;
