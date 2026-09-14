# Build Report — Version 6 PostgreSQL 18

## Scope

ปรับฐานข้อมูลของโครงการจาก PostgreSQL 16 เป็น PostgreSQL 18 โดยไม่เปลี่ยน functional workflow ของ Citizen LIFF, LINE OA Webhook และ Admin Dashboard

## Changed

- Docker Official Image: `postgres:18-alpine`
- PGDATA: `/var/lib/postgresql/18/docker`
- Persistent volume mount: `/var/lib/postgresql`
- Docker volume: `postgres18_data`
- Runtime major-version enforcement: `POSTGRES_REQUIRED_MAJOR=18`
- Health endpoints expose database version
- Upgrade guide for PostgreSQL 16 → 18

## Compatibility

SQL migrations use PostgreSQL-compatible data types and syntax supported by PostgreSQL 18. Existing PostgreSQL 16 clusters require a supported major-version migration method; their data directories must not be mounted directly into the PostgreSQL 18 container.
