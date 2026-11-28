"use strict";
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRATCH_PUPPETEER = "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/40ee4297-6bd4-41aa-b0b1-15b5e963627e/scratch/e2e/node_modules/puppeteer-core";
const puppeteer = require(process.env.PUPPETEER_PATH || SCRATCH_PUPPETEER);
const SHOT_DIR = process.env.E2E_SCREENSHOT_DIR || "";
const LIVE_URL = process.env.E2E_BASE_URL || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => {
      resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function checkLayout(page, label) {
  const res = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth
  }));
  assert.ok(res.sw <= res.iw, `${label}: horizontal overflow (${res.sw} > ${res.iw})`);
}

async function snap(page, vp, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${vp.width}px-${name}.png`), fullPage: false });
}

async function runSuiteForViewport(browser, baseUrl, vp) {
  console.log(`\n--- E2E Viewport ${vp.width}x${vp.height} ---`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(vp);
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console.error: " + msg.text());
  });

  // 1. Fresh cold boot fetches catalog.json + ONLY 1 chapter JSON
  const fetched = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/content/")) fetched.push(u.split("/content/")[1].split("?")[0]);
  });

  await page.goto(baseUrl + "/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".plan-card");
  await checkLayout(page, "Home cold boot");

  const chFetches = fetched.filter((f) => f !== "catalog.json");
  assert.strictEqual(chFetches.length, 1, `Expected 1 chapter JSON on cold boot, got ${JSON.stringify(chFetches)}`);
  console.log("PASS: Cold boot fetches catalog + 1 chapter JSON");

  // Teacher pill must stay hidden on student device
  const teacherHidden = await page.$eval("#teacher-pill", (el) => el.hidden);
  assert.strictEqual(teacherHidden, true, "#teacher-pill must stay hidden for students");

  // Home shows Coming soon only for chapters without file (unloaded live chapters show 0 of N stops)
  const homeText = await page.$eval("#app", (el) => el.textContent);
  assert.ok(homeText.includes("Mechanical Properties of Fluids"), "Unloaded live chapter must render");
  assert.ok(homeText.includes("0 of 14 stops"), "Unloaded live chapter must show stop count");
  assert.ok(homeText.includes("Physics, Chemistry, Maths I, Maths II"), "planInfo must count all 4 active subjects");
  assert.ok(homeText.includes("of 70"), "Home must show /70 prediction");
  assert.ok(homeText.includes("of 80"), "Home must show /80 prediction");
  console.log("PASS: Home renders unloaded live chapters, 4 active subjects, and /70, /70, /80 predictions");

  // Subject filter pills & Theme toggle
  await page.click('[data-act="home-subj"][data-subj="maths1"]');
  const m1Text = await page.$eval(".gauge-card", (el) => el.textContent);
  assert.ok(m1Text.includes("of 40") && m1Text.includes("Combined Maths paper"), "Maths I filter must show /40 + Combined Maths pill");
  await page.click('[data-act="home-subj"][data-subj="all"]');

  await page.click("#th-focus");
  assert.strictEqual(await page.$eval("html", (el) => el.getAttribute("data-theme")), "focus");
  await checkLayout(page, "Exam focus theme");
  await page.click("#th-quest");
  assert.strictEqual(await page.$eval("html", (el) => el.getAttribute("data-theme")), "quest");
  console.log("PASS: Subject filter pills & Exam focus / Quest theme toggle");

  // #/sync hides Teacher card for students
  await page.goto(baseUrl + "/#/sync", { waitUntil: "networkidle0" });
  const syncTxt = await page.$eval("#app", (el) => el.textContent);
  assert.ok(!syncTxt.includes("Parent / Teacher view"), "Student #/sync must not show Teacher view card");
  console.log("PASS: Teacher view hidden on #/sync for students");

  // 2. Seed due bank item in unloaded maths2:ch01 -> #due-badge shows 1 -> #/review lazy-loads it
  const today = todayStr();
  await page.evaluate((t) => {
    const st = JSON.parse(localStorage.getItem("hscPrep.v2") || "{}");
    st.bank = { "c|maths2:ch01|s01|0": { due: t, streak: 0, added: t, reason: "missed", prio: false, updatedAt: Date.now() } };
    st.notes = { "chemistry/ch01/s01": "Unit cell packing efficiency note" };
    st.qp = { "maths1/ch01/s01": { phase: "cards", ci: 0, ki: 0, results: [], xp: 0, added: 0, at: Date.now() } };
    localStorage.setItem("hscPrep.v2", JSON.stringify(st));
  }, today);

  await page.evaluate(() => { history.replaceState(null, "", "#/"); });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".plan-card");
  const badgeTxt = await page.$eval("#due-badge", (el) => el.hidden ? "" : el.textContent.trim());
  assert.strictEqual(badgeTxt, "1", "Due badge must show 1 on boot for unloaded maths2:ch01 item");
  const contText = await page.$eval("#app", (el) => el.textContent);
  assert.ok(contText.includes("Continue:"), "Home must show Continue quest for paused maths1/ch01");
  console.log("PASS: #due-badge counts unloaded chapter item & paused quest shows on Home");

  // Open #/review -> lazy-loads maths2/ch01 and renders item
  await page.goto(baseUrl + "/#/review", { waitUntil: "networkidle0" });
  await page.waitForSelector(".check-card");
  await checkLayout(page, "Review lazy-loaded");
  console.log("PASS: #/review lazy-loads maths2/ch01");

  // Open #/notes -> loads chemistry/ch01 and displays seeded note
  await page.goto(baseUrl + "/#/notes", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector("#app").textContent.includes("Unit cell packing efficiency note"));
  await checkLayout(page, "Notes lazy-loaded");
  console.log("PASS: #/notes lazy-loads chemistry/ch01");

  // Open #/formulas -> All chapters lazy-loads all 5 live chapters
  await page.goto(baseUrl + "/#/formulas", { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-act="formula-ch"][data-ch="all"]');
  await page.click('[data-act="formula-ch"][data-ch="all"]');
  await page.waitForFunction(() => document.querySelectorAll(".fchap").length >= 5);
  await checkLayout(page, "Formulas all chapters");
  await snap(page, vp, "formulas-all");
  console.log("PASS: #/formulas All chapters lazy-loads all live chapters");

  // 3. Direct deep-link #/maths2/ch01/s03/quest on cold load
  const page2 = await ctx.newPage();
  await page2.setViewport(vp);
  page2.on("pageerror", (e) => errors.push("page2 error: " + e.message));
  await page2.goto(baseUrl + "/#/maths2/ch01/s03/quest", { waitUntil: "networkidle0" });
  await page2.waitForSelector(".concept");
  await checkLayout(page2, "Deep-link quest");
  await page2.close();
  console.log("PASS: Cold deep-link #/maths2/ch01/s03/quest renders cleanly");

  // 4. P1: Board-card point marking + All correct toggle + untick 1 + Units / Cond. + Save
  await page.goto(baseUrl + "/#/physics/ch01/board", { waitUntil: "networkidle0" });
  await page.waitForSelector(".bq");
  const multiQ = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".bq"));
    for (const c of cards) {
      if (c.textContent.includes("2 marks") || c.textContent.includes("3 marks")) return c.getAttribute("data-q");
    }
    return cards[0].getAttribute("data-q");
  });
  await page.click(`.bq[data-q="${multiQ}"] [data-act="reveal"]`);
  await page.waitForSelector(`.bq[data-q="${multiQ}"] [data-act="bq-all"]`);
  await page.click(`.bq[data-q="${multiQ}"] [data-act="bq-all"]`);
  await page.click(`.bq[data-q="${multiQ}"] [data-act="bq-tick"][data-i="0"]`);
  await page.waitForSelector(`.bq[data-q="${multiQ}"] [data-act="bq-err"][data-err="units"]`);
  await page.click(`.bq[data-q="${multiQ}"] [data-act="bq-err"][data-err="units"]`);
  await page.$eval(`.bq[data-q="${multiQ}"] [data-act="bq-save"]`, (el) => el.scrollIntoView({ block: "center" }));
  await snap(page, vp, "board-card");
  await page.click(`.bq[data-q="${multiQ}"] [data-act="bq-save"]`);
  const savedP1 = await page.evaluate((qid) => {
    const st = JSON.parse(localStorage.getItem("hscPrep.v2"));
    return { bp: st.boardPts[qid], bank: st.bank["b|ch01|" + qid], errLog: st.errLog };
  }, multiQ);
  assert.ok(savedP1.bp && savedP1.bp.got < savedP1.bp.of && savedP1.bp.err === "units", "boardPts must record partial score + units err");
  assert.ok(savedP1.bank && savedP1.bank.err === "units", "bank item must record units err");
  assert.ok(savedP1.errLog.length >= 1 && savedP1.errLog[0].err === "units", "errLog must record units err");
  await checkLayout(page, "Board card point marking");
  console.log("PASS: P1 board-card point marking, All correct toggle, error tag & Save");

  // 5. P1: Complete a 1-mark round -> roundHist appended (no ids/results) + Error Breakdown card renders on Home
  await page.goto(baseUrl + "/#/physics/ch01/round", { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-act="round-start"][data-mode="m1"]');
  await page.click('[data-act="round-start"][data-mode="m1"]');
  await page.waitForSelector('[data-act="round-reveal"]');
  for (let step = 0; step < 10; step++) {
    const hasReveal = await page.$('[data-act="round-reveal"]');
    if (!hasReveal) break;
    await page.$eval('[data-act="round-reveal"]', (el) => el.scrollIntoView({ block: "center" }));
    await page.click('[data-act="round-reveal"]');
    await page.waitForSelector('[data-act="round-next"]');
    if (step === 0) {
      await page.waitForSelector('[data-act="round-err"][data-err="calc"]');
      await page.$eval('[data-act="round-err"][data-err="calc"]', (el) => el.scrollIntoView({ block: "center" }));
      await page.click('[data-act="round-err"][data-err="calc"]');
    }
    await page.$eval('[data-act="round-next"]', (el) => el.scrollIntoView({ block: "center" }));
    await page.click('[data-act="round-next"]');
  }
  await page.waitForSelector(".rres");
  await snap(page, vp, "round-result");
  const histCheck = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("hscPrep.v2"));
    return st.roundHist && st.roundHist["physics/ch01"];
  });
  assert.ok(Array.isArray(histCheck) && histCheck.length === 1, "roundHist must have 1 entry");
  assert.strictEqual(histCheck[0].ids, undefined, "roundHist must NOT store ids");
  assert.strictEqual(histCheck[0].results, undefined, "roundHist must NOT store results");

  // Navigate Home -> Error Breakdown card renders (2 errors logged: units + calc)
  await page.goto(baseUrl + "/#/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".err-card");
  const errCardText = await page.$eval(".err-card", (el) => el.textContent);
  assert.ok(errCardText.includes("Units / Cond.") && errCardText.includes("Calculation"), "Error Breakdown card must show logged errors");
  await checkLayout(page, "Home with Error Breakdown");
  await page.$eval(".gauge-card", (el) => el.scrollIntoView({ block: "start" }));
  await snap(page, vp, "home-predictions-errors");
  console.log("PASS: P1 1-mark round updates slim roundHist & Error Breakdown card renders on Home");

  // 6. P2: Active Formula Recall (#/formulas -> Test yourself -> reveal -> Missed -> Missed only)
  await page.goto(baseUrl + "/#/formulas", { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-act="formula-quiz"]');
  await page.click('[data-act="formula-quiz"]');
  await page.waitForSelector('[data-act="formula-reveal"]');
  const hiddenCheck = await page.evaluate(() => ({
    hasFn: !!document.querySelector(".frm .fn"),
    hasCover: !!document.querySelector(".frm .fq-cover")
  }));
  assert.ok(hiddenCheck.hasFn && hiddenCheck.hasCover, "Formula quiz must hide formula while keeping name visible");
  await snap(page, vp, "formula-quiz");
  await page.$eval('[data-act="formula-reveal"]', (el) => el.scrollIntoView({ block: "center" }));
  await page.click('[data-act="formula-reveal"]');
  await page.waitForSelector('[data-act="formula-mark"][data-ok="0"]');
  await page.$eval('[data-act="formula-mark"][data-ok="0"]', (el) => el.scrollIntoView({ block: "center" }));
  await page.click('[data-act="formula-mark"][data-ok="0"]');
  await page.waitForSelector('[data-act="formula-miss"]');
  await page.$eval('[data-act="formula-miss"]', (el) => el.scrollIntoView({ block: "center" }));
  await page.click('[data-act="formula-miss"]');
  assert.strictEqual(await page.$$eval(".frm", (els) => els.length), 1, "Missed only filter must show 1 missed formula");
  await page.$eval('[data-act="formula-quiz"]', (el) => el.scrollIntoView({ block: "center" }));
  await page.click('[data-act="formula-quiz"]'); // exit quiz
  console.log("PASS: P2 Active Formula Recall mode");

  // 7. P2: ArrowDown moves focus across radio buttons
  await page.goto(baseUrl + "/#/physics/ch01/s01/quest", { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-act="card-next"]');
  while (await page.$('[data-act="card-next"]')) {
    await page.click('[data-act="card-next"]');
  }
  await page.waitForSelector('.opts[role="radiogroup"] [role="radio"]');
  await page.focus('.opts[role="radiogroup"] [role="radio"]');
  const firstText = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press("ArrowDown");
  const secondText = await page.evaluate(() => document.activeElement.textContent);
  assert.notStrictEqual(firstText, secondText, "ArrowDown must move focus to next radio option");
  console.log("PASS: P2 ArrowDown radiogroup keyboard navigation");

  // 8. P2: Manifest 200 OK, Service Worker controls page, and Offline reload renders cleanly
  const manifestRes = await page.evaluate(async () => {
    const r = await fetch("./manifest.webmanifest");
    return { status: r.status, ok: r.ok };
  });
  assert.strictEqual(manifestRes.status, 200, "manifest.webmanifest must return 200 OK");
  await page.goto(baseUrl + "/#/", { waitUntil: "networkidle0" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".plan-card");
  await page.setOfflineMode(false);
  console.log("PASS: P2 manifest 200 OK, SW controls page, and offline reload renders");

  assert.strictEqual(errors.length, 0, `Unexpected console/page errors: ${errors.join("; ")}`);
  await ctx.close();
}

async function main() {
  const srvInfo = LIVE_URL ? { srv: null, url: LIVE_URL.replace(/\/+$/, "") } : await startServer();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    await runSuiteForViewport(browser, srvInfo.url, { width: 390, height: 844 });
    await runSuiteForViewport(browser, srvInfo.url, { width: 820, height: 1180 });
    console.log("\nALL E2E TESTS PASSED");
  } finally {
    await browser.close();
    if (srvInfo.srv) srvInfo.srv.close();
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
