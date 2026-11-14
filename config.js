/**
 * ตั้งค่าหน้าเว็บเช็คชื่อ — แก้เฉพาะไฟล์นี้
 *
 * APPS_SCRIPT_URL : URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec)
 *                   ได้จากขั้นตอน Deploy ใน README.md
 *                   ถ้าเว้นว่าง หน้าเว็บจะเปิดในโหมดทดลอง (ไม่บันทึกจริง)
 * CLASS_TITLE     : ชื่อคลาสที่แสดงก่อนโหลดข้อมูลจาก Google Sheet
 * POLL_SECONDS    : ดึงข้อมูลใหม่จาก Google Sheet ทุกกี่วินาที
 */
window.CHECKIN_CONFIG = {
  APPS_SCRIPT_URL: "",
  CLASS_TITLE: "Claude AI Class",
  POLL_SECONDS: 15
};
