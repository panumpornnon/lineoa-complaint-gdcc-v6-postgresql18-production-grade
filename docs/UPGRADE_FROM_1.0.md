# อัปเกรดจากรุ่น 1.0 เป็น 1.1

## 1. สำรองระบบเดิม

ก่อนเปลี่ยนโค้ด ต้องสำรอง:
- PostgreSQL
- `.env`
- Nginx configuration
- Docker Compose configuration

## 2. นำโค้ดรุ่นใหม่ขึ้นระบบ

ตรวจค่าใหม่ใน `.env`:

```env
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_FILES=5
MAX_UPLOAD_MB=10
MAX_IMAGE_DIMENSION=1920
JPEG_QUALITY=85
GOOGLE_MAPS_API_KEY=...
```

## 3. Build Image ใหม่

```bash
docker compose build --no-cache app
```

## 4. สร้างตารางรูปภาพ

```bash
docker compose run --rm app npm run db:migrate
```

Migration script จะตรวจฐานข้อมูลรุ่น 1.0 และบันทึก `001_schema.sql` กับ `002_seed.sql` เป็น baseline จากนั้นรัน `003_attachments.sql`

ตรวจสอบ:

```sql
SELECT filename, applied_at
FROM schema_migrations
ORDER BY filename;
```

ควรพบ:

```text
001_schema.sql
002_seed.sql
003_attachments.sql
```

## 5. เปิดระบบ

```bash
docker compose up -d
docker compose logs -f app
```

## 6. ทดสอบ

- เปิด LIFF
- อนุญาตพิกัด
- แนบรูป JPEG 1 ภาพ
- ส่งเรื่อง
- ตรวจเลขรับเรื่อง
- เปิดแท็บติดตามและดูรูป
- เข้าหน้า `/admin.html`
- เปิดรูปและ Google Maps
- เปลี่ยนสถานะและตรวจข้อความ LINE

## 7. ข้อควรระวัง

- เรื่องเก่ารุ่น 1.0 อาจไม่มีรูปและพิกัดได้ตามข้อมูลเดิม
- เรื่องใหม่รุ่น 1.1 ต้องมีรูปอย่างน้อย 1 ภาพและพิกัด
- Docker volume `complaint_uploads` ต้องไม่ถูกลบเมื่อ deploy
- หากใช้หลาย Web/API instance ต้องย้ายรูปไป Shared/Object Storage ก่อน
