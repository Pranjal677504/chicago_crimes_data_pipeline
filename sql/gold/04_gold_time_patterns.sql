CREATE OR REPLACE TABLE gold_time_patterns AS
SELECT
    CAST(EXTRACT(ISODOW FROM date) AS INTEGER) AS day_of_week_number,
    STRFTIME(date, '%A') AS day_of_week,
    CAST(EXTRACT(HOUR FROM date) AS INTEGER) AS hour_of_day,
    COUNT(crime_id) AS total_crimes,
    COUNT(crime_id) FILTER (WHERE arrest = TRUE) AS total_arrests,
    ROUND(
        100.0 * COUNT(crime_id) FILTER (WHERE arrest = TRUE)
        / NULLIF(COUNT(crime_id), 0),
        2
    ) AS arrest_rate
FROM silver_crimes
GROUP BY day_of_week_number, day_of_week, hour_of_day;

