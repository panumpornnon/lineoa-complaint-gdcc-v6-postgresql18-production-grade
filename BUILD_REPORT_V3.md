# Build Report — Version 3.0.0

## Validation

- JavaScript syntax: passed
- Node unit tests: passed
- Existing LINE OA / LIFF flow retained
- Existing PostgreSQL migrations retained
- Dashboard API extended for trends, status breakdown, urgent cases and map cases

## Main UI files

- `public/index.html` — Smart City Citizen Portal
- `public/styles.css` — Citizen Enterprise theme
- `public/admin.html` — Smart City Command Center
- `public/admin-v3.css` — Enterprise Admin theme
- `public/admin.js` — Dashboard, charts, map, table and case management

## Deployment note

ต้องรัน migration เดิมทั้งหมดผ่าน `npm run db:migrate` และกำหนด `.env` ให้ครบ การแสดงข้อมูลจริงต้องมี PostgreSQL, LINE Login, LIFF, Messaging API และ Google Maps configuration ที่ใช้งานได้
