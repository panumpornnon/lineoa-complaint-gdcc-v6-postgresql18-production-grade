# คู่มือติดตั้งบน GDCC VM

> ขั้นตอนเครือข่ายและบริการเสริมของ GDCC อาจต่างกันตามทรัพยากรที่หน่วยงานได้รับ ให้ประสานผู้ดูแล GDCC/SRS ของหน่วยงานก่อนเปิดระบบจริง

## 1. ทรัพยากรขั้นต่ำที่แนะนำสำหรับ MVP

### Web/API VM
- Ubuntu Server 22.04 หรือ 24.04 LTS
- 2 vCPU, RAM 4 GB
- Disk 40 GB และพื้นที่/Volume สำหรับรูปภาพ
- Public IP หรือ Load Balancer สำหรับ HTTPS
- Private IP สำหรับติดต่อ Database VM

### PostgreSQL VM
- Ubuntu Server 22.04 หรือ 24.04 LTS
- 2–4 vCPU, RAM 4–8 GB
- Data disk แยกตามปริมาณข้อมูล
- Private IP เท่านั้น
- ห้ามเปิดพอร์ต 5432 ต่ออินเทอร์เน็ต

ระบบใช้งานจริงควรพิจารณา High Availability, monitoring, off-site backup, WAF, Anti-DDoS และ Antivirus ตามบริการที่ GDCC จัดสรรให้

## 2. Firewall / Security Group

### Web/API VM
- TCP 443 จากอินเทอร์เน็ต
- TCP 80 เฉพาะ redirect หรือออกใบรับรอง TLS
- TCP 22 เฉพาะ VPN/Bastion/IP ผู้ดูแล
- TCP 5432 ขาออกไปยัง Private IP ของ Database VM

### Database VM
- TCP 5432 เฉพาะ Private IP ของ Web/API VM
- TCP 22 เฉพาะ VPN/Bastion/IP ผู้ดูแล
- ไม่ต้องมี Public IP

## 3. เตรียม Web/API VM ด้วย Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nginx
sudo systemctl enable --now docker nginx
sudo usermod -aG docker "$USER"
```

ออกจากระบบแล้วเข้าใหม่ จากนั้นนำโครงการขึ้น VM:

```bash
cd /opt
sudo mkdir complaint-system
sudo chown "$USER":"$USER" complaint-system
cd complaint-system
# วางไฟล์โปรเจกต์ไว้ที่นี่
cp .env.example .env
nano .env
```

ตั้งค่าความลับทั้งหมดใน `.env` รวมถึง:

```env
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_FILES=5
MAX_UPLOAD_MB=10
GOOGLE_MAPS_API_KEY=...
```

Google Maps API Key ต้องจำกัด HTTP referrer ให้ตรงโดเมน และจำกัดเฉพาะ Maps Embed API

จากนั้น:

```bash
docker compose build
docker compose up -d db
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run admin:create -- admin "รหัสผ่านยาวมาก" "ผู้ดูแลระบบ" admin
docker compose up -d
curl http://127.0.0.1:3000/health
```

> `docker-compose.yml` ในชุดนี้เหมาะกับการทดลองหรือระบบขนาดเล็กที่ PostgreSQL อยู่ใน Docker เดียวกัน หาก GDCC จัดแยก Database VM ให้เปลี่ยน `DATABASE_URL` ไปยัง Private IP และนำ service `db` ออกจาก Compose
>
> รูปภาพอยู่ใน Docker volume `complaint_uploads` บน Web VM ระบบหลาย Instance ควรเปลี่ยนไปใช้ Shared/Object Storage ที่หน่วยงานได้รับอนุมัติ

## 4. ติดตั้ง Nginx และ HTTPS

แก้ชื่อโดเมนใน `nginx/complaints.conf` แล้ว:

```bash
sudo cp nginx/complaints.conf /etc/nginx/sites-available/complaints
sudo ln -s /etc/nginx/sites-available/complaints /etc/nginx/sites-enabled/complaints
sudo nginx -t
sudo systemctl reload nginx
```

ติดตั้งใบรับรอง TLS จาก CA ที่หน่วยงานอนุมัติ หรือใช้กระบวนการออกใบรับรองของหน่วยงาน ห้ามเปิด LIFF/Webhook ด้วย HTTP เพราะ LINE ต้องใช้ HTTPS

## 5. ตั้งค่า LINE Developers

ต้องสร้างช่องทางดังนี้ภายใต้ **Provider เดียวกัน**

1. Messaging API channel ที่ผูกกับ LINE Official Account
2. LINE Login channel สำหรับ LIFF

ใน LIFF:
- Endpoint URL: `https://ชื่อโดเมน/`
- Size: Full
- Scope: `openid`, `profile`
- เปิด Add friend option ตามนโยบายของหน่วยงาน
- นำ LIFF ID ใส่ใน `.env`

ใน Messaging API:
- Webhook URL: `https://ชื่อโดเมน/webhook`
- เปิด Use webhook
- กด Verify
- ออก Channel access token
- นำ Channel secret และ Channel access token ใส่ใน `.env`

จากนั้น restart:

```bash
docker compose up -d --force-recreate app
```

## 6. Rich Menu

สร้าง Rich Menu อย่างน้อย 2 ปุ่ม:
- “แจ้งเรื่อง” → เปิด LIFF URL `https://liff.line.me/<LIFF_ID>`
- “ติดตามเรื่อง” → เปิด LIFF URL เดียวกัน แล้วผู้ใช้เลือกแท็บติดตามเรื่อง

## 7. รูปภาพและพื้นที่จัดเก็บ

ระบบจะเก็บภาพไว้ที่ `UPLOAD_DIR` และ Metadata ใน PostgreSQL

- ห้ามเปิด Upload directory เป็น Static Public
- ต้องจำกัดสิทธิ์ OS เฉพาะบัญชี App
- ต้องตรวจพื้นที่ว่างและตั้ง Alert
- ระบบหลาย Web VM ต้องใช้ Shared/Object Storage
- ต้องกำหนดอายุการเก็บและลบภาพตามนโยบายข้อมูล

## 8. Backup

ตัวอย่าง cron รายวันเวลา 02:00:

```bash
sudo install -m 700 scripts/backup.sh /usr/local/sbin/complaint-backup
sudo crontab -e
```

เพิ่ม:

```cron
0 2 * * * DATABASE_URL='postgresql://...' UPLOAD_DIR='/app/uploads' BACKUP_DIR='/secure-backups' /usr/local/sbin/complaint-backup >> /var/log/complaint-backup.log 2>&1
```

ต้อง:
- เก็บสำเนา Backup คนละระบบ/คนละดิสก์กับฐานข้อมูลหลัก
- เข้ารหัส Backup
- จำกัดสิทธิ์เข้าถึง
- ทดสอบ restore เป็นระยะ
- กำหนด RPO/RTO ของหน่วยงาน

## 9. Checklist ก่อนเปิดจริง

- [ ] LINE Login และ Messaging API อยู่ Provider เดียวกัน
- [ ] HTTPS ใช้งานได้และใบรับรองไม่หมดอายุ
- [ ] Webhook Verify ผ่าน
- [ ] PostgreSQL ไม่มี Public IP และ 5432 จำกัดต้นทาง
- [ ] Google Maps Key จำกัด HTTP referrer และ API
- [ ] Upload volume มีสิทธิ์ถูกต้อง มีพื้นที่เพียงพอ และไม่เปิด Public
- [ ] ทดสอบภาพจาก iPhone/Android และรูป HEIC/JPEG
- [ ] เปลี่ยนรหัสผ่านและ JWT_SECRET แล้ว
- [ ] `NODE_ENV=production`
- [ ] `DEV_BYPASS_LINE_AUTH=false`
- [ ] มี Privacy Notice ที่ฝ่ายกฎหมาย/DPO ตรวจแล้ว
- [ ] ทดสอบสิทธิ์เจ้าหน้าที่
- [ ] ทดสอบ Backup และ Restore
- [ ] เปิด Log, monitoring, alert และ time synchronization
- [ ] ทำ Vulnerability Assessment / Penetration Test ตามนโยบายหน่วยงาน
