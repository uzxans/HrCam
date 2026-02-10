# PHP endpoints for remote SKUD control

## 1) `sync_time_hr.php`

Receives hourly attendance aggregates and upserts into `time_hr`.

### Request body (JSON)

```json
{
  "db_host": "127.0.0.1",
  "db_name": "your_db",
  "db_user": "your_user",
  "db_pass": "your_pass",
  "table": "time_hr",
  "data": [
    { "iduser": "4178", "data": "2026-02-10", "start": "08:15:00", "end": "17:45:00" }
  ]
}
```

## 2) `upsert_employee.php`

Receives new/updated employee records and inserts/updates rows in `hrapp`.

### Request body (JSON)

```json
{
  "db_host": "127.0.0.1",
  "db_name": "your_db",
  "db_user": "your_user",
  "db_pass": "your_pass",
  "db_table": "hrapp",
  "employees": [
    {
      "id": "4178",
      "full_name": "Ivan Ivanov",
      "photo": "https://example.com/photo.jpg",
      "status": 100,
      "object": "41"
    }
  ]
}
```
