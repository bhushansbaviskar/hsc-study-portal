"use strict";
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRATCH_PUPPETEER = "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/40ee4297-6bd4-41aa-b0b1-15b5e963627e/scratch/e2e/node_modules/puppeteer-core";
const puppeteer = require(process.env.PUPPETEER_PATH || SCRATCH_PUPPETEER);

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
    if (u.includes("/content/")) fetched.push(u.split("/content/")[1]);
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
  console.log("PASS: Home renders unloaded live chapters & counts all 4 active subjects");

  // 2. Seed due bank item in unloaded maths2:ch01 -> #due-badge shows 1 -> #/review lazy-loads it
  const today = todayStr();
  await page.evaluate((t) => {
    const st = JSON.parse(localStorage.getItem("hscPrep.v2") || "{}");
    st.bank = { "c|maths2:ch01|s01|0": { due: t, streak: 0, added: t, reason: "missed", prio: false, updatedAt: Date.now() } };
    st.notes = { "chemistry/ch01/s01": "Unit cell packing efficiency note" };
    st.qp = { "maths1/ch01/s01": { phase: "cards", ci: 0, ki: 0, results: [], xp: 0, added: 0, at: Date.now() } };
    localStorage.setItem("hscPrep.v2", JSON.stringify(st));
  }, today);

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

  // 3. Direct deep-link #/maths2/ch01/s03/quest on cold load
  const page2 = await ctx.newPage();
  await page2.setViewport(vp);
  page2.on("pageerror", (e) => errors.push("page2 error: " + e.message));
  await page2.goto(baseUrl + "/#/maths2/ch01/s03/quest", { waitUntil: "networkidle0" });
  await page2.waitForSelector(".concept");
  await checkLayout(page2, "Deep-link quest");
  await page2.close();
  console.log("PASS: Cold deep-link #/maths2/ch01/s03/quest renders cleanly");

  assert.strictEqual(errors.length, 0, `Unexpected console/page errors: ${errors.join("; ")}`);
  await ctx.close();
}

async function main() {
  const { srv, url } = await startServer();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    await runSuiteForViewport(browser, url, { width: 390, height: 844 });
    await runSuiteForViewport(browser, url, { width: 820, height: 1180 });
    console.log("\nALL E2E TESTS PASSED");
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
