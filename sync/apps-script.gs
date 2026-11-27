/**
 * HSC Board Prep — Google Drive Sync & Teacher View backend (Google Apps Script).
 *
 * Zero secrets live in this file. Run initSetup() once in the Apps Script editor
 * to generate strong random codes and create your private Google Drive sync folder.
 * See sync/SETUP.md for full deployment steps.
 */

var DEFAULT_FOLDER_NAME = "HSC-Study-Portal-Sync";
var DEFAULT_TIMEZONE = "Asia/Kolkata";
var MAX_STATE_BYTES = 500000;       // 500 KB safety cap per student JSON
var MAX_AUTH_FAILS = 10;            // lockout threshold
var AUTH_LOCKOUT_SEC = 600;         // 10 minutes
var LOCK_WAIT_MS = 10000;

/* ---------- one-time setup (run manually in Apps Script editor) ---------- */
function initSetup() {
  var props = PropertiesService.getScriptProperties();
  var studentsJson = props.getProperty("STUDENTS_JSON");
  var teacherKey = props.getProperty("TEACHER_KEY");
  var folderId = props.getProperty("FOLDER_ID");
  var tz = props.getProperty("TIMEZONE");

  var generatedStudentCode = null;
  if (!studentsJson) {
    generatedStudentCode = Utilities.getUuid().replace(/-/g, "").slice(0, 20);
    var map = {};
    map[generatedStudentCode] = { id: "student1", name: "Student" };
    studentsJson = JSON.stringify(map);
    props.setProperty("STUDENTS_JSON", studentsJson);
  }
  if (!teacherKey) {
    teacherKey = Utilities.getUuid().replace(/-/g, "").slice(0, 24);
    props.setProperty("TEACHER_KEY", teacherKey);
  }
  if (!folderId) {
    var folder = DriveApp.createFolder(DEFAULT_FOLDER_NAME);
    folderId = folder.getId();
    props.setProperty("FOLDER_ID", folderId);
  }
  if (!tz) {
    props.setProperty("TIMEZONE", DEFAULT_TIMEZONE);
  }

  Logger.log("=== HSC Board Prep Sync Setup Complete ===");
  Logger.log("FOLDER_ID: " + folderId);
  Logger.log("TIMEZONE: " + (tz || DEFAULT_TIMEZONE));
  if (generatedStudentCode) {
    Logger.log("Generated STUDENT_CODE (student1): " + generatedStudentCode);
  } else {
    Logger.log("STUDENTS_JSON already configured (kept existing).");
  }
  Logger.log("TEACHER_KEY: " + teacherKey);
  Logger.log("Next: Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).");
}

/* ---------- HTTP entrypoints ---------- */
function doGet() {
  return jsonOut({ ok: true, service: "hsc-study-portal-sync" });
}

function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== "string") {
      return jsonOut({ ok: false, error: "Empty request body." });
    }
    if (e.postData.contents.length > MAX_STATE_BYTES + 4096) {
      return jsonOut({ ok: false, error: "Payload too large." });
    }
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut({ ok: false, error: "Invalid JSON payload." });
    }
    if (!isObj(body) || typeof body.action !== "string") {
      return jsonOut({ ok: false, error: "Missing action." });
    }

    if (isLockedOut()) {
      return jsonOut({ ok: false, error: "Too many invalid attempts. Try again in 10 minutes." });
    }

    if (body.action === "pull") return handlePull(body);
    if (body.action === "push") return handlePush(body);
    if (body.action === "teacher") return handleTeacher(body);
    if (body.action === "teacherUpdate") return handleTeacherUpdate(body);
    return jsonOut({ ok: false, error: "Unknown action." });
  } catch (err) {
    return jsonOut({ ok: false, error: "Server error: " + String(err && err.message ? err.message : err) });
  }
}

/* ---------- action handlers ---------- */
function handlePull(body) {
  var student = authStudent(body.code);
  if (!student) {
    recordAuthFail();
    return jsonOut({ ok: false, error: "Invalid student code." });
  }
  clearAuthFail();

  var folder = getFolderIfExists();
  if (!folder) {
    return jsonOut({ ok: true, rev: 0, updatedAt: 0, state: null, teacher: null, studentId: student.id, studentName: student.name });
  }
  var rec = readStudentRecord(folder, student.id);
  if (!rec) {
    return jsonOut({ ok: true, rev: 0, updatedAt: 0, state: null, teacher: null, studentId: student.id, studentName: student.name });
  }
  return jsonOut({
    ok: true,
    rev: rec.rev,
    updatedAt: rec.updatedAt,
    state: rec.state || null,
    teacher: isObj(rec.teacher) ? rec.teacher : null,
    studentId: student.id,
    studentName: student.name
  });
}

function handlePush(body) {
  var student = authStudent(body.code);
  if (!student) {
    recordAuthFail();
    return jsonOut({ ok: false, error: "Invalid student code." });
  }
  clearAuthFail();

  var baseRev = body.baseRev;
  if (typeof baseRev !== "number" || !isFinite(baseRev) || Math.floor(baseRev) !== baseRev || baseRev < 0) {
    return jsonOut({ ok: false, error: "Invalid baseRev." });
  }
  var state = body.state;
  if (!isValidState(state)) {
    return jsonOut({ ok: false, error: "Invalid state payload." });
  }
  var serializedState = JSON.stringify(state);
  if (serializedState.length > MAX_STATE_BYTES) {
    return jsonOut({ ok: false, error: "State payload exceeds limit." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return jsonOut({ ok: false, error: "Sync busy, please retry." });
  }

  var newRev = 0;
  var now = Date.now();
  var preservedTeacher = null;
  try {
    var folder = getOrCreateFolder();
    var existing = readStudentRecord(folder, student.id);
    var currentRev = existing ? existing.rev : 0;
    preservedTeacher = existing && isObj(existing.teacher) ? existing.teacher : null;

    if (baseRev !== currentRev) {
      return jsonOut({
        ok: false,
        conflict: true,
        rev: currentRev,
        updatedAt: existing ? existing.updatedAt : 0,
        state: existing ? existing.state : null,
        teacher: preservedTeacher,
        studentId: student.id,
        studentName: student.name
      });
    }

    newRev = currentRev + 1;
    var payload = {
      studentId: student.id,
      studentName: student.name,
      rev: newRev,
      updatedAt: now,
      state: state,
      teacher: preservedTeacher
    };
    writeStudentRecord(folder, student.id, payload);
  } finally {
    lock.releaseLock();
  }

  // Optional live Google Sheet summary (non-fatal: Drive JSON is the source of truth)
  try {
    updateSummarySheet(student, newRev, now, state);
  } catch (sheetErr) {
    Logger.log("Sheet summary update skipped: " + sheetErr);
  }

  return jsonOut({
    ok: true,
    rev: newRev,
    updatedAt: now,
    teacher: preservedTeacher,
    studentId: student.id,
    studentName: student.name
  });
}

function handleTeacher(body) {
  var props = PropertiesService.getScriptProperties();
  var expectedKey = props.getProperty("TEACHER_KEY");
  if (!expectedKey || typeof body.key !== "string" || !body.key || !safeEq(body.key, expectedKey)) {
    recordAuthFail();
    return jsonOut({ ok: false, error: "Invalid teacher key." });
  }
  clearAuthFail();

  var students = listConfiguredStudents();
  var folder = getFolderIfExists();
  var out = [];
  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    var rec = folder ? readStudentRecord(folder, s.id) : null;
    out.push({
      id: s.id,
      name: s.name,
      rev: rec ? rec.rev : 0,
      updatedAt: rec ? rec.updatedAt : 0,
      state: rec ? rec.state : null,
      teacher: rec && isObj(rec.teacher) ? rec.teacher : null
    });
  }
  return jsonOut({ ok: true, serverTime: Date.now(), students: out });
}

function handleTeacherUpdate(body) {
  var props = PropertiesService.getScriptProperties();
  var expectedKey = props.getProperty("TEACHER_KEY");
  if (!expectedKey || typeof body.key !== "string" || !body.key || !safeEq(body.key, expectedKey)) {
    recordAuthFail();
    return jsonOut({ ok: false, error: "Invalid teacher key." });
  }
  clearAuthFail();

  var sid = sanitizeId(body.studentId);
  var students = listConfiguredStudents();
  var match = null;
  for (var i = 0; i < students.length; i++) {
    if (students[i].id === sid) { match = students[i]; break; }
  }
  if (!match) {
    return jsonOut({ ok: false, error: "Unknown student." });
  }
  var teacherObj = isObj(body.teacher) ? body.teacher : {};
  if (JSON.stringify(teacherObj).length > 16384) {
    return jsonOut({ ok: false, error: "Teacher settings too large." });
  }
  teacherObj.updatedAt = Date.now();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return jsonOut({ ok: false, error: "Sync busy, please retry." });
  }
  try {
    var folder = getOrCreateFolder();
    var existing = readStudentRecord(folder, match.id);
    var payload = {
      studentId: match.id,
      studentName: match.name,
      rev: existing ? existing.rev : 0,
      updatedAt: existing ? existing.updatedAt : 0,
      state: existing ? existing.state : null,
      teacher: teacherObj
    };
    writeStudentRecord(folder, match.id, payload);
  } finally {
    lock.releaseLock();
  }
  return jsonOut({ ok: true, studentId: match.id, teacher: teacherObj });
}

/* ---------- auth & throttling helpers ---------- */
function getStudentsMap() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("STUDENTS_JSON");
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (isObj(parsed)) return parsed;
    } catch (e) {
      return {};
    }
  }
  var single = props.getProperty("STUDENT_CODE");
  if (single && typeof single === "string") {
    var m = {};
    m[single] = { id: "student1", name: "Student" };
    return m;
  }
  return {};
}

function authStudent(code) {
  if (typeof code !== "string" || !code) return null;
  var map = getStudentsMap();
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (safeEq(code, keys[i])) {
      var entry = map[keys[i]];
      if (isObj(entry) && typeof entry.id === "string" && entry.id) {
        return { id: sanitizeId(entry.id), name: String(entry.name || entry.id) };
      }
      if (typeof entry === "string" && entry) {
        return { id: sanitizeId(entry), name: entry };
      }
    }
  }
  return null;
}

function listConfiguredStudents() {
  var map = getStudentsMap();
  var seen = {};
  var list = [];
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    var entry = map[keys[i]];
    var id = sanitizeId(isObj(entry) ? entry.id : entry);
    var name = isObj(entry) ? String(entry.name || id) : id;
    if (id && !seen[id]) {
      seen[id] = true;
      list.push({ id: id, name: name });
    }
  }
  return list;
}

function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function isLockedOut() {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get("auth_fails") || "0", 10);
  return n >= MAX_AUTH_FAILS;
}

function recordAuthFail() {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get("auth_fails") || "0", 10) + 1;
  cache.put("auth_fails", String(n), AUTH_LOCKOUT_SEC);
}

function clearAuthFail() {
  CacheService.getScriptCache().remove("auth_fails");
}

/* ---------- Drive storage helpers ---------- */
function getFolderIfExists() {
  var folderId = PropertiesService.getScriptProperties().getProperty("FOLDER_ID");
  if (!folderId) return null;
  try {
    var f = DriveApp.getFolderById(folderId);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

function getOrCreateFolder() {
  var f = getFolderIfExists();
  if (f) return f;
  var props = PropertiesService.getScriptProperties();
  var created = DriveApp.createFolder(DEFAULT_FOLDER_NAME);
  props.setProperty("FOLDER_ID", created.getId());
  return created;
}

function readStudentRecord(folder, studentId) {
  var name = studentId + ".json";
  var files = folder.getFilesByName(name);
  if (!files.hasNext()) return null;
  var file = files.next();
  try {
    var rec = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
    if (!isObj(rec) || typeof rec.rev !== "number") return null;
    return rec;
  } catch (e) {
    return null;
  }
}

function writeStudentRecord(folder, studentId, payload) {
  var name = studentId + ".json";
  var content = JSON.stringify(payload);
  var files = folder.getFilesByName(name);
  if (files.hasNext()) {
    files.next().setContent(content);
  } else {
    folder.createFile(name, content, MimeType.PLAIN_TEXT);
  }
}

/* ---------- optional Google Sheet summary ---------- */
function updateSummarySheet(student, rev, nowMs, state) {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty("SHEET_ID");
  if (!sheetId) return;
  var tz = props.getProperty("TIMEZONE") || DEFAULT_TIMEZONE;
  var todayStr = Utilities.formatDate(new Date(nowMs), tz, "yyyy-MM-dd");
  var syncedStr = Utilities.formatDate(new Date(nowMs), tz, "yyyy-MM-dd HH:mm:ss");

  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName("Live Status") || ss.insertSheet("Live Status");
  var headers = ["Student ID", "Name", "Rev", "Last Synced (" + tz + ")", "Stops Done", "Done Today", "XP", "Mistake Bank", "Due Now", "Best Board Round %"];
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  }

  var done = isObj(state.done) ? state.done : {};
  var doneKeys = Object.keys(done);
  var doneTodayCount = 0;
  for (var i = 0; i < doneKeys.length; i++) {
    if (done[doneKeys[i]] === todayStr) doneTodayCount++;
  }
  var bank = isObj(state.bank) ? state.bank : {};
  var bankKeys = Object.keys(bank);
  var dueNow = 0;
  for (var j = 0; j < bankKeys.length; j++) {
    if (bank[bankKeys[j]] && bank[bankKeys[j]].due <= todayStr) dueNow++;
  }
  var bestRound = isObj(state.round) && typeof state.round.bestFull === "number" ? state.round.bestFull : 0;

  var row = [
    student.id,
    student.name,
    rev,
    syncedStr,
    doneKeys.length,
    doneTodayCount,
    typeof state.xp === "number" ? state.xp : 0,
    bankKeys.length,
    dueNow,
    bestRound
  ];

  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === student.id) {
      sh.getRange(r + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}

/* ---------- utils ---------- */
function isObj(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function isValidState(s) {
  return isObj(s) && s.v === 2 && isObj(s.done);
}

function sanitizeId(id) {
  return String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
