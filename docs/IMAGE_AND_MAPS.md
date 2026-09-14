# รูปภาพประกอบและพิกัด Google Maps

## 1. ภาพรวม

ระบบรุ่นนี้กำหนดให้เรื่องร้องเรียนมี:

- รูปภาพอย่างน้อย 1 ภาพ
- ได้สูงสุดตาม `MAX_UPLOAD_FILES` ค่าเริ่มต้น 5 ภาพ
- พิกัด Latitude และ Longitude
- ข้อความอธิบายสถานที่
- ลิงก์เปิด Google Maps
- แผนที่แบบฝัง เมื่อกำหนด Google Maps API Key

## 2. ทำไมไม่เก็บไฟล์ภาพไว้ใน PostgreSQL โดยตรง

PostgreSQL เก็บเฉพาะ Metadata:

```text
complaint_id
storage_key
original_name
mime_type
size_bytes
width
height
sha256
sort_order
```

ไฟล์จริงเก็บใน `UPLOAD_DIR`

ข้อดี:
- Backup และย้ายไฟล์ได้ง่าย
- Database ไม่โตจาก Binary Data อย่างรวดเร็ว
- เปลี่ยนไปใช้ Object Storage ภายหลังได้
- ควบคุม HTTP Cache และการส่งไฟล์ได้แยกจาก SQL

## 3. ความปลอดภัยของรูปภาพ

ระบบทำดังนี้:

1. จำกัดจำนวนไฟล์
2. จำกัดขนาดต่อไฟล์
3. ตรวจ Mime type เบื้องต้น
4. ให้ Sharp Decode ภาพจริง
5. หมุนภาพตาม Orientation
6. ย่อภาพตามขนาดสูงสุด
7. แปลงเป็น JPEG ใหม่ ทำให้ Metadata เดิม เช่น EXIF ไม่ถูกคัดลอก
8. ตั้งชื่อไฟล์ด้วย UUID
9. ไม่เปิด `/uploads` เป็น Static Public
10. เปิดภาพผ่าน API ที่ตรวจ LINE ID Token หรือ Admin JWT
11. เก็บ SHA-256 ของไฟล์ที่ประมวลผลแล้ว

## 4. HEIC / HEIF จาก iPhone

หน้าเว็บอนุญาต HEIC/HEIF แต่การแปลงสำเร็จขึ้นอยู่กับความสามารถของ Sharp/libvips ใน Image ที่ใช้งาน หากระบบแจ้งว่าอ่านไฟล์ไม่ได้ ให้ผู้ใช้:

- ถ่ายภาพจากหน้า Web App ใหม่
- หรือแปลงภาพเป็น JPEG ก่อนแนบ

ก่อนเปิดจริงควรทดสอบกับ iPhone และ Android รุ่นที่กลุ่มผู้ใช้ใช้งาน

## 5. Google Maps

### 5.1 ลิงก์ Google Maps

ระบบสร้างลิงก์:

```text
https://www.google.com/maps/search/?api=1&query=<latitude>,<longitude>
```

ลิงก์นี้เปิด Google Maps บน Browser หรือแอปที่รองรับ

### 5.2 แผนที่แบบฝัง

กำหนด:

```env
GOOGLE_MAPS_API_KEY=...
```

แล้วระบบใช้ Maps Embed API:

```text
https://www.google.com/maps/embed/v1/place
```

แนะนำให้ตั้งค่าคีย์:

- Application restriction: Websites
- HTTP referrers:
  - `https://complaint.example.go.th/*`
- API restriction:
  - Maps Embed API

ไม่ควรใช้คีย์เดียวกับ Backend API หรือบริการอื่น

### 5.3 การเก็บพิกัด

ฐานข้อมูลใช้:

```sql
latitude numeric(9,6)
longitude numeric(9,6)
```

ความละเอียด 6 ตำแหน่งทศนิยมเพียงพอสำหรับระบุตำแหน่งระดับประมาณหลักสิบเซนติเมตรในเชิงตัวเลข แต่ความแม่นยำจริงขึ้นกับ GPS อุปกรณ์ สภาพแวดล้อม และสิทธิ์ตำแหน่ง

ระบบจึงควรให้เจ้าหน้าที่ตรวจภาพ ข้อความสถานที่ และหมุดร่วมกัน ไม่ควรอาศัย GPS เพียงค่าเดียว

## 6. การเก็บไฟล์บน GDCC

### แบบ VM เดียว / MVP

```text
/app/uploads
```

ใช้ Docker named volume `complaint_uploads`

เหมาะสำหรับ:
- Pilot
- ระบบผู้ใช้น้อย
- Web/API instance เดียว

### ระบบ Production หรือหลาย Instance

ควรใช้ Shared/Object Storage ที่หน่วยงานได้รับอนุมัติ แล้วเปลี่ยน `uploads.js` เป็น Storage Adapter

เหตุผล:
- ทุก Web/API instance เห็นไฟล์เดียวกัน
- รองรับการขยายระบบ
- แยกอายุข้อมูลและ Backup
- ลดความเสี่ยงเมื่อ Web VM เสียหาย

ห้ามสมมติว่า GDCC ของทุกหน่วยงานมีบริการ Object Storage เหมือนกัน ต้องตรวจบริการที่ได้รับจัดสรรจริง

## 7. Backup

ต้องสำรองทั้ง:

```text
PostgreSQL dump
+ Upload directory / Object Storage
```

การกู้คืนต้องตรวจว่า:
- Row ใน `complaint_attachments` มีไฟล์ครบ
- SHA-256 ตรงกับไฟล์
- สิทธิ์ไฟล์ถูกต้อง
- รูปเปิดผ่าน API ได้
