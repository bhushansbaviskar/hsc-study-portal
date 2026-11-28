"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const gsCode = fs.readFileSync(path.join(ROOT, "sync/apps-script.gs"), "utf8");

function makeSandbox(opts) {
  const sheetRows = [];
  const propsMap = Object.assign({
    FOLDER_ID: "folder-secret-id-999",
    TIMEZONE: "Asia/Kolkata",
    TEACHER_KEY: "SECRET_TEACHER_KEY_DO_NOT_LEAK",
    STUDENTS_JSON: JSON.stringify({
      SECRET_STU_CODE_123: { id: "student1", name: "Aarav" }
    })
  }, (opts && opts.props) || {});

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
    Logger: { log: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(gsCode, sandbox);
  return { sandbox, sheetRows };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS:", name); }

test("Apps Script has zero MailApp or email-sending references", () => {
  assert.ok(!/MailApp|sendWeeklyReport|setupWeeklyTrigger/i.test(gsCode), "Must not reference MailApp or email digest");
});

test("updateSummarySheet records rounds, latest paper, predicted marks, and top error leak", () => {
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
  assert.strictEqual(sheetRows.length, 2);
  assert.strictEqual(sheetRows[1][9], 92, "Reads bestFull across state.rounds");
  assert.ok(String(sheetRows[1][10]).includes("maths 68/80 (85%)"), "Includes latest paper");
  assert.ok(String(sheetRows[1][11]).includes("60/70"), "Includes predSummary");
  assert.ok(String(sheetRows[1][12]).includes("calc (1)"), "Includes top error leak");
});

console.log(`\nALL ${passed} APPS SCRIPT TESTS PASSED`);
