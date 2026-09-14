# Deploy บน Render

## แบบ Blueprint (แนะนำ)

1. Push โปรเจกต์นี้ขึ้น GitHub โดยให้ `render.yaml` อยู่ที่ root ของ repository
2. Render Dashboard → **New +** → **Blueprint**
3. เชื่อม repository แล้วกด **Apply**
4. ตอนสร้างครั้งแรก Render จะถามค่าที่ตั้ง `sync: false` ให้กรอก:
   - `LIFF_ID`
   - `LINE_LOGIN_CHANNEL_ID`
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
5. รอให้ฐานข้อมูลและ Web Service deploy สำเร็จ
6. URL จะเป็น `https://lineoa-complaint-gdcc-v6.onrender.com` หรือชื่อที่ Render จัดให้
7. นำ URL HTTPS ไปใส่ใน LINE Developers Console → LIFF → Endpoint URL

## กรณีใช้ Web Service เดิม

ตั้งค่าใน Render ดังนี้:

- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health/live`
- Node version: `22`

Environment Variables ที่จำเป็น:

```env
NODE_ENV=production
DATABASE_URL=<Internal Database URL จาก Render Postgres>
DB_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=false
POSTGRES_REQUIRED_MAJOR=18
TRUST_PROXY=1
UPLOAD_DIR=/tmp/uploads
LIFF_ID=<LIFF ID>
LINE_LOGIN_CHANNEL_ID=<LINE Login Channel ID>
LINE_CHANNEL_SECRET=<Messaging API Channel Secret>
LINE_CHANNEL_ACCESS_TOKEN=<Messaging API Channel Access Token>
JWT_SECRET=<สุ่มอย่างน้อย 32 ตัวอักษร>
```

ไม่ต้องตั้ง `PORT`; Render กำหนดให้และแอปอ่าน `process.env.PORT` อัตโนมัติ

`npm start` จะรัน migration ที่ยังไม่เคยใช้ก่อน แล้วจึงเปิดเซิร์ฟเวอร์
