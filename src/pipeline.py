"""Incremental Chicago crimes pipeline for MotherDuck."""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


API_URL = "https://data.cityofchicago.org/resource/ijzp-q8t2.json"
PIPELINE_NAME = "chicago_crimes_incremental"
PAGE_SIZE = 50_000
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = PROJECT_ROOT / "sql"

SOURCE_COLUMNS = [
    "id", "case_number", "date", "block", "iucr", "primary_type",
    "description", "location_description", "arrest", "domestic", "beat",
    "district", "ward", "community_area", "fbi_code", "x_coordinate",
    "y_coordinate", "year", "updated_on", "latitude", "longitude",
    "location",
]


def require_environment() -> tuple[str, str, int, int, str | None]:
    token = os.getenv("MOTHERDUCK_TOKEN")
    if not token:
        raise RuntimeError("MOTHERDUCK_TOKEN is required")

    database = os.getenv(
        "MOTHERDUCK_DATABASE", "chicago_crimes_2020_to_2026"
    )
    start_year = int(os.getenv("PIPELINE_START_YEAR", "2020"))
    overlap_hours = int(os.getenv("OVERLAP_HOURS", "24"))
    app_token = os.getenv("CHICAGO_APP_TOKEN") or None
    return token, database, start_year, overlap_hours, app_token


def connect(token: str, database: str) -> duckdb.DuckDBPyConnection:
    os.environ["motherduck_token"] = token
    return duckdb.connect(f"md:{database}")


def execute_sql_file(
    connection: duckdb.DuckDBPyConnection, filename: str
) -> None:
    connection.execute((SQL_DIR / filename).read_text(encoding="utf-8"))


def ensure_history_table(connection: duckdb.DuckDBPyConnection) -> None:
    statement = (SQL_DIR / "05_monitoring.sql").read_text(encoding="utf-8")
    connection.execute(statement.split("-- Latest runs", maxsplit=1)[0])


def current_watermark(
    connection: duckdb.DuckDBPyConnection, start_year: int
) -> datetime:
    table_exists = connection.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = 'bronze_crimes'
        """
    ).fetchone()[0]
    if not table_exists:
        raise RuntimeError(
            "bronze_crimes does not exist; load the historical Bronze table first"
        )

    value = connection.execute(
        "SELECT MAX(TRY_CAST(updated_on AS TIMESTAMP)) FROM bronze_crimes"
    ).fetchone()[0]
    return value or datetime(start_year, 1, 1)


def api_session() -> requests.Session:
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def fetch_records(
    watermark: datetime, start_year: int, app_token: str | None
) -> list[dict[str, Any]]:
    timestamp = watermark.strftime("%Y-%m-%dT%H:%M:%S.000")
    headers = {"X-App-Token": app_token} if app_token else {}
    records: list[dict[str, Any]] = []
    offset = 0

    with api_session() as session:
        while True:
            params = {
                "$where": (
                    f"updated_on >= '{timestamp}' AND year >= {start_year}"
                ),
                "$order": "updated_on ASC, id ASC",
                "$limit": PAGE_SIZE,
                "$offset": offset,
            }
            response = session.get(
                API_URL, params=params, headers=headers, timeout=90
            )
            response.raise_for_status()
            page = response.json()
            if not page:
                break
            records.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

    return records


def prepare_dataframe(
    records: list[dict[str, Any]], batch_id: str, ingested_at: datetime
) -> pd.DataFrame:
    prepared: list[dict[str, Any]] = []
    for record in records:
        row = {column: record.get(column) for column in SOURCE_COLUMNS}
        if isinstance(row["location"], (dict, list)):
            row["location"] = json.dumps(row["location"], separators=(",", ":"))
        row["ingested_at"] = ingested_at.replace(tzinfo=None)
        row["source_file"] = API_URL
        row["batch_id"] = batch_id
        prepared.append(row)

    return pd.DataFrame(
        prepared,
        columns=SOURCE_COLUMNS + ["ingested_at", "source_file", "batch_id"],
    )


def create_stage(
    connection: duckdb.DuckDBPyConnection, dataframe: pd.DataFrame
) -> int:
    connection.register("api_dataframe", dataframe)
    connection.execute(
        """
        CREATE OR REPLACE TEMP TABLE bronze_api_stage AS
        SELECT
            TRY_CAST(id AS BIGINT) AS id,
            CAST(case_number AS VARCHAR) AS case_number,
            CAST(date AS VARCHAR) AS date,
            CAST(block AS VARCHAR) AS block,
            CAST(iucr AS VARCHAR) AS iucr,
            CAST(primary_type AS VARCHAR) AS primary_type,
            CAST(description AS VARCHAR) AS description,
            CAST(location_description AS VARCHAR) AS location_description,
            TRY_CAST(arrest AS BOOLEAN) AS arrest,
            TRY_CAST(domestic AS BOOLEAN) AS domestic,
            TRY_CAST(beat AS BIGINT) AS beat,
            TRY_CAST(district AS BIGINT) AS district,
            TRY_CAST(ward AS BIGINT) AS ward,
            TRY_CAST(community_area AS BIGINT) AS community_area,
            CAST(fbi_code AS VARCHAR) AS fbi_code,
            TRY_CAST(x_coordinate AS DOUBLE) AS x_coordinate,
            TRY_CAST(y_coordinate AS DOUBLE) AS y_coordinate,
            TRY_CAST(year AS BIGINT) AS year,
            CAST(updated_on AS VARCHAR) AS updated_on,
            TRY_CAST(latitude AS DOUBLE) AS latitude,
            TRY_CAST(longitude AS DOUBLE) AS longitude,
            CAST(location AS VARCHAR) AS location,
            TRY_CAST(ingested_at AS TIMESTAMP) AS ingested_at,
            CAST(source_file AS VARCHAR) AS source_file,
            CAST(batch_id AS VARCHAR) AS batch_id
        FROM api_dataframe
        WHERE TRY_CAST(id AS BIGINT) IS NOT NULL
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY TRY_CAST(id AS BIGINT)
            ORDER BY TRY_CAST(updated_on AS TIMESTAMP) DESC
        ) = 1
        """
    )
    connection.unregister("api_dataframe")
    return connection.execute("SELECT COUNT(*) FROM bronze_api_stage").fetchone()[0]


def merge_stage(
    connection: duckdb.DuckDBPyConnection,
) -> tuple[int, int, int]:
    inserted, updated, overlap = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE target.id IS NULL) AS rows_inserted,
            COUNT(*) FILTER (
                WHERE target.id IS NOT NULL
                  AND TRY_CAST(source.updated_on AS TIMESTAMP)
                      >= TRY_CAST(target.updated_on AS TIMESTAMP)
            ) AS rows_updated,
            COUNT(*) FILTER (WHERE target.id IS NOT NULL) AS overlap_rows
        FROM bronze_api_stage AS source
        LEFT JOIN bronze_crimes AS target USING (id)
        """
    ).fetchone()

    assignments = ",\n".join(
        f"{column} = source.{column}"
        for column in SOURCE_COLUMNS[1:] + [
            "ingested_at", "source_file", "batch_id"
        ]
    )
    columns = SOURCE_COLUMNS + ["ingested_at", "source_file", "batch_id"]
    column_list = ", ".join(columns)
    value_list = ", ".join(f"source.{column}" for column in columns)

    connection.execute(
        f"""
        MERGE INTO bronze_crimes AS target
        USING bronze_api_stage AS source
        ON target.id = source.id
        WHEN MATCHED
          AND TRY_CAST(source.updated_on AS TIMESTAMP)
              >= TRY_CAST(target.updated_on AS TIMESTAMP)
        THEN UPDATE SET {assignments}
        WHEN NOT MATCHED THEN
          INSERT ({column_list}) VALUES ({value_list})
        """
    )
    return int(inserted), int(updated), int(overlap)


def log_run(
    connection: duckdb.DuckDBPyConnection, values: tuple[Any, ...]
) -> None:
    connection.execute(
        """
        INSERT INTO pipeline_run_history VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        values,
    )


def main() -> int:
    token, database, start_year, overlap_hours, app_token = require_environment()
    run_id = str(uuid.uuid4())
    batch_id = datetime.now(timezone.utc).strftime("api_%Y%m%dT%H%M%SZ")
    started_at = datetime.now(timezone.utc).replace(tzinfo=None)
    connection: duckdb.DuckDBPyConnection | None = None
    watermark_before: datetime | None = None
    fetched = stage_rows = inserted = updated = overlap = 0
    bronze_rows = silver_rows = gold_passed = 0

    try:
        connection = connect(token, database)
        ensure_history_table(connection)
        latest = current_watermark(connection, start_year)
        watermark_before = latest - timedelta(hours=overlap_hours)
        records = fetch_records(watermark_before, start_year, app_token)
        fetched = len(records)

        connection.execute("BEGIN TRANSACTION")
        if records:
            dataframe = prepare_dataframe(records, batch_id, started_at)
            stage_rows = create_stage(connection, dataframe)
            inserted, updated, overlap = merge_stage(connection)

        execute_sql_file(connection, "01_silver_transform.sql")
        execute_sql_file(connection, "02_silver_quality.sql")
        for gold_file in sorted((SQL_DIR / "gold").glob("*.sql")):
            connection.execute(gold_file.read_text(encoding="utf-8"))
        execute_sql_file(connection, "04_gold_quality.sql")

        bronze_rows = connection.execute(
            "SELECT COUNT(*) FROM bronze_crimes"
        ).fetchone()[0]
        silver_rows = connection.execute(
            "SELECT COUNT(*) FROM silver_crimes"
        ).fetchone()[0]
        gold_passed = connection.execute(
            """
            SELECT COUNT(*) FROM gold_quality_results
            WHERE validation_status = 'PASS'
            """
        ).fetchone()[0]
        watermark_after = connection.execute(
            "SELECT MAX(TRY_CAST(updated_on AS TIMESTAMP)) FROM bronze_crimes"
        ).fetchone()[0]
        connection.execute("COMMIT")

        ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
        log_run(
            connection,
            (
                run_id, PIPELINE_NAME, database, started_at, ended_at,
                (ended_at - started_at).total_seconds(), "SUCCESS", batch_id,
                watermark_before, watermark_after, fetched, stage_rows, inserted,
                updated, overlap, bronze_rows, silver_rows, gold_passed, None,
            ),
        )
        print(
            json.dumps(
                {
                    "run_id": run_id,
                    "status": "SUCCESS",
                    "batch_id": batch_id,
                    "api_records_fetched": fetched,
                    "rows_inserted": inserted,
                    "rows_updated": updated,
                    "bronze_rows_after": bronze_rows,
                    "silver_rows_after": silver_rows,
                    "gold_tables_passed": gold_passed,
                },
                default=str,
            )
        )
        return 0
    except Exception as exc:
        if connection is not None:
            try:
                connection.execute("ROLLBACK")
            except Exception:
                pass
            try:
                ensure_history_table(connection)
                ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
                log_run(
                    connection,
                    (
                        run_id, PIPELINE_NAME, database, started_at, ended_at,
                        (ended_at - started_at).total_seconds(), "FAILED", batch_id,
                        watermark_before, None, fetched, stage_rows, inserted,
                        updated, overlap, bronze_rows, silver_rows, gold_passed,
                        str(exc)[:2000],
                    ),
                )
            except Exception as logging_error:
                print(f"Could not record failure: {logging_error}", file=sys.stderr)
        print(f"Pipeline failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    started = time.monotonic()
    exit_code = main()
    print(f"Total runtime: {time.monotonic() - started:.2f} seconds")
    raise SystemExit(exit_code)
