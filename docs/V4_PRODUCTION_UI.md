# Version 4 Production Smart City UX/UI

เวอร์ชันนี้ปรับหน้า Citizen Portal และ Admin Command Center ให้ใช้โค้ด UI จริงตามแนวภาพเป้าหมาย พร้อมเพิ่มฟังก์ชันระบบที่เคยเป็นโครงให้ทำงานกับ Backend API และ PostgreSQL

## ระบบที่ทำงานจริง

- LINE Login / LIFF และตรวจ ID Token ที่ Backend
- รับเรื่องพร้อมรูปภาพและพิกัด Google Maps
- ติดตามสถานะและแจ้งเตือนผ่าน LINE OA
- Dashboard KPI, กราฟแนวโน้ม, Donut Chart และภาระงานหน่วยงาน
- ตารางค้นหา กรอง แบ่งหน้า และ Detail Drawer
- มอบหมายหน่วยงาน เจ้าหน้าที่ ความสำคัญ และกำหนดเสร็จ
- Smart Map และลิงก์เปิด Google Maps
- Export รายงาน CSV
- จัดการหมวดหมู่และ SLA
- จัดการหน่วยงาน
- จัดการบัญชีเจ้าหน้าที่ตาม Role
- Audit Log การเปลี่ยนสถานะ การมอบหมาย การตั้งค่า และการส่งออกรายงาน

## Migration ใหม่

รัน `sql/005_smartcity_governance.sql` ผ่านคำสั่ง migration ตามปกติ

```bash
docker compose build --no-cache app
docker compose run --rm app npm run db:migrate
docker compose up -d
```

## สิทธิ์

- officer: จัดการเรื่องร้องเรียนตามสิทธิ์พื้นฐาน
- supervisor: ดู Governance และ Audit Log
- admin: จัดการหมวดหมู่ หน่วยงาน ผู้ใช้งาน และ Audit Log

ก่อนเปิดใช้จริงต้องทำ VA/PT, ทดสอบ Backup/Restore, ตรวจ Privacy Notice และกำหนด Workflow/SLA ของหน่วยงาน
