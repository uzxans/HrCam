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
  "object_id": "41",
  "data": [
    { "iduser": "4178", "date": "2026-02-10", "start": "08:15:00", "end": "" },
    { "iduser": "4178", "date": "2026-02-11", "start": "", "end": "05:40:00" }
  ]
}
```

`sync_time_hr.php` checks open shifts in `time_hr` (`end` empty).  
If an open shift exists, `end` event closes it. If no open shift exists, a new row is inserted.

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
