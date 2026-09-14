# Version 2.0 – ระบบหลังบ้านเจ้าหน้าที่

หน้าเจ้าหน้าที่อยู่ที่ `/admin.html` และพัฒนาเป็น Web Application จริง ไม่ใช่ภาพ Mockup

## ฟังก์ชันที่พร้อมใน Version 2.0

- Sidebar และหน้า Dashboard
- KPI: ทั้งหมด, รอดำเนินการ, กำลังดำเนินการ, เสร็จสิ้น, เกินกำหนด
- รายการเรื่องล่าสุด
- สรุปตามหมวดหมู่และหน่วยงาน
- ตารางเรื่องร้องเรียน พร้อมค้นหา กรอง และแบ่งหน้า
- Detail Drawer ด้านขวา
- ดูข้อมูลผู้ร้อง รายละเอียด สถานที่ รูปภาพ และ Google Maps
- Timeline ประวัติการดำเนินงาน
- มอบหมายหน่วยงานและเจ้าหน้าที่
- กำหนดความสำคัญและวันครบกำหนด
- เปลี่ยนสถานะและส่งข้อความแจ้งประชาชนผ่าน LINE OA
- หน้าแผนที่แบบรายการตำแหน่ง
- หน้าสรุปรายงาน KPI
- Role เดิม: officer, supervisor, admin

## Migration ใหม่

ไฟล์ `sql/004_enterprise_admin.sql` เพิ่ม:

- ตาราง `departments`
- `department_id`
- `assigned_staff_user_id`
- `priority`
- `due_at`
- `completed_at`

รันคำสั่ง:

```bash
docker compose build --no-cache app
docker compose run --rm app npm run db:migrate
docker compose up -d
```

## ขอบเขตที่เป็นโครงสำหรับพัฒนาต่อ

เมนูรายงานและตั้งค่ามี UI และข้อมูลสรุปพื้นฐานแล้ว แต่การส่งออก PDF/Excel, CRUD ผู้ใช้, CRUD หมวดหมู่, Heat Map, ปฏิทินงาน และ Audit Log แบบละเอียด ยังต้องพัฒนาเพิ่มตามกระบวนงานและสิทธิ์จริงของหน่วยงาน
