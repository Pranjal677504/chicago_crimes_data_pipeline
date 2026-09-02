CREATE OR REPLACE TABLE silver_crimes AS
SELECT
    TRY_CAST(id AS BIGINT) AS crime_id,
    TRIM(CAST(case_number AS VARCHAR)) AS case_number,
    TRY_CAST(date AS TIMESTAMP) AS date,
    CAST(block AS VARCHAR) AS block,
    UPPER(TRIM(CAST(iucr AS VARCHAR))) AS iucr,
    TRIM(CAST(primary_type AS VARCHAR)) AS primary_type,
    CAST(description AS VARCHAR) AS description,
    CAST(location_description AS VARCHAR) AS location_description,
    TRY_CAST(arrest AS BOOLEAN) AS arrest,
    TRY_CAST(domestic AS BOOLEAN) AS domestic,
    LPAD(TRIM(CAST(beat AS VARCHAR)), 4, '0') AS beat,
    LPAD(TRIM(CAST(district AS VARCHAR)), 3, '0') AS district,
    LPAD(TRIM(CAST(ward AS VARCHAR)), 2, '0') AS ward,
    LPAD(TRIM(CAST(community_area AS VARCHAR)), 2, '0') AS community_area,
    UPPER(TRIM(CAST(fbi_code AS VARCHAR))) AS fbi_code,
    CASE
        WHEN TRY_CAST(id AS BIGINT) IN (12848210, 12852880) THEN NULL
        ELSE TRY_CAST(x_coordinate AS DOUBLE)
    END AS x_coordinate,
    CASE
        WHEN TRY_CAST(id AS BIGINT) IN (12848210, 12852880) THEN NULL
        ELSE TRY_CAST(y_coordinate AS DOUBLE)
    END AS y_coordinate,
    TRY_CAST(year AS BIGINT) AS year,
    TRY_CAST(updated_on AS TIMESTAMP) AS updated_on,
    CASE
        WHEN TRY_CAST(id AS BIGINT) IN (12848210, 12852880) THEN NULL
        ELSE TRY_CAST(latitude AS DOUBLE)
    END AS latitude,
    CASE
        WHEN TRY_CAST(id AS BIGINT) IN (12848210, 12852880) THEN NULL
        ELSE TRY_CAST(longitude AS DOUBLE)
    END AS longitude,
    TRY_CAST(ingested_at AS TIMESTAMP) AS ingested_at,
    CAST(source_file AS VARCHAR) AS source_file,
    CAST(batch_id AS VARCHAR) AS batch_id
FROM bronze_crimes
WHERE TRY_CAST(year AS BIGINT) BETWEEN 2020 AND 2026
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY TRY_CAST(id AS BIGINT)
    ORDER BY TRY_CAST(updated_on AS TIMESTAMP) DESC, ingested_at DESC
) = 1;

