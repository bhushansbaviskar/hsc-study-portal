"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STRICT = process.argv.includes("--strict");

const CANONICAL_KINDS = new Set([
  "mcq", "vsa", "define", "distinguish", "numerical",
  "derivation", "proof", "theory", "diagram", "problem"
]);

let errors = 0;
let warnings = 0;

function err(msg) {
  errors++;
  console.error("ERROR:", msg);
}
function warn(msg) {
  if (STRICT) err(msg);
  else {
    warnings++;
    console.warn("WARN:", msg);
  }
}

function normText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
function diceSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = bigrams(a), bb = bigrams(b);
  const counts = new Map();
  for (const g of ba) counts.set(g, (counts.get(g) || 0) + 1);
  let inter = 0;
  for (const g of bb) {
    const c = counts.get(g) || 0;
    if (c > 0) { inter++; counts.set(g, c - 1); }
  }
  return (2 * inter) / (ba.length + bb.length);
}

function checkFig(figPath, ctx) {
  if (!figPath) return;
  const full = path.resolve(ROOT, figPath);
  if (!fs.existsSync(full)) { err(`${ctx}: missing fig file ${figPath}`); return; }
  const stat = fs.statSync(full);
  if (stat.size >= 15 * 1024) err(`${ctx}: fig ${figPath} is ${stat.size} bytes (>= 15 KB)`);
  const svg = fs.readFileSync(full, "utf8");
  if (!/<svg[\s>]/i.test(svg)) err(`${ctx}: fig ${figPath} does not contain <svg`);
  if (/<script/i.test(svg)) err(`${ctx}: fig ${figPath} contains <script`);
  if (/https?:\/\//i.test(svg)) err(`${ctx}: fig ${figPath} contains external URL`);
}

function main() {
  const catPath = path.join(ROOT, "content", "catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catPath, "utf8"));

  // 1. Validate weightage sums per paper group
  const subjMap = {};
  for (const sub of catalog.subjects || []) {
    subjMap[sub.id] = sub;
    for (const c of sub.chapters || []) {
      if (typeof c.marks !== "number" || c.marks <= 0) err(`catalog ${sub.id}/${c.id}: invalid marks`);
      if (typeof c.marksWithOptions !== "number" || c.marksWithOptions < c.marks) err(`catalog ${sub.id}/${c.id}: invalid marksWithOptions`);
      if (!c.prefix) err(`catalog ${sub.id}/${c.id}: missing prefix`);
    }
  }

  const expectedGroups = {
    physics: { marks: 70, withOptions: 98 },
    chemistry: { marks: 70, withOptions: 98 },
    maths: { marks: 80, withOptions: 112 }
  };
  for (const [gk, exp] of Object.entries(expectedGroups)) {
    const pg = catalog.paperGroups && catalog.paperGroups[gk];
    if (!pg) { err(`catalog: missing paperGroups.${gk}`); continue; }
    let mSum = 0, oSum = 0;
    for (const sid of pg.subjects || []) {
      const sub = subjMap[sid];
      if (!sub) { err(`catalog paperGroups.${gk}: unknown subject ${sid}`); continue; }
      for (const c of sub.chapters) {
        mSum += c.marks || 0;
        oSum += c.marksWithOptions || 0;
      }
    }
    if (mSum !== exp.marks || oSum !== exp.withOptions) {
      err(`catalog ${gk} weightage sum is ${mSum}/${oSum}, expected ${exp.marks}/${exp.withOptions}`);
    }
  }

  // 2. Validate all live chapters
  const seenBoardIds = new Map();
  const seenDerivIds = new Map();
  let liveCount = 0;

  for (const sub of catalog.subjects || []) {
    for (const entry of sub.chapters || []) {
      if (!entry.file) continue;
      liveCount++;
      const chKey = `${sub.id}/${entry.id}`;
      const chPath = path.resolve(ROOT, entry.file);
      if (!fs.existsSync(chPath)) { err(`${chKey}: missing file ${entry.file}`); continue; }
      const ch = JSON.parse(fs.readFileSync(chPath, "utf8"));
      const isLite = !!ch.lite || !!entry.lite;
      const isLegacyP1 = chKey === "physics/ch01";

      // Book & offset
      const book = catalog.books && catalog.books[ch.book];
      if (!book) err(`${chKey}: invalid book "${ch.book}"`);
      else if (!Number.isInteger(book.pdfPageOffset)) err(`${chKey}: book "${ch.book}" missing integer pdfPageOffset`);

      // Counts match catalog
      const stops = Array.isArray(ch.stops) ? ch.stops : [];
      const board = Array.isArray(ch.board) ? ch.board : [];
      const derivs = Array.isArray(ch.derivations) ? ch.derivations : [];
      if (entry.stopCount !== stops.length) err(`${chKey}: catalog stopCount (${entry.stopCount}) !== stops.length (${stops.length})`);
      if (entry.boardCount !== board.length) err(`${chKey}: catalog boardCount (${entry.boardCount}) !== board.length (${board.length})`);

      // Stops & quests
      const stopIds = new Set();
      for (const s of stops) {
        if (!s.id) err(`${chKey}: stop missing id`);
        else stopIds.add(s.id);
        if (s.fig) checkFig(s.fig, `${chKey}/${s.id}`);
        if (!isLite && !s.quest) {
          err(`${chKey}/${s.id}: missing quest on non-lite chapter`);
        }
        if (s.quest) {
          if (!Array.isArray(s.quest.cards) || !s.quest.cards.length) err(`${chKey}/${s.id}: quest.cards empty`);
          else {
            s.quest.cards.forEach((c, idx) => {
              if (c.page == null) err(`${chKey}/${s.id}: card[${idx}] missing page`);
            });
          }
          if (!Array.isArray(s.quest.checks) || !s.quest.checks.length) err(`${chKey}/${s.id}: quest.checks empty`);
          else {
            s.quest.checks.forEach((chk, idx) => {
              if (chk.page == null) err(`${chKey}/${s.id}: check[${idx}] missing page`);
              if (chk.type === "num") {
                if (typeof chk.answer !== "number" || !Number.isFinite(chk.answer)) err(`${chKey}/${s.id}: check[${idx}] num answer not finite`);
                if ((sub.id === "physics" || sub.id === "chemistry") && (!chk.unit || !String(chk.unit).trim())) {
                  err(`${chKey}/${s.id}: check[${idx}] num missing unit`);
                }
              } else if (chk.type === "tf") {
                if (typeof chk.answer !== "boolean") err(`${chKey}/${s.id}: check[${idx}] tf answer not boolean`);
              } else {
                if (!Array.isArray(chk.options) || chk.options.length < 2) err(`${chKey}/${s.id}: check[${idx}] invalid options`);
                else if (typeof chk.answer !== "number" || chk.answer < 0 || chk.answer >= chk.options.length) {
                  err(`${chKey}/${s.id}: check[${idx}] answer index out of range`);
                }
              }
            });
          }
        }
      }

      // Derivations
      for (const d of derivs) {
        if (!d.id) { err(`${chKey}: derivation missing id`); continue; }
        if (seenDerivIds.has(d.id)) err(`${chKey}: duplicate derivation id "${d.id}" (also in ${seenDerivIds.get(d.id)})`);
        else seenDerivIds.set(d.id, chKey);
        if (!stopIds.has(d.stop)) err(`${chKey}/deriv/${d.id}: unknown stop "${d.stop}"`);
        if (d.fig) checkFig(d.fig, `${chKey}/deriv/${d.id}`);
      }

      // Board items
      const normTexts = [];
      for (const q of board) {
        if (!q.id) { err(`${chKey}: board item missing id`); continue; }
        if (seenBoardIds.has(q.id)) err(`${chKey}: duplicate board id "${q.id}" (also in ${seenBoardIds.get(q.id)})`);
        else seenBoardIds.set(q.id, chKey);

        if (!isLegacyP1 && !q.id.startsWith(entry.prefix)) {
          err(`${chKey}: board id "${q.id}" must start with "${entry.prefix}"`);
        }
        if (!stopIds.has(q.stop)) err(`${chKey}/${q.id}: unknown stop "${q.stop}"`);

        if (Array.isArray(q.points) && q.points.length) {
          const pSum = q.points.reduce((a, p) => a + (Number(p.marks) || 0), 0);
          if (pSum !== q.marks) err(`${chKey}/${q.id}: points sum (${pSum}) !== marks (${q.marks})`);
        } else {
          err(`${chKey}/${q.id}: missing points array`);
        }

        if (q.options !== undefined) {
          if (!Array.isArray(q.options) || q.options.length < 3) err(`${chKey}/${q.id}: options.length < 3`);
        }

        // page & canonical kind: hard error on lite or --strict, warn on pre-existing
        if (q.page == null || q.page === "") {
          const msg = `${chKey}/${q.id}: missing page`;
          if (isLite || STRICT) err(msg); else warn(msg);
        }
        if (!q.kind || !CANONICAL_KINDS.has(q.kind)) {
          const msg = `${chKey}/${q.id}: non-canonical kind "${q.kind}"`;
          if (isLite || STRICT) err(msg); else warn(msg);
        }

        if (q.fig) checkFig(q.fig, `${chKey}/${q.id}`);

        // Near-duplicate check within chapter
        const nt = normText(q.text);
        for (const prev of normTexts) {
          if (nt === prev.nt || diceSim(nt, prev.nt) > 0.88) {
            err(`${chKey}/${q.id}: near-duplicate text with ${prev.id}`);
          }
        }
        normTexts.push({ id: q.id, nt });
      }
    }
  }

  console.log(`Validated ${liveCount} live chapters, 47 catalog entries: ${errors} errors, ${warnings} warnings.`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
