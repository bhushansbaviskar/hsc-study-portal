/* HSC Board Prep — Physics Chapter 1.
   Shell, themes (Quest / Exam focus), quests, board questions, derivation drills, formula card,
   mistake bank (spaced review) and notes. Plain JS, no dependencies.
   Everything is stored on this device only (localStorage key hscPrep.v2, in-memory fallback). */
(function () {
  "use strict";

  var PLAN_DEFAULT_STOPS = 14;     // estimated stops for chapters that have no content yet
  var STORE_KEY = "hscPrep.v2", OLD_KEY = "hscPrep.v1";
  var XP_FIRST = 10, XP_SECOND = 5, HINT_COST = 2, PASS_MARK = 2, TOL = 0.02;
  var SUBJ = "physics", CHID = "ch01";
  var BASE = "#/" + SUBJ + "/" + CHID;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var app = document.getElementById("app");
  var titleEl = document.getElementById("title");
  var backEl = document.getElementById("back");
  var xpEl = document.getElementById("xp");
  var dueEl = document.getElementById("due-badge");
  var syncPillEl = document.getElementById("sync-pill");
  var syncLabelEl = document.getElementById("sync-label");
  var SYNC = window.HSCSync || null;
  var catalog = null, CH = null;
  var redraw = null;               // re-renders the interactive view currently on screen
  var Q = null, R = null, D = null; // quest, review and drill sessions (in memory)
  var revealed = {};               // board answers shown this session
  var TState = { loading: false, error: "", data: null, checkedAt: 0 };

  /* ---------- icons ---------- */
  var ICON = {
    flame: '<svg class="flame" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M12 2c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-2.5 1-4 2.5-5.5C9 10.5 10 11.5 11 12c-.5-4-.5-7 1-10z" fill="#BA7517"/><path d="M12 21a3.5 3.5 0 0 1-3.5-3.5c0-2 1.8-3 3.5-5 1.7 2 3.5 3 3.5 5A3.5 3.5 0 0 1 12 21z" fill="#FAEEDA"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    checkS: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M13 2L5 13.5h6L10 22l9-12h-6z" fill="currentColor"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M7 3.5h10v5.5a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 5.5H4v2a3.5 3.5 0 0 0 3.5 3.5M17 5.5h3v2a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20.5h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- storage (never throws) ---------- */
  var mem = null;
  function blank() { return { v: 2, done: {}, xp: 0, quest: {}, bank: {}, bankDel: {}, notes: {}, noteAt: {}, board: {}, boardAt: {}, theme: "quest", qp: {}, qpDel: {}, drill: {}, planStart: "", round: blankRound(), updatedAt: 0 }; }
  function blankRound() { return { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null }; }
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function normalizeState(s) {
    if (!isObj(s)) s = blank();
    var b = blank();
    for (var k in b) if (s[k] == null || typeof s[k] !== typeof b[k]) s[k] = b[k];
    if (s.theme !== "quest" && s.theme !== "focus") s.theme = "quest";
    s.v = 2;
    if (!isObj(s.round)) s.round = blankRound();
    var rd = s.round, rb = blankRound();
    for (var rk in rb) if (rd[rk] === undefined || (rb[rk] !== null && typeof rd[rk] !== typeof rb[rk]) || (rb[rk] === null && rd[rk] !== null && !isObj(rd[rk]))) rd[rk] = rb[rk];
    if (!isObj(rd.modes)) rd.modes = {};
    return s;
  }
  function load() {
    if (mem) return mem;
    var s = null, fresh = false;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    if (!isObj(s)) {
      var old = null;
      try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch (e2) { old = null; }
      s = blank();
      if (isObj(old) && isObj(old.done)) s.done = old.done;   // migrate v1 progress
      fresh = true;
    }
    s = normalizeState(s);
    if (!s.planStart) { s.planStart = today(); fresh = true; }   // plan clock starts the first time the app runs
    mem = s;
    if (fresh) save({ silentSync: true });
    return mem;
  }
  function save(opts) {
    opts = opts || {};
    if (!opts.fromRemote && mem) mem.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(mem)); } catch (e) { /* keep in memory only */ }
    if (SYNC && !opts.fromRemote) SYNC.onLocalSave(opts);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* escape, then turn _{x} into subscript and ^{x} into superscript */
  function fm(s) {
    return esc(s).replace(/_\{([^}]*)\}/g, "<sub>$1</sub>").replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>");
  }
  function plain(s) { return String(s == null ? "" : s).replace(/_\{([^}]*)\}/g, "$1").replace(/\^\{([^}]*)\}/g, "^$1"); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  /* The single source of "today". Tests can fake it with window.__TODAY = "YYYY-MM-DD" or ?today=YYYY-MM-DD */
  function today() {
    var o = null;
    try { o = window.__TODAY || new URLSearchParams(location.search).get("today"); } catch (e) { o = null; }
    if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
    return fmtDate(new Date());
  }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
  function niceDate(s) { var d = parseDate(s); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function relTime(ms) {
    if (!ms) return "Never";
    var sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (sec < 45) return "just now";
    var min = Math.round(sec / 60);
    if (min < 60) return min + " min ago";
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + " hr ago";
    var d = new Date(ms);
    return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function daysLeft(dateStr) {
    return Math.max(0, Math.round((parseDate(dateStr) - parseDate(today())) / 86400000));
  }
  function K(stopId) { return SUBJ + "/" + CHID + "/" + stopId; }
  function isDone(stopId, st) { return !!((st || load()).done[K(stopId)]); }
  function doneToday(st) {
    var t = today(), n = 0, d = (st || load()).done;
    for (var k in d) if (d[k] === t) n++;
    return n;
  }
  function streak(st) {
    var days = {}, d = (st || load()).done;
    for (var k in d) days[d[k]] = true;
    var cur = today(), n = 0;
    if (!days[cur]) cur = addDays(cur, -1);          // streak stays alive until the end of today
    while (days[cur]) { n++; cur = addDays(cur, -1); }
    return n;
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function stopIndex(id) { for (var i = 0; i < CH.stops.length; i++) if (CH.stops[i].id === id) return i; return -1; }
  function stopById(id) { var i = stopIndex(id); return i < 0 ? null : CH.stops[i]; }
  function chapterProgress(st) {
    var done = CH.stops.filter(function (s) { return isDone(s.id, st); }).length;
    return { done: done, total: CH.stops.length, pct: Math.round(100 * done / CH.stops.length) };
  }
  function pdfOf(p) { return String(p).replace(/\d+/g, function (n) { return +n + (CH.pdfPageOffset || 10); }); }
  function bookChip(bookId, page, label, cls) {
    var b = catalog.books[bookId];
    var pdf = pdfOf(page);
    return '<a class="chip ' + (cls || "") + '" href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener noreferrer" ' +
      'title="Opens the PDF in Google Drive. Go to PDF page ' + esc(pdf) + '.">' +
      esc(label || b.label) + " · p. " + esc(page) + " (PDF " + esc(pdf) + ")</a>";
  }
  function pageChip(p) { return bookChip(CH.book, p, "Textbook"); }
  function tag(t) { return '<span class="tag">' + esc(t) + "</span>"; }

  /* ---------- derived data from the chapter file ---------- */
  function isBoardPYQ(b) { return !!(b && b.year); }
  function pyqAskCount(b) { return isBoardPYQ(b) ? 1 + (Array.isArray(b.alsoAsked) ? b.alsoAsked.length : 0) : 0; }
  function boardPriorityCmp(a, b) {
    var pa = isBoardPYQ(a) ? 1 : 0, pb = isBoardPYQ(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;                                  // previously asked PYQs always come first
    if (pa) return pyqAskCount(b) - pyqAskCount(a) || (b.year || 0) - (a.year || 0) || b.marks - a.marks;
    return b.marks - a.marks;
  }
  function boardFor(stopId) {
    return CH.board.filter(function (b) { return b.stop === stopId; }).sort(boardPriorityCmp);
  }
  function boardTag(b) {
    if (!isBoardPYQ(b)) return b.source || "Important";
    var base = b.year + " " + b.qno;
    return Array.isArray(b.alsoAsked) && b.alsoAsked.length ? base + " · " + b.alsoAsked.join(" · ") : base;
  }
  function askedCount(stopId) {
    return CH.board.reduce(function (n, b) { return b.stop === stopId ? n + pyqAskCount(b) : n; }, 0);
  }
  function getBoard(id) { return CH.board.filter(function (b) { return b.id === id; })[0]; }
  function getDeriv(id) { return CH.derivations.filter(function (d) { return d.id === id; })[0]; }

  /* ---------- plan worked back from the exam ---------- */
  function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function planInfo(st) {
    var total = 0, t = today();
    st = st || load();
    catalog.subjects.forEach(function (sub) {
      sub.chapters.forEach(function (c) {
        total += (sub.id === SUBJ && c.id === CHID) ? CH.stops.length : (c.estStops || PLAN_DEFAULT_STOPS);
      });
    });
    var done = Object.keys(st.done).length, left = Math.max(0, total - done);
    var pStart = /^\d{4}-\d{2}-\d{2}$/.test(st.planStart || "") ? st.planStart : t;
    var span = Math.max(1, dayDiff(pStart, catalog.planEnd));
    var since = Math.min(span, Math.max(0, dayDiff(pStart, t)));
    var daysLeft = Math.max(0, dayDiff(t, catalog.planEnd));
    var pace = Math.max(1, Math.ceil(left / Math.max(1, daysLeft)));
    var expected = total * since / span, diff = done - expected;
    var status = diff >= 1 ? "ahead" : diff <= -1 ? "behind" : "on";
    return { total: total, done: done, left: left, span: span, since: since, daysLeft: daysLeft, pace: pace,
      expected: expected, status: status, n: Math.floor(Math.abs(diff)) };
  }
  function planHTML(pl) {
    var label = pl.status === "on" ? "On track" : pl.status === "ahead" ? "Ahead by " + pl.n + (pl.n === 1 ? " stop" : " stops") : "Behind by " + pl.n + (pl.n === 1 ? " stop" : " stops");
    return '<div class="card plan-card plan-' + pl.status + '"><div class="row"><h2 class="grow">Your plan</h2><span class="pill plan-pill" data-plan="' + pl.status + '">' + esc(label) + "</span></div>" +
      '<p class="plan-line"><b>' + pl.pace + (pl.pace === 1 ? " stop" : " stops") + ' a day</b> to finish by ' + niceDate(catalog.planEnd) + ". " + pl.left + " of " + pl.total + " stops left, " + pl.daysLeft + (pl.daysLeft === 1 ? " day" : " days") + " to go.</p>" +
      '<p class="note">Only Physics is counted until other subjects are added. The last 10 days are kept for revision.</p></div>';
  }

  /* ---------- predicted board marks ---------- */
  function drillClean(id, st) { var r = (st || load()).drill[id]; return !!(r && r.clean); }
  function stopMastery(s, st) {
    // Average of the parts that apply to this stop: quest always; board questions and
    // derivations only if the stop has them. Nothing is credited before it is done.
    st = st || load();
    var parts = [isDone(s.id, st) ? 1 : 0];
    var bq = boardFor(s.id);
    if (bq.length) parts.push(bq.filter(function (b) { return st.board[b.id] === "got"; }).length / bq.length);
    var ds = CH.derivations.filter(function (d) { return d.stop === s.id; });
    if (ds.length) parts.push(ds.filter(function (d) { return drillClean(d.id, st); }).length / ds.length);
    return parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
  }
  function stopWeight(s) { return 1 + askedCount(s.id); }
  function gaugeData(st) {
    var em = CH.examMarks || { avg: 0, basis: "" }, tw = 0, sw = 0;
    var rows = CH.stops.map(function (s, i) {
      var w = stopWeight(s), m = stopMastery(s, st);
      tw += w; sw += w * m;
      return { s: s, i: i, w: w, m: m };
    });
    var M = tw ? sw / tw : 0;
    rows.forEach(function (r) { r.gain = em.avg * r.w / tw * (1 - r.m); });
    var top = rows.filter(function (r) { return r.gain > 0.0001; })
      .sort(function (a, b) { return b.gain - a.gain || a.i - b.i; }).slice(0, 2);
    return { avg: em.avg, basis: em.basis, M: M, pred: Math.round(em.avg * M * 2) / 2, top: top };
  }
  function gaugeHTML(st) {
    if (!CH.examMarks) return "";
    var g = gaugeData(st), pct = Math.round(g.M * 1000) / 10;
    var line = "About " + g.pred + " of ~" + Math.round(g.avg) + " marks secured";
    var gain = g.top.length ? '<p class="small gain">Biggest gain next: <b>' + g.top.map(function (r) { return esc(r.s.title); }).join(", then ") + "</b></p>" : "";
    var how = '<details class="how"><summary>How this is worked out</summary><p class="small">An estimate based on past papers: the average marks this chapter carried (' + esc(g.basis) +
      ') times how much of the chapter you have mastered (quest, board questions, derivations), counting often-asked stops more.</p></details>';
    var h;
    if (isFocus()) {
      h = '<div class="card gauge-card gauge-line"><div class="g-text" data-gauge="' + g.pred + '">' + line + "</div>" +
        '<div class="bar thin amber" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100" aria-label="Predicted marks"><i style="width:' + pct + '%"></i></div>' + gain + how + "</div>";
    } else {
      h = '<div class="card gauge-card"><h2>Predicted board marks</h2><div class="gauge">' +
        '<svg viewBox="0 0 120 68" role="img" aria-label="' + esc(line) + '"><path class="g-track" d="M10 60 A50 50 0 0 1 110 60" pathLength="100"/>' +
        '<path class="g-fill" d="M10 60 A50 50 0 0 1 110 60" pathLength="100" stroke-dasharray="' + pct + ' 100"/></svg>' +
        '<div class="g-num"><b>' + g.pred + '</b><span>of ~' + Math.round(g.avg) + "</span></div></div>" +
        '<p class="g-text center" data-gauge="' + g.pred + '">' + line + "</p>" + gain + how + "</div>";
    }
    return h;
  }

  /* ---------- mid-quest saving ---------- */
  function saveQuest() {
    if (!Q || Q.phase === "result") return;
    var ce = Q.ce;
    load().qp[K(Q.stop.id)] = { phase: Q.phase, ci: Q.ci, ki: Q.ki, results: Q.results, xp: Q.xp, added: Q.added, at: Date.now(),
      ce: ce ? { attempt: ce.attempt, hint: ce.hint, sel: ce.sel, val: ce.val, status: ce.status, gain: ce.gain, conf: ce.conf, flag: ce.flag || "" } : null };
    save();
  }
  function restoreQuest(s) {
    var r = load().qp[K(s.id)], cards = s.quest.cards, checks = s.quest.checks;
    if (!isObj(r) || (r.phase !== "cards" && r.phase !== "check")) return null;
    if (!(r.ci >= 0 && r.ci < cards.length) || !(r.ki >= 0 && r.ki < checks.length) || !Array.isArray(r.results)) return null;
    var q = { stop: s, phase: r.phase, ci: r.ci, ki: r.ki, ce: null, results: r.results, xp: +r.xp || 0, added: +r.added || 0, resumed: true };
    if (r.phase === "check") {
      if (r.results.length !== r.ki) return null;
      var ce = newCE(checks[r.ki], "quest"), c = isObj(r.ce) ? r.ce : {};
      ce.attempt = c.attempt === 1 ? 1 : 0; ce.hint = !!c.hint; ce.sel = typeof c.sel === "number" ? c.sel : null;
      ce.val = typeof c.val === "string" ? c.val : ""; ce.gain = +c.gain || 0; ce.conf = c.conf === "sure" || c.conf === "guess" ? c.conf : null;
      ce.flag = c.flag === "guessed" || c.flag === "sure" ? c.flag : "";
      ce.status = ["ask", "wrong", "right", "failed"].indexOf(c.status) >= 0 ? c.status : "ask";
      q.ce = ce;
    }
    return q;
  }
  function resumeInfo() {
    var qp = load().qp, best = null;
    for (var k in qp) {
      var id = k.split("/")[2], s = stopById(id);
      if (!s) continue;
      var q = restoreQuest(s);
      if (!q) continue;
      if (!best || (qp[k].at || 0) > best.at) best = { s: s, q: q, at: qp[k].at || 0 };
    }
    return best;
  }
  function progressText(q) {
    return q.phase === "check" ? "check " + (q.ki + 1) + " of " + q.stop.quest.checks.length : "concept " + (q.ci + 1) + " of " + q.stop.quest.cards.length;
  }

  /* ---------- XP ---------- */
  function addXP(n) { if (n > 0) { load().xp += n; save(); updateChrome(); } }

  /* ---------- mistake bank (spaced review) ---------- */
  var REASON = { "guessed": "Guessed", "confident mistake": "Confident mistake", "missed": "Missed", "need practice": "Need practice", "slip": "Slip", "below full marks": "Below full marks" };
  function bankAdd(id, reason) {
    var st = load(), b = st.bank, old = b[id];
    if (reason === "guessed" && old) return false;   // already in the bank: leave its schedule alone
    var keep = old && old.prio && reason !== "confident mistake";
    b[id] = { due: addDays(today(), 1), streak: 0, added: old ? old.added : today(),
      reason: keep ? old.reason : (reason || "missed"), prio: reason === "confident mistake" || !!keep, updatedAt: Date.now() };
    delete st.bankDel[id];
    save(); updateChrome();
    return true;
  }
  function reasonTag(id, st) {
    var it = (st || load()).bank[id];
    if (!it) return "";
    var r = it.reason || "missed";
    return '<span class="tag rtag' + (it.prio ? " prio" : "") + '">' + esc(REASON[r] || r) + (it.prio ? " · priority" : "") + "</span>";
  }
  function bankReview(id, ok) {
    var st = load(), b = st.bank, it = b[id];
    if (!it) return;
    var now = Date.now();
    if (ok) {
      it.prio = false;
      it.streak = (it.streak || 0) + 1;
      if (it.streak >= 2) { delete b[id]; st.bankDel[id] = now; }
      else { it.due = addDays(today(), 2); it.updatedAt = now; }
    } else { it.streak = 0; it.due = addDays(today(), 1); it.updatedAt = now; }
    save(); updateChrome();
  }
  function bankIds(st) { return Object.keys((st || load()).bank); }
  function dueIds(st) {
    var t = today(), b = (st || load()).bank;
    return Object.keys(b).filter(function (id) { return b[id] && b[id].due <= t; })
      .sort(function (x, y) {
        if (!!b[x].prio !== !!b[y].prio) return b[x].prio ? -1 : 1;   // confident mistakes first
        return b[x].due < b[y].due ? -1 : b[x].due > b[y].due ? 1 : (x < y ? -1 : 1);
      });
  }
  function nextDueDate(st) {
    var b = (st || load()).bank, ids = Object.keys(b);
    if (!ids.length) return null;
    return ids.map(function (i) { return b[i].due; }).sort()[0];
  }
  function parseId(id) { var p = id.split("|"); return { kind: p[0], ch: p[1], a: p[2], b: p[3] }; }
  function itemExists(id) {
    var p = parseId(id);
    if (p.kind === "c") { var s = stopById(p.a); return !!(s && s.quest.checks[+p.b]); }
    if (p.kind === "d") { var d = getDeriv(p.a); return !!(d && d.steps[+p.b]); }
    if (p.kind === "b") return !!getBoard(p.a);
    return false;
  }

  /* ---------- chrome: header, theme, tabs ---------- */
  function setHeader(title, backHref, opts) {
    opts = opts || {};
    titleEl.textContent = title;
    document.title = title + " · HSC Board Prep";
    if (backHref) { backEl.hidden = false; backEl.setAttribute("href", backHref); } else { backEl.hidden = true; }
    xpEl.hidden = !opts.xp;
    setTab(opts.tab || "");
    updateChrome();
  }
  function setTab(t) {
    var links = document.querySelectorAll(".tabs a[data-tab]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-tab") === t) links[i].setAttribute("aria-current", "page");
      else links[i].removeAttribute("aria-current");
    }
  }
  function updateSyncPill() {
    if (!syncPillEl || !syncLabelEl || !SYNC) return;
    var st = SYNC.getStatus();
    if (!st.linked) {
      syncPillEl.removeAttribute("data-sync");
      syncLabelEl.textContent = "Sync";
      return;
    }
    if (st.syncing) {
      syncPillEl.setAttribute("data-sync", "syncing");
      syncLabelEl.textContent = "Syncing…";
    } else if (st.state === "offline") {
      syncPillEl.setAttribute("data-sync", "offline");
      syncLabelEl.textContent = "Offline";
    } else if (st.state === "error") {
      syncPillEl.setAttribute("data-sync", "error");
      syncLabelEl.textContent = "Sync issue";
    } else {
      syncPillEl.setAttribute("data-sync", "synced");
      syncLabelEl.textContent = st.dirty ? "Saving…" : "Synced";
    }
  }
  function updateChrome() {
    xpEl.innerHTML = ICON.bolt + " " + load().xp + " XP";
    var n = 0;
    try { n = CH ? dueIds().filter(itemExists).length : 0; } catch (e) { n = 0; }
    if (n > 0) { dueEl.hidden = false; dueEl.textContent = n; dueEl.setAttribute("aria-label", n + " due"); } else dueEl.hidden = true;
    updateSyncPill();
  }
  function applyTheme() {
    var t = load().theme;
    document.documentElement.setAttribute("data-theme", t);
    document.getElementById("th-quest").setAttribute("aria-pressed", String(t === "quest"));
    document.getElementById("th-focus").setAttribute("aria-pressed", String(t === "focus"));
  }
  function errorView(msg) {
    setHeader("Something went wrong", "#/", {});
    app.innerHTML = '<div class="card"><h2>Something went wrong</h2><p class="muted">' + esc(msg) +
      '</p><a class="btn" href="#/">Go home</a></div>';
  }
  function isFocus() { return load().theme === "focus"; }

  /* ---------- home ---------- */
  function homeView() {
    setHeader("HSC Board Prep", null, { tab: "home" });
    var left = daysLeft(catalog.examDate), dt = doneToday(), pl = planInfo(), remaining = Math.max(0, pl.pace - dt);
    var prog = chapterProgress(), st = load(), due = dueIds().filter(itemExists).length;
    var h = "", ri = resumeInfo(), rr = roundRestore(), nextStop = CH.stops.filter(function (s) { return !isDone(s.id); })[0];
    var showRound = !!rr && (!ri || (rr.at || 0) > ri.at);
    if (showRound) {
      h += '<a class="card cont-card" href="' + BASE + '/round/run"><span class="num">' + ICON.play + '</span><span class="grow"><b>Continue: Board round · question ' + (rr.i + 1) + " of " + rr.ids.length + '</b><br><span class="small">Pick up where you stopped</span></span>' + ICON.chev + "</a>";
    } else if (ri) {
      h += '<a class="card cont-card" href="' + BASE + "/" + ri.s.id + '/quest"><span class="num">' + ICON.play + '</span><span class="grow"><b>Continue: ' + esc(ri.s.title) + " · " + progressText(ri.q) + '</b><br><span class="small">Pick up where you stopped</span></span>' + ICON.chev + "</a>";
    } else if (nextStop) {
      h += '<a class="card cont-card" href="' + BASE + "/" + nextStop.id + '/quest"><span class="num">' + ICON.play + '</span><span class="grow"><b>Next up: ' + esc(nextStop.title) + '</b><br><span class="small">Stop ' + (stopIndex(nextStop.id) + 1) + " · textbook p. " + esc(nextStop.page) + " · start the quest</span></span>" + ICON.chev + "</a>";
    }
    if (isFocus()) {
      h += '<div class="card countdown"><div class="cd-num">' + left + '</div><div class="cd-lab">days to the board exam · 1 February 2027</div>' +
        '<div class="bar thin amber" role="progressbar" aria-valuenow="' + prog.pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Chapter 1 progress"><i style="width:' + prog.pct + '%"></i></div>' +
        '<div class="cd-foot small muted"><span>Chapter 1: ' + prog.done + " of " + prog.total + ' stops done</span><span>Streak ' + streak() + ' d · ' + st.xp + ' XP</span></div></div>';
    } else {
      h += '<div class="card streak">' + ICON.flame + '<div class="grow"><b class="s-big">' + streak() + '-day streak</b>' +
        '<div class="muted">' + (remaining ? remaining + " more today" : "Today's target done") + '</div></div>' +
        '<div class="s-days"><b>' + left + '</b><span>days to exam</span></div></div>';
    }
    if (due > 0) {
      h += '<a class="card review-card" href="#/review"><span class="num amber">' + due + '</span><span class="grow"><b>Review: ' + due + ' due</b><br><span class="muted small">Redo what you got wrong, a few minutes</span></span>' + ICON.chev + "</a>";
    }
    h += planHTML(pl) + gaugeHTML();
    var shownId = showRound ? null : ri ? ri.s.id : (nextStop && nextStop.id);
    var next = CH.stops.filter(function (s) { return !isDone(s.id) && s.id !== shownId; }).slice(0, Math.max(0, (remaining || 1) - 1));
    h += '<div class="card"><h2>' + (remaining ? "Today's target" : "Target done for today") + "</h2>";
    h += '<p class="muted small">Today: ' + Math.min(dt, pl.pace) + " of " + pl.pace + " stops</p>";
    if (!nextStop) h += "<p>Chapter 1 complete. More chapters are coming soon.</p>";
    else if (!next.length) h += '<p class="muted small">Start with the card at the top.</p>';
    h += '<ul class="list">' + next.map(function (s) {
      var n = stopIndex(s.id) + 1;
      return '<li><a class="item" href="' + BASE + "/" + s.id + '"><span class="num">' + n + '</span>' +
        '<span class="grow"><b>' + esc(s.title) + '</b><br><span class="muted small">Textbook p. ' + s.page + "</span></span>" + ICON.chev + "</a></li>";
    }).join("") + "</ul></div>";
    var phy = catalog.subjects.filter(function (s) { return s.id === SUBJ; })[0];
    h += '<div class="card"><h2>Physics</h2><ul class="list">' + phy.chapters.map(function (c) {
      if (!c.file) return '<li><div class="soon"><span class="num">' + c.number + '</span><span class="grow">' + esc(c.title) + '<br><span class="small">Coming soon</span></span></div></li>';
      return '<li><a class="item" href="#/' + SUBJ + "/" + c.id + '"><span class="num">' + c.number + '</span>' +
        '<span class="grow"><b>' + esc(c.title) + '</b><div class="bar" style="margin-top:6px"><i style="width:' + prog.pct + '%"></i></div>' +
        '<span class="muted small">' + prog.done + " of " + prog.total + " stops</span></span>" + ICON.chev + "</a>" +
        '<a class="rlink" href="' + BASE + '/round"><span class="ricon">' + ICON.trophy + '</span><span class="grow"><b>Board round</b><br><span class="muted small">' + CH.board.length + " past-paper questions · open now</span>" + (roundComplete() ? "<br>" + badgeHTML("home") : "") + "</span>" + ICON.chev + "</a></li>";
    }).join("") + "</ul></div>";
    if (!isFocus()) {
      h += '<div class="stats"><div class="stat"><b>' + st.xp + '</b><span>XP</span></div><div class="stat"><b>' + prog.done + "/" + prog.total + '</b><span>stops done</span></div><div class="stat"><b>' + bankIds().length + '</b><span>in mistake bank</span></div></div>';
    }
    app.innerHTML = h;
  }

  /* ---------- chapter ---------- */
  var ZH = 104;   // row height of the quest path
  function zigPath(n, doneArr) {
    function xy(i) { return [i % 2 === 0 ? 20 : 80, i * ZH + ZH / 2]; }
    var segs = "";
    for (var i = 0; i < n - 1; i++) {
      var a = xy(i), b = xy(i + 1), m = ZH * 0.55;
      var d = "M" + a[0] + " " + a[1] + " C" + a[0] + " " + (a[1] + m) + " " + b[0] + " " + (b[1] - m) + " " + b[0] + " " + b[1];
      segs += '<path class="zs' + (doneArr[i] && doneArr[i + 1] ? " on" : "") + '" d="' + d + '" vector-effect="non-scaling-stroke"/>';
    }
    return '<svg class="zig-svg" viewBox="0 0 100 ' + (n * ZH) + '" preserveAspectRatio="none" aria-hidden="true">' + segs + "</svg>";
  }
  function chapterView() {
    setHeader("Ch " + CH.number + " · " + CH.title, "#/", { xp: true, tab: "map" });
    var prog = chapterProgress();
    var firstOpen = CH.stops.filter(function (s) { return !isDone(s.id); })[0];
    var h = '<div class="card"><div class="row"><div class="grow"><b>' + prog.done + " of " + prog.total + ' stops</b>' +
      '<div class="bar" style="margin-top:6px"><i style="width:' + prog.pct + '%"></i></div></div><b>' + prog.pct + '%</b></div>' +
      (roundComplete() ? '<div class="cb-row">' + badgeHTML("page") + "</div>" : "") +
      '<div class="chips">' + bookChip(CH.book, 1, "Chapter in textbook") + "</div>" +
      '<p class="note">Textbook pages ' + esc(CH.printedPages) + ". The Drive viewer can't jump to a page, so use the PDF page number shown.</p></div>";
    h += gaugeHTML();
    var pyqN = CH.board.filter(isBoardPYQ).length, impN = CH.board.length - pyqN;
    h += '<div class="tiles"><a class="tile" href="' + BASE + '/board"><b>Board questions</b><span class="muted small">' + pyqN + ' PYQs' + (impN ? ' + ' + impN + ' imp' : '') + '</span></a>' +
      '<a class="tile" href="' + BASE + '/derive"><b>Derivation drills</b><span class="muted small">' + CH.derivations.length + ' derivations</span></a>' +
      '<a class="tile" href="#/formulas"><b>Formula card</b><span class="muted small">All of Chapter 1</span></a></div>';
    if (isFocus()) {
      var order = CH.stops.map(function (s, i) { return { s: s, i: i, c: askedCount(s.id) }; })
        .sort(function (a, b) { return b.c - a.c || a.i - b.i; });
      h += '<a class="card round-card" href="' + BASE + '/round"><span class="ricon">' + ICON.trophy + '</span><span class="grow"><b>Board round</b><br><span class="small muted">' + CH.board.length + " exam questions · PYQs first, then derived important</span>" + (roundComplete() ? "<br>" + badgeHTML("map") : "") + "</span>" + ICON.chev + "</a>";
      h += '<div class="card flist-card"><h2>Stops, most asked first</h2><ul class="flist">' + order.map(function (o) {
        var s = o.s, d = isDone(s.id), pyqs = boardFor(s.id).filter(isBoardPYQ);
        return '<li><a class="frow" href="' + BASE + "/" + s.id + '"><span class="fnum' + (d ? " done" : "") + '">' + (d ? ICON.checkS : o.i + 1) + "</span>" +
          '<span class="grow"><span class="t">' + esc(s.title) + '</span><span class="fmeta muted small">p. ' + s.page + "</span>" +
          (pyqs.length ? '<span class="tags">' + pyqs.map(function (b) { return tag(boardTag(b)); }).join("") + "</span>" : "") + "</span></a></li>";
      }).join("") + "</ul></div>";
    } else {
      var doneArr = CH.stops.map(function (s) { return isDone(s.id); }), rn = CH.stops.length;
      h += '<div class="card zig-card"><div class="zig" style="height:' + ((rn + 1) * ZH) + 'px">' + zigPath(rn + 1, doneArr.concat([roundComplete()])) +
        CH.stops.map(function (s, i) {
          var d = doneArr[i], cur = s === firstOpen, c = askedCount(s.id);
          var cls = d ? "done" : cur ? "cur" : "";
          return '<a class="zrow ' + (i % 2 ? "r" : "l") + '" style="top:' + (i * ZH) + 'px" href="' + BASE + "/" + s.id + '">' +
            '<span class="zn"><span class="node ' + cls + '">' + (d ? ICON.check : cur ? ICON.play : i + 1) + "</span></span>" +
            '<span class="zl"><span class="t">' + esc(s.title) + '</span><span class="muted small">p. ' + s.page + (cur ? " · up next" : "") + "</span>" +
            (c ? '<span class="tag">asked ' + c + "×</span>" : "") + "</span></a>";
        }).join("") +
        '<a class="rrow ' + (rn % 2 ? "r" : "l") + '" style="top:' + (rn * ZH) + 'px" href="' + BASE + '/round"><span class="zn"><span class="node rn' + (roundComplete() ? " done" : "") + '">' + ICON.trophy + "</span></span>" +
        '<span class="zl"><span class="t">Board round</span><span class="muted small">' + CH.board.length + " questions · open now</span>" + badgeHTML("map") + "</span></a>" +
        "</div></div>";
    }
    app.innerHTML = h;
  }

  /* ---------- notes box helpers ---------- */
  function noteSyncCopy() { return SYNC && SYNC.isLinked() ? "Synced across your devices" : "Saved on this device only"; }
  function noteBox(stopId) {
    var v = load().notes[K(stopId)] || "";
    return '<div class="card"><h2>My notes</h2><label class="small muted" for="note">' + noteSyncCopy() + '</label>' +
      '<textarea id="note" class="note-ta" data-stop="' + esc(stopId) + '" rows="5" placeholder="Write your own reminders, tricks or doubts for this stop">' + esc(v) + "</textarea>" +
      '<div class="note-foot"><span id="saved" class="saved" aria-live="polite"></span><a href="#/notes">All my notes</a></div></div>';
  }
  var noteTimer = null, noteDirty = null;
  function flushNote(immediate) {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    if (noteDirty) { save({ immediate: !!immediate }); noteDirty = null; var el = document.getElementById("saved"); if (el) el.textContent = "Saved"; }
  }
  function onNoteInput(ta) {
    var st = load(), k = K(ta.getAttribute("data-stop")), v = ta.value;
    if (v.trim()) st.notes[k] = v; else delete st.notes[k];
    st.noteAt[k] = Date.now();
    noteDirty = k;
    var el = document.getElementById("saved"); if (el) el.textContent = "Saving…";
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { flushNote(false); }, 350);
  }

  /* ---------- board question card ---------- */
  function boardCard(q, withStop) {
    var r = load().board[q.id], inBank = !!load().bank["b|" + CHID + "|" + q.id], open = !!revealed[q.id];
    var s = stopById(q.stop);
    var h = '<article class="bq" data-q="' + esc(q.id) + '"><div class="bq-top">' + tag(boardTag(q)) +
      '<span class="marks">' + q.marks + (q.marks === 1 ? " mark" : " marks") + "</span>" +
      (q.kind ? '<span class="kind">' + esc(q.kind) + "</span>" : "") + "</div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>";
    if (q.options) h += '<ul class="bq-opts">' + q.options.map(function (o) { return "<li>" + fm(o) + "</li>"; }).join("") + "</ul>";
    if (withStop && s) h += '<p class="small muted">Stop ' + (stopIndex(s.id) + 1) + ': <a href="' + BASE + "/" + s.id + '">' + esc(s.title) + "</a></p>";
    h += '<button type="button" class="btn ghost" data-act="reveal" aria-expanded="' + open + '">' + (open ? "Hide model answer" : "Show model answer") + "</button>";
    h += '<div class="answer"' + (open ? "" : " hidden") + "><b>Model answer</b><p>" + fm(q.answer) + "</p></div>";
    h += '<div class="rate"><button type="button" class="btn ok' + (r === "got" ? "" : " ghost") + '" data-act="rate-got" aria-pressed="' + (r === "got") + '">Got it</button>' +
      '<button type="button" class="btn warn' + (r === "need" || r === "practice" ? "" : " ghost") + '" data-act="rate-need" aria-pressed="' + (r === "need" || r === "practice") + '">Need practice</button></div>';
    if ((r === "need" || r === "practice") && inBank) h += '<p class="small muted">In your mistake bank. Review: ' + niceDate(load().bank["b|" + CHID + "|" + q.id].due) + ".</p>";
    return h + "</article>";
  }

  /* ---------- stop ---------- */
  function stopView(stopId) {
    var i = stopIndex(stopId);
    if (i < 0) return errorView("That stop doesn't exist.");
    var s = CH.stops[i], done = isDone(s.id), qr = load().quest[K(s.id)], sq = restoreQuest(s);
    setHeader((i + 1) + ". " + s.title, BASE, { xp: true, tab: "map" });
    var h = '<div class="card"><h2>In short</h2><p>' + fm(s.inShort) + "</p></div>";
    var nChecks = s.quest.checks.length;
    h += '<div class="card quest-card"><div class="row"><div class="grow"><h2>Quest' + (done ? ' <span class="pill ok">' + ICON.checkS + " Done</span>" : "") + "</h2>" +
      '<p class="muted small">' + s.quest.cards.length + " concept cards, then " + nChecks + " checks. Up to " + nChecks * XP_FIRST + " XP." +
      (qr ? " Best score: <b>" + qr.best + "/" + nChecks + "</b>." : "") + "</p></div></div>" +
      (sq ? '<a class="btn primary block" href="' + BASE + "/" + s.id + '/quest">Resume quest · ' + progressText(sq) + '</a><button type="button" class="btn ghost block" style="margin-top:8px" data-act="q-over" data-stop="' + esc(s.id) + '">Start over</button>' :
        '<a class="btn primary block" href="' + BASE + "/" + s.id + '/quest">' + (qr ? "Replay quest" : "Start quest") + "</a>") +
      (done ? '<p class="note">Completed ' + niceDate(load().done[K(s.id)]) + ". Finish with at least " + PASS_MARK + " of " + nChecks + " correct to count a stop as done.</p>" :
        '<p class="note">Finish with at least ' + PASS_MARK + " of " + nChecks + " correct to complete this stop. Read the textbook section first for the full story.</p>") + "</div>";
    h += '<div class="card"><h2>Textbook sections</h2><ul class="sections">' +
      s.sections.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<div class="chips">' + bookChip(CH.book, s.page, "Std XII") +
      s.figs.map(function (f) { return '<span class="chip">' + esc(f) + "</span>"; }).join("") + "</div></div>";
    if (s.xi.length) {
      h += '<div class="card"><h2>Builds on Std XI</h2><p class="muted small">Quick revision if this feels unfamiliar.</p><div class="chips">' +
        s.xi.map(function (x) { return bookChip("xi", x.page, x.label, "xi"); }).join("") + "</div></div>";
    }
    var bq = boardFor(s.id);
    if (bq.length) {
      var hasPyq = bq.some(isBoardPYQ), hasImp = bq.some(function (x) { return !isBoardPYQ(x); });
      var bHead = hasPyq && hasImp ? "Board & important questions" : hasPyq ? "Asked in board papers" : "Important exam questions";
      var bSub = hasPyq ? "Previously asked board questions first" + (hasImp ? ", followed by derived important questions" : "") + ". Try each before opening the answer." : "High-yield textbook question. Try it before opening the answer.";
      h += '<div class="card"><h2>' + bHead + '</h2><p class="muted small">' + bSub + "</p>" +
        bq.map(function (q) { return boardCard(q, false); }).join("") + "</div>";
    }
    h += noteBox(s.id);
    var prev = CH.stops[i - 1], next = CH.stops[i + 1];
    h += '<div class="nav2">' +
      (prev ? '<a class="btn ghost" href="' + BASE + "/" + prev.id + '">‹ Previous</a>' : "<span></span>") +
      (next ? '<a class="btn ghost" href="' + BASE + "/" + next.id + '">Next ›</a>' : '<a class="btn ghost" href="' + BASE + '">Chapter map</a>') + "</div>";
    app.innerHTML = h;
  }

  /* ---------- check engine (quests and review) ---------- */
  function newCE(chk, mode) { return { chk: chk, mode: mode, attempt: 0, hint: false, sel: null, val: "", status: "ask", gain: 0, msg: "", conf: null, flag: "" }; }
  function ceOptions(chk) { return chk.type === "tf" ? ["True", "False"] : chk.options; }
  function ceAnswerIdx(chk) { return chk.type === "tf" ? (chk.answer ? 0 : 1) : chk.answer; }
  function ceAnswerText(chk) {
    if (chk.type === "num") return chk.answer + " " + chk.unit;
    return ceOptions(chk)[ceAnswerIdx(chk)];
  }
  function parseNum(s) {
    s = String(s).trim().replace(/,/g, ".").replace(/\s*[x×*]\s*10\s*\^?\s*\(?\s*(-?\d+)\s*\)?/i, "e$1");
    var m = s.match(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
    return m ? parseFloat(m[0]) : NaN;
  }
  function ceIsCorrect(ce) {
    var c = ce.chk;
    if (c.type === "num") {
      var v = parseNum(ce.val);
      return !isNaN(v) && Math.abs(v - c.answer) <= TOL * Math.abs(c.answer);
    }
    return ce.sel === ceAnswerIdx(c);
  }
  function ceSubmit(ce) {
    var ok = ceIsCorrect(ce);
    if (ok) {
      ce.status = "right";
      if (ce.mode === "quest") {
        ce.gain = Math.max(0, (ce.attempt === 0 ? XP_FIRST : XP_SECOND) - (ce.hint ? HINT_COST : 0));
        addXP(ce.gain);
      }
    } else if (ce.mode === "quest" && ce.attempt === 0) ce.status = "wrong";
    else ce.status = "failed";
    return ok;
  }
  function ceHTML(ce, label) {
    var c = ce.chk, st = ce.status, h = "";
    var kindLabel = c.type === "step" ? "Pick the correct next step" : c.type === "num" ? "Numerical" : c.type === "tf" ? "True or false" : "Multiple choice";
    h += '<div class="card check-card"><div class="check-head"><span class="pill">' + esc(label) + '</span><span class="muted small">' + kindLabel + "</span></div>";
    h += '<p class="q">' + fm(c.q) + "</p>";
    var locked = st !== "ask";
    if (c.type === "num") {
      h += '<div class="numrow"><input id="numin" class="numin" type="text" inputmode="decimal" autocomplete="off" aria-label="Your answer" placeholder="Your answer" value="' + esc(ce.val) + '"' + (locked ? " disabled" : "") + '><span class="unit">' + fm(c.unit) + "</span></div>";
    } else {
      h += '<div class="opts" role="radiogroup">' + ceOptions(c).map(function (o, i) {
        var cls = "opt";
        if (ce.sel === i) cls += " sel";
        if (locked && st === "right" && ce.sel === i) cls += " right";
        if (locked && st !== "right" && ce.sel === i) cls += " wrong";
        if (st === "failed" && ceAnswerIdx(c) === i) cls += " right";
        return '<button type="button" class="' + cls + '" role="radio" aria-checked="' + (ce.sel === i) + '" data-act="ce-pick" data-i="' + i + '"' + (locked ? " disabled" : "") + '><span class="ltr">' + "ABCD".charAt(i) + "</span><span>" + fm(o) + "</span></button>";
      }).join("") + "</div>";
    }
    if (st === "ask") {
      if (ce.msg) h += '<p class="small warn-t" role="alert">' + esc(ce.msg) + "</p>";
      h += '<div class="conf" role="group" aria-label="How sure are you?"><span class="small muted">How sure are you?</span>' +
        '<button type="button" class="cbtn' + (ce.conf === "sure" ? " on" : "") + '" data-act="ce-conf" data-v="sure" aria-pressed="' + (ce.conf === "sure") + '">Sure</button>' +
        '<button type="button" class="cbtn' + (ce.conf === "guess" ? " on" : "") + '" data-act="ce-conf" data-v="guess" aria-pressed="' + (ce.conf === "guess") + '">Guessing</button></div>';
      if (ce.hint) h += '<div class="hint"><b>Hint.</b> ' + fm(c.hint) + "</div>";
      h += '<div class="actions">' +
        (ce.mode === "quest" && !ce.hint ? '<button type="button" class="btn amber-g" data-act="ce-hint">Hint (−' + HINT_COST + " XP)</button>" : "<span></span>") +
        '<button type="button" class="btn primary" data-act="ce-check">Check answer</button></div>';
      if (ce.attempt === 1) h += '<p class="small muted">Second try: worth ' + XP_SECOND + " XP.</p>";
    } else if (st === "wrong") {
      h += '<div class="fb bad" role="status"><b>Not quite.</b> ' + (c.hint ? "Hint: " + fm(c.hint) : "Have another look.") +
        ' <span class="small muted">Re-read textbook p. ' + esc(c.page) + ". The full working shows after your next try.</span></div>" +
        '<button type="button" class="btn primary block" data-act="ce-retry">Try again (' + XP_SECOND + " XP)</button>";
    } else if (st === "right") {
      h += '<div class="fb good" role="status"><b>Correct!' + (ce.mode === "quest" ? " +" + ce.gain + " XP" : "") + "</b> " + fm(c.explain) + '<div class="small muted">Textbook p. ' + esc(c.page) + "</div>" +
        (ce.flag === "guessed" ? '<div class="small">You were guessing, so this is saved to your mistake bank for tomorrow.</div>' : "") + "</div>" +
        '<button type="button" class="btn primary block" data-act="ce-next">Next</button>';
    } else {
      h += '<div class="fb bad" role="status"><b>The answer is ' + fm(ceAnswerText(c)) + ".</b> " + fm(c.explain) + '<div class="small muted">Textbook p. ' + esc(c.page) + "</div>" +
        (ce.mode === "quest" ? '<div class="small">No XP this time. It is saved to your mistake bank for tomorrow' + (ce.flag === "sure" ? ", and comes first in review because you were sure" : "") + ".</div>" : "") + "</div>" +
        '<button type="button" class="btn primary block" data-act="ce-next">Next</button>';
    }
    return h + "</div>";
  }
  function steps(total, cur) {
    var h = '<div class="steps" role="progressbar" aria-valuemin="1" aria-valuemax="' + total + '" aria-valuenow="' + (cur + 1) + '">';
    for (var i = 0; i < total; i++) h += '<i class="' + (i < cur ? "d" : i === cur ? "c" : "") + '"></i>';
    return h + "</div>";
  }

  /* ---------- quest ---------- */
  function questStart(stopId, fresh) {
    var s = stopById(stopId);
    if (!s) return errorView("That stop doesn't exist.");
    if (fresh) { var st = load(); delete st.qp[K(s.id)]; st.qpDel[K(s.id)] = Date.now(); save(); }
    Q = (fresh ? null : restoreQuest(s)) || { stop: s, phase: "cards", ci: 0, ki: 0, ce: null, results: [], xp: 0, added: 0 };
    redraw = questRender; questRender();
  }
  function questRender() {
    var s = Q.stop, i = stopIndex(s.id), cards = s.quest.cards, checks = s.quest.checks;
    var total = cards.length + checks.length;
    setHeader("Quest · " + s.title, BASE + "/" + s.id, { xp: true, tab: "map" });
    var h = "";
    var started = Q.phase === "check" || Q.ci > 0;
    if (Q.resumed && Q.phase !== "result") h += '<p class="small muted center resumed">Picking up where you left off.</p>';
    if (Q.phase === "cards") {
      var c = cards[Q.ci];
      h += steps(total, Q.ci);
      h += '<div class="card concept"><p class="small muted">Concept ' + (Q.ci + 1) + " of " + cards.length + "</p><h2>" + fm(c.t) + "</h2><p class=\"big\">" + fm(c.text) + "</p>" +
        '<div class="chips">' + pageChip(c.page) + "</div></div>";
      h += '<div class="actions two">' + (Q.ci > 0 ? '<button type="button" class="btn ghost" data-act="card-prev">Back</button>' : "<span></span>") +
        '<button type="button" class="btn primary" data-act="card-next">' + (Q.ci === cards.length - 1 ? "Start checks" : "Next") + "</button></div>";
      if (started) h += '<div class="center"><button type="button" class="btn ghost sm" data-act="q-over">Start over</button></div>';
    } else if (Q.phase === "check") {
      h += steps(total, cards.length + Q.ki);
      h += ceHTML(Q.ce, "Check " + (Q.ki + 1) + " of " + checks.length);
      h += '<div class="center"><button type="button" class="btn ghost sm" data-act="q-over">Start over</button></div>';
    } else {
      var score = Q.results.filter(function (r) { return r.ok; }).length, passed = score >= PASS_MARK;
      var next = CH.stops[i + 1];
      h += '<div class="card result ' + (passed ? "pass" : "fail") + '"><div class="score">' + score + "/" + checks.length + "</div>" +
        "<h2>" + (passed ? "Stop complete" : "Nearly there") + "</h2>" +
        '<p class="xp-gain">' + ICON.bolt + " +" + Q.xp + " XP this run</p>" +
        '<ul class="res-list">' + Q.results.map(function (r, n) {
          return '<li class="' + (r.ok ? "ok" : "no") + '"><span class="ri">' + (r.ok ? ICON.checkS : ICON.cross) + "</span><span>Check " + (n + 1) + (r.ok ? (r.first ? ": first try" : ": second try") : ": missed") + "</span></li>";
        }).join("") + "</ul>" +
        (passed ? '<p class="muted">Stop ' + (i + 1) + " is marked done. Today: " + Math.min(doneToday(), planInfo().pace) + " of " + planInfo().pace + " stops.</p>" :
          '<p class="muted">You need at least ' + PASS_MARK + " of " + checks.length + " correct to complete this stop. Read the cards again and replay.</p>") +
        (Q.added ? '<p class="small muted">' + Q.added + " item" + (Q.added > 1 ? "s" : "") + " added to your mistake bank. They come back for review tomorrow.</p>" : "") +
        "</div>";
      h += '<div class="stack">' +
        (passed && next ? '<a class="btn primary block" href="' + BASE + "/" + next.id + '">Next stop: ' + esc(next.title) + "</a>" : "") +
        '<button type="button" class="btn ' + (passed ? "ghost" : "primary") + ' block" data-act="q-replay">Replay quest</button>' +
        '<a class="btn ghost block" href="' + BASE + "/" + s.id + '">Back to stop</a></div>';
    }
    app.innerHTML = h;
    window.scrollTo(0, 0);
  }
  function questNext() {
    var s = Q.stop, checks = s.quest.checks, ce = Q.ce;
    var ok = ce.status === "right";
    Q.results.push({ ok: ok, first: ok && ce.attempt === 0 });
    Q.xp += ce.gain;
    if (Q.ki < checks.length - 1) { Q.ki++; Q.ce = newCE(checks[Q.ki], "quest"); }
    else {
      var st = load(), key = K(s.id), score = Q.results.filter(function (r) { return r.ok; }).length;
      var rec = st.quest[key] || { best: 0, plays: 0 };
      rec.best = Math.max(rec.best, score); rec.plays++; rec.last = today();
      st.quest[key] = rec;
      if (score >= PASS_MARK && !st.done[key]) st.done[key] = today();
      delete st.qp[key];
      st.qpDel[key] = Date.now();
      save({ immediate: true }); updateChrome();
      Q.phase = "result";
    }
    saveQuest();
    questRender();
  }

  /* ---------- board page ---------- */
  function boardView() {
    setHeader("Board questions", BASE, { xp: true, tab: "map" });
    var h = '<div class="card"><p>Previously asked Chapter 1 board questions (2022, 2023 and 2025) come first in every marks group, followed by derived important textbook questions. No duplicates.</p>' +
      '<p class="note"><b>No 2024 paper available yet.</b> Tap “Need practice” to add a question to your mistake bank.</p></div>';
    [1, 2, 3, 4].forEach(function (m) {
      var list = CH.board.filter(function (b) { return b.marks === m; }).sort(boardPriorityCmp);
      if (!list.length) return;
      h += '<h2 class="grp">' + m + (m === 1 ? " mark" : " marks") + ' <span class="muted small">' + list.length + " question" + (list.length > 1 ? "s" : "") + "</span></h2>" +
        '<div class="card">' + list.map(function (q) { return boardCard(q, true); }).join("") + "</div>";
    });
    app.innerHTML = h;
  }


  /* ---------- board round (final stop of the chapter, not one of the 14 stops) ---------- */
  var RD = null;                   // { run, phase: "run" | "result" } for the round on screen
  var rTimer = null, tOff = 0;     // 1 s interval for the mock clock; test hook offset (ms)
  var MIN_PER_MARK = 90;           // seconds per mark in the timed mock
  var PASS_PCT = 80;
  var MODE_NAME = { m1: "1-mark questions", m2: "2-mark questions", m3: "3-mark questions", m4: "4-mark questions", most: "Most asked first", mock: "Timed mock" };
  function nowMs() { return Date.now() + tOff; }
  function RS() { return load().round; }
  function validMode(m) { return Object.prototype.hasOwnProperty.call(MODE_NAME, m); }
  function totalMarks(ids) { return ids.reduce(function (a, id) { var q = getBoard(id); return a + (q ? q.marks : 0); }, 0); }
  function qPoints(q) {
    var p = q.points;
    if (Array.isArray(p) && p.length && p.reduce(function (a, x) { return a + (+x.marks || 0); }, 0) === q.marks) return p;
    return [{ text: "My answer matches the model answer", marks: q.marks }];
  }
  function pointsNeedCheck(q) { return qPoints(q).some(function (x) { return x.needsCheck; }); }
  function modeIds(mode) {
    var all = CH.board.map(function (b, i) { return { b: b, i: i }; });
    if (/^m[1-4]$/.test(mode)) {
      all = all.filter(function (x) { return x.b.marks === +mode.charAt(1); })
        .sort(function (a, b) { return boardPriorityCmp(a.b, b.b) || a.i - b.i; });
    } else if (mode === "most") {
      all.sort(function (a, b) {
        var pa = isBoardPYQ(a.b) ? 1 : 0, pb = isBoardPYQ(b.b) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return pyqAskCount(b.b) - pyqAskCount(a.b) || askedCount(b.b.stop) - askedCount(a.b.stop) || b.b.marks - a.b.marks || (b.b.year || 0) - (a.b.year || 0) || a.i - b.i;
      });
    } else if (mode === "mock") {
      all.sort(function (a, b) { return a.b.marks - b.b.marks || boardPriorityCmp(a.b, b.b) || a.i - b.i; });
    }
    return all.map(function (x) { return x.b.id; });
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), r = sec % 60;
    return (m ? m + " min" : "") + (m && r ? " " : "") + (r || !m ? r + " s" : "");
  }
  function fmtClock(sec) { sec = Math.max(0, sec); return Math.floor(sec / 60) + ":" + pad(sec % 60); }
  function marksWord(n) { return n + (n === 1 ? " mark" : " marks"); }
  function pctOf(got, of) { return of ? Math.round(100 * got / of) : 0; }
  function modeRec(mode) { var m = RS().modes[mode]; return isObj(m) ? m : {}; }
  function scoreLine(mode) {
    var m = modeRec(mode);
    if (!isObj(m.last)) return '<span class="rscores">Not tried yet</span>';
    return '<span class="rscores">Best <b>' + (isObj(m.best) ? m.best.pct : m.last.pct) + '%</b> · Last <b>' + m.last.pct + "%</b></span>";
  }
  function roundComplete(st) { return !!((st ? st.round : RS()).complete); }
  function badgeText(st) { var r = st ? st.round : RS(); return "Chapter " + CH.number + " complete · best board round " + r.bestFull + "%"; }
  function badgeHTML(where, st) {
    return roundComplete(st) ? '<span class="cbadge" data-badge="' + where + '">' + ICON.trophy.replace('width="28" height="28"', 'width="16" height="16"') + " " + esc(badgeText(st)) + "</span>" : "";
  }

  /* clock: elapsed is counted from timestamps, so it stays right if the tab sleeps */
  function runElapsed(r) { return r.elapsed + (r.since ? nowMs() - r.since : 0); }
  function rebase(r) { if (r.since) { r.elapsed = runElapsed(r); r.since = nowMs(); } }
  function saveRound(silent) {
    var run = RD && RD.phase === "run" ? RD.run : null;
    if (!run) return;
    rebase(run); run.at = Date.now();
    RS().run = run; save(silent ? { silentSync: true } : {});
  }
  function roundRestore() {
    var rs = RS(), r = rs.run;
    if (!r) return null;
    var ok = isObj(r) && validMode(r.mode) && Array.isArray(r.ids) && r.ids.length && r.ids.every(function (id) { return !!getBoard(id); }) &&
      typeof r.i === "number" && r.i >= 0 && r.i < r.ids.length && Array.isArray(r.results) && r.results.length === r.i;
    if (!ok) { rs.run = null; rs.runDel = Date.now(); save(); return null; }
    var q = getBoard(r.ids[r.i]), np = qPoints(q).length;
    if (!Array.isArray(r.ticks)) r.ticks = [];
    r.ticks = r.ticks.slice(0, np).map(function (x) { return !!x; });
    while (r.ticks.length < np) r.ticks.push(false);
    r.rev = !!r.rev;
    if (!(RD && RD.run === r)) { r.since = 0; r.resumed = true; }   // a reloaded mock comes back paused
    r.elapsed = +r.elapsed > 0 ? +r.elapsed : 0;
    if (r.mode === "mock") { r.limit = totalMarks(r.ids) * MIN_PER_MARK; r.timeUp = !!r.timeUp; }
    return r;
  }
  function roundLeave() {
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    var run = RD && RD.phase === "run" ? RD.run : null;
    if (run && run.since) { rebase(run); run.since = 0; saveRound(false); }   // leaving the page pauses the mock clock
  }
  function roundTick() {
    var run = RD && RD.phase === "run" ? RD.run : null;
    if (!run || !run.limit) return;
    if (run.since) {
      var el = runElapsed(run);
      if (el >= run.limit * 1000) {
        run.elapsed = run.limit * 1000; run.since = 0; run.timeUp = true;
        saveRound(false); roundRender(false); return;
      }
      saveRound(true);
    }
    var c = document.getElementById("rclock");
    if (c) c.textContent = fmtClock(Math.ceil((run.limit * 1000 - runElapsed(run)) / 1000));
  }
  window.__roundAdvance = function (sec) { tOff += sec * 1000; roundTick(); };   // test hook: fake the passing of time

  function roundStart(mode) {
    if (!validMode(mode)) return;
    var ids = modeIds(mode);
    if (!ids.length) return;
    var run = { mode: mode, ids: ids, i: 0, results: [], ticks: qPoints(getBoard(ids[0])).map(function () { return false; }), rev: false,
      elapsed: 0, since: 0, at: Date.now() };
    if (mode === "mock") { run.limit = totalMarks(ids) * MIN_PER_MARK; run.timeUp = false; run.since = nowMs(); }
    RD = { run: run, phase: "run" };
    saveRound(false);
    if (location.hash === BASE + "/round/run") route(false); else location.hash = BASE + "/round/run";
  }
  function roundNext() {
    var run = RD.run, q = getBoard(run.ids[run.i]), pts = qPoints(q), got = 0;
    pts.forEach(function (x, k) { if (run.ticks[k]) got += +x.marks || 0; });
    run.results.push({ id: q.id, got: got, of: q.marks }); run.resumed = false;
    var st = load();
    st.boardAt[q.id] = Date.now();
    if (got >= q.marks) { st.board[q.id] = "got"; save(); }
    else { st.board[q.id] = "practice"; bankAdd("b|" + CHID + "|" + q.id, "below full marks"); }
    if (run.i < run.ids.length - 1) {
      run.i++; run.rev = false; run.ticks = qPoints(getBoard(run.ids[run.i])).map(function () { return false; });
      saveRound(false); roundRender(true);
    } else roundFinish();
  }
  function roundFinish() {
    var run = RD.run, rs = RS(), got = 0, of = 0, now = Date.now();
    run.results.forEach(function (r) { got += r.got; of += r.of; });
    rebase(run);
    var rec = { mode: run.mode, ids: run.ids, results: run.results, got: got, of: of, pct: pctOf(got, of), date: today(), at: now, newlyComplete: false };
    if (run.limit) { rec.secs = Math.min(Math.round(run.elapsed / 1000), run.limit); rec.limit = run.limit; rec.timeUp = !!run.timeUp; }
    var m = isObj(rs.modes[run.mode]) ? rs.modes[run.mode] : (rs.modes[run.mode] = {});
    m.last = { got: got, of: of, pct: rec.pct, date: rec.date, at: now };
    if (!isObj(m.best) || rec.pct > m.best.pct) m.best = { got: got, of: of, pct: rec.pct, date: rec.date };
    var full = run.ids.length === CH.board.length && (run.mode === "most" || run.mode === "mock");
    if (full) {
      rs.bestFull = Math.max(rs.bestFull, rec.pct);
      if (got * 100 >= PASS_PCT * of) { if (!rs.complete) rec.newlyComplete = true; rs.complete = true; }
    }
    rec.full = full;
    rs.last = rec; rs.run = null; rs.runDel = now; save({ immediate: true }); updateChrome();
    RD = { run: null, phase: "result", rec: rec };
    roundRender(true);
  }

  /* ---------- board round: pages ---------- */
  function roundPickerView() {
    setHeader("Board round", BASE, { tab: "map" });
    var rs = RS(), run = roundRestore(), f = isFocus(), n = CH.board.length, tm = totalMarks(modeIds("most"));
    var h = '<div class="card round-intro' + (f ? " dense" : "") + '">' + (f ? "" : '<div class="r-art" aria-hidden="true">' + ICON.trophy.replace('width="28" height="28"', 'width="64" height="64"') + "</div>") +
      '<div class="grow"><h2>Board round</h2><p class="small muted">' + n + " real board questions from Chapter " + CH.number + ", marked by you against examiner points. Try it any time.</p></div></div>";
    h += '<div class="card round-status" data-complete="' + roundComplete() + '">' + (roundComplete() ? '<p class="status-line">' + badgeHTML("page") + "</p>" :
      '<p class="status-line"><b>Chapter ' + CH.number + " is not complete yet.</b></p>") +
      '<p class="small muted">' + (roundComplete() ? "Keep practising to raise your best score." : "Score " + PASS_PCT + "% or more on a full round (Most asked first or Timed mock) to complete the chapter. By-marks rounds never count towards it.") + "</p></div>";
    if (run) {
      h += '<div class="card resume-card"><div class="row"><span class="num">' + ICON.play + '</span><div class="grow"><b>Round in progress</b><br><span class="small muted">' + esc(MODE_NAME[run.mode]) + " · question " + (run.i + 1) + " of " + run.ids.length + '</span></div></div>' +
        '<div class="actions two"><button type="button" class="btn ghost" data-act="round-discard">Discard</button><a class="btn primary" href="' + BASE + '/round/run">Resume</a></div></div>';
    }
    h += '<div class="card rmode" data-mode-card="marks"><h2>By marks</h2><p class="small muted">Practise one kind of question at a time.</p><div class="mk-grid">' +
      [1, 2, 3, 4].map(function (m) {
        var c = CH.board.filter(function (b) { return b.marks === m; }).length;
        return '<button type="button" class="mk" data-act="round-start" data-mode="m' + m + '"' + (c ? "" : " disabled") + '><b>' + marksWord(m) + '</b><span class="small muted">' + c + (c === 1 ? " question" : " questions") + "</span>" + scoreLine("m" + m) + "</button>";
      }).join("") + "</div></div>";
    h += '<div class="card rmode" data-mode-card="most"><div class="row"><div class="grow"><h2>Most asked first</h2><p class="small muted">All ' + n + " questions. Topics the papers ask most come first.</p>" + scoreLine("most") +
      '</div></div><button type="button" class="btn primary block" data-act="round-start" data-mode="most">Start</button></div>';
    h += '<div class="card rmode" data-mode-card="mock"><div class="row"><div class="grow"><h2>Timed mock</h2><p class="small muted">All ' + n + ' questions, 1-mark ones first, then 2, 3 and 4. <b class="mockinfo">' + tm + " marks · " + fmtDur(tm * MIN_PER_MARK) + "</b> (1.5 minutes a mark).</p>" + scoreLine("mock") +
      '</div></div><button type="button" class="btn primary block" data-act="round-start" data-mode="mock">Start the clock</button></div>';
    if (run) h += '<p class="note">Starting a new round replaces the one in progress.</p>';
    app.innerHTML = h;
  }
  function roundRunRoute(rerender) {
    var run = roundRestore();
    if (RD && RD.phase === "result" && !run) { redraw = function () { roundRender(false); }; return roundRender(true); }
    if (!run) {
      if (RS().last) { RD = { run: null, phase: "result", rec: RS().last }; redraw = function () { roundRender(false); }; return roundRender(true); }
      location.hash = BASE + "/round"; return;
    }
    if (!(RD && RD.phase === "run" && RD.run === run)) RD = { run: run, phase: "run" };
    redraw = function () { roundRender(false); };
    roundRender(!rerender);
  }
  function roundOptionsHTML(q) {
    return q.options ? '<ul class="bq-opts">' + q.options.map(function (o) { return "<li>" + fm(o) + "</li>"; }).join("") + "</ul>" : "";
  }
  function pointsHTML(q, ticks, attr) {
    var pts = qPoints(q), got = 0;
    pts.forEach(function (x, k) { if (ticks[k]) got += +x.marks || 0; });
    return '<div class="pts"><b>Examiner points</b><p class="small muted">Tick each point you earned on paper.</p><ul class="plist">' + pts.map(function (x, k) {
      return '<li><button type="button" class="ptick' + (ticks[k] ? " on" : "") + '" role="checkbox" aria-checked="' + !!ticks[k] + '" data-act="' + attr + '" data-i="' + k + '">' +
        '<span class="box">' + (ticks[k] ? ICON.checkS : "") + '</span><span class="ptxt">' + fm(x.text) + '</span><span class="pm">' + marksWord(+x.marks) + "</span></button></li>";
    }).join("") + '</ul><p class="rscore" data-got="' + got + '">You scored <b>' + got + " of " + q.marks + "</b></p>" +
      '<p class="small muted">Mark splits follow the board pattern but are our estimate, not the official scheme.</p>' + "</div>";
  }
  function roundRender(scroll) {
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    if (!RD) return roundPickerView();
    var f = isFocus(), h = "";
    if (RD.phase === "result") {
      setHeader("Board round · result", BASE + "/round", { tab: "map" });
      app.innerHTML = roundResultHTML(RD.rec, f);
      if (scroll) window.scrollTo(0, 0);
      return;
    }
    var run = RD.run, q = getBoard(run.ids[run.i]), n = run.ids.length;
    setHeader("Board round · " + (run.i + 1) + " of " + n, BASE + "/round", { tab: "map" });
    h += steps(n, run.i);
    h += '<p class="small muted center rmeta">' + esc(MODE_NAME[run.mode]) + " · question " + (run.i + 1) + " of " + n + (run.resumed ? " · picking up where you left off" : "") + "</p>";
    if (run.limit) {
      var left = Math.ceil((run.limit * 1000 - runElapsed(run)) / 1000), paused = !run.since && !run.timeUp;
      h += '<div class="card rtimer' + (paused ? " paused" : "") + (run.timeUp ? " up" : "") + '"><div class="rt-main"><span id="rclock" class="rt-clock" role="timer" aria-label="Time left">' + fmtClock(left) + '</span><span class="small muted">of ' + fmtDur(run.limit) + "</span></div>" +
        (run.timeUp ? "" : '<button type="button" class="btn ghost sm" data-act="' + (paused ? "round-resume" : "round-pause") + '">' + (paused ? "Resume" : "Pause") + "</button>") + "</div>";
      if (run.timeUp) h += '<div class="fb timeup" role="status"><b>Time\'s up — finish marking</b><div class="small">Your answers are kept. Mark the questions you have written, then see your result.</div></div>';
      if (paused) {
        h += '<div class="card center"><h2>Paused</h2><p class="muted">The clock is stopped and the question is hidden. Press Resume when you are ready.</p></div>';
        app.innerHTML = h; if (scroll) window.scrollTo(0, 0);
        return;
      }
    }
    h += '<article class="card rq" data-q="' + esc(q.id) + '"><div class="bq-top">' + tag(boardTag(q)) + '<span class="marks">' + marksWord(q.marks) + "</span>" + (q.kind ? '<span class="kind">' + esc(q.kind) + "</span>" : "") + "</div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>" + roundOptionsHTML(q);
    if (!run.rev) {
      h += '<p class="rinst">Write your answer on paper first.</p><button type="button" class="btn primary block" data-act="round-reveal">I\'ve written my answer</button>';
    } else {
      h += '<div class="answer"><b>Model answer</b><p>' + fm(q.answer) + "</p></div>" + pointsHTML(q, run.ticks, "round-tick") +
        '<button type="button" class="btn primary block" data-act="round-next">' + (run.i < n - 1 ? "Next question" : "See result") + "</button>";
    }
    h += "</article>";
    h += '<div class="center"><button type="button" class="btn ghost sm" data-act="round-discard">Stop this round</button></div>';
    app.innerHTML = h;
    if (scroll) window.scrollTo(0, 0);
    if (run.limit && run.since && !run.timeUp) rTimer = setInterval(roundTick, 1000);
  }
  function roundResultHTML(rec, f) {
    var missed = rec.results.filter(function (r) { return r.got < r.of; });
    var h = '<div class="card result rres ' + (rec.pct >= PASS_PCT ? "pass" : "fail") + (f ? " dense" : "") + '">' +
      (!f && rec.newlyComplete ? '<div class="r-art" aria-hidden="true">' + ICON.trophy.replace('width="28" height="28"', 'width="56" height="56"') + "</div>" : "") +
      '<p class="small muted">' + esc(MODE_NAME[rec.mode]) + '</p><div class="score" data-score="' + rec.got + "/" + rec.of + '">' + rec.got + " / " + rec.of + '</div><p class="rpct"><b>' + rec.pct + "%</b> of the marks you attempted</p>";
    if (rec.limit) h += '<p class="rtime">Time taken: <b>' + fmtDur(rec.secs) + "</b> of " + fmtDur(rec.limit) + (rec.timeUp ? ". Time ran out." : ".") + "</p>";
    if (rec.newlyComplete) h += '<p class="rdone"><b>Chapter ' + CH.number + " complete.</b> " + badgeHTML("result") + "</p>";
    else if (rec.full && rec.pct < PASS_PCT && !roundComplete()) h += '<p class="small muted">Score ' + PASS_PCT + "% or more on a full round to complete the chapter.</p>";
    else if (!rec.full) h += '<p class="small muted">This round does not count towards chapter completion.</p>';
    h += '<ul class="res-list rlist">' + rec.results.map(function (r) {
      var q = getBoard(r.id), ok = r.got >= r.of;
      return '<li class="' + (ok ? "ok" : "no") + '"><span class="ri">' + (ok ? ICON.checkS : ICON.cross) + '</span><span class="grow">' + esc(q ? boardTag(q) : r.id) + '</span><b>' + r.got + " of " + r.of + "</b></li>";
    }).join("") + "</ul>";
    if (missed.length) h += '<p class="small muted">' + missed.length + " question" + (missed.length > 1 ? "s" : "") + " below full marks " + (missed.length > 1 ? "are" : "is") + " in your mistake bank for tomorrow.</p>";
    h += "</div>";
    h += '<div class="stack">' + (missed.length ? '<a class="btn primary block" href="#/review/round">Review these (' + missed.length + ")</a>" : "") +
      '<button type="button" class="btn ' + (missed.length ? "ghost" : "primary") + ' block" data-act="round-start" data-mode="' + esc(rec.mode) + '">Practise this again</button>' +
      '<a class="btn ghost block" href="' + BASE + '/round">Back to Board round</a></div>';
    return h;
  }

  /* ---------- derivations ---------- */
  function shuffle3(id, idx, n) {   // deterministic position for the correct line
    var x = 0, s = id + idx;
    for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 9973;
    return x % n;
  }
  function stepOptions(d, idx) {
    var st = d.steps[idx], pos = shuffle3(d.id, idx, 3), opts = st.wrong.slice(0, 2);
    opts.splice(pos, 0, st.line);
    return { opts: opts, correct: pos };
  }
  function deriveListView() {
    setHeader("Derivation drills", BASE, { xp: true, tab: "map" });
    var h = '<div class="card"><p>Build each derivation one line at a time. At every step pick the correct next line from three. Slips go to your mistake bank.</p></div>';
    h += CH.derivations.map(function (d) {
      var s = stopById(d.stop);
      return '<div class="card"><h2>' + fm(d.title) + "</h2>" +
        '<p class="small muted">Stop ' + (stopIndex(d.stop) + 1) + ": " + esc(s.title) + " · Textbook p. " + d.page + " · " + d.steps.length + " steps</p>" +
        (d.asked.length ? '<div class="tags">' + d.asked.map(function (a) { return tag("Asked " + a); }).join("") + "</div>" :
          '<p class="small muted">Not asked in the papers we have (2024 paper not available).' + (d.related ? " Related questions: " + d.related.join(", ") + "." : "") + "</p>") +
        '<a class="btn primary block" style="margin-top:12px" href="' + BASE + "/derive/" + d.id + '">Start drill</a></div>';
    }).join("");
    app.innerHTML = h;
  }
  function drillStart(id) {
    var d = getDeriv(id);
    if (!d) return errorView("That derivation doesn't exist.");
    D = { d: d, i: 0, slips: 0, slipped: false, wrongPicks: [], done: false };
    redraw = drillRender; drillRender();
  }
  function drillRender() {
    var d = D.d;
    setHeader("Drill · " + plain(d.title), BASE + "/derive", { xp: true, tab: "map" });
    var h = steps(d.steps.length, D.i);
    h += '<div class="card"><h2>' + fm(d.title) + '</h2><p class="small muted">Textbook p. ' + d.page + "</p><p>" + fm(d.given) + "</p></div>";
    if (!D.done) {
      if (D.i > 0) {
        h += '<div class="card"><ol class="dlines">' + d.steps.slice(0, D.i).map(function (s) { return "<li>" + fm(s.line) + (s.note ? '<div class="small muted">' + fm(s.note) + "</div>" : "") + "</li>"; }).join("") + "</ol></div>";
      }
      var o = stepOptions(d, D.i);
      h += '<div class="card check-card"><div class="check-head"><span class="pill">Step ' + (D.i + 1) + " of " + d.steps.length + '</span><span class="muted small">Pick the correct next line</span></div><div class="opts">' +
        o.opts.map(function (t, k) {
          var wr = D.wrongPicks.indexOf(k) >= 0;
          return '<button type="button" class="opt' + (wr ? " wrong" : "") + '" data-act="drill-pick" data-i="' + k + '"' + (wr ? " disabled" : "") + '><span class="ltr">' + "ABC".charAt(k) + "</span><span>" + fm(t) + "</span></button>";
        }).join("") + "</div>" +
        (D.wrongPicks.length ? '<div class="fb bad" role="status"><b>Not this one.</b> Look at what the last line gave you and try another option.</div>' : "") + "</div>";
    } else {
      h += '<div class="card result pass"><h2>Full derivation</h2>' +
        '<ol class="dlines full">' + d.steps.map(function (s) { return "<li>" + fm(s.line) + (s.note ? '<div class="small muted">' + fm(s.note) + "</div>" : "") + "</li>"; }).join("") + "</ol>" +
        '<p class="muted">' + (D.slips ? D.slips + " step" + (D.slips > 1 ? "s" : "") + " needed another try. Added to your mistake bank." : "No slips. Well done.") + "</p>" +
        (d.asked.length ? '<div class="tags">' + d.asked.map(function (a) { return tag("Asked " + a); }).join("") + "</div>" : "") + "</div>" +
        '<div class="stack"><button type="button" class="btn primary block" data-act="drill-again">Drill again</button><a class="btn ghost block" href="' + BASE + '/derive">All derivations</a></div>';
    }
    app.innerHTML = h;
  }
  function drillPick(k) {
    var d = D.d, o = stepOptions(d, D.i);
    if (k === o.correct) {
      D.i++; D.wrongPicks = []; D.slipped = false;
      if (D.i >= d.steps.length) {
        D.done = true;
        var dr = load().drill[d.id] || { runs: 0, clean: false };
        dr.runs++; dr.last = today(); if (!D.slips) dr.clean = true;
        load().drill[d.id] = dr; save();
      }
    } else {
      D.wrongPicks.push(k);
      if (!D.slipped) { D.slipped = true; D.slips++; bankAdd("d|" + CHID + "|" + d.id + "|" + D.i, "slip"); }
    }
    drillRender();
  }

  /* ---------- formula card ---------- */
  function formulasView() {
    setHeader("Formula card · Ch 1", null, { xp: true, tab: "formulas" });
    var h = '<div class="card fhead"><div class="row"><p class="grow">Every Chapter 1 formula, grouped by stop, with the textbook page. Balbharati notation.</p>' +
      '<button type="button" class="btn ghost noprint" data-act="print">Print</button></div></div>';
    h += CH.formulas.map(function (g) {
      var s = stopById(g.stop);
      return '<section class="card fgroup"><h2><a href="' + BASE + "/" + s.id + '">' + (stopIndex(s.id) + 1) + ". " + esc(s.title) + "</a></h2>" +
        g.items.map(function (f) {
          return '<div class="frm"><div class="fn">' + esc(f.n) + '<span class="fp">p. ' + f.p + "</span></div><div class=\"ff\">" + fm(f.f) + "</div>" +
            (f.s ? '<div class="fs">' + fm(f.s) + "</div>" : "") + "</div>";
        }).join("") + "</section>";
    }).join("");
    app.innerHTML = h;
  }

  /* ---------- review ---------- */
  function itemLabel(id) {
    var p = parseId(id);
    if (p.kind === "c") { var s = stopById(p.a), c = s.quest.checks[+p.b]; return "Stop " + (stopIndex(s.id) + 1) + ", check " + (+p.b + 1) + ": " + plain(c.q); }
    if (p.kind === "d") { var d = getDeriv(p.a); return "Derivation: " + plain(d.title) + ", step " + (+p.b + 1); }
    var b = getBoard(p.a); return "Board " + boardTag(b) + ": " + plain(b.text);
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }
  function reviewStart() {
    var ids = dueIds().filter(itemExists);
    R = { queue: ids, i: 0, ok: 0, bad: 0, ce: null, ds: null, shown: false };
    redraw = reviewRender;
    reviewSetup(); reviewRender();
  }
  function reviewSetup() {
    R.shown = false; R.ds = null; R.ce = null; R.ticks = [];
    if (R.i >= R.queue.length) return;
    var p = parseId(R.queue[R.i]);
    if (p.kind === "c") R.ce = newCE(stopById(p.a).quest.checks[+p.b], "review");
    if (p.kind === "d") R.ds = { picked: null };
    if (p.kind === "b") R.ticks = qPoints(getBoard(p.a)).map(function () { return false; });
  }
  function reviewByPoints(id) { var it = load().bank[id]; return !!(it && it.reason === "below full marks"); }
  function reviewRoundStart() {
    var rec = RS().last, ids = [];
    if (rec && Array.isArray(rec.results)) ids = rec.results.filter(function (r) { return r.got < r.of; }).map(function (r) { return "b|" + CHID + "|" + r.id; }).filter(function (id) { return itemExists(id) && load().bank[id]; });
    R = { queue: ids, i: 0, ok: 0, bad: 0, ce: null, ds: null, shown: false, ticks: [] };
    redraw = reviewRender;
    reviewSetup(); reviewRender();
  }
  function reviewRender() {
    setHeader("Review", null, { tab: "review" });
    var h = "";
    if (!R.queue.length) {
      var nd = nextDueDate(), n = bankIds().length;
      h += '<div class="card center empty"><h2>' + (nd ? "Nothing due — next review on " + niceDate(nd) : "Nothing due") + "</h2>" +
        '<p class="muted">' + (n ? "Your mistake bank has " + n + " item" + (n > 1 ? "s" : "") + " waiting for their day." : "Your mistake bank is empty. Wrong answers and “Need practice” questions will show up here.") + "</p>" +
        (n ? '<a class="btn ghost" href="#/review/all">See all items in the bank</a>' : '<a class="btn primary" href="' + BASE + '">Go to the map</a>') + "</div>";
    } else if (R.i >= R.queue.length) {
      var nd2 = nextDueDate();
      h += '<div class="card result pass"><div class="score">' + R.ok + "/" + R.queue.length + "</div><h2>Review done</h2>" +
        '<p class="muted">' + R.ok + " correct" + (R.bad ? ", " + R.bad + " to try again tomorrow" : "") + ". " + (nd2 ? "Next review on " + niceDate(nd2) + "." : "Your mistake bank is now empty.") + "</p></div>" +
        '<div class="stack"><a class="btn primary block" href="#/">Home</a><a class="btn ghost block" href="#/review/all">See all items in the bank</a></div>';
    } else {
      var id = R.queue[R.i], p = parseId(id);
      h += steps(R.queue.length, R.i);
      h += '<p class="muted small center">Item ' + (R.i + 1) + " of " + R.queue.length + "</p>";
      h += '<div class="rtags center">' + reasonTag(id) + (load().bank[id] && load().bank[id].prio ? ' <span class="small muted">You were sure but wrong, so this comes first.</span>' : "") + "</div>";
      if (p.kind === "c") h += ceHTML(R.ce, "Re-check");
      else if (p.kind === "d") h += reviewDrillHTML(getDeriv(p.a), +p.b);
      else h += reviewBoardHTML(getBoard(p.a));
    }
    app.innerHTML = h;
    window.scrollTo(0, 0);
  }
  function reviewDrillHTML(d, idx) {
    var o = stepOptions(d, idx), ds = R.ds, h = "";
    h += '<div class="card"><h2>' + fm(d.title) + '</h2><p class="small muted">Textbook p. ' + d.page + "</p><p>" + fm(d.given) + "</p>";
    if (idx > 0) h += '<ol class="dlines">' + d.steps.slice(0, idx).map(function (s) { return "<li>" + fm(s.line) + "</li>"; }).join("") + "</ol>";
    h += "</div>";
    var locked = ds.picked != null;
    h += '<div class="card check-card"><div class="check-head"><span class="pill">Step ' + (idx + 1) + " of " + d.steps.length + '</span><span class="muted small">Pick the correct next line</span></div><div class="opts">' +
      o.opts.map(function (t, k) {
        var cls = "opt";
        if (locked && ds.picked === k) cls += k === o.correct ? " right" : " wrong";
        if (locked && k === o.correct) cls += " right";
        return '<button type="button" class="' + cls + '" data-act="rv-pick" data-i="' + k + '"' + (locked ? " disabled" : "") + '><span class="ltr">' + "ABC".charAt(k) + "</span><span>" + fm(t) + "</span></button>";
      }).join("") + "</div>";
    if (locked) h += '<div class="fb ' + (ds.picked === o.correct ? "good" : "bad") + '" role="status"><b>' + (ds.picked === o.correct ? "Correct." : "Not this one.") + "</b> " + (d.steps[idx].note ? fm(d.steps[idx].note) : "The correct line is marked.") + '</div><button type="button" class="btn primary block" data-act="rv-next">Next</button>';
    return h + "</div>";
  }
  function reviewBoardHTML(q) {
    var h = '<div class="card"><div class="bq-top">' + tag(boardTag(q)) + '<span class="marks">' + q.marks + (q.marks === 1 ? " mark" : " marks") + "</span></div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>";
    if (q.options) h += '<ul class="bq-opts">' + q.options.map(function (o) { return "<li>" + fm(o) + "</li>"; }).join("") + "</ul>";
    if (reviewByPoints("b|" + CHID + "|" + q.id)) {
      if (!R.shown) h += '<p class="rinst">Write your answer on paper first.</p><button type="button" class="btn primary block" data-act="rv-written">I\'ve written my answer</button>';
      else h += '<div class="answer"><b>Model answer</b><p>' + fm(q.answer) + "</p></div>" + pointsHTML(q, R.ticks, "rv-tick") + '<button type="button" class="btn primary block" data-act="rv-score">Done</button>';
      return h + "</div>";
    }
    if (!R.shown) h += '<button type="button" class="btn primary block" data-act="rv-show">Show model answer</button>';
    else h += '<div class="answer"><b>Model answer</b><p>' + fm(q.answer) + '</p></div><p class="small muted">How did you do without looking?</p><div class="rate"><button type="button" class="btn ok" data-act="rv-got">Got it</button><button type="button" class="btn warn ghost" data-act="rv-need">Need practice</button></div>';
    return h + "</div>";
  }
  function reviewKeep() { var y = window.scrollY; reviewRender(); window.scrollTo(0, y); }
  function reviewAdvance(ok) {
    bankReview(R.queue[R.i], ok);
    if (ok) R.ok++; else R.bad++;
    R.i++;
    reviewSetup(); reviewRender();
  }
  function bankListView() {
    setHeader("Mistake bank", "#/review", { tab: "review" });
    var st = load(), ids = bankIds().filter(itemExists).sort(function (a, b) {
      if (!!st.bank[a].prio !== !!st.bank[b].prio) return st.bank[a].prio ? -1 : 1;
      return st.bank[a].due < st.bank[b].due ? -1 : st.bank[a].due > st.bank[b].due ? 1 : 0;
    });
    var t = today(), h = "";
    if (!ids.length) h = '<div class="card center"><h2>The bank is empty</h2><p class="muted">Wrong answers and “Need practice” questions will appear here.</p></div>';
    else {
      h += '<div class="card"><p class="muted small">' + ids.length + " item" + (ids.length > 1 ? "s" : "") + '. Each correct review pushes an item out; two correct reviews in a row remove it.</p><ul class="list bank">' +
        ids.map(function (id) {
          var it = st.bank[id], due = it.due <= t ? "Due now" : "Due " + niceDate(it.due);
          return '<li class="bank-row"><div class="grow"><div class="bt">' + esc(trunc(itemLabel(id), 110)) + '</div><div class="small muted">' + reasonTag(id) + ' <span class="pill ' + (it.due <= t ? "amber" : "") + '">' + due + "</span> " + (it.streak || 0) + " of 2 correct reviews</div></div>" +
            '<button type="button" class="btn ghost sm" data-act="bank-remove" data-id="' + esc(id) + '" aria-label="Remove from bank">Remove</button></li>';
        }).join("") + "</ul></div>";
    }
    app.innerHTML = h;
  }

  /* ---------- my notes ---------- */
  function notesText() {
    var st = load(), out = ["HSC Physics, Chapter " + CH.number + ": " + CH.title + " (my notes)", ""];
    CH.stops.forEach(function (s, i) {
      var v = st.notes[K(s.id)];
      if (v && v.trim()) { out.push((i + 1) + ". " + s.title); out.push(v.trim()); out.push(""); }
    });
    return out.join("\n");
  }
  function notesView() {
    setHeader("My notes", null, { tab: "notes" });
    var st = load(), any = CH.stops.filter(function (s) { return st.notes[K(s.id)] && st.notes[K(s.id)].trim(); });
    var h = "";
    if (!any.length) {
      h = '<div class="card center"><h2>No notes yet</h2><p class="muted">Open any stop and write in the notes box. ' + noteSyncCopy() + '.</p><a class="btn primary" href="' + BASE + '">Go to the map</a></div>';
    } else {
      h += '<div class="card"><p class="muted small">' + (SYNC && SYNC.isLinked() ? "Synced across your devices." : "Saved on this device only. Nothing is uploaded.") + '</p><div class="actions two"><button type="button" class="btn primary" data-act="notes-copy">Copy all</button><button type="button" class="btn ghost" data-act="notes-dl">Download .txt</button></div><p id="notes-msg" class="small muted" role="status"></p></div>';
      h += any.map(function (s) {
        return '<div class="card"><h2><a href="' + BASE + "/" + s.id + '">' + (stopIndex(s.id) + 1) + ". " + esc(s.title) + "</a></h2><p class=\"note-text\">" + esc(st.notes[K(s.id)].trim()) + "</p></div>";
      }).join("");
    }
    app.innerHTML = h;
  }
  function setNotesMsg(t) { var el = document.getElementById("notes-msg"); if (el) el.textContent = t; }
  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }
  function downloadText(name, text) {
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" }), url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- sync page (#/sync) ---------- */
  var syncMsg = "";
  function syncView() {
    setHeader("Sync across devices", "#/", {});
    if (!SYNC) {
      app.innerHTML = '<div class="card"><p class="muted">Sync module is not loaded.</p></div>';
      return;
    }
    var st = SYNC.getStatus(), c = SYNC.getConfig();
    var notice = syncMsg || st.notice || "";
    var h = "";
    if (st.linked) {
      var pillCls = st.state === "error" || st.state === "offline" ? "amber" : "ok";
      var pillTxt = st.syncing ? "Syncing…" : st.state === "offline" ? "Offline" : st.state === "error" ? "Needs attention" : st.dirty ? "Unsynced changes" : "Synced";
      h += '<div class="card"><div class="row"><div class="grow"><h2>' + esc(st.studentName || "Student") + '</h2><p class="small muted">Last synced: ' + esc(relTime(st.lastSync)) + (st.rev ? " · rev " + st.rev : "") + '</p></div><span class="pill ' + pillCls + '">' + esc(pillTxt) + "</span></div>";
      if (st.error) h += '<div class="fb bad" role="alert">' + esc(st.error) + "</div>";
      if (notice) h += '<p class="small muted" role="status" style="margin-top:8px">' + esc(notice) + "</p>";
      h += '<div class="stack" style="margin-top:12px">' +
        '<button type="button" class="btn primary block" data-act="sync-now"' + (st.syncing ? " disabled" : "") + '>' + (st.syncing ? "Syncing…" : "Sync now") + "</button>" +
        '<button type="button" class="btn ghost block" data-act="sync-copy-link">Copy setup link for another device</button>' +
        '<button type="button" class="btn ghost block" data-act="sync-unlink">Unlink this device</button></div>' +
        '<p class="note">Unlinking only disconnects sync. Your progress stays saved on this device.</p></div>';
    } else {
      h += '<div class="card"><h2>Link this device</h2><p class="small muted">Sync your progress, notes, mistake bank, and board rounds between phone and tablet using your private Google Drive sync link. Your existing progress on this device will be kept.</p>';
      if (st.error) h += '<div class="fb bad" role="alert">' + esc(st.error) + "</div>";
      if (notice) h += '<p class="small warn-t" role="status">' + esc(notice) + "</p>";
      h += '<div class="field" style="margin-top:12px"><label for="sync-url">Sync Web App URL</label><input id="sync-url" class="fin" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(c.url || "") + '"></div>' +
        '<div class="field"><label for="sync-code">Student code</label><div class="pw-row"><input id="sync-code" class="fin" type="password" autocomplete="off" spellcheck="false" placeholder="Enter student code" value="' + esc(c.code || "") + '"><button type="button" class="btn ghost sm" data-act="pw-toggle" data-target="sync-code">Show</button></div></div>' +
        '<button type="button" class="btn primary block" data-act="sync-save">Save &amp; Sync</button></div>';
    }
    h += '<div class="card"><div class="row"><div class="grow"><h2>Parent / Teacher view</h2><p class="small muted">Check live study progress, predicted marks, and mistake bank from your own device.</p></div><a class="btn ghost sm" href="#/teacher">Open</a></div></div>';
    app.innerHTML = h;
  }

  /* ---------- teacher / parent view (#/teacher) ---------- */
  function teacherFetch() {
    if (!SYNC || !SYNC.hasTeacherConfig()) return teacherView();
    TState.loading = true; TState.error = "";
    teacherView();
    SYNC.fetchTeacher().then(function (res) {
      TState.loading = false;
      TState.checkedAt = Date.now();
      if (!res.ok) { TState.error = res.error || "Could not load student status."; }
      else { TState.data = res; TState.error = ""; }
      if (location.hash === "#/teacher") teacherView();
    });
  }
  function teacherStudentHTML(entry) {
    var name = entry.name || entry.id || "Student";
    if (!entry.state) {
      return '<div class="card"><h2>' + esc(name) + '</h2><p class="muted">No progress synced yet. Link the student\'s device first.</p></div>';
    }
    var st = normalizeState(entry.state);
    var pl = planInfo(st), prog = chapterProgress(st), dt = doneToday(st), strk = streak(st), left = daysLeft(catalog.examDate);
    var due = dueIds(st).filter(itemExists);
    var prio = bankIds(st).filter(function (id) { return itemExists(id) && st.bank[id] && st.bank[id].prio; });
    var cleanDrills = CH.derivations.filter(function (d) { return drillClean(d.id, st); }).length;
    var planLabel = pl.status === "on" ? "On track" : pl.status === "ahead" ? "Ahead by " + pl.n : "Behind by " + pl.n;

    var h = '<div class="card"><div class="t-head"><div class="grow"><h2>' + esc(name) + '</h2>' +
      '<p class="small muted">Student last synced: <b>' + esc(relTime(entry.updatedAt)) + '</b>' + (entry.updatedAt ? " · " + esc(new Date(entry.updatedAt).toLocaleString()) : "") + "</p></div>" +
      '<span class="pill plan-pill" data-plan="' + pl.status + '">' + esc(planLabel) + "</span></div></div>";

    h += '<div class="t-grid">' +
      '<div class="t-kpi"><b>' + Math.min(dt, pl.pace) + "/" + pl.pace + '</b><span>stops today</span></div>' +
      '<div class="t-kpi"><b>' + strk + ' d</b><span>streak</span></div>' +
      '<div class="t-kpi"><b>' + st.xp + '</b><span>XP</span></div>' +
      '<div class="t-kpi"><b>' + left + ' d</b><span>to board exam</span></div></div>';

    h += gaugeHTML(st);

    h += '<div class="card"><h2>Chapter ' + CH.number + ": " + esc(CH.title) + '</h2>' +
      '<div class="row"><div class="grow"><div class="bar"><i style="width:' + prog.pct + '%"></i></div></div><b>' + prog.done + "/" + prog.total + ' stops (' + prog.pct + "%)</b></div>" +
      '<p class="small muted" style="margin-top:8px">Derivation drills clean: <b>' + cleanDrills + " of " + CH.derivations.length + "</b> · Board round best: <b>" + (st.round.bestFull ? st.round.bestFull + "%" : "Not tried") + "</b></p>" +
      (roundComplete(st) ? '<div class="cb-row">' + badgeHTML("teacher", st) + "</div>" : "") +
      (st.round.last ? '<p class="small muted" style="margin-top:6px">Last board round: ' + esc(MODE_NAME[st.round.last.mode] || st.round.last.mode) + " — <b>" + st.round.last.got + "/" + st.round.last.of + " (" + st.round.last.pct + "%)</b> on " + esc(niceDate(st.round.last.date)) + "</p>" : "");

    var doneStops = CH.stops.filter(function (s) { return isDone(s.id, st); });
    if (doneStops.length) {
      h += '<details class="how"><summary>Completed stops (' + doneStops.length + ')</summary><ul class="t-list">' +
        doneStops.map(function (s) {
          return '<li><span>' + (stopIndex(s.id) + 1) + ". " + esc(s.title) + '</span><span class="small muted">' + esc(niceDate(st.done[K(s.id)])) + "</span></li>";
        }).join("") + "</ul></details>";
    }
    h += "</div>";

    h += '<div class="card"><h2>Mistake bank watchlist</h2><p class="small muted"><b>' + bankIds(st).filter(itemExists).length + "</b> items in bank · <b>" + due.length + "</b> due now · <b>" + prio.length + "</b> confident mistakes (priority)</p>";
    if (prio.length) {
      h += '<ul class="t-list">' + prio.slice(0, 8).map(function (id) {
        return '<li><span>' + esc(trunc(itemLabel(id), 100)) + '</span>' + reasonTag(id, st) + "</li>";
      }).join("") + "</ul>";
    } else {
      h += '<p class="small muted">No confident-mistake alerts right now.</p>';
    }
    h += "</div>";

    var noted = CH.stops.filter(function (s) { return st.notes[K(s.id)] && st.notes[K(s.id)].trim(); });
    if (noted.length) {
      h += '<div class="card"><details class="t-notes"><summary>Student notes (' + noted.length + ' stops)</summary>' +
        noted.map(function (s) {
          return '<div style="margin-top:10px"><b>' + (stopIndex(s.id) + 1) + ". " + esc(s.title) + '</b><p class="note-text small muted">' + esc(st.notes[K(s.id)].trim()) + "</p></div>";
        }).join("") + "</details></div>";
    }
    return h;
  }
  function teacherView() {
    setHeader("Parent / Teacher view", "#/", {});
    if (!SYNC) {
      app.innerHTML = '<div class="card"><p class="muted">Sync module is not loaded.</p></div>';
      return;
    }
    var c = SYNC.getConfig();
    if (!SYNC.hasTeacherConfig()) {
      var st = SYNC.getStatus();
      var h = '<div class="card"><h2>Connect Parent / Teacher view</h2><p class="small muted">View live student progress from Google Drive without affecting your own device\'s study data.</p>';
      if (TState.error || st.notice) h += '<div class="fb bad" role="alert">' + esc(TState.error || st.notice) + "</div>";
      h += '<div class="field" style="margin-top:12px"><label for="t-url">Sync Web App URL</label><input id="t-url" class="fin" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(c.url || "") + '"></div>' +
        '<div class="field"><label for="t-key">Teacher key</label><div class="pw-row"><input id="t-key" class="fin" type="password" autocomplete="off" spellcheck="false" placeholder="Enter teacher key"><button type="button" class="btn ghost sm" data-act="pw-toggle" data-target="t-key">Show</button></div></div>' +
        '<button type="button" class="btn primary block" data-act="t-connect">Connect</button></div>';
      app.innerHTML = h;
      return;
    }
    var out = '<div class="card"><div class="t-head"><div class="grow"><h2>Live status</h2><p class="small muted">' +
      (TState.loading ? "Checking Google Drive…" : TState.checkedAt ? "Checked " + esc(relTime(TState.checkedAt)) : "Ready") + '</p></div>' +
      '<div class="row"><button type="button" class="btn primary sm" data-act="t-refresh"' + (TState.loading ? " disabled" : "") + '>Refresh</button>' +
      '<button type="button" class="btn ghost sm" data-act="t-signout">Sign out</button></div></div>' +
      (TState.error ? '<div class="fb bad" role="alert">' + esc(TState.error) + "</div>" : "") + "</div>";

    if (TState.data && Array.isArray(TState.data.students)) {
      if (!TState.data.students.length) {
        out += '<div class="card center"><p class="muted">No students configured in Apps Script yet.</p></div>';
      } else {
        out += TState.data.students.map(teacherStudentHTML).join("");
      }
    } else if (!TState.loading && !TState.error) {
      out += '<div class="card center"><p class="muted">Tap Refresh to load the latest student status.</p></div>';
    }
    app.innerHTML = out;
  }

  /* ---------- apply merged remote state safely ---------- */
  function applyRemoteState(merged) {
    var prevRound = mem ? JSON.stringify(mem.round) : "";
    mem = normalizeState(merged);
    save({ fromRemote: true });
    if (RD && JSON.stringify(mem.round) !== prevRound) {
      if (rTimer) { clearInterval(rTimer); rTimer = null; }
      RD = null;
    }
    updateChrome();
    // Never clobber an active note textarea or sync/teacher form inputs
    var ae = document.activeElement;
    var editingInput = ae && (ae.id === "note" || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
    var hash = location.hash || "#/";
    if (!editingInput && hash !== "#/sync" && hash !== "#/teacher") {
      route(true);
    } else if (hash === "#/sync" && SYNC && SYNC.isLinked()) {
      syncView();
    }
  }

  /* ---------- events ---------- */
  function dataI(t) { return +t.getAttribute("data-i"); }
  app.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act]");
    if (!t || !app.contains(t)) return;
    var act = t.getAttribute("data-act"), ce, q;
    var ctxCE = function () { return R && R.ce && location.hash.indexOf("#/review") === 0 ? R.ce : Q && Q.ce; };
    switch (act) {
      case "card-next":
        if (Q.ci < Q.stop.quest.cards.length - 1) Q.ci++; else { Q.phase = "check"; Q.ki = 0; Q.ce = newCE(Q.stop.quest.checks[0], "quest"); }
        saveQuest(); return questRender();
      case "card-prev": if (Q.ci > 0) Q.ci--; saveQuest(); return questRender();
      case "q-replay": return questStart(Q.stop.id, true);
      case "q-over":
        var sid = t.getAttribute("data-stop") || Q.stop.id;
        var qst = load(); delete qst.qp[K(sid)]; qst.qpDel[K(sid)] = Date.now(); save();
        if (Q && Q.stop.id === sid && location.hash === BASE + "/" + sid + "/quest") return questStart(sid, true);
        location.hash = BASE + "/" + sid + "/quest"; return;
      case "ce-pick": ce = ctxCE(); if (ce && ce.status === "ask") { ce.sel = dataI(t); ce.msg = ""; if (ce.mode === "quest") saveQuest(); redraw(); } return;
      case "ce-conf": ce = ctxCE(); if (ce && ce.status === "ask") { syncNum(ce); ce.conf = t.getAttribute("data-v"); ce.msg = ""; if (ce.mode === "quest") saveQuest(); redraw(); } return;
      case "ce-hint": ce = ctxCE(); ce.hint = true; syncNum(ce); if (ce.mode === "quest") saveQuest(); return redraw();
      case "ce-check":
        ce = ctxCE(); syncNum(ce);
        if (ce.chk.type === "num" ? isNaN(parseNum(ce.val)) : ce.sel == null) { ce.msg = ce.chk.type === "num" ? "Type a number first." : "Pick an answer first."; return redraw(); }
        if (!ce.conf) { ce.msg = "Choose Sure or Guessing first."; return redraw(); }
        ce.msg = "";
        var okNow = ceIsCorrect(ce), cid = ce.mode === "quest" ? "c|" + CHID + "|" + Q.stop.id + "|" + Q.ki : R.queue[R.i];
        if (ce.mode === "quest") {
          if (ce.attempt === 0) {   // first try decides what goes to the mistake bank
            if (!okNow) { if (bankAdd(cid, ce.conf === "sure" ? "confident mistake" : "missed")) Q.added++; ce.flag = ce.conf === "sure" ? "sure" : ""; }
            else if (ce.conf === "guess") { if (bankAdd(cid, "guessed")) Q.added++; ce.flag = "guessed"; }
          }
        } else if (!okNow && ce.conf === "sure" && load().bank[cid]) {
          load().bank[cid].prio = true; load().bank[cid].reason = "confident mistake"; load().bank[cid].updatedAt = Date.now(); save();
        }
        ceSubmit(ce);
        if (ce.mode === "quest") saveQuest();
        return redraw();
      case "ce-retry": ce = ctxCE(); ce.attempt = 1; ce.sel = null; ce.val = ""; ce.status = "ask"; ce.conf = null; if (ce.mode === "quest") saveQuest(); return redraw();
      case "ce-next":
        if (R && location.hash.indexOf("#/review") === 0) return reviewAdvance(R.ce.status === "right");
        return questNext();
      case "reveal":
        q = t.closest(".bq"); var qid = q.getAttribute("data-q");
        revealed[qid] = !revealed[qid];
        q.outerHTML = boardCard(getBoard(qid), location.hash.slice(-5) === "board");
        return;
      case "rate-got": case "rate-need":
        q = t.closest(".bq"); var id = q.getAttribute("data-q");
        var bst = load();
        bst.board[id] = act === "rate-got" ? "got" : "need";
        bst.boardAt[id] = Date.now();
        if (act === "rate-need") bankAdd("b|" + CHID + "|" + id, "need practice"); else save();
        q.outerHTML = boardCard(getBoard(id), location.hash.slice(-5) === "board");
        return;
      case "drill-pick": return drillPick(dataI(t));
      case "drill-again": return drillStart(D.d.id);
      case "rv-pick":
        R.ds.picked = dataI(t); return reviewRender();
      case "rv-next": var pd = parseId(R.queue[R.i]); return reviewAdvance(R.ds.picked === stepOptions(getDeriv(pd.a), +pd.b).correct);
      case "rv-show": case "rv-written": R.shown = true; return reviewRender();
      case "rv-tick": R.ticks[dataI(t)] = !R.ticks[dataI(t)]; return reviewKeep();
      case "rv-score":
        var rq = getBoard(parseId(R.queue[R.i]).a), rg = 0;
        qPoints(rq).forEach(function (x, k) { if (R.ticks[k]) rg += +x.marks || 0; });
        return reviewAdvance(rg >= rq.marks);
      case "round-start": return roundStart(t.getAttribute("data-mode"));
      case "round-reveal": RD.run.rev = true; saveRound(false); return roundRender(false);
      case "round-tick": RD.run.ticks[dataI(t)] = !RD.run.ticks[dataI(t)]; saveRound(false); return roundRender(false);
      case "round-next": return roundNext();
      case "round-pause": rebase(RD.run); RD.run.elapsed = runElapsed(RD.run); RD.run.since = 0; saveRound(false); return roundRender(false);
      case "round-resume": RD.run.since = nowMs(); saveRound(false); return roundRender(false);
      case "round-discard":
        if (RS().run) { RS().run = null; RS().runDel = Date.now(); save(); }
        RD = null; if (location.hash === BASE + "/round") return roundPickerView(); location.hash = BASE + "/round"; return;
      case "rv-got": return reviewAdvance(true);
      case "rv-need": return reviewAdvance(false);
      case "bank-remove":
        var bid = t.getAttribute("data-id"), bkst = load();
        delete bkst.bank[bid]; bkst.bankDel[bid] = Date.now(); save(); updateChrome(); return bankListView();
      case "print": return window.print();
      case "notes-copy": return copyText(notesText()).then(function (ok) { setNotesMsg(ok ? "Copied to the clipboard." : "Could not copy. Use Download instead."); });
      case "notes-dl": return setNotesMsg(downloadText("hsc-physics-ch1-notes.txt", notesText()) ? "Downloaded hsc-physics-ch1-notes.txt" : "Could not download on this device.");
      case "pw-toggle":
        var inp = document.getElementById(t.getAttribute("data-target"));
        if (inp) { var show = inp.type === "password"; inp.type = show ? "text" : "password"; t.textContent = show ? "Hide" : "Show"; }
        return;
      case "sync-save":
        if (!SYNC) return;
        syncMsg = ""; SYNC.clearNotice();
        var su = document.getElementById("sync-url"), sc = document.getElementById("sync-code");
        SYNC.linkStudent(su ? su.value : "", sc ? sc.value : "").then(function (res) {
          syncMsg = res.ok ? "Synced with Google Drive." : (res.error || "Could not sync.");
          if (location.hash === "#/sync") syncView();
        });
        return;
      case "sync-now":
        if (!SYNC) return;
        syncMsg = ""; SYNC.clearNotice();
        SYNC.syncNow().then(function (res) {
          syncMsg = res.ok ? "Up to date." : (res.error || "Sync failed.");
          if (location.hash === "#/sync") syncView();
        });
        return;
      case "sync-copy-link":
        if (!SYNC) return;
        var link = SYNC.buildStudentLink();
        if (!link) return;
        return copyText(link).then(function (ok) {
          syncMsg = ok ? "Private setup link copied. Send it only to the student's other device." : "Could not copy link.";
          if (location.hash === "#/sync") syncView();
        });
      case "sync-unlink":
        if (!SYNC) return;
        SYNC.unlinkStudent(); syncMsg = "Device unlinked. Local progress was kept.";
        return syncView();
      case "t-connect":
        if (!SYNC) return;
        SYNC.clearNotice();
        var tu = document.getElementById("t-url"), tk = document.getElementById("t-key");
        var tres = SYNC.setTeacherConfig(tu ? tu.value : "", tk ? tk.value : "");
        if (!tres.ok) { TState.error = tres.error; return teacherView(); }
        TState.error = ""; TState.data = null;
        return teacherFetch();
      case "t-refresh": return teacherFetch();
      case "t-signout":
        if (!SYNC) return;
        SYNC.clearTeacherConfig(); TState = { loading: false, error: "", data: null, checkedAt: 0 };
        return teacherView();
    }
  });
  function syncNum(ce) { var el = document.getElementById("numin"); if (el) ce.val = el.value; }
  app.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "numin") { var ce = R && R.ce && location.hash.indexOf("#/review") === 0 ? R.ce : Q && Q.ce; if (ce) { ce.val = t.value; if (ce.mode === "quest") saveQuest(); } }
    if (t.classList && t.classList.contains("note-ta")) onNoteInput(t);
  });
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "numin") { var b = app.querySelector('[data-act="ce-check"]'); if (b) b.click(); }
  });
  app.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("note-ta")) flushNote(true); });
  window.addEventListener("pagehide", function () { flushNote(true); saveRound(false); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) { flushNote(true); saveRound(false); } });
  document.querySelector(".themebar").addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme-set]");
    if (!b) return;
    load().theme = b.getAttribute("data-theme-set"); save({ silentSync: true }); applyTheme(); route(true);
  });

  document.querySelector(".tabs").addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");     // tapping the tab you are already on restarts that page
    if (a && (location.hash || "#/") === a.getAttribute("href")) route(false);
  });

  /* ---------- router ---------- */
  function route(rerender) {
    flushNote(false);
    var rawHash = (location.hash || "#/").split("?")[0];
    var parts = rawHash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!rerender) window.scrollTo(0, 0);
    redraw = null;
    var p0 = parts[0];
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    if (!(p0 === SUBJ && parts[1] === CHID && parts[2] === "round" && parts[3] === "run")) roundLeave();
    if (!parts.length) return homeView();
    if (p0 === "sync") return syncView();
    if (p0 === "teacher") {
      if (!rerender && SYNC && SYNC.hasTeacherConfig() && !TState.loading) return teacherFetch();
      return teacherView();
    }
    if (p0 === "review") {
      if (parts[1] === "all") return bankListView();
      if (parts[1] === "round") { if (rerender && R) { redraw = reviewRender; return reviewRender(); } return reviewRoundStart(); }
      if (rerender && R) { redraw = reviewRender; return reviewRender(); }
      return reviewStart();
    }
    if (p0 === "notes") return notesView();
    if (p0 === "formulas") return formulasView();
    if (p0 === SUBJ && parts[1] === CHID) {
      var p2 = parts[2], p3 = parts[3];
      if (!p2) return chapterView();
      if (p2 === "board") return boardView();
      if (p2 === "round") {
        if (!p3) { redraw = roundPickerView; return roundPickerView(); }
        if (p3 === "run") return roundRunRoute(rerender);
      }
      if (p2 === "derive") {
        if (!p3) return deriveListView();
        if (rerender && D && D.d.id === p3) { redraw = drillRender; return drillRender(); }
        return drillStart(p3);
      }
      if (p3 === "quest") {
        if (rerender && Q && Q.stop.id === p2) { redraw = questRender; return questRender(); }
        return questStart(p2);
      }
      if (!p3) return stopView(p2);
    }
    location.hash = "#/";
  }

  Promise.all([getJSON("content/catalog.json"), getJSON("content/physics/ch01-rotational-dynamics.json")]).then(function (r) {
    catalog = r[0]; CH = r[1];
    load(); applyTheme();
    if (SYNC) {
      SYNC.init({
        getState: function () { return load(); },
        applyState: applyRemoteState,
        onStatus: function () {
          updateSyncPill();
          if (location.hash === "#/sync" && SYNC.isLinked()) syncView();
        }
      });
    }
    window.addEventListener("hashchange", function () { route(false); });
    route(false);
  }).catch(function (e) {
    errorView("Could not load the portal (" + e.message + "). Check your connection and refresh.");
  });
})();
