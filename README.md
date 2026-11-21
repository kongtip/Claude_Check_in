# เช็คชื่อเข้าเรียน · Claude AI Class

**เวอร์ชัน 2.0.0** (หน้าเว็บ v2.0.0 · ฐานข้อมูล v2.0.0) · อัปเดต 21 พ.ย. 2026 · เว็บจริง: https://kongtip.github.io/Claude_Check_in/
ดูการเปลี่ยนแปลงทั้งหมดใน [CHANGELOG.md](CHANGELOG.md)

ระบบเช็คชื่อเข้าเรียนออนไลน์ ทุกคน **ล็อกอินด้วย Gmail** ผู้เรียนเลือกชื่อตัวเองครั้งแรกครั้งเดียว แล้วเซ็นชื่อเช็คชื่อได้เฉพาะชื่อตัวเอง ข้อมูลทั้งหมดเก็บใน **Supabase** ใช้ได้ทั้งมือถือ แท็บเล็ต และคอมพิวเตอร์

- หน้าเว็บ: ไฟล์ `index.html` ไฟล์เดียว วางบน GitHub Pages
- ฐานข้อมูลและล็อกอิน: Supabase (Postgres + Auth + Row Level Security)
- ผู้สอน / ผู้ดูแลระบบ: `kongtipoom.mane@gmail.com` (แก้ได้ในตาราง `admins`)

---

## โครงสร้างไฟล์

```
Claude_Check_in/
├── index.html              หน้าเว็บทั้งหมด (ตั้งค่า Supabase อยู่ด้านบนไฟล์)
├── version.json            เวอร์ชันล่าสุด — หน้าเว็บใช้เช็คว่ามีเวอร์ชันใหม่
├── supabase/schema.sql     โครงสร้างฐานข้อมูล กฎความปลอดภัย และฟังก์ชันทั้งหมด
├── templates/roster-template.csv   ไฟล์ตัวอย่างรายชื่อ
├── CHANGELOG.md
└── README.md
```

---

## สิ่งที่ตั้งค่าไว้แล้ว ✅
- โปรเจกต์ Supabase `zjzukimhnjtgwayezpkh` (ภูมิภาค ap-southeast-2) พร้อมตาราง `admins`, `settings`, `roster`, `attendance` และกฎความปลอดภัยครบ
- รายชื่อผู้เรียน 22 คน, เวลาเริ่มเรียน 09:00 น., นับว่าสายหลัง 15 นาที, เขตเวลา Asia/Bangkok
- `index.html` ใส่ `SUPABASE_URL` และ publishable key แล้ว

## สิ่งที่ต้องทำเอง (ครั้งเดียว ประมาณ 10 นาที) — เปิดล็อกอินด้วย Google

### 1. สร้าง OAuth Client ใน Google Cloud
1. ไปที่ [console.cloud.google.com](https://console.cloud.google.com/) › สร้างโปรเจกต์ใหม่ (หรือเลือกโปรเจกต์ที่มี)
2. **APIs & Services › OAuth consent screen** (หรือ **Google Auth Platform › Branding**)
   - User type: **External** · App name: `Claude AI Class Check-in` · ใส่อีเมลติดต่อ › Save
   - ที่ **Audience** กด **Publish app** (ถ้ายังเป็น Testing ต้องเพิ่มอีเมลผู้เรียนทุกคนเป็น test user)
3. **Credentials › Create credentials › OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://kongtip.github.io`
   - Authorized redirect URIs: `https://zjzukimhnjtgwayezpkh.supabase.co/auth/v1/callback`
4. กด Create แล้วคัดลอก **Client ID** และ **Client secret**

### 2. เปิด Google ใน Supabase
1. [Supabase Dashboard](https://supabase.com/dashboard/project/zjzukimhnjtgwayezpkh) › **Authentication › Sign In / Providers › Google**
2. เปิด **Enable Sign in with Google** › วาง Client ID และ Client secret › Save

### 3. ตั้งค่า URL ที่อนุญาต
**Authentication › URL Configuration**
- Site URL: `https://kongtip.github.io/Claude_Check_in/`
- Redirect URLs › Add URL: `https://kongtip.github.io/Claude_Check_in/`

### 4. ทดสอบ
1. เปิด https://kongtip.github.io/Claude_Check_in/ › **เข้าสู่ระบบด้วย Google** › เลือก `kongtipoom.mane@gmail.com`
2. หัวเว็บต้องขึ้นป้าย **ผู้สอน** และปุ่ม **จัดการคลาส** ใต้แถบสรุปต้องขึ้น "เว็บ v2.0.0 · ฐานข้อมูล v2.0.0"
3. ลองล็อกอินด้วย Gmail อื่น › ต้องเห็นหน้า "เลือกชื่อของคุณ"

---

## การใช้งาน

**ผู้เรียน**
1. เปิดลิงก์ (หรือสแกน QR) › เข้าสู่ระบบด้วย Google
2. ครั้งแรก: เลือกชื่อตัวเองจากรายชื่อ (เลือกได้ครั้งเดียว)
3. ทุกครั้งที่มาเรียน: กด **เช็คชื่อวันนี้** › เซ็นชื่อ › Approve

**ผู้สอน** (ปุ่ม **จัดการคลาส**)
- นำเข้ารายชื่อจาก CSV / Excel / Google Forms — ถ้ามีคอลัมน์อีเมล ระบบผูกบัญชีให้อัตโนมัติเมื่อผู้เรียนล็อกอินด้วย Gmail นั้น
- ปุ่ม `⋯` ที่แต่ละชื่อ: แก้ชื่อ / กลุ่ม / Gmail, **ยกเลิกการผูกบัญชี** (เมื่อผู้เรียนเลือกชื่อผิด), ลบรายชื่อ
- เช็คชื่อแทนผู้เรียน (เช่น ใช้แท็บเล็ตหน้าห้อง), ดูลายเซ็น, ยกเลิกการเช็คชื่อ
- ตั้งเวลาเริ่มเรียน และนาทีที่นับว่าสาย, ดูข้อมูลย้อนหลังตามวันที่
- ส่งออก: คัดลอกไปวางใน Google Sheets หรือดาวน์โหลด CSV

**เพิ่มผู้สอนคนอื่น** — Supabase › SQL Editor:
```sql
insert into public.admins (email) values ('another.teacher@gmail.com');
```

---

## ความปลอดภัย

| ใคร | เห็น / ทำได้ |
|---|---|
| ยังไม่ล็อกอิน | เห็นเฉพาะหน้าล็อกอิน อ่านข้อมูลใดๆ ไม่ได้ |
| ผู้เรียน | เห็นชื่อ กลุ่ม และสถานะของเพื่อน · เช็คชื่อได้เฉพาะชื่อตัวเองวันละครั้ง · เห็นลายเซ็นของตัวเองเท่านั้น |
| ผู้สอน | เห็นและจัดการได้ทุกอย่าง รวมถึงลายเซ็นและอีเมล |

- กฎทั้งหมดบังคับในฐานข้อมูล (Row Level Security + ฟังก์ชัน `check_in`, `claim_roster`) แก้หน้าเว็บก็ข้ามกฎไม่ได้
- เวลาเช็คชื่อมาจากเซิร์ฟเวอร์ Supabase แก้นาฬิกาในเครื่องเพื่อโกงเวลาไม่ได้
- `SUPABASE_KEY` ใน `index.html` เป็น **publishable key** เปิดเผยได้ตามปกติ — **ห้ามใส่ secret key หรือ service_role key ในหน้าเว็บเด็ดขาด**
- อย่าอัปโหลดไฟล์รายชื่อผู้เรียนจริงขึ้น GitHub (repo สาธารณะ) ให้นำเข้าผ่านปุ่มจัดการคลาสแทน

---

## เวอร์ชัน และการอัปเดต

| จุด | ดูได้ที่ |
|---|---|
| หน้าเว็บ | ป้ายเวอร์ชันบนหัวเว็บและหน้าล็อกอิน (กดเพื่อดูประวัติ), ใต้แถบสรุป, ท้ายหน้า |
| ฐานข้อมูล | ใต้แถบสรุป "ฐานข้อมูล v…" (จากฟังก์ชัน `public.backend_version()`) |
| เวอร์ชันใหม่บน GitHub | หน้าเว็บเช็ค `version.json` ทุก 5 นาที แล้วขึ้นจุดสีส้มและแถบ "มีเวอร์ชันใหม่" |
| ไม่เข้ากัน | ถ้าฐานข้อมูลเก่ากว่า `MIN_BACKEND` ใน `index.html` จะขึ้นแถบเตือนสีเหลือง |

> สำหรับผู้พัฒนา: ออกเวอร์ชันใหม่ให้เปลี่ยนเลขใน `version.json`, `APP_VERSION` / `RELEASES` / `<meta name="version">` / footer ใน `index.html`, `backend_version()` ใน `supabase/schema.sql` (ถ้าแก้ฐานข้อมูล), หัว README และเพิ่มรายการใน `CHANGELOG.md`

## แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| กดเข้าสู่ระบบแล้วขึ้น "Unsupported provider" / "provider is not enabled" | ยังไม่ได้เปิด Google ใน Supabase (ขั้นตอนที่ 2) |
| Google ขึ้น `redirect_uri_mismatch` | Redirect URI ใน Google Cloud ต้องเป็น `https://zjzukimhnjtgwayezpkh.supabase.co/auth/v1/callback` ตรงทุกตัวอักษร |
| ล็อกอินแล้วเด้งไปหน้าอื่น / localhost | ตั้ง Site URL และ Redirect URLs (ขั้นตอนที่ 3) |
| ผู้เรียนบางคนล็อกอินไม่ได้ ขึ้น "access blocked" | แอปใน Google Cloud ยังเป็น Testing — กด Publish app |
| ผู้เรียนเลือกชื่อผิด | ผู้สอนกด `⋯` ที่ชื่อนั้น › ยกเลิกการผูกบัญชี แล้วให้ผู้เรียนเลือกใหม่ |
| ไม่ขึ้นปุ่มจัดการคลาส | ต้องล็อกอินด้วยอีเมลที่อยู่ในตาราง `admins` |
| อัปเดตแล้วยังเห็นเวอร์ชันเก่า | กดแถบ "มีเวอร์ชันใหม่" หรือปิดแท็บแล้วเปิดใหม่ |
