"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const gsCode = fs.readFileSync(path.join(ROOT, "sync/apps-script.gs"), "utf8");

function makeSandbox(opts) {
  const sentEmails = [];
  const sheetRows = [];
  const propsMap = Object.assign({
    FOLDER_ID: "folder-secret-id-999",
    TIMEZONE: "Asia/Kolkata",
    TEACHER_KEY: "SECRET_TEACHER_KEY_DO_NOT_LEAK",
    REPORT_EMAIL: "parent@example.com",
    STUDENTS_JSON: JSON.stringify({
      SECRET_STU_CODE_123: { id: "student1", name: "Aarav" },
      SECRET_STU_CODE_456: { id: "student2", name: "Diya" }
    })
  }, opts.props || {});

  const filesMap = opts.files || {};
  const sandbox = {
    Date, Math, Object, Array, String, Number, JSON,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propsMap ? propsMap[k] : null),
        setProperty: (k, v) => { propsMap[k] = v; }
      })
    },
    Utilities: {
      formatDate: (d, _tz, fmt) => {
        const iso = d.toISOString();
        if (fmt === "yyyy-MM-dd") return iso.slice(0, 10);
        return iso.slice(0, 19).replace("T", " ");
      },
      getUuid: () => "12345678-1234-1234-1234-123456789012"
    },
    DriveApp: {
      getFolderById: () => ({
        isTrashed: () => false,
        getFilesByName: (name) => {
          const hit = filesMap[name];
          let idx = 0;
          return {
            hasNext: () => !!hit && idx === 0,
            next: () => {
              idx++;
              return { getBlob: () => ({ getDataAsString: () => JSON.stringify(hit) }) };
            }
          };
        }
      })
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: () => ({
          getLastRow: () => sheetRows.length,
          appendRow: (r) => sheetRows.push(r),
          getDataRange: () => ({ getValues: () => sheetRows }),
          getRange: (r, _c, _nr, _nc) => ({ setValues: (vals) => { sheetRows[r - 1] = vals[0]; } })
        }),
        insertSheet: () => ({
          getLastRow: () => sheetRows.length,
          appendRow: (r) => sheetRows.push(r),
          getDataRange: () => ({ getValues: () => sheetRows })
        })
      })
    },
    MailApp: {
      sendEmail: (to, subject, body) => sentEmails.push({ to, subject, body })
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    ScriptApp: {
      WeekDay: { SUNDAY: "SUNDAY" },
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ onWeekDay: () => ({ atHour: () => ({ inTimezone: () => ({ create: () => {} }) }) }) }) })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(gsCode, sandbox);
  return { sandbox, sentEmails, sheetRows };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS:", name); }

test("P8: sendWeeklyReport summarizes active + zero-activity students and never leaks secrets", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { sandbox, sentEmails } = makeSandbox({
    files: {
      "student1.json": {
        rev: 5,
        state: {
          v: 2,
          done: { "physics/ch01/s01": todayStr },
          timeByDay: { [todayStr]: 2700 },
          roundHist: { "physics/ch01": [{ date: todayStr, got: 10, of: 12, pct: 83 }] },
          papers: [{ date: todayStr, paperKey: "physics", got: 56, of: 70, pct: 80 }],
          predSummary: { physics: 58, chemistry: 54, maths: 66 },
          errLog: [{ at: Date.now(), err: "units" }, { at: Date.now(), err: "units" }, { at: Date.now(), err: "calc" }],
          bank: { "c|physics:ch01|s01|0": { due: todayStr, streak: 0 } }
        }
      }
      // student2 has no synced file yet (zero-activity)
    }
  });

  const res = sandbox.sendWeeklyReport();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(sentEmails.length, 1);
  const email = sentEmails[0];
  assert.strictEqual(email.to, "parent@example.com");
  assert.ok(email.body.includes("Aarav"), "Includes active student name");
  assert.ok(email.body.includes("45 min across 1/7 days"), "Includes 7d study time");
  assert.ok(email.body.includes("Physics 58/70"), "Includes predicted marks");
  assert.ok(email.body.includes("units (2)"), "Includes top leak");
  assert.ok(email.body.includes("Diya") && email.body.includes("No synced activity yet"), "Handles zero-activity student cleanly");
  assert.ok(!email.body.includes("SECRET_TEACHER_KEY"), "Must never leak TEACHER_KEY");
  assert.ok(!email.body.includes("SECRET_STU_CODE"), "Must never leak STUDENT_CODE");
  assert.ok(!email.body.includes("folder-secret-id-999"), "Must never leak FOLDER_ID");
});

test("P8: updateSummarySheet records rounds, latest paper, predicted marks, and top error leak", () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { sandbox, sheetRows } = makeSandbox({ props: { SHEET_ID: "sheet-1" } });
  sandbox.updateSummarySheet({ id: "student1", name: "Aarav" }, 7, Date.now(), {
    v: 2,
    done: { "physics/ch01/s01": todayStr },
    xp: 120,
    bank: {},
    rounds: { "chemistry/ch01": { bestFull: 92 } },
    papers: [{ paperKey: "maths", got: 68, of: 80, pct: 85 }],
    predSummary: { physics: 60, chemistry: 55, maths: 70 },
    errLog: [{ at: Date.now(), err: "calc" }]
  });
  assert.strictEqual(sheetRows.length, 2); // header + 1 student row
  assert.strictEqual(sheetRows[1][9], 92, "Reads bestFull across state.rounds");
  assert.ok(String(sheetRows[1][10]).includes("maths 68/80 (85%)"), "Includes latest paper");
  assert.ok(String(sheetRows[1][11]).includes("60/70"), "Includes predSummary");
  assert.ok(String(sheetRows[1][12]).includes("calc (1)"), "Includes top error leak");
});

console.log(`\nALL ${passed} APPS SCRIPT TESTS PASSED`);
