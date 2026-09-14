# คู่มือ PostgreSQL 18 — ติดตั้งใหม่และย้ายจาก PostgreSQL 16

## สถานะของโครงการ

โครงการรุ่นนี้กำหนด PostgreSQL major version เป็น 18 ผ่าน `POSTGRES_REQUIRED_MAJOR=18` และตรวจสอบเวอร์ชันตอนเริ่ม Backend หากเชื่อมต่อฐานข้อมูล major version อื่น ระบบจะหยุดเพื่อป้องกันการใช้งานผิดสภาพแวดล้อม

## ติดตั้งใหม่ด้วย Docker

```bash
cp .env.example .env
# กำหนด POSTGRES_PASSWORD และค่าที่จำเป็น

docker compose pull db
docker compose up -d db
docker compose run --rm app npm run db:migrate
docker compose up -d app
curl http://127.0.0.1:3000/health/ready
```

ผล health check ต้องมี `databaseMajor: 18`

## PostgreSQL 18 Docker data directory

Official Image รุ่น 18 ใช้ data directory `/var/lib/postgresql/18/docker` โครงการจึง mount persistent volume ที่ `/var/lib/postgresql` และกำหนด:

```yaml
PGDATA: /var/lib/postgresql/18/docker
```

ห้ามเปลี่ยนกลับไป mount เฉพาะ `/var/lib/postgresql/data` โดยไม่ตรวจสอบโครงสร้าง image รุ่น 18

## การย้ายข้อมูล PostgreSQL 16 → 18 แบบ dump/restore

วิธีนี้เหมาะกับระบบขนาดเล็กถึงกลางและเข้าใจง่ายที่สุด

### 1. หยุดการเขียนข้อมูล

ปิด Web App หรือเปิด maintenance mode เพื่อไม่ให้เกิดข้อมูลใหม่ระหว่าง backup

### 2. สำรองฐานข้อมูลจาก PostgreSQL 16

```bash
mkdir -p ./upgrade-backup
chmod 700 ./upgrade-backup

pg_dump "$OLD_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=./upgrade-backup/complaint_pg16.dump
```

สำรอง uploads แยกต่างหาก:

```bash
tar -C /path/to/uploads -czf ./upgrade-backup/complaint_uploads.tar.gz .
```

### 3. ตรวจสอบ backup

```bash
pg_restore --list ./upgrade-backup/complaint_pg16.dump > ./upgrade-backup/restore-list.txt
```

เก็บ checksum:

```bash
shasum -a 256 ./upgrade-backup/complaint_pg16.dump \
  ./upgrade-backup/complaint_uploads.tar.gz \
  > ./upgrade-backup/SHA256SUMS
```

### 4. เริ่ม PostgreSQL 18 ด้วย volume ใหม่

โครงการใช้ volume `postgres18_data` โดยตั้งชื่อแยกจาก volume รุ่นเดิมเพื่อไม่ให้ Docker นำ data directory ของ PostgreSQL 16 มาเปิดด้วย PostgreSQL 18

```bash
docker compose up -d db
```

### 5. Restore เข้า PostgreSQL 18

จากเครื่องที่มี PostgreSQL 18 client tools:

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="$NEW_DATABASE_URL" \
  ./upgrade-backup/complaint_pg16.dump
```

กรณีเป็นฐานข้อมูลใหม่ว่างและพบข้อความว่าลบ object ไม่ได้ สามารถ restore โดยตัด `--clean --if-exists` ได้

### 6. รัน migration

```bash
DATABASE_URL="$NEW_DATABASE_URL" POSTGRES_REQUIRED_MAJOR=18 npm run db:migrate
```

### 7. Restore รูปภาพ

```bash
mkdir -p /path/to/new/uploads
tar -C /path/to/new/uploads -xzf ./upgrade-backup/complaint_uploads.tar.gz
```

### 8. ตรวจสอบหลังย้าย

```sql
SELECT version();
SELECT count(*) FROM complaints;
SELECT count(*) FROM complaint_attachments;
SELECT count(*) FROM complaint_status_history;
SELECT count(*) FROM audit_logs;
```

ทดสอบอย่างน้อย:

- `/health/ready` แสดง major version 18
- เจ้าหน้าที่เข้าสู่ระบบได้
- รายการร้องเรียนเดิมครบ
- รูปภาพเดิมเปิดได้
- ประชาชนส่งเรื่องใหม่ได้
- เปลี่ยนสถานะและส่ง LINE Push Message ได้
- backup และ restore test ผ่าน

## pg_upgrade

PostgreSQL รองรับ `pg_upgrade` สำหรับ major-version upgrade แต่ต้องมี binary ของทั้งรุ่นเก่าและรุ่นใหม่ รวมถึงตรวจ extension และขั้นตอนหยุดบริการอย่างเป็นระบบ สำหรับ GDCC ให้ DBA เป็นผู้ดำเนินการและทดสอบใน staging ก่อน production

## Rollback

อย่าลบ PostgreSQL 16 cluster หรือ backup เดิมก่อนผ่าน acceptance test และรอบ backup/restore ของ PostgreSQL 18 อย่างน้อยหนึ่งรอบ หากต้อง rollback ให้หยุดแอป ชี้ `DATABASE_URL` กลับ cluster PostgreSQL 16 และตั้ง `POSTGRES_REQUIRED_MAJOR=16` เฉพาะระหว่าง rollback
