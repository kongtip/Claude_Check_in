/**
 * Claude AI Class — Attendance backend (Google Apps Script)
 * ---------------------------------------------------------------
 * วางไฟล์นี้ใน Extensions > Apps Script ของ Google Sheet ที่จะใช้เก็บข้อมูล
 * แล้วรันฟังก์ชัน setup() หนึ่งครั้ง จากนั้น Deploy เป็น Web app
 * (ดูขั้นตอนเต็มใน README.md)
 *
 * ชีตที่ระบบสร้างให้:
 *   Roster      — รายชื่อผู้เรียน (วางชื่อเพิ่มเองได้ ระบบใส่ ID ให้อัตโนมัติ)
 *   Attendance  — 1 แถวต่อการเช็คชื่อ 1 ครั้ง (บันทึกทันทีเมื่อกด Approve)
 *   Settings    — ชื่อคลาส เวลาเริ่มเรียน และจำนวนนาทีที่นับว่าสาย
 *
 * Script properties (Project Settings > Script properties):
 *   ADMIN_PIN          — PIN ของผู้สอน (setup() สร้างให้ถ้ายังไม่มี)
 *   SIGNATURE_SHARING  — "private" (ค่าเริ่มต้น) หรือ "link" ให้ทุกคนที่มีลิงก์เปิดลายเซ็นได้
 */

/** เลขเวอร์ชันของระบบหลังบ้าน — หน้าเว็บกำหนดเวอร์ชันขั้นต่ำไว้ที่ MIN_BACKEND ใน index.html */
const BACKEND_VERSION = '1.0.0';

const SHEET = { ROSTER: 'Roster', ATT: 'Attendance', SET: 'Settings' };
const HEADERS = {
  Roster:     ['ID', 'ชื่อ-นามสกุล', 'รหัส', 'กลุ่ม', 'ลำดับ', 'เพิ่มเมื่อ'],
  Attendance: ['Timestamp', 'วันที่', 'เวลา', 'RosterID', 'ชื่อ-นามสกุล', 'รหัส', 'กลุ่ม', 'สถานะ', 'ลายเซ็น', 'อุปกรณ์'],
  Settings:   ['key', 'value', 'คำอธิบาย']
};
const DEFAULTS = {
  title:     ['Claude AI Class', 'ชื่อคลาสที่แสดงบนหน้าเว็บ'],
  startTime: ['09:00', 'เวลาเริ่มเรียน (HH:mm)'],
  lateAfter: ['15', 'เช็คชื่อหลังเวลาเริ่มกี่นาทีจึงนับว่ามาสาย']
};
const STATUS_TH = { on: 'ตรงเวลา', late: 'มาสาย' };
const MAX_SIGNATURE_CHARS = 600000;
const MAX_IMPORT_ROWS = 2000;

/* ============================================================
 * Setup & menu
 * ========================================================== */

/** รันครั้งแรกครั้งเดียว: สร้างชีต ค่าเริ่มต้น PIN และโฟลเดอร์ลายเซ็น */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name));
  const set = ss.getSheetByName(SHEET.SET);
  const current = readSettingsRaw_();
  Object.keys(DEFAULTS).forEach(k => {
    if (current[k] === undefined) set.appendRow([k, DEFAULTS[k][0], DEFAULTS[k][1]]);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PIN')) {
    props.setProperty('ADMIN_PIN', String(Math.floor(100000 + Math.random() * 900000)));
  }
  if (!props.getProperty('SIGNATURE_SHARING')) props.setProperty('SIGNATURE_SHARING', 'private');
  const folder = getSignatureFolder_();
  const msg = 'ตั้งค่าเสร็จแล้ว (ระบบหลังบ้าน v' + BACKEND_VERSION + ')\n\nPIN ผู้สอน: ' + props.getProperty('ADMIN_PIN') +
              '\n(เปลี่ยนได้ที่ Project Settings > Script properties > ADMIN_PIN)\n\nโฟลเดอร์ลายเซ็น: ' + folder.getUrl();
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (_) { /* run from editor: see Execution log */ }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('เช็คชื่อ Claude AI')
    .addItem('ตั้งค่าเริ่มต้น (setup)', 'setup')
    .addItem('ดู PIN ผู้สอน', 'showPin')
    .addToUi();
}

function showPin() {
  const pin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '(ยังไม่ได้ตั้ง — รัน setup ก่อน)';
  SpreadsheetApp.getUi().alert('PIN ผู้สอน: ' + pin);
}

/* ============================================================
 * Web app entry points
 * ========================================================== */

function doGet(e) {
  return withLock_(() => {
    const p = (e && e.parameter) || {};
    const action = p.action || 'state';
    if (action === 'state') return getState_(p.date);
    if (action === 'ping') return { ok: true, version: BACKEND_VERSION, now: Date.now() };
    fail_('unknown_action');
  });
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (_) { return json_({ ok: false, error: 'bad_json' }); }

  return withLock_(() => {
    switch (body.action) {
      case 'checkin':      return checkin_(body);
      case 'verifyPin':    requirePin_(body); return { ok: true, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
      case 'importRoster': requirePin_(body); return importRoster_(body.rows, body.mode);
      case 'addStudent':   requirePin_(body); return importRoster_([body.student || {}], 'append');
      case 'saveSettings': requirePin_(body); return saveSettings_(body.settings || {});
      case 'undo':         requirePin_(body); return deleteAttendance_(body.date, body.rosterId);
      case 'resetDay':     requirePin_(body); return deleteAttendance_(body.date, null);
      case 'clearRoster':  requirePin_(body); return clearRoster_();
      default:             fail_('unknown_action');
    }
  });
}

/* ============================================================
 * Actions
 * ========================================================== */

function getState_(date) {
  const today = todayKey_();
  const d = isDateKey_(date) ? date : today;
  return {
    ok: true,
    version: BACKEND_VERSION,
    today: today,
    date: d,
    now: Date.now(),
    settings: readSettings_(),
    roster: readRoster_(),
    checkins: readAttendance_(d).map(publicRecord_)
  };
}

function checkin_(b) {
  const roster = readRoster_();
  const r = roster.filter(x => x.id === String(b.rosterId || ''))[0];
  if (!r) fail_('not_found', 'ไม่พบรายชื่อนี้');

  const today = todayKey_();
  const existing = readAttendance_(today).filter(a => a.rosterId === r.id)[0];
  if (existing) fail_('already_checked_in', 'ชื่อนี้เช็คชื่อไปแล้ว');

  const sig = String(b.signature || '');
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > MAX_SIGNATURE_CHARS) {
    fail_('bad_signature', 'ลายเซ็นไม่ถูกต้อง');
  }

  const now = new Date();
  const time = Utilities.formatDate(now, tz_(), 'HH:mm:ss');
  const status = statusFor_(now, readSettings_());
  const signatureUrl = saveSignature_(sig, today, r.name);
  const device = clean_(String(b.device || '').slice(0, 40));

  sheet_(SHEET.ATT).appendRow([now, today, time, r.id, clean_(r.name), clean_(r.code), clean_(r.group), STATUS_TH[status], signatureUrl, device]);

  return {
    ok: true,
    record: { rosterId: r.id, name: r.name, date: today, time: time, at: now.getTime(), status: status, signatureUrl: signatureUrl, device: device }
  };
}

function importRoster_(rows, mode) {
  if (!Array.isArray(rows)) fail_('bad_request', 'ไม่มีรายชื่อ');
  if (rows.length > MAX_IMPORT_ROWS) fail_('too_many', 'นำเข้าได้สูงสุดครั้งละ ' + MAX_IMPORT_ROWS + ' คน');
  const sh = sheet_(SHEET.ROSTER);
  if (mode === 'replace') clearRoster_();

  const current = readRoster_();
  const have = {};
  current.forEach(r => { have[nameKey_(r.name)] = true; });
  let order = current.reduce((m, r) => Math.max(m, r.order || 0), 0);
  const now = new Date();
  const out = [];
  rows.forEach(row => {
    const name = String((row && row.name) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) return;
    const k = nameKey_(name);
    if (have[k]) return;
    have[k] = true;
    out.push([newId_(), clean_(name), clean_(String(row.code || '').slice(0, 40)), clean_(String(row.group || '').slice(0, 120)), ++order, now]);
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return { ok: true, added: out.length, skipped: rows.length - out.length };
}

function saveSettings_(s) {
  const next = {};
  if (s.title !== undefined) next.title = clean_(String(s.title).trim().slice(0, 120)) || DEFAULTS.title[0];
  if (s.startTime !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.startTime))) fail_('bad_request', 'รูปแบบเวลาไม่ถูกต้อง');
    next.startTime = String(s.startTime);
  }
  if (s.lateAfter !== undefined) next.lateAfter = String(Math.max(0, Math.min(180, parseInt(s.lateAfter, 10) || 0)));

  const sh = sheet_(SHEET.SET);
  const values = sh.getDataRange().getValues();
  Object.keys(next).forEach(k => {
    let row = -1;
    for (let i = 1; i < values.length; i++) if (String(values[i][0]) === k) { row = i + 1; break; }
    if (row > 0) sh.getRange(row, 2).setValue(next[k]);
    else sh.appendRow([k, next[k], DEFAULTS[k] ? DEFAULTS[k][1] : '']);
  });
  return { ok: true, settings: readSettings_() };
}

function deleteAttendance_(date, rosterId) {
  if (!isDateKey_(date)) fail_('bad_request', 'วันที่ไม่ถูกต้อง');
  const sh = sheet_(SHEET.ATT);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, removed: 0 };
  const values = sh.getRange(2, 1, last - 1, HEADERS.Attendance.length).getValues();
  let removed = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (dateCell_(values[i][1]) !== date) continue;
    if (rosterId && String(values[i][3]) !== String(rosterId)) continue;
    sh.deleteRow(i + 2);
    removed++;
  }
  return { ok: true, removed: removed };
}

function clearRoster_() {
  const sh = sheet_(SHEET.ROSTER);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, HEADERS.Roster.length).clearContent();
  return { ok: true };
}

/* ============================================================
 * Readers
 * ========================================================== */

function readRoster_() {
  const sh = sheet_(SHEET.ROSTER);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const range = sh.getRange(2, 1, last - 1, HEADERS.Roster.length);
  const values = range.getValues();
  let dirty = false;
  const out = [];
  values.forEach((r, i) => {
    const name = String(r[1] || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (!r[0]) { r[0] = newId_(); dirty = true; }          // names pasted straight into the sheet
    if (r[4] === '' || r[4] === null) { r[4] = i + 1; dirty = true; }
    if (!r[5]) { r[5] = new Date(); dirty = true; }
    out.push({ id: String(r[0]), name: name, code: String(r[2] || ''), group: String(r[3] || ''), order: Number(r[4]) || i + 1 });
  });
  if (dirty) range.setValues(values);
  return out.sort((a, b) => a.order - b.order);
}

function readAttendance_(date) {
  const sh = sheet_(SHEET.ATT);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.Attendance.length).getValues()
    .filter(r => dateCell_(r[1]) === date)
    .map(r => ({
      at: r[0] instanceof Date ? r[0].getTime() : 0,
      date: dateCell_(r[1]),
      time: timeCell_(r[2]),
      rosterId: String(r[3]),
      name: String(r[4]),
      status: String(r[7]) === STATUS_TH.late ? 'late' : 'on',
      signatureUrl: String(r[8] || ''),
      device: String(r[9] || '')
    }));
}

/** Drive enforces who may open a signature file, so the link itself can be returned. */
function publicRecord_(a) { return a; }

function readSettingsRaw_() {
  const sh = sheet_(SHEET.SET);
  const out = {};
  sh.getDataRange().getValues().slice(1).forEach(r => { if (r[0] !== '') out[String(r[0])] = r[1]; });
  return out;
}

function readSettings_() {
  const raw = readSettingsRaw_();
  const start = raw.startTime instanceof Date ? Utilities.formatDate(raw.startTime, tz_(), 'HH:mm') : String(raw.startTime || DEFAULTS.startTime[0]);
  return {
    title: String(raw.title || DEFAULTS.title[0]),
    startTime: /^\d{1,2}:\d{2}$/.test(start) ? ('0' + start).slice(-5) : DEFAULTS.startTime[0],
    lateAfter: Number(raw.lateAfter === undefined || raw.lateAfter === '' ? DEFAULTS.lateAfter[0] : raw.lateAfter) || 0
  };
}

/* ============================================================
 * Helpers
 * ========================================================== */

function statusFor_(when, settings) {
  const parts = settings.startTime.split(':').map(Number);
  const limit = parts[0] * 60 + parts[1] + Number(settings.lateAfter || 0);
  const hm = Utilities.formatDate(when, tz_(), 'HH:mm').split(':').map(Number);
  return hm[0] * 60 + hm[1] > limit ? 'late' : 'on';
}

function saveSignature_(dataUrl, date, name) {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  const safeName = String(name).replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
  const blob = Utilities.newBlob(Utilities.base64Decode(dataUrl.slice(comma + 1)), mime, date + '_' + safeName + '.' + ext);
  const file = getSignatureFolder_().createFile(blob);
  if (PropertiesService.getScriptProperties().getProperty('SIGNATURE_SHARING') === 'link') {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return file.getUrl();
}

function getSignatureFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SIGNATURE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) { /* deleted: recreate */ } }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.createFolder(ss.getName() + ' — Signatures');
  props.setProperty('SIGNATURE_FOLDER_ID', folder.getId());
  return folder;
}

function ensureSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const h = HEADERS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#0f7a55').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  if (name === SHEET.ATT) { sh.getRange('B:C').setNumberFormat('@'); sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss'); }
  if (name === SHEET.ROSTER) sh.getRange('A:D').setNumberFormat('@');
  if (name === SHEET.SET) sh.getRange('B:B').setNumberFormat('@');
  return sh;
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ensureSheet_(ss, name);
}

function requirePin_(b) {
  const pin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!pin || String(b.pin || '') !== pin) fail_('bad_pin', 'PIN ไม่ถูกต้อง');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(fn());
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code, message: err.message || '' });
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function fail_(code, message) { const e = new Error(message || code); e.code = code; throw e; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Bangkok'; }
function todayKey_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function isDateKey_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function dateCell_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : String(v || '').trim(); }
function timeCell_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'HH:mm:ss') : String(v || '').trim(); }
function nameKey_(n) { return String(n || '').replace(/\s/g, '').toLowerCase(); }
function newId_() { return 'st-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
/** Prevent spreadsheet formula injection from user-supplied text. */
function clean_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
