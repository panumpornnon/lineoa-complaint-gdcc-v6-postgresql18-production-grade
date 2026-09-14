# API ที่สำคัญ

## Public / LIFF

### `GET /api/config`

ส่งค่า:
- LIFF ID
- URL ประกาศความเป็นส่วนตัว
- Google Maps API Key สำหรับ Maps Embed API
- จำนวนและขนาดรูปภาพสูงสุด

> Google Maps API Key เป็นคีย์ฝั่ง Browser จึงต้องจำกัด HTTP referrer และจำกัด API

### `GET /api/categories`

รายการหมวดหมู่ร้องเรียน

### `POST /api/complaints`

ต้องส่ง:

```http
Authorization: Bearer <LINE_ID_TOKEN>
Content-Type: multipart/form-data
```

Fields:

| Field | ประเภท | บังคับ |
|---|---|---:|
| `categoryId` | UUID | ✓ |
| `title` | Text | ✓ |
| `description` | Text | ✓ |
| `locationText` | Text | ✓ |
| `latitude` | Number | ✓ |
| `longitude` | Number | ✓ |
| `contactName` | Text | ✓ |
| `contactPhone` | Text | ✓ |
| `contactEmail` | Text | |
| `privacyConsent` | `true` | ✓ |
| `images` | Image file 1–5 files | ✓ |

รองรับ input:
- JPEG
- PNG
- WebP
- HEIC / HEIF เมื่อ Sharp ใน environment สามารถ decode รูปนั้นได้

ทุกภาพจะถูกแปลงเป็น JPEG และลดขนาดตามค่าระบบก่อนจัดเก็บ

ตัวอย่าง JavaScript:

```javascript
const formData = new FormData();
formData.set('categoryId', categoryId);
formData.set('title', title);
formData.set('description', description);
formData.set('locationText', locationText);
formData.set('latitude', latitude);
formData.set('longitude', longitude);
formData.set('contactName', contactName);
formData.set('contactPhone', contactPhone);
formData.set('privacyConsent', 'true');

for (const file of imageInput.files) {
  formData.append('images', file, file.name);
}

await fetch('/api/complaints', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${lineIdToken}`,
  },
  body: formData,
});
```

### `GET /api/complaints`

รายการร้องเรียนของ LINE User ที่เข้าสู่ระบบ พร้อม:
- พิกัด
- Metadata ของรูปภาพ
- จำนวนรูปภาพ

### `GET /api/complaints/:referenceNo`

รายละเอียด ประวัติสถานะ พิกัด และรายการรูปภาพของเจ้าของเรื่อง

### `GET /api/complaints/:referenceNo/attachments/:attachmentId`

อ่านไฟล์ภาพ ต้องส่ง LINE ID Token และต้องเป็นเจ้าของเรื่องเท่านั้น

## LINE Messaging API

### `POST /webhook`

รับ Webhook และตรวจ `x-line-signature` จาก raw body

## เจ้าหน้าที่

### `POST /api/admin/login`

รับ username/password และคืน JWT

### `GET /api/admin/complaints`

ตัวกรอง:
- `status`
- `search`
- `page`
- `limit`

ผลลัพธ์มีพิกัดและรายการรูปภาพ

### `GET /api/admin/attachments/:id`

อ่านรูปภาพสำหรับเจ้าหน้าที่ที่มี JWT

### `PATCH /api/admin/complaints/:id/status`

ตัวอย่าง body:

```json
{
  "status": "in_progress",
  "note": "ส่งให้กองช่างตรวจสอบแล้ว"
}
```
