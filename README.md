# Version 6 — PostgreSQL 18 Production Grade Smart City Complaint Platform

This release upgrades the database runtime to PostgreSQL 18 and keeps the hardened deployment, operations and reliability controls for GDCC. Start with `docs/POSTGRESQL18_UPGRADE.md`, `docs/PRODUCTION_GRADE_GDCC.md` and `docs/GO_LIVE_CHECKLIST.md`.

# ระบบรับเรื่องร้องเรียนผ่าน LINE OA บน GDCC

โปรเจกต์ตัวอย่างแบบ MVP สำหรับ:

```text
LINE OA / Rich Menu
        ↓
LIFF Web App
        ↓ HTTPS + LINE ID Token
Node.js Backend API บน GDCC
        ↓ Private Network
PostgreSQL
        ↓
หน้าเจ้าหน้าที่ + แจ้งสถานะกลับ LINE OA
```

## ความสามารถที่มีในชุดนี้

- หน้า LIFF สำหรับแจ้งเรื่องร้องเรียน
- อ่านพิกัดจากอุปกรณ์โดยได้รับอนุญาต และบังคับยืนยัน Latitude/Longitude ก่อนส่ง
- ตรวจสอบ LINE ID Token ที่ Backend
- บันทึกข้อมูลด้วย Parameterized Query
- แนบรูปภาพประกอบ 1–5 ภาพ พร้อม Preview ก่อนส่ง
- แปลงรูปเป็น JPEG ลบ EXIF ย่อสูงสุด 1,920 px และเก็บไฟล์แยกจากฐานข้อมูล
- แสดงพิกัดผ่าน Google Maps พร้อมลิงก์เปิดแอป/เว็บไซต์แผนที่
- ออกเลขรับเรื่อง `CMP-YYYYMMDD-000001`
- ประชาชนดูรายการของตนเอง
- Webhook ตรวจ `x-line-signature`
- ตอบคำว่า “สถานะ” หรือ “ติดตาม CMP-...” ในแชต
- ส่ง Push Message เมื่อรับเรื่องและเปลี่ยนสถานะ
- หน้าเจ้าหน้าที่ `/admin.html`
- บัญชีเจ้าหน้าที่พร้อม Role
- ประวัติการเปลี่ยนสถานะ
- Docker / PostgreSQL 18 / Nginx / Health Check / Backup Script
- แม่แบบ Privacy Notice

## สิ่งที่ยังไม่ได้ใส่ใน MVP

- แนบไฟล์เอกสาร วิดีโอ และเสียง (รุ่นนี้รองรับเฉพาะรูปภาพ)
- ระบบมอบหมายกอง/ฝ่ายแบบละเอียด
- SSO ของหน่วยงาน
- Dashboard เชิงสถิติ
- SLA/แจ้งเตือนเรื่องเกินกำหนด
- ลายมือชื่อดิจิทัล
- Integration กับระบบสารบรรณ
- High Availability และ Disaster Recovery

รายการเหล่านี้ควรทำในระยะถัดไปหลังยืนยันกระบวนงานจริง

---

## 1. โปรแกรมที่ต้องมีสำหรับการทดลอง

- Node.js 22 ขึ้นไป
- PostgreSQL 18.x หรือ Docker (โปรเจกต์ตรวจสอบ major version ตอนเริ่มระบบ)
- LINE Official Account
- LINE Developers Provider
- Messaging API channel
- LINE Login channel และ LIFF app

> Messaging API channel และ LINE Login channel ต้องอยู่ภายใต้ Provider เดียวกัน เพื่อให้ user ID ของคนเดียวกันตรงกัน

---

## 2. เริ่มต้นแบบ Docker

คัดลอกไฟล์ตั้งค่า:

```bash
cp .env.example .env
```

เพิ่มค่าของ Compose ใน `.env`:

```env
POSTGRES_DB=complaint_db
POSTGRES_USER=complaint_app
POSTGRES_PASSWORD=เปลี่ยนเป็นรหัสผ่านฐานข้อมูลที่ปลอดภัย
```

จากนั้นกรอกค่าหลัก:

```env
NODE_ENV=development
APP_BASE_URL=https://ชื่อโดเมนของคุณ
CORS_ORIGINS=https://ชื่อโดเมนของคุณ
DATABASE_URL=postgresql://complaint_app:รหัสผ่าน@db:5432/complaint_db
POSTGRES_REQUIRED_MAJOR=18

LIFF_ID=...
LINE_LOGIN_CHANNEL_ID=...
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
JWT_SECRET=สุ่มข้อความยาวอย่างน้อย32ตัวอักษร
```

สร้างระบบ:

```bash
docker compose build
docker compose up -d db
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run admin:create -- admin "รหัสผ่านอย่างน้อย12ตัว" "ผู้ดูแลระบบ" admin
docker compose up -d
```

> PostgreSQL 18 ใช้ volume `postgres18_data` และ data directory `/var/lib/postgresql/18/docker` ตามโครงสร้างของ Official Image รุ่น 18 ห้ามนำ volume PostgreSQL 16 เดิมมาต่อโดยตรง ให้ทำ dump/restore ตาม `docs/POSTGRESQL18_UPGRADE.md`

ทดสอบ:

```bash
curl http://127.0.0.1:3000/health
```

หน้าใช้งาน:
- LIFF Web App: `http://localhost:3000/`
- เจ้าหน้าที่: `http://localhost:3000/admin.html`

> การทดสอบ LIFF จริงต้องใช้ HTTPS Endpoint ที่ LINE เข้าถึงได้

---

## 3. เริ่มต้นแบบไม่ใช้ Docker

สร้างฐานข้อมูลและผู้ใช้ PostgreSQL ก่อน แล้วกำหนด `DATABASE_URL`

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run admin:create -- admin "รหัสผ่านอย่างน้อย12ตัว" "ผู้ดูแลระบบ" admin
npm start
```

---

## 4. ตั้งค่า LINE

### Provider

สร้างหรือเลือก Provider ของหน่วยงาน แล้ววางทั้งสอง channel ใต้ Provider เดียวกัน:

1. Messaging API channel ของ LINE OA
2. LINE Login channel สำหรับ LIFF

### LIFF app

- Endpoint URL: `https://ชื่อโดเมน/`
- Scope: `openid`, `profile`
- นำ LIFF ID ไปใส่ `LIFF_ID`
- นำ Channel ID ของ LINE Login ไปใส่ `LINE_LOGIN_CHANNEL_ID`

### Messaging API

- Webhook URL: `https://ชื่อโดเมน/webhook`
- เปิด Use webhook
- นำ Channel secret ไปใส่ `LINE_CHANNEL_SECRET`
- ออก Channel access token แล้วใส่ `LINE_CHANNEL_ACCESS_TOKEN`

### Rich Menu

ลิงก์ปุ่ม “แจ้งเรื่อง” ไปที่:

```text
https://liff.line.me/<LIFF_ID>
```

---

## 5. โครงสร้างฐานข้อมูล

ตารางหลัก:

- `complaint_categories` — หมวดหมู่
- `complaints` — เรื่องร้องเรียน
- `complaint_status_history` — ประวัติสถานะ
- `complaint_attachments` — Metadata และตำแหน่งจัดเก็บรูปภาพ
- `staff_users` — บัญชีเจ้าหน้าที่

สถานะ:

```text
new
→ received
→ assigned / in_progress
→ waiting_for_info
→ completed
```

และสถานะปลายทาง:

```text
rejected
cancelled
```

---



## 5.1 รูปภาพและ Google Maps

เพิ่มค่าใน `.env`:

```env
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_FILES=5
MAX_UPLOAD_MB=10
MAX_IMAGE_DIMENSION=1920
JPEG_QUALITY=85

GOOGLE_MAPS_API_KEY=คีย์ที่จำกัดสิทธิ์แล้ว
```

การทำงานของรูปภาพ:

```text
Browser ส่ง multipart/form-data
→ Backend ตรวจชนิดและขนาด
→ Sharp หมุนภาพตาม EXIF
→ ย่อขนาดและแปลงเป็น JPEG
→ ลบ Metadata เดิม
→ บันทึกไฟล์ใน UPLOAD_DIR
→ บันทึก Metadata ใน complaint_attachments
→ เปิดดูผ่าน API ที่ตรวจสิทธิ์แล้ว
```

Google Maps:

- พิกัดบันทึกเป็น `latitude` และ `longitude` ใน PostgreSQL
- ลิงก์ “เปิด Google Maps” ใช้พิกัดโดยตรง
- แผนที่แบบฝังในหน้าเว็บใช้ `GOOGLE_MAPS_API_KEY`
- คีย์ที่ใช้ใน Browser ต้องจำกัด HTTP referrer ให้ตรงกับโดเมนระบบ
- จำกัดคีย์ให้เรียกเฉพาะ Maps Embed API
- หากไม่ใส่คีย์ ระบบยังบันทึกพิกัดและเปิดลิงก์ Google Maps ได้ แต่ไม่แสดงแผนที่แบบฝัง

รายละเอียดเพิ่มเติม: `docs/IMAGE_AND_MAPS.md`


## 6. ความปลอดภัยที่ใส่มาแล้ว

- ตรวจ ID Token กับ LINE ที่ Backend
- ไม่รับ LINE user ID จาก Browser โดยตรง
- ตรวจลายเซ็น Webhook จาก raw body
- Parameterized SQL
- Rate limit
- Helmet security headers
- JWT สำหรับเจ้าหน้าที่
- Hash รหัสผ่านด้วย bcrypt
- แยกสิทธิ์ฐานข้อมูลออกจากหน้า Web App
- ไม่ทำให้การบันทึกเรื่องล้มเหลวเมื่อส่ง LINE ไม่สำเร็จ
- จำกัดขนาด JSON request
- ไม่แสดง stack trace ใน production
- รูปภาพถูกเปิดผ่าน API ที่ตรวจเจ้าของเรื่องหรือ JWT เจ้าหน้าที่
- ชื่อไฟล์จริงใช้ UUID และไม่เปิดโฟลเดอร์ Upload เป็น Static Public
- ตรวจขนาดไฟล์ จำกัดจำนวนไฟล์ และ Decode ภาพจริงก่อนบันทึก

## 7. สิ่งที่ต้องทำเพิ่มก่อนใช้งานราชการจริง

1. ปรับแบบฟอร์มและขั้นตอนตามภารกิจจริง
2. ทำ Privacy Notice และ Record of Processing Activities
3. กำหนดระยะเวลาเก็บข้อมูลและกระบวนการลบ
4. ใช้ SSO/IdP ของหน่วยงานแทนบัญชีรหัสผ่าน หากมี
5. จัดทำ Audit Log สำหรับการดูข้อมูลสำคัญ
6. แยก Web VM และ Database VM
7. ใช้ Private IP สำหรับ PostgreSQL
8. เปิด WAF/Anti-DDoS/Monitoring ตามบริการ GDCC
9. ทำ VA/PT และแก้ช่องโหว่ก่อน Go-live
10. ทดสอบ Backup/Restore และแผน DR
11. ทำ Malware Scan หากเพิ่มระบบแนบไฟล์
12. ให้ฝ่ายกฎหมาย/DPO และผู้ดูแลความมั่นคงปลอดภัยตรวจรับ

ดูขั้นตอน GDCC เพิ่มเติมที่ `docs/GDCC_DEPLOYMENT.md`

---

## 8. คำสั่งที่ใช้บ่อย

ดู Log:

```bash
docker compose logs -f app
```

Restart:

```bash
docker compose up -d --force-recreate app
```

สร้างหรือเปลี่ยนรหัสบัญชีเจ้าหน้าที่:

```bash
docker compose run --rm app npm run admin:create -- officer01 "รหัสผ่านยาว" "เจ้าหน้าที่รับเรื่อง" officer
```

สำรองฐานข้อมูลและโฟลเดอร์รูปภาพ:

```bash
DATABASE_URL='postgresql://...' UPLOAD_DIR='/app/uploads' ./scripts/backup.sh
```

รันทดสอบ:

```bash
npm test
```

---

## 9. หมายเหตุสำคัญ

โค้ดนี้เป็นต้นแบบที่รันได้และวางแนวความปลอดภัยพื้นฐาน แต่ไม่ใช่การรับรองว่าผ่านมาตรฐานของหน่วยงานโดยอัตโนมัติ การเปิดให้ประชาชนใช้จริงต้องผ่านกระบวนการตรวจรับระบบ ความมั่นคงปลอดภัย PDPA การสำรอง/กู้คืน และเงื่อนไขการให้บริการ GDCC ของหน่วยงาน

---

## Version 2.0: Enterprise Admin Dashboard

โปรเจกต์รุ่นนี้เพิ่มระบบหลังบ้านแบบ Dashboard ตามแนวภาพต้นแบบ พร้อม KPI, Sidebar, ตารางรายการ, Detail Drawer, รูปภาพ, Google Maps, Timeline และการมอบหมายงาน

อ่านรายละเอียดที่ `docs/V2_ADMIN_DASHBOARD.md`

---

# Version 3 Smart City Enterprise

หน้าประชาชนและระบบหลังบ้านถูกออกแบบใหม่เป็น Smart City Enterprise UX/UI รายละเอียดอยู่ที่ `docs/V3_SMART_CITY_ENTERPRISE.md`

หน้าใช้งาน:

- Citizen LIFF: `/`
- Staff Command Center: `/admin.html`

Version 3 เพิ่มกราฟแนวโน้ม, สัดส่วนสถานะ, KPI, เรื่องเร่งด่วน, Smart Map และ Case Intelligence Drawer โดยใช้ข้อมูลจาก PostgreSQL ผ่าน Backend API


## Version 4 Production UI

ดูรายละเอียดที่ `docs/V4_PRODUCTION_UI.md`
