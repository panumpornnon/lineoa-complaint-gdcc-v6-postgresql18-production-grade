# Changelog

## 6.0.0 — PostgreSQL 18

- เปลี่ยน Docker database image เป็น `postgres:18-alpine`
- ปรับ PostgreSQL 18 data directory และ volume mount เป็น `/var/lib/postgresql/18/docker`
- เปลี่ยนชื่อ volume เป็น `postgres18_data` เพื่อป้องกันการนำ PostgreSQL 16 data directory มาเปิดตรง ๆ
- เพิ่มการตรวจ PostgreSQL major version ตอน startup และ health check
- เพิ่มคู่มือ dump/restore จาก PostgreSQL 16 ไป PostgreSQL 18
- คง schema, migrations, parameterized queries และ backup format เดิมที่รองรับ PostgreSQL 18


## 1.1.0 — รูปภาพและ Google Maps

เพิ่ม:
- แนบรูปภาพประกอบ 1–5 ภาพ
- Preview รูปก่อนส่ง
- รองรับ JPEG, PNG, WebP และทดลองรองรับ HEIC/HEIF
- แปลงภาพเป็น JPEG ลบ EXIF และย่อขนาดด้วย Sharp
- ตาราง `complaint_attachments`
- API อ่านภาพที่ตรวจสิทธิ์เจ้าของเรื่องหรือ Admin JWT
- บังคับ Latitude/Longitude สำหรับเรื่องใหม่
- Google Maps URL และ Maps Embed API
- Docker volume สำหรับ Upload
- Backup ฐานข้อมูลและรูปภาพ
- Migration tracking รองรับการอัปเกรดจาก 1.0

ปรับปรุง:
- Nginx request size สำหรับ multipart upload
- Privacy Notice ให้ครอบคลุมรูปภาพ พิกัด และ Google Maps
- เอกสารติดตั้ง GDCC และ Security Checklist
