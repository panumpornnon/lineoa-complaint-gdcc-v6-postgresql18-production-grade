# Version 3 — Smart City Enterprise UX/UI

Version 3 ปรับทั้ง Citizen Web App และ Staff Admin Web App โดยยังใช้สถาปัตยกรรมเดิม:

```text
LINE OA / LIFF
  → Node.js Backend API บน GDCC
  → PostgreSQL
  → Private image storage
  → LINE Messaging API
```

## Citizen Portal

- Smart City Hero และข้อมูลความน่าเชื่อถือ
- แบบฟอร์มแบ่งเป็น 4 ส่วนที่อ่านง่าย
- LINE Login และการตรวจ ID Token ที่ Backend
- แนบภาพหลายภาพ พร้อม Preview
- GPS และ Google Maps
- ติดตามเรื่องของบัญชี LINE ที่เข้าสู่ระบบ
- Responsive สำหรับโทรศัพท์

## Enterprise Admin

- Secure Staff Login
- Smart City Command Center
- KPI 6 รายการจากฐานข้อมูลจริง
- กราฟรับเรื่องและปิดงานย้อนหลัง 6 เดือน
- Donut สัดส่วนสถานะ
- เรื่องเร่งด่วนและใกล้ครบกำหนด
- ตารางค้นหา กรอง และแบ่งหน้า
- Case Intelligence Drawer
- รูปภาพ พิกัด Timeline การมอบหมาย และเปลี่ยนสถานะ
- Smart Map แบบภาพรวม พร้อมลิงก์ Google Maps
- Analytics ตามหมวดหมู่และหน่วยงาน
- System Governance UI สำหรับการต่อยอด

## สิ่งที่ทำงานจริง

- Dashboard API และข้อมูลกราฟ
- ค้นหา/กรอง/แบ่งหน้า
- เปิดรายละเอียดและรูปที่มีสิทธิ์
- มอบหมายหน่วยงาน เจ้าหน้าที่ ความสำคัญ และ Due date
- เปลี่ยนสถานะและแจ้ง LINE OA
- พิกัดและ Google Maps
- LINE Login, JWT และ PostgreSQL

## โมดูลที่เป็น UI สำหรับต่อยอด

ปุ่มจัดการผู้ใช้งาน หมวดหมู่ Backup Center และ Notification Rules ถูกแสดงเป็นโครง UX/UI แต่ยังไม่มี CRUD ครบวงจรใน Version 3 นี้ การเปิดใช้งานจริงควรกำหนด Role, Workflow และนโยบายหน่วยงานก่อนพัฒนา Endpoint เพิ่ม
