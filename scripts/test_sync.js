"use strict";
const assert = require("assert");
const path = require("path");

// Mock browser globals for assets/sync.js
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
let scrubbedTo = null;
global.location = { origin: "https://bhushansbaviskar.github.io", pathname: "/hsc-study-portal/", search: "", hash: "#/" };
global.history = { replaceState: (_s, _t, u) => { scrubbedTo = u; } };

const Sync = require(path.resolve(__dirname, "..", "assets", "sync.js"));

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log("PASS:", name);
  }, (err) => {
    console.error("FAIL:", name, err);
    process.exitCode = 1;
  });
}

async function run() {
  const VALID_URL = "https://script.google.com/macros/s/TestIdxTestDeployment123456/exec";

  await test("URL allowlist accepts valid GAS /exec and Workspace /exec URLs", () => {
    assert.strictEqual(Sync.isValidSyncUrl(VALID_URL), true);
    assert.strictEqual(Sync.isValidSyncUrl("https://script.google.com/a/macros/example.org/macros/s/TestId123/exec"), true);
    assert.strictEqual(Sync.isValidSyncUrl("http://script.google.com/macros/s/TestId123/exec"), false);
    assert.strictEqual(Sync.isValidSyncUrl("https://script.google.com/macros/s/TestId123/dev"), false);
    assert.strictEqual(Sync.isValidSyncUrl("https://script.google.com/macros/u/1/s/TestId123/exec"), false);
    assert.strictEqual(Sync.isValidSyncUrl("https://evil.example/macros/s/TestId123/exec"), false);
  });

  await test("Synchronous captureHashParams validates URL, stores creds separately, and scrubs URL", () => {
    Sync._resetForTest();
    delete store["hscPrep.sync.v1"];
    scrubbedTo = null;
    const bad = Sync.captureHashParams("#/sync?url=https%3A%2F%2Fevil.example%2Fsteal&code=abc");
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(Sync.isLinked(), false);
    assert.strictEqual(scrubbedTo, "/hsc-study-portal/#/sync");

    const good = Sync.captureHashParams("#/sync?url=" + encodeURIComponent(VALID_URL) + "&code=secretCode99");
    assert.strictEqual(good.ok, true);
    assert.strictEqual(Sync.isLinked(), true);
    assert.strictEqual(Sync.hasTeacherConfig(), false);
    assert.strictEqual(scrubbedTo, "/hsc-study-portal/#/sync");

    // Connecting teacher view does not overwrite student code
    const tGood = Sync.captureHashParams("#/teacher?url=" + encodeURIComponent(VALID_URL) + "&key=teacherSecret88");
    assert.strictEqual(tGood.ok, true);
    assert.strictEqual(Sync.isLinked(), true);
    assert.strictEqual(Sync.hasTeacherConfig(), true);
    assert.strictEqual(Sync.getConfig().code, "secretCode99");
    assert.strictEqual(Sync.getConfig().teacherKey, "teacherSecret88");
    assert.strictEqual(scrubbedTo, "/hsc-study-portal/#/teacher");
  });

  await test("Pre-sync legacy hscPrep.v2 items (updatedAt===0) survive merge when delAt===0", () => {
    const legacy = {
      v: 2,
      done: { "physics/ch01/s01": "2026-11-20" },
      xp: 45,
      quest: { "physics/ch01/s01": { best: 3, plays: 1, last: "2026-11-20" } },
      bank: { "c|ch01|s01|0": { due: "2026-11-21", streak: 0, added: "2026-11-20", reason: "missed", prio: false } },
      notes: { "physics/ch01/s01": "Remember omega = v/r" },
      board: { "2022-Q1vii": "got" },
      theme: "quest",
      qp: {},
      drill: { d01: { runs: 1, clean: true, last: "2026-11-20" } },
      planStart: "2026-11-18",
      round: { modes: {}, complete: false, bestFull: 0, run: null, last: null }
    };
    const merged = Sync.mergeState(legacy, null);
    assert.strictEqual(merged.xp, 45);
    assert.strictEqual(merged.done["physics/ch01/s01"], "2026-11-20");
    assert.ok(merged.bank["c|ch01|s01|0"], "Legacy bank item must be preserved");
    assert.strictEqual(merged.notes["physics/ch01/s01"], "Remember omega = v/r");
    assert.strictEqual(merged.board["2022-Q1vii"], "got");
    assert.strictEqual(merged.planStart, "2026-11-18");
  });

  await test("mergeState is commutative and respects bankDel, noteAt deletion, qpDel, runDel tombstones", () => {
    const now = 1795700000000;
    const phone = {
      v: 2,
      done: { "physics/ch01/s01": "2026-11-20", "physics/ch01/s02": "2026-11-22" },
      xp: 120,
      quest: { "physics/ch01/s01": { best: 3, plays: 2, last: "2026-11-21" } },
      bank: {
        "c|ch01|s01|0": { due: "2026-11-22", streak: 0, added: "2026-11-20", reason: "missed", prio: false, updatedAt: now - 5000 },
        "c|ch01|s02|1": { due: "2026-11-23", streak: 0, added: "2026-11-22", reason: "confident mistake", prio: true, updatedAt: now - 1000 }
      },
      bankDel: {},
      notes: { "physics/ch01/s01": "Old note" },
      noteAt: { "physics/ch01/s01": now - 5000 },
      board: { "2022-Q1vii": "need" },
      boardAt: { "2022-Q1vii": now - 5000 },
      theme: "quest",
      qp: { "physics/ch01/s03": { phase: "check", ci: 2, ki: 1, results: [{ ok: true }], xp: 10, added: 0, at: now - 4000 } },
      qpDel: {},
      drill: { d01: { runs: 1, clean: false, last: "2026-11-20" } },
      planStart: "2026-11-18",
      round: {
        modes: { most: { best: { got: 18, of: 24, pct: 75, date: "2026-11-21" }, last: { got: 18, of: 24, pct: 75, date: "2026-11-21", at: now - 9000 } } },
        complete: false,
        bestFull: 75,
        run: { mode: "mock", ids: ["2022-Q1vii"], i: 0, results: [], ticks: [false], rev: false, elapsed: 5000, since: now - 3000, at: now - 3000 },
        runDel: 0,
        last: { mode: "most", got: 18, of: 24, pct: 75, date: "2026-11-21", at: now - 9000 }
      },
      updatedAt: now - 1000
    };

    const tablet = {
      v: 2,
      done: { "physics/ch01/s01": "2026-11-21", "physics/ch01/s03": "2026-11-23" },
      xp: 150,
      quest: { "physics/ch01/s01": { best: 2, plays: 3, last: "2026-11-22" } },
      bank: {},
      bankDel: { "c|ch01|s01|0": now - 2000 }, // cleared on tablet after phone's update
      notes: {},
      noteAt: { "physics/ch01/s01": now - 2000 }, // deleted on tablet after phone's note
      board: { "2022-Q1vii": "got" },
      boardAt: { "2022-Q1vii": now - 2000 },
      theme: "focus",
      qp: {},
      qpDel: { "physics/ch01/s03": now - 1000 }, // finished on tablet after phone's mid-quest
      drill: { d01: { runs: 2, clean: true, last: "2026-11-23" } },
      planStart: "2026-11-23",
      round: {
        modes: { most: { best: { got: 20, of: 24, pct: 83, date: "2026-11-23" }, last: { got: 20, of: 24, pct: 83, date: "2026-11-23", at: now - 1000 } } },
        complete: true,
        bestFull: 83,
        run: null,
        runDel: now - 1000, // discarded/finished on tablet after phone's run
        last: { mode: "most", got: 20, of: 24, pct: 83, date: "2026-11-23", at: now - 1000 }
      },
      updatedAt: now - 1000
    };

    const ab = Sync.mergeState(phone, tablet, now);
    const ba = Sync.mergeState(tablet, phone, now);

    // Commutative (ignoring theme)
    assert.strictEqual(Sync.statesEqual(ab, ba), true, "merge(A,B) must equal merge(B,A)");
    // Device-local theme preserved
    assert.strictEqual(ab.theme, "quest");
    assert.strictEqual(ba.theme, "focus");
    // Exact expected results
    assert.strictEqual(ab.done["physics/ch01/s01"], "2026-11-20"); // earlier date
    assert.strictEqual(ab.done["physics/ch01/s02"], "2026-11-22");
    assert.strictEqual(ab.done["physics/ch01/s03"], "2026-11-23");
    assert.strictEqual(ab.xp, 150);
    assert.strictEqual(ab.planStart, "2026-11-18");
    assert.strictEqual(ab.bank["c|ch01|s01|0"], undefined, "Cleared bank item must not resurrect");
    assert.ok(ab.bank["c|ch01|s02|1"], "Newer bank item must remain");
    assert.strictEqual(ab.notes["physics/ch01/s01"], undefined, "Deleted note must not resurrect");
    assert.strictEqual(ab.board["2022-Q1vii"], "got");
    assert.strictEqual(ab.qp["physics/ch01/s03"], undefined, "Finished quest qp must not resurrect");
    assert.strictEqual(ab.drill.d01.clean, true);
    assert.strictEqual(ab.round.complete, true);
    assert.strictEqual(ab.round.bestFull, 83);
    assert.strictEqual(ab.round.run, null, "Discarded/finished round.run must not resurrect");
  });

  await test("Remote timed mock run comes back paused (since = 0)", () => {
    const now = 1795700000000;
    const remote = {
      v: 2, done: {}, xp: 0, quest: {}, bank: {}, notes: {}, board: {}, qp: {}, drill: {}, planStart: "2026-11-20",
      round: { modes: {}, complete: false, bestFull: 0, run: { mode: "mock", ids: ["2022-Q1vii"], i: 0, results: [], ticks: [false], rev: false, elapsed: 12000, since: now - 1000, at: now }, runDel: 0, last: null }
    };
    const merged = Sync.mergeState({ v: 2, done: {}, theme: "quest" }, remote, now);
    assert.ok(merged.round.run);
    assert.strictEqual(merged.round.run.since, 0);
    assert.strictEqual(merged.round.run.resumed, true);
  });

  await test("Mock network: rev===0 pulls first, fresh tablet does not redundant-push, conflict retries, HTML error handled, silentSync skips push", async () => {
    Sync._resetForTest();
    delete store["hscPrep.sync.v1"];

    let serverRev = 3;
    let serverState = {
      v: 2, done: { "physics/ch01/s01": "2026-11-20" }, xp: 30, quest: {}, bank: {}, bankDel: {},
      notes: {}, noteAt: {}, board: {}, boardAt: {}, qp: {}, qpDel: {}, drill: {},
      planStart: "2026-11-20", round: { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null }, updatedAt: 1000
    };
    let calls = [];
    let forceConflictOnce = false;
    let forceHtmlOnce = false;

    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.action);
      if (forceHtmlOnce) {
        forceHtmlOnce = false;
        return { status: 200, text: async () => "<!DOCTYPE html><html><body>Sign in</body></html>" };
      }
      if (body.action === "pull") {
        return { status: 200, text: async () => JSON.stringify({ ok: true, rev: serverRev, updatedAt: 1000, state: serverState, studentName: "Aarav" }) };
      }
      if (body.action === "push") {
        if (forceConflictOnce) {
          forceConflictOnce = false;
          serverRev = 4;
          serverState = Object.assign({}, serverState, { xp: 60 });
          return { status: 200, text: async () => JSON.stringify({ ok: false, conflict: true, rev: serverRev, updatedAt: 2000, state: serverState }) };
        }
        assert.strictEqual(body.baseRev, serverRev);
        serverRev++;
        serverState = body.state;
        return { status: 200, text: async () => JSON.stringify({ ok: true, rev: serverRev, updatedAt: 3000, studentName: "Aarav" }) };
      }
      if (body.action === "teacher") {
        return { status: 200, text: async () => JSON.stringify({ ok: true, students: [{ id: "student1", name: "Aarav", rev: serverRev, updatedAt: 3000, state: serverState }] }) };
      }
      return { status: 400, text: async () => JSON.stringify({ ok: false, error: "bad" }) };
    };

    let localState = {
      v: 2, done: {}, xp: 0, quest: {}, bank: {}, bankDel: {},
      notes: {}, noteAt: {}, board: {}, boardAt: {}, theme: "focus", qp: {}, qpDel: {}, drill: {},
      planStart: "2026-11-27", round: { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null }, updatedAt: 500
    };
    let appliedCount = 0;
    Sync.init({
      getState: () => localState,
      applyState: (m) => { localState = m; appliedCount++; },
      onStatus: () => {}
    });

    // Fresh tablet linking against rev 3: pulls remote, adopts it, NO redundant push!
    const linkRes = await Sync.linkStudent(VALID_URL, "code123");
    assert.strictEqual(linkRes.ok, true);
    assert.deepStrictEqual(calls, ["pull"]);
    assert.strictEqual(appliedCount, 1);
    assert.strictEqual(localState.xp, 30);
    assert.strictEqual(localState.planStart, "2026-11-20");
    assert.strictEqual(localState.theme, "focus"); // device-local preserved

    // silentSync (mock 1s timer tick) must NOT trigger a push
    calls = [];
    Sync.onLocalSave({ silentSync: true });
    assert.deepStrictEqual(calls, []);

    // Real edit + conflict retry: merges xp:60 from server with local done s02, retries with baseRev:4 -> rev:5
    localState.done["physics/ch01/s02"] = "2026-11-27";
    forceConflictOnce = true;
    Sync.onLocalSave({ immediate: true });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(calls, ["push", "push"]);
    assert.strictEqual(serverRev, 5);
    assert.strictEqual(localState.xp, 60);
    assert.strictEqual(localState.done["physics/ch01/s02"], "2026-11-27");

    // HTML response yields friendly error
    forceHtmlOnce = true;
    const htmlRes = await Sync.syncNow();
    assert.strictEqual(htmlRes.ok, false);
    assert.ok(htmlRes.error.includes("web page instead of JSON"));

    // Teacher fetch works independently
    Sync.setTeacherConfig(VALID_URL, "teacherKey99");
    const tRes = await Sync.fetchTeacher();
    assert.strictEqual(tRes.ok, true);
    assert.strictEqual(tRes.students[0].name, "Aarav");
    assert.strictEqual(tRes.students[0].rev, 5);
  });

  await test("Golden pre-P0 legacy hscPrep.v2 state merges with zero phantom diff", () => {
    const App = require(path.resolve(__dirname, "..", "assets", "app.js"));
    const legacy = {
      v: 2,
      done: { "physics/ch01/s01": "2026-11-20" },
      xp: 45,
      quest: { "physics/ch01/s01": { best: 3, plays: 1, last: "2026-11-20" } },
      bank: { "c|ch01|s01|0": { due: "2026-11-21", streak: 0, added: "2026-11-20", reason: "missed", prio: false } },
      bankDel: {},
      notes: { "physics/ch01/s01": "Remember omega" },
      noteAt: { "physics/ch01/s01": 1795600000000 },
      board: { "2022-Q1vii": "got" },
      boardAt: { "2022-Q1vii": 1795600000000 },
      theme: "quest",
      lastChapter: "physics/ch01",
      qp: {},
      qpDel: {},
      drill: { d01: { runs: 1, clean: true, last: "2026-11-20" } },
      planStart: "2026-11-18",
      round: { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null },
      rounds: {},
      timeByDay: {},
      timeByCh: {},
      dismissedNoteAt: 0,
      updatedAt: 1795600000000
    };
    const normalizedLegacy = App.normalizeState(JSON.parse(JSON.stringify(legacy)));
    const mergedLegacy = Sync.mergeState(normalizedLegacy, legacy);
    assert.strictEqual(Sync.statesEqual(normalizedLegacy, mergedLegacy), true);
  });

  await test("All 8 new P0 fields + pickBankItem.err are commutative and idempotent", () => {
    const now = 1795700000000;
    const A = {
      v: 2,
      bank: { "b|ch01|2023-Q5": { due: "2026-11-25", streak: 1, added: "2026-11-20", reason: "below full marks", prio: false, err: "units", updatedAt: now - 1000 } },
      roundHist: { "physics/ch01": [{ at: now - 5000, date: "2026-11-20", mode: "most", got: 20, of: 25, pct: 80, secs: 600, errs: { units: 1 } }] },
      boardPts: { "p2-2023-Q3": { got: 2, of: 2, at: now - 2000, err: "" }, "2023-Q5": { got: 1, of: 2, at: now - 3000, err: "calc" } },
      graduated: { "c|ch01|s01|0": now - 4000 },
      errLog: [{ at: now - 3000, date: "2026-11-21", id: "2023-Q5", chKey: "physics/ch01", err: "calc" }],
      papers: [{ id: "pp1", at: now - 4000, date: "2026-11-21", paperKey: "physics", mode: "full", full: true, got: 56, of: 70, pct: 80, secs: 9000, secScores: { A: 16, B: 12, C: 18, D: 10 }, errs: { units: 2 } }],
      paperRun: { id: "pr2", paperKey: "physics", phase: "write", i: 4, at: now - 500, since: 0 },
      paperRunDel: 0,
      predSummary: { physics: 35.5, chemistry: 12, maths: 20, at: now - 1000 }
    };
    const B = {
      v: 2,
      bank: { "b|ch01|2023-Q5": { due: "2026-11-25", streak: 1, added: "2026-11-20", reason: "below full marks", prio: false, err: "calc", updatedAt: now - 1000 } },
      roundHist: { "physics/ch01": [{ at: now - 2000, date: "2026-11-22", mode: "mock", got: 22, of: 25, pct: 88 }] },
      boardPts: { "2023-Q5": { got: 2, of: 2, at: now - 1000, err: "" } },
      graduated: { "c|ch01|s01|0": now - 1000, "c|ch01|s02|0": now - 500 },
      errLog: [{ at: now - 1000, date: "2026-11-22", id: "p2-2023-Q3", chKey: "physics/ch02", err: "units" }],
      papers: [{ id: "pp2", at: now - 1000, date: "2026-11-22", paperKey: "chemistry", mode: "full", full: false, got: 20, of: 30, pct: 67, secs: 2400, secScores: { A: 10, B: 10 }, errs: {} }],
      paperRun: { id: "pr2", paperKey: "physics", phase: "read", i: 1, at: now - 800, since: 0 },
      paperRunDel: 0,
      predSummary: { physics: 30, chemistry: 10, maths: 15, at: now - 5000 }
    };
    const ab = Sync.mergeState(A, B, now);
    const ba = Sync.mergeState(B, A, now);
    assert.strictEqual(Sync.statesEqual(ab, ba), true, "merge(A,B) must equal merge(B,A)");
    const aa = Sync.mergeState(ab, ab, now);
    assert.strictEqual(Sync.statesEqual(ab, aa), true, "merge must be idempotent");
    assert.strictEqual(ab.roundHist["physics/ch01"].length, 2);
    assert.strictEqual(ab.boardPts["2023-Q5"].got, 2);
    assert.strictEqual(ab.graduated["c|ch01|s01|0"], now - 1000);
    assert.strictEqual(ab.errLog.length, 2);
    assert.strictEqual(ab.papers.length, 2);
    assert.strictEqual(ab.paperRun.phase, "write");
    assert.strictEqual(ab.predSummary.physics, 35.5);
    assert.strictEqual(ab.bank["b|ch01|2023-Q5"].err, "units");
    // Remote active paperRun comes back paused
    const remPR = Sync.mergeState({ v: 2 }, { v: 2, paperRun: { id: "pr3", paperKey: "physics", phase: "write", i: 2, at: now, since: now - 100 } }, now);
    assert.strictEqual(remPR.paperRun.since, 0);
    assert.strictEqual(remPR.paperRun.resumed, true);
  });

  await test("Stress test: max-capped 47-chapter state stays well under 250 KB (< 500 KB limit)", () => {
    const big = {
      v: 2, done: {}, xp: 9999, quest: {}, bank: {}, bankDel: {}, notes: {}, noteAt: {},
      board: {}, boardAt: {}, roundHist: {}, boardPts: {}, graduated: {}, errLog: [], papers: [],
      paperRun: null, paperRunDel: 0, predSummary: { physics: 60, chemistry: 58, maths: 72, at: 1795700000000 },
      timeByDay: {}, timeByCh: {}
    };
    for (let i = 0; i < 550; i++) big.done[`physics/ch${String((i % 16) + 1).padStart(2, "0")}/s${String((i % 14) + 1).padStart(2, "0")}`] = "2026-11-28";
    for (let c = 0; c < 47; c++) {
      const k = `subj/ch${String(c + 1).padStart(2, "0")}`;
      big.roundHist[k] = [];
      for (let r = 0; r < 20; r++) {
        big.roundHist[k].push({ at: 1795700000000 - r * 1000, date: "2026-11-28", mode: "most", got: 20, of: 25, pct: 80, secs: 900, errs: { units: 1 } });
      }
    }
    for (let q = 0; q < 700; q++) {
      big.boardPts[`p${(q % 16) + 1}-2023-Q${q}`] = { got: 2, of: 3, at: 1795700000000, err: "units" };
    }
    for (let e = 0; e < 200; e++) {
      big.errLog.push({ at: 1795700000000 - e * 1000, date: "2026-11-28", id: `p1-2023-Q${e}`, chKey: "physics/ch01", err: "units" });
    }
    for (let p = 0; p < 30; p++) {
      big.papers.push({ id: `paper-${p}`, at: 1795700000000 - p * 1000, date: "2026-11-28", paperKey: "physics", mode: "full", full: true, got: 58, of: 70, pct: 83, secs: 9600, secScores: { A: 16, B: 14, C: 18, D: 10 }, errs: { units: 2 } });
    }
    const merged = Sync.mergeState(big, big, 1795700000000);
    const bytes = Buffer.byteLength(JSON.stringify(merged), "utf8");
    console.log(`  [stress payload: ${(bytes / 1024).toFixed(1)} KB]`);
    assert.ok(bytes < 250000, `Expected < 250 KB, got ${bytes} bytes`);
  });

  console.log(`\nALL ${passed} TESTS PASSED`);
}

run();
