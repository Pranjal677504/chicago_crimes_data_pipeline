"""Build the static dashboard data bundle from validated MotherDuck tables."""

from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb


TABLES = {
    "monthly": "gold_monthly_crime_trends",
    "area": "gold_area_crime_summary",
    "arrest": "gold_arrest_analysis",
    "time": "gold_time_patterns",
    "hotspots": "gold_crime_hotspots",
    "silver": "silver_crimes",
}


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the JSON consumed by the Chicago crime dashboard."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("_site/data"),
        help="Directory for generated JSON files (default: _site/data).",
    )
    parser.add_argument(
        "--parquet-dir",
        type=Path,
        help="Optional local Parquet source used for offline validation.",
    )
    return parser.parse_args()


def connect(parquet_dir: Path | None) -> tuple[duckdb.DuckDBPyConnection, str]:
    if parquet_dir is None:
        token = os.getenv("MOTHERDUCK_TOKEN")
        if not token:
            raise RuntimeError("MOTHERDUCK_TOKEN is required")
        database = os.getenv(
            "MOTHERDUCK_DATABASE", "chicago_crimes_2020_to_2026"
        )
        os.environ["motherduck_token"] = token
        return duckdb.connect(f"md:{database}"), f"MotherDuck / {database}"

    connection = duckdb.connect()
    files = {
        "monthly": "gold_monthly_crime_trends.parquet",
        "area": "gold_area_crime_summary.parquet",
        "arrest": "gold_arrest_analysis.parquet",
        "time": "gold_time_patterns.parquet",
        "hotspots": "gold_crime_hotspots.parquet",
        "silver": "silver_crimes_full.parquet",
    }
    for alias, filename in files.items():
        path = (parquet_dir / filename).resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        safe_path = str(path).replace("'", "''")
        connection.execute(
            f"CREATE VIEW {alias} AS SELECT * FROM read_parquet('{safe_path}')"
        )
    return connection, f"Local Parquet / {parquet_dir.resolve()}"


def prepare_views(
    connection: duckdb.DuckDBPyConnection, parquet_mode: bool
) -> None:
    if parquet_mode:
        return
    for alias, table in TABLES.items():
        connection.execute(
            f"CREATE OR REPLACE TEMP VIEW {alias} AS SELECT * FROM {table}"
        )


def json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def rows(connection: duckdb.DuckDBPyConnection, query: str) -> list[list[Any]]:
    return [list(row) for row in connection.execute(query).fetchall()]


def scalar(connection: duckdb.DuckDBPyConnection, query: str) -> Any:
    return connection.execute(query).fetchone()[0]


def write(output: Path, name: str, payload: Any) -> None:
    destination = output / name
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(
            payload,
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
            default=json_default,
        )
    temporary.replace(destination)


def validate(connection: duckdb.DuckDBPyConnection) -> None:
    silver_total = scalar(connection, "SELECT count(*) FROM silver")
    monthly_total = scalar(connection, "SELECT sum(total_crimes) FROM monthly")
    area_total = scalar(connection, "SELECT sum(total_crimes) FROM area")
    if silver_total != monthly_total or silver_total != area_total:
        raise RuntimeError(
            "Dashboard reconciliation failed: Silver, monthly Gold, and area Gold "
            "totals do not match"
        )
    if scalar(connection, "SELECT count(DISTINCT crime_id) FROM silver") != silver_total:
        raise RuntimeError("Dashboard validation failed: duplicate Silver crime_id")


def build(connection: duckdb.DuckDBPyConnection, output: Path, source: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "incidents.json").unlink(missing_ok=True)
    validate(connection)

    silver_meta = connection.execute(
        """
        SELECT count(*) AS row_count,
               count(DISTINCT crime_id) AS unique_ids,
               min(date) AS min_date,
               max(date) AS max_date,
               max(updated_on) AS last_updated,
               count(DISTINCT primary_type) AS crime_types,
               count(DISTINCT district) AS districts,
               count(DISTINCT community_area) AS communities,
               sum(arrest::INTEGER) AS arrests,
               sum(domestic::INTEGER) AS domestic_incidents,
               count(latitude) AS geocoded_rows
        FROM silver
        """
    ).fetchone()

    meta = {
        "rowCount": silver_meta[0],
        "uniqueIds": silver_meta[1],
        "minDate": str(silver_meta[2]),
        "maxDate": str(silver_meta[3]),
        "lastUpdated": str(silver_meta[4]),
        "crimeTypeCount": silver_meta[5],
        "districtCount": silver_meta[6],
        "communityCount": silver_meta[7],
        "arrests": silver_meta[8],
        "domesticIncidents": silver_meta[9],
        "geocodedRows": silver_meta[10],
        "refreshMode": "Automated daily pipeline",
    }

    write(
        output,
        "core.json",
        {
            "meta": meta,
            "monthly": rows(
                connection,
                "SELECT year, month, primary_type, total_crimes, total_arrests, "
                "arrest_rate FROM monthly ORDER BY year, month, primary_type",
            ),
            "area": rows(
                connection,
                "SELECT year, district, total_crimes, total_arrests, arrest_rate "
                "FROM area ORDER BY year, district",
            ),
            "arrest": rows(
                connection,
                "SELECT year, primary_type, domestic::INTEGER, total_crimes, "
                "total_arrests, arrest_rate FROM arrest "
                "ORDER BY year, primary_type, domestic",
            ),
            "time": rows(
                connection,
                "SELECT day_of_week_number, day_of_week, hour_of_day, total_crimes, "
                "total_arrests, arrest_rate FROM time "
                "ORDER BY day_of_week_number, hour_of_day",
            ),
            "crimeTypes": [
                row[0]
                for row in rows(
                    connection,
                    "SELECT DISTINCT primary_type FROM monthly ORDER BY primary_type",
                )
            ],
            "years": [
                row[0]
                for row in rows(
                    connection, "SELECT DISTINCT year FROM monthly ORDER BY year"
                )
            ],
            "districts": [
                row[0]
                for row in rows(
                    connection, "SELECT DISTINCT district FROM area ORDER BY district"
                )
            ],
            "communities": [
                row[0]
                for row in rows(
                    connection,
                    "SELECT DISTINCT community_area FROM silver "
                    "WHERE community_area IS NOT NULL ORDER BY community_area",
                )
            ],
        },
    )

    write(
        output,
        "hotspots.json",
        {
            "rows": rows(
                connection,
                "SELECT lat_bin, long_bin, total_crimes, total_arrests, arrest_rate "
                "FROM hotspots ORDER BY total_crimes DESC",
            ),
            "totalCrime": scalar(
                connection, "SELECT sum(total_crimes) FROM hotspots"
            ),
        },
    )

    write(
        output,
        "geo_cube.json",
        {
            "columns": [
                "year", "district", "community_area", "primary_type", "domestic",
                "total_crimes", "total_arrests",
            ],
            "rows": rows(
                connection,
                """
                SELECT year,
                       CASE WHEN district = '031' THEN 'UNASSIGNED' ELSE district END
                           AS district,
                       coalesce(community_area, 'UNKNOWN') AS community_area,
                       primary_type,
                       domestic::INTEGER AS domestic,
                       count(*) AS total_crimes,
                       sum(arrest::INTEGER) AS total_arrests
                FROM silver
                GROUP BY ALL
                ORDER BY year, district, community_area, primary_type, domestic
                """,
            ),
        },
    )

    write(
        output,
        "monthly_geo.json",
        {
            "columns": [
                "year", "month", "district", "community_area", "primary_type",
                "domestic", "total_crimes", "total_arrests",
            ],
            "rows": rows(
                connection,
                """
                SELECT year, month(date) AS month,
                       CASE WHEN district = '031' THEN 'UNASSIGNED' ELSE district END
                           AS district,
                       coalesce(community_area, 'UNKNOWN') AS community_area,
                       primary_type,
                       domestic::INTEGER AS domestic,
                       count(*) AS total_crimes,
                       sum(arrest::INTEGER) AS total_arrests
                FROM silver
                GROUP BY ALL
                ORDER BY year, month(date), district, community_area,
                         primary_type, domestic
                """,
            ),
        },
    )

    write(
        output,
        "time_cube.json",
        {
            "columns": [
                "year", "month", "primary_type", "domestic", "day", "hour",
                "total_crimes", "total_arrests",
            ],
            "rows": rows(
                connection,
                """
                SELECT year, month(date) AS month, primary_type,
                       domestic::INTEGER AS domestic,
                       ((dayofweek(date) + 6) % 7) + 1 AS day,
                       hour(date) AS hour,
                       count(*) AS total_crimes,
                       sum(arrest::INTEGER) AS total_arrests
                FROM silver
                GROUP BY ALL
                ORDER BY year, month, primary_type, domestic, day, hour
                """,
            ),
        },
    )

    grains = {
        "monthly": "year + month + primary_type",
        "area": "year + district",
        "arrest": "year + primary_type + domestic",
        "time": "day_of_week_number + hour_of_day",
        "hotspots": "lat_bin + long_bin",
        "silver": "crime_id (incident-level)",
    }
    date_expressions = {
        "monthly": "min(year), max(year)",
        "area": "min(year), max(year)",
        "arrest": "min(year), max(year)",
        "time": "NULL, NULL",
        "hotspots": "NULL, NULL",
        "silver": "min(date), max(date)",
    }
    inventory = {
        "generatedAt": str(
            connection.execute("SELECT current_timestamp").fetchone()[0]
        ),
        "source": source,
        "files": [],
    }
    for alias, table in TABLES.items():
        schema = connection.execute(f"DESCRIBE SELECT * FROM {alias}").fetchall()
        range_start, range_end = connection.execute(
            f"SELECT {date_expressions[alias]} FROM {alias}"
        ).fetchone()
        inventory["files"].append(
            {
                "filename": table,
                "format": "MotherDuck table" if "MotherDuck" in source else "Parquet",
                "rowCount": scalar(connection, f"SELECT count(*) FROM {alias}"),
                "columns": [
                    {"name": row[0], "type": row[1], "nullable": row[2] == "YES"}
                    for row in schema
                ],
                "rangeStart": None if range_start is None else str(range_start),
                "rangeEnd": None if range_end is None else str(range_end),
                "grain": grains[alias],
            }
        )
    write(output, "inventory.json", inventory)

    sizes = {path.name: path.stat().st_size for path in sorted(output.glob("*.json"))}
    print(json.dumps({"source": source, "files": sizes}, indent=2))


def main() -> int:
    args = arguments()
    connection, source = connect(args.parquet_dir)
    try:
        prepare_views(connection, args.parquet_dir is not None)
        build(connection, args.output, source)
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
