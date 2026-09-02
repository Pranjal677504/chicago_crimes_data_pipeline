# Data Dictionary

## Silver table: `silver_crimes`

| Column | Type | Meaning |
| --- | --- | --- |
| `crime_id` | BIGINT | Unique source record identifier |
| `case_number` | VARCHAR | Chicago Police case number; not assumed unique |
| `date` | TIMESTAMP | Date and time of the incident |
| `block` | VARCHAR | Partially redacted block address |
| `iucr` | VARCHAR | Illinois Uniform Crime Reporting code |
| `primary_type` | VARCHAR | Primary crime category |
| `description` | VARCHAR | Crime description |
| `location_description` | VARCHAR | Type of location |
| `arrest` | BOOLEAN | Whether an arrest was made |
| `domestic` | BOOLEAN | Whether the incident was domestic-related |
| `beat` | VARCHAR | Four-character police beat code |
| `district` | VARCHAR | Three-character police district code |
| `ward` | VARCHAR | Two-character ward code |
| `community_area` | VARCHAR | Two-character community-area code |
| `fbi_code` | VARCHAR | FBI crime classification code |
| `x_coordinate` | DOUBLE | Illinois State Plane X coordinate |
| `y_coordinate` | DOUBLE | Illinois State Plane Y coordinate |
| `year` | BIGINT | Incident year |
| `updated_on` | TIMESTAMP | Last source-system update time |
| `latitude` | DOUBLE | Incident latitude when available |
| `longitude` | DOUBLE | Incident longitude when available |
| `ingested_at` | TIMESTAMP | Pipeline ingestion timestamp |
| `source_file` | VARCHAR | Source API or historical file identifier |
| `batch_id` | VARCHAR | Pipeline batch identifier |

`case_number` duplicates are retained because separate records can legitimately share a case number. `crime_id` is the uniqueness key.

## Gold tables

| Table | Grain | Measures |
| --- | --- | --- |
| `gold_monthly_crime_trends` | `year`, `month`, `primary_type` | `total_crimes`, `total_arrests`, `arrest_rate` |
| `gold_area_crime_summary` | `year`, `district` | `total_crimes`, `total_arrests`, `arrest_rate` |
| `gold_arrest_analysis` | `year`, `primary_type`, `domestic` | `total_crimes`, `total_arrests`, `arrest_rate` |
| `gold_time_patterns` | `day_of_week_number`, `day_of_week`, `hour_of_day` | `total_crimes`, `total_arrests`, `arrest_rate` |
| `gold_crime_hotspots` | `lat_bin`, `long_bin` | `total_crimes`, `total_arrests`, `arrest_rate` |

In `gold_area_crime_summary`, source district `031` is presented as `UNASSIGNED`. Hotspot coordinates are grouped into 0.001-degree bins.

