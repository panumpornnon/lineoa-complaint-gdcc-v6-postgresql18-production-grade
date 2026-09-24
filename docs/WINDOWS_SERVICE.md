# ติดตั้งระบบเป็น Windows Service บนเซิร์ฟเวอร์

> ใช้กับ **เซิร์ฟเวอร์ GDCC เท่านั้น**
> เครื่องพัฒนาให้รัน `npm start` จากหน้าต่าง CMD ตามปกติ ไม่ต้องทำเป็น Service

---

## ทำไมต้องเป็น Service

ถ้ารันด้วยการเปิดหน้าต่าง CMD ค้างไว้ ระบบจะดับในกรณีเหล่านี้

| เหตุการณ์ | หน้าต่าง CMD | Service |
|---|---|---|
| Windows Update รีบูตกลางดึก | ดับจนกว่าจะมีคนมาเปิดใหม่ | ขึ้นเองอัตโนมัติ |
| ผู้ดูแลกด Log off | ดับทันที | ไม่กระทบ |
| เผลอปิดหน้าต่าง | ดับทันที | ไม่มีหน้าต่างให้ปิด |
| แอปหยุดทำงานเอง | ค้างดับไว้ | รีสตาร์ทให้ใน 5 วินาที |
| ต้องการดู log ย้อนหลัง | ไม่มีบันทึก | อยู่ในไฟล์ หมุนเก็บอัตโนมัติ |

ระบบนี้เป็นช่องทางที่ประชาชนใช้แจ้งเรื่องร้องเรียน ถ้าดับตอนกลางคืนโดยไม่มีใครรู้
เรื่องที่ส่งเข้ามาจะหายไปเงียบๆ ผู้แจ้งเห็นแค่ว่าส่งไม่สำเร็จ แล้วอาจไม่ส่งซ้ำอีกเลย

---

## ไฟล์ในชุดนี้

| ไฟล์ | หน้าที่ | ใช้เมื่อไร |
|---|---|---|
| `scripts/windows/install-service.cmd` | ติดตั้งเป็น Service | ครั้งเดียวตอนตั้งเครื่อง |
| `scripts/windows/deploy.cmd` | ดึงโค้ดใหม่ รัน migration รีสตาร์ท | ทุกครั้งที่ deploy |
| `scripts/windows/uninstall-service.cmd` | ถอน Service ออก | เวลาต้องรื้อทำใหม่ |

**หมายเหตุ:** ข้อความในไฟล์ `.cmd` เป็นภาษาอังกฤษทั้งหมดโดยตั้งใจ เพราะหน้าต่าง
คอนโซลของ Windows Server ส่วนใหญ่ใช้ code page ที่แสดงภาษาไทยเป็นตัวขยะ
คำอธิบายภาษาไทยอยู่ในเอกสารฉบับนี้แทน

---

## ขั้นตอนติดตั้ง

### 1. ติดตั้ง NSSM

ดาวน์โหลด `nssm-2.24.zip` จาก https://nssm.cc/download แตกไฟล์
แล้วคัดลอก `win64\nssm.exe` ไปไว้ที่ `C:\Windows\System32\`

ตรวจว่าใช้ได้ด้วยคำสั่ง `nssm version`

### 2. หาค่าที่ต้องใช้ 3 อย่าง

เปิด **CMD แบบ Run as administrator** บนเซิร์ฟเวอร์ แล้วรัน

```cmd
dir C:\www\apps
where node
sc query state= all | findstr /i postgres
```

### 3. แก้ค่าในไฟล์

เปิด `scripts\windows\install-service.cmd` ด้วย Notepad แก้ 4 บรรทัดบนสุด

```cmd
set "APP_DIR=C:\www\apps\complaint-app"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "SVC=ComplaintApp"
set "PGSVC=postgresql-x64-18"
```

### 4. รัน

```cmd
cd /d C:\www\apps\complaint-app
scripts\windows\install-service.cmd
```

สคริปต์จะตรวจ 4 อย่างก่อนเริ่มจริง ได้แก่ สิทธิ์ Administrator, การมีอยู่ของ NSSM,
เส้นทาง Node กับโฟลเดอร์แอปกับไฟล์ `.env` และชื่อ service ของ PostgreSQL
ถ้าข้อใดไม่ผ่านจะหยุดทันทีโดยไม่แตะระบบ แล้วบอกว่าต้องแก้อะไร

เมื่อผ่านครบจะถามยืนยันหนึ่งครั้ง ตอบ `y` แล้วจะรัน migration ติดตั้ง Service และเริ่มทำงานให้
ปิดท้ายด้วยการแสดงสถานะ พอร์ตที่ฟังอยู่ และเนื้อหาของ log

### 5. เปิด Firewall (ถ้าต้องเข้าถึงจากเครื่องอื่น)

สคริปต์ไม่เปิดให้เอง เพราะเป็นการเปิดช่องทางเข้าเครื่อง ควรตัดสินใจเอง

```cmd
netsh advfirewall firewall add rule name="Complaint App" dir=in action=allow protocol=TCP localport=3000
```

---

## การใช้งานประจำวัน

```cmd
nssm status ComplaintApp      ดูสถานะ
nssm restart ComplaintApp     รีสตาร์ท
nssm stop ComplaintApp        หยุด
nssm edit ComplaintApp        เปิดหน้าต่างตั้งค่าแบบกราฟิก
```

ดู log แบบไล่ตามเรียลไทม์ ใช้ PowerShell

```powershell
Get-Content C:\www\logs\complaint-err.log -Wait -Tail 50
```

### deploy โค้ดใหม่

```cmd
cd /d C:\www\apps\complaint-app
scripts\windows\deploy.cmd
```

สคริปต์จะหยุด Service ดึงโค้ด ติดตั้ง dependency รัน migration แล้วเริ่มใหม่
ถ้าขั้นใดล้มเหลวจะ**เริ่ม Service กลับด้วยโค้ดที่อยู่บนดิสก์ตอนนั้น** ไม่ปล่อยให้ระบบดับค้างไว้

---

## เรื่องที่ตั้งใจออกแบบไว้แบบนี้

### migration ไม่ได้อยู่ใน Service

Service สั่งรันแค่ `node src/server.js` ไม่ได้ใช้ `npm start` ซึ่งเป็น
`node scripts/migrate.js && node src/server.js`

เหตุผล: ถ้า migration พังขึ้นมา Service จะเข้าลูปรีสตาร์ทแล้วพยายามรัน migration
ซ้ำไม่หยุด การแยก migration ออกมาทำตอน deploy ทำให้เห็นข้อผิดพลาดชัดเจนและแก้ได้ก่อน

### ตั้งให้รอ PostgreSQL

`DependOnService` ทำให้ Windows ไม่เริ่มแอปจนกว่าฐานข้อมูลจะพร้อม
ถ้าไม่ตั้งไว้ เวลาเซิร์ฟเวอร์รีบูตแอปมักขึ้นก่อนฐานข้อมูลแล้วตายด้วย `ECONNREFUSED`

### หน่วงเวลาก่อนรีสตาร์ท

`AppThrottle 10000` หมายความว่า ถ้าแอปตายภายใน 10 วินาทีหลังเริ่ม NSSM จะถือว่า
เริ่มไม่สำเร็จจริงแล้วหน่วงก่อนลองใหม่ ป้องกันการรีสตาร์ทรัวๆ จนกิน CPU

### log หมุนอัตโนมัติ

ตั้งไว้ที่ 10 MB ต่อไฟล์ ถ้าไม่ตั้ง log จะโตเรื่อยๆ จนดิสก์เต็มแล้วระบบล่มทั้งเครื่อง

---

## แก้ปัญหา

ถ้า Service ขึ้นแล้วดับทันที ให้เปิด `C:\www\logs\complaint-err.log` เป็นอันดับแรก

| ข้อความใน log | สาเหตุ | วิธีแก้ |
|---|---|---|
| `DATABASE_URL is required` | Service รันด้วยบัญชี `LocalSystem` แต่ไฟล์ `.env` ถูกตั้งสิทธิ์ให้อ่านได้เฉพาะบัญชีผู้ติดตั้ง | เพิ่มสิทธิ์อ่านให้ `SYSTEM` ที่ไฟล์ `.env` หรือเปลี่ยนบัญชีที่ Service ใช้ผ่าน `nssm edit` แท็บ Log on |
| `ECONNREFUSED` | ชื่อ service ของ PostgreSQL ที่ตั้งไว้ผิด แอปจึงขึ้นก่อนฐานข้อมูล | หาชื่อจริงด้วย `sc query state= all \| findstr /i postgres` แล้ว `nssm set ComplaintApp DependOnService <ชื่อจริง>` |
| `EADDRINUSE` | มี node ตัวเก่าค้างถือพอร์ตอยู่ | `netstat -ano \| findstr :3000` หา PID แล้ว `taskkill /PID <pid> /F` |
| `EACCES` ตอนอัปโหลดรูป | `UPLOAD_DIR` ไม่ใช่เส้นทางเต็มแบบ Windows หรือบัญชี Service ไม่มีสิทธิ์เขียน | ตั้ง `UPLOAD_DIR` เป็นเส้นทางเต็ม เช่น `C:\www\apps\complaint-app\uploads` แล้วให้สิทธิ์เขียนแก่บัญชีที่ Service ใช้ |
| ไฟล์ log ว่างเปล่า แต่ Service ไม่ขึ้น | มักเป็นเส้นทาง Node หรือโฟลเดอร์แอปผิด | `nssm edit ComplaintApp` แล้วตรวจแท็บ Application ทั้ง Path และ Startup directory |

ถ้าจะรื้อทำใหม่ทั้งหมด รัน `scripts\windows\uninstall-service.cmd` แล้วติดตั้งใหม่
โค้ด ฐานข้อมูล และ log ไม่ถูกลบ
