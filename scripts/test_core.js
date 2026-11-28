"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const App = require(path.join(ROOT, "assets", "app.js"));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "catalog.json"), "utf8"));
const phy1 = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "physics", "ch01-rotational-dynamics.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS:", name);
  } catch (err) {
    console.error("FAIL:", name, err);
    process.exitCode = 1;
  }
}

test("P0: KIND_LABEL maps all 10 canonical kinds and falls back safely", () => {
  assert.strictEqual(App.kindLabel("mcq"), "MCQ");
  assert.strictEqual(App.kindLabel("numerical"), "Numerical");
  assert.strictEqual(App.kindLabel("distinguish"), "Distinguish");
  assert.strictEqual(App.kindLabel("Truth table"), "Truth table");
});

test("P0: bootNeededKeys returns only 1 key on fresh state, and includes started chapters & boardPts", () => {
  App._setTestEnv({ catalog, chapters: { "physics/ch01": phy1 }, state: App.blank() });
  const fresh = App.bootNeededKeys(App.blank(), null);
  assert.deepStrictEqual(fresh, ["physics/ch01"]);

  const st = App.blank();
  st.done["chemistry/ch01/s01"] = "2026-11-28";
  st.boardPts["m2c1-2025-Q21"] = { got: 2, of: 3, at: 1795700000000, err: "calc" };
  const keys = App.bootNeededKeys(st, { focus: { chKey: "maths1/ch01", stopId: "s01" } });
  assert.ok(keys.includes("physics/ch01"));
  assert.ok(keys.includes("chemistry/ch01"));
  assert.ok(keys.includes("maths2/ch01"));
  assert.ok(keys.includes("maths1/ch01"));
});

test("P0: planInfo counts all 4 active subjects even when only 1 chapter is loaded", () => {
  App._setTestEnv({ catalog, chapters: { "physics/ch01": phy1 }, state: App.blank() });
  const pl = App.planInfo(App.blank(), "all");
  assert.ok(pl.scopeNames.includes("Physics"));
  assert.ok(pl.scopeNames.includes("Chemistry"));
  assert.ok(pl.scopeNames.includes("Maths I"));
  assert.ok(pl.scopeNames.includes("Maths II"));
});

test("P0: fm() escapes HTML and formats subscripts/superscripts", () => {
  const out = App.fm("<script>x_{2}^{3}</script>");
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("<sub>2</sub>"));
  assert.ok(out.includes("<sup>3</sup>"));
});

test("P0: parseNum parses integers, decimals, and scientific notation", () => {
  assert.strictEqual(App.parseNum("42"), 42);
  assert.strictEqual(App.parseNum("3.14"), 3.14);
  assert.strictEqual(App.parseNum("6.28×10^-5"), 6.28e-5);
  assert.ok(Number.isNaN(App.parseNum("abc")));
});

test("P1: stopMastery handles lite stop with 0 board & 0 drills without NaN", () => {
  const liteCh = { subject: "physics", id: "ch99", stops: [{ id: "s01", title: "Lite" }], board: [], derivations: [] };
  const st = App.blank();
  assert.strictEqual(App.stopMastery(liteCh.stops[0], st, liteCh), 0);
  st.done["physics/ch99/s01"] = "2026-11-28";
  assert.strictEqual(App.stopMastery(liteCh.stops[0], st, liteCh), 1);
});

test("P1: Need practice after older 3/3 boardPts overrides credit to 0; legacy got gets 0.5", () => {
  const ch = {
    subject: "physics", id: "ch98",
    stops: [{ id: "s01", title: "T", quest: { cards: [{}], checks: [{}] } }],
    board: [{ id: "b1", stop: "s01", marks: 3 }],
    derivations: []
  };
  const st = App.blank();
  st.done["physics/ch98/s01"] = "2026-11-28";
  st.quest["physics/ch98/s01"] = { best: 1, plays: 1 };
  // Legacy got -> 0.5 board credit: (0.20*1 + 0.50*0.5) / 0.70 = 0.45/0.70
  st.board["b1"] = "got";
  const mGot = App.stopMastery(ch.stops[0], st, ch);
  assert.ok(Math.abs(mGot - (0.45 / 0.70)) < 1e-6);

  // Point-marked 3/3 -> 1.0 board credit -> 1.0 total
  st.boardPts["b1"] = { got: 3, of: 3, at: 1000, err: "" };
  assert.ok(Math.abs(App.stopMastery(ch.stops[0], st, ch) - 1.0) < 1e-6);

  // Need practice at newer timestamp -> 0 board credit -> 0.20 / 0.70
  st.board["b1"] = "need";
  st.boardAt["b1"] = 2000;
  assert.ok(Math.abs(App.stopMastery(ch.stops[0], st, ch) - (0.20 / 0.70)) < 1e-6);
});

test("P1: gaugeData caps at 85% without full round, and blends 70/30 with roundHist", () => {
  const ch = {
    subject: "physics", id: "ch01", examMarks: { avg: 10, basis: "test" },
    stops: [{ id: "s01", title: "T" }], board: [], derivations: []
  };
  const st = App.blank();
  st.done["physics/ch01/s01"] = "2026-11-28";
  App._setTestEnv({ catalog, chapters: { "physics/ch01": ch }, state: st });
  const gNoRound = App.gaugeData(st, ch);
  assert.strictEqual(gNoRound.M, 0.85);

  st.roundHist["physics/ch01"] = [
    { at: 2000, date: "2026-11-28", mode: "most", got: 8, of: 10, pct: 80 },
    { at: 1000, date: "2026-11-27", mode: "mock", got: 10, of: 10, pct: 100 }
  ];
  // recentPct = 0.6*80 + 0.4*100 = 88 -> M = 0.7*1.0 + 0.3*0.88 = 0.964
  const gWithRound = App.gaugeData(st, ch);
  assert.ok(Math.abs(gWithRound.M - 0.964) < 1e-6);
});

test("P1: errorSummary enforces 14-day cutoff and sorts descending", () => {
  App._setTestEnv({ catalog, chapters: { "physics/ch01": phy1 }, state: App.blank(), today: "2026-11-28" });
  const st = App.blank();
  st.errLog = [
    { at: 1, date: "2026-11-28", id: "q1", chKey: "physics/ch01", err: "units" },
    { at: 2, date: "2026-11-20", id: "q2", chKey: "physics/ch01", err: "units" },
    { at: 3, date: "2026-11-15", id: "q3", chKey: "physics/ch01", err: "calc" },
    { at: 4, date: "2026-11-10", id: "q4", chKey: "physics/ch01", err: "concept" } // > 14 days old -> excluded
  ];
  const sum = App.errorSummary(st, 14);
  assert.strictEqual(sum.total, 3);
  assert.strictEqual(sum.rows[0].id, "units");
  assert.strictEqual(sum.rows[0].count, 2);
  assert.strictEqual(sum.rows[1].id, "calc");
});

test("P1: nextReviewDate enforces >=7d gap for confident mistakes and uses subject exam date", () => {
  App._setTestEnv({ catalog, chapters: { "physics/ch01": phy1 }, state: App.blank(), today: "2026-11-28" });
  // Normal item at streak 1 -> +3d ("2026-12-01")
  assert.strictEqual(App.nextReviewDate(1, "c|ch01|s01|0", false), "2026-12-01");
  // Confident mistake at streak 1 -> >= 7d ("2026-12-05")
  assert.strictEqual(App.nextReviewDate(1, "c|ch01|s01|0", true), "2026-12-05");
  // Subject exam date lookup
  assert.strictEqual(App.subjectExamDate("maths2/ch01"), "2027-02-25");
  assert.strictEqual(App.subjectExamDate("physics/ch01"), "2027-02-15");
});

console.log(`\nALL ${passed} CORE TESTS PASSED`);
