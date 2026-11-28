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

console.log(`\nALL ${passed} CORE TESTS PASSED`);
