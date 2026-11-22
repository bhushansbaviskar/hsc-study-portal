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
  var catalog = null, CH = null;
  var redraw = null;               // re-renders the interactive view currently on screen
  var Q = null, R = null, D = null; // quest, review and drill sessions (in memory)
  var revealed = {};               // board answers shown this session

  /* ---------- icons ---------- */
  var ICON = {
    flame: '<svg class="flame" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M12 2c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-2.5 1-4 2.5-5.5C9 10.5 10 11.5 11 12c-.5-4-.5-7 1-10z" fill="#BA7517"/><path d="M12 21a3.5 3.5 0 0 1-3.5-3.5c0-2 1.8-3 3.5-5 1.7 2 3.5 3 3.5 5A3.5 3.5 0 0 1 12 21z" fill="#FAEEDA"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    checkS: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M13 2L5 13.5h6L10 22l9-12h-6z" fill="currentColor"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- storage (never throws) ---------- */
  var mem = null;
  function blank() { return { v: 2, done: {}, xp: 0, quest: {}, bank: {}, notes: {}, board: {}, theme: "quest", qp: {}, drill: {}, planStart: "" }; }
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
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
    var b = blank();
    for (var k in b) if (s[k] == null || typeof s[k] !== typeof b[k]) s[k] = b[k];
    if (s.theme !== "quest" && s.theme !== "focus") s.theme = "quest";
    s.v = 2;
    if (!s.planStart) { s.planStart = today(); fresh = true; }   // plan clock starts the first time the app runs
    mem = s;
    if (fresh) save();
    return mem;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(mem)); } catch (e) { /* keep in memory only */ }
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
  function daysLeft(dateStr) {
    return Math.max(0, Math.round((parseDate(dateStr) - parseDate(today())) / 86400000));
  }
  function K(stopId) { return SUBJ + "/" + CHID + "/" + stopId; }
  function isDone(stopId) { return !!load().done[K(stopId)]; }
  function doneToday() {
    var t = today(), n = 0, d = load().done;
    for (var k in d) if (d[k] === t) n++;
    return n;
  }
  function streak() {
    var days = {}, d = load().done;
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
  function chapterProgress() {
    var done = CH.stops.filter(function (s) { return isDone(s.id); }).length;
    return { done: done, total: CH.stops.length, pct: Math.round(100 * done / CH.stops.length) };
  }
  function pdfOf(p) { return String(p).replace(/\d+/g, function (n) { return +n + (CH.pdfPageOffset || 10); }); }
  function bookChip(bookId, page, label, cls) {
    var b = catalog.books[bookId];
    var pdf = pdfOf(page);
    return '<a class="chip ' + (cls || "") + '" href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener" ' +
      'title="Opens the PDF in Google Drive. Go to PDF page ' + esc(pdf) + '.">' +
      esc(label || b.label) + " · p. " + esc(page) + " (PDF " + esc(pdf) + ")</a>";
  }
  function pageChip(p) { return bookChip(CH.book, p, "Textbook"); }
  function tag(t) { return '<span class="tag">' + esc(t) + "</span>"; }

  /* ---------- derived data from the chapter file ---------- */
  function boardFor(stopId) { return CH.board.filter(function (b) { return b.stop === stopId; }); }
  function boardTag(b) { return b.year + " " + b.qno; }
  function askedCount(stopId) { return boardFor(stopId).length; }
  function getBoard(id) { return CH.board.filter(function (b) { return b.id === id; })[0]; }
  function getDeriv(id) { return CH.derivations.filter(function (d) { return d.id === id; })[0]; }

  /* ---------- plan worked back from the exam ---------- */
  function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function planInfo() {
    var total = 0, st = load(), t = today();
    catalog.subjects.forEach(function (sub) {
      sub.chapters.forEach(function (c) {
        total += (sub.id === SUBJ && c.id === CHID) ? CH.stops.length : (c.estStops || PLAN_DEFAULT_STOPS);
      });
    });
    var done = Object.keys(st.done).length, left = Math.max(0, total - done);
    var span = Math.max(1, dayDiff(st.planStart, catalog.planEnd));
    var since = Math.min(span, Math.max(0, dayDiff(st.planStart, t)));
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
  function drillClean(id) { var r = load().drill[id]; return !!(r && r.clean); }
  function stopMastery(s) {
    // Average of the parts that apply to this stop: quest always; board questions and
    // derivations only if the stop has them. Nothing is credited before it is done.
    var st = load(), parts = [isDone(s.id) ? 1 : 0];
    var bq = boardFor(s.id);
    if (bq.length) parts.push(bq.filter(function (b) { return st.board[b.id] === "got"; }).length / bq.length);
    var ds = CH.derivations.filter(function (d) { return d.stop === s.id; });
    if (ds.length) parts.push(ds.filter(function (d) { return drillClean(d.id); }).length / ds.length);
    return parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
  }
  function stopWeight(s) { return 1 + askedCount(s.id); }
  function gaugeData() {
    var em = CH.examMarks || { avg: 0, basis: "" }, tw = 0, sw = 0;
    var rows = CH.stops.map(function (s, i) {
      var w = stopWeight(s), m = stopMastery(s);
      tw += w; sw += w * m;
      return { s: s, i: i, w: w, m: m };
    });
    var M = tw ? sw / tw : 0;
    rows.forEach(function (r) { r.gain = em.avg * r.w / tw * (1 - r.m); });
    var top = rows.filter(function (r) { return r.gain > 0.0001; })
      .sort(function (a, b) { return b.gain - a.gain || a.i - b.i; }).slice(0, 2);
    return { avg: em.avg, basis: em.basis, M: M, pred: Math.round(em.avg * M * 2) / 2, top: top };
  }
  function gaugeHTML() {
    if (!CH.examMarks) return "";
    var g = gaugeData(), pct = Math.round(g.M * 1000) / 10;
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
  var REASON = { "guessed": "Guessed", "confident mistake": "Confident mistake", "missed": "Missed", "need practice": "Need practice", "slip": "Slip" };
  function bankAdd(id, reason) {
    var b = load().bank, old = b[id];
    if (reason === "guessed" && old) return false;   // already in the bank: leave its schedule alone
    var keep = old && old.prio && reason !== "confident mistake";
    b[id] = { due: addDays(today(), 1), streak: 0, added: old ? old.added : today(),
      reason: keep ? old.reason : (reason || "missed"), prio: reason === "confident mistake" || !!keep };
    save(); updateChrome();
    return true;
  }
  function reasonTag(id) {
    var it = load().bank[id];
    if (!it) return "";
    var r = it.reason || "missed";
    return '<span class="tag rtag' + (it.prio ? " prio" : "") + '">' + esc(REASON[r] || r) + (it.prio ? " · priority" : "") + "</span>";
  }
  function bankReview(id, ok) {
    var b = load().bank, it = b[id];
    if (!it) return;
    if (ok) {
      it.prio = false;
      it.streak = (it.streak || 0) + 1;
      if (it.streak >= 2) delete b[id]; else it.due = addDays(today(), 2);
    } else { it.streak = 0; it.due = addDays(today(), 1); }
    save(); updateChrome();
  }
  function bankIds() { return Object.keys(load().bank); }
  function dueIds() {
    var t = today(), b = load().bank;
    return bankIds().filter(function (id) { return b[id].due <= t; })
      .sort(function (x, y) {
        if (!!b[x].prio !== !!b[y].prio) return b[x].prio ? -1 : 1;   // confident mistakes first
        return b[x].due < b[y].due ? -1 : b[x].due > b[y].due ? 1 : (x < y ? -1 : 1);
      });
  }
  function nextDueDate() {
    var b = load().bank, ids = bankIds();
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
  function updateChrome() {
    xpEl.innerHTML = ICON.bolt + " " + load().xp + " XP";
    var n = 0;
    try { n = CH ? dueIds().filter(itemExists).length : 0; } catch (e) { n = 0; }
    if (n > 0) { dueEl.hidden = false; dueEl.textContent = n; dueEl.setAttribute("aria-label", n + " due"); } else dueEl.hidden = true;
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
    var h = "", ri = resumeInfo(), nextStop = CH.stops.filter(function (s) { return !isDone(s.id); })[0];
    if (ri) {
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
    var shownId = ri ? ri.s.id : (nextStop && nextStop.id);
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
        '<span class="muted small">' + prog.done + " of " + prog.total + " stops</span></span>" + ICON.chev + "</a></li>";
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
      '<div class="chips">' + bookChip(CH.book, 1, "Chapter in textbook") + "</div>" +
      '<p class="note">Textbook pages ' + esc(CH.printedPages) + ". The Drive viewer can't jump to a page, so use the PDF page number shown.</p></div>";
    h += gaugeHTML();
    h += '<div class="tiles"><a class="tile" href="' + BASE + '/board"><b>Board questions</b><span class="muted small">' + CH.board.length + ' from 2022–2025</span></a>' +
      '<a class="tile" href="' + BASE + '/derive"><b>Derivation drills</b><span class="muted small">' + CH.derivations.length + ' derivations</span></a>' +
      '<a class="tile" href="#/formulas"><b>Formula card</b><span class="muted small">All of Chapter 1</span></a></div>';
    if (isFocus()) {
      var order = CH.stops.map(function (s, i) { return { s: s, i: i, c: askedCount(s.id) }; })
        .sort(function (a, b) { return b.c - a.c || a.i - b.i; });
      h += '<div class="card flist-card"><h2>Stops, most asked first</h2><ul class="flist">' + order.map(function (o) {
        var s = o.s, d = isDone(s.id);
        return '<li><a class="frow" href="' + BASE + "/" + s.id + '"><span class="fnum' + (d ? " done" : "") + '">' + (d ? ICON.checkS : o.i + 1) + "</span>" +
          '<span class="grow"><span class="t">' + esc(s.title) + '</span><span class="fmeta muted small">p. ' + s.page + (o.c ? "" : "") + "</span>" +
          (o.c ? '<span class="tags">' + boardFor(s.id).map(function (b) { return tag(boardTag(b)); }).join("") + "</span>" : "") + "</span></a></li>";
      }).join("") + "</ul></div>";
    } else {
      var doneArr = CH.stops.map(function (s) { return isDone(s.id); });
      h += '<div class="card zig-card"><div class="zig" style="height:' + (CH.stops.length * ZH) + 'px">' + zigPath(CH.stops.length, doneArr) +
        CH.stops.map(function (s, i) {
          var d = doneArr[i], cur = s === firstOpen, c = askedCount(s.id);
          var cls = d ? "done" : cur ? "cur" : "";
          return '<a class="zrow ' + (i % 2 ? "r" : "l") + '" style="top:' + (i * ZH) + 'px" href="' + BASE + "/" + s.id + '">' +
            '<span class="zn"><span class="node ' + cls + '">' + (d ? ICON.check : cur ? ICON.play : i + 1) + "</span></span>" +
            '<span class="zl"><span class="t">' + esc(s.title) + '</span><span class="muted small">p. ' + s.page + (cur ? " · up next" : "") + "</span>" +
            (c ? '<span class="tag">asked ' + c + "×</span>" : "") + "</span></a>";
        }).join("") + "</div></div>";
    }
    app.innerHTML = h;
  }

  /* ---------- notes box helpers ---------- */
  function noteBox(stopId) {
    var v = load().notes[K(stopId)] || "";
    return '<div class="card"><h2>My notes</h2><label class="small muted" for="note">Saved on this device only</label>' +
      '<textarea id="note" class="note-ta" data-stop="' + esc(stopId) + '" rows="5" placeholder="Write your own reminders, tricks or doubts for this stop">' + esc(v) + "</textarea>" +
      '<div class="note-foot"><span id="saved" class="saved" aria-live="polite"></span><a href="#/notes">All my notes</a></div></div>';
  }
  var noteTimer = null, noteDirty = null;
  function flushNote() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    if (noteDirty) { save(); noteDirty = null; var el = document.getElementById("saved"); if (el) el.textContent = "Saved"; }
  }
  function onNoteInput(ta) {
    var st = load(), k = K(ta.getAttribute("data-stop")), v = ta.value;
    if (v.trim()) st.notes[k] = v; else delete st.notes[k];
    noteDirty = k;
    var el = document.getElementById("saved"); if (el) el.textContent = "Saving…";
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(flushNote, 350);
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
      '<button type="button" class="btn warn' + (r === "need" ? "" : " ghost") + '" data-act="rate-need" aria-pressed="' + (r === "need") + '">Need practice</button></div>';
    if (r === "need" && inBank) h += '<p class="small muted">In your mistake bank. Review: ' + niceDate(load().bank["b|" + CHID + "|" + q.id].due) + ".</p>";
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
      h += '<div class="card"><h2>Asked in board papers</h2><p class="muted small">' + bq.length + " question" + (bq.length > 1 ? "s" : "") + " from 2022–2025. Try each before you open the answer.</p>" +
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
    if (fresh) { delete load().qp[K(s.id)]; save(); }
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
      save(); updateChrome();
      Q.phase = "result";
    }
    saveQuest();
    questRender();
  }

  /* ---------- board page ---------- */
  function boardView() {
    setHeader("Board questions", BASE, { xp: true, tab: "map" });
    var h = '<div class="card"><p>All Chapter 1 questions from the 2022, 2023 and 2025 board papers, grouped by marks. Try each one, then check the model answer.</p>' +
      '<p class="note"><b>No 2024 paper available yet.</b> Tap “Need practice” to add a question to your mistake bank.</p></div>';
    [1, 2, 3, 4].forEach(function (m) {
      var list = CH.board.filter(function (b) { return b.marks === m; });
      if (!list.length) return;
      h += '<h2 class="grp">' + m + (m === 1 ? " mark" : " marks") + ' <span class="muted small">' + list.length + " question" + (list.length > 1 ? "s" : "") + "</span></h2>" +
        '<div class="card">' + list.map(function (q) { return boardCard(q, true); }).join("") + "</div>";
    });
    app.innerHTML = h;
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
    R.shown = false; R.ds = null; R.ce = null;
    if (R.i >= R.queue.length) return;
    var p = parseId(R.queue[R.i]);
    if (p.kind === "c") R.ce = newCE(stopById(p.a).quest.checks[+p.b], "review");
    if (p.kind === "d") R.ds = { picked: null };
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
    if (!R.shown) h += '<button type="button" class="btn primary block" data-act="rv-show">Show model answer</button>';
    else h += '<div class="answer"><b>Model answer</b><p>' + fm(q.answer) + '</p></div><p class="small muted">How did you do without looking?</p><div class="rate"><button type="button" class="btn ok" data-act="rv-got">Got it</button><button type="button" class="btn warn ghost" data-act="rv-need">Need practice</button></div>';
    return h + "</div>";
  }
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
      h = '<div class="card center"><h2>No notes yet</h2><p class="muted">Open any stop and write in the notes box. Notes are saved on this device only.</p><a class="btn primary" href="' + BASE + '">Go to the map</a></div>';
    } else {
      h += '<div class="card"><p class="muted small">Saved on this device only. Nothing is uploaded.</p><div class="actions two"><button type="button" class="btn primary" data-act="notes-copy">Copy all</button><button type="button" class="btn ghost" data-act="notes-dl">Download .txt</button></div><p id="notes-msg" class="small muted" role="status"></p></div>';
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
        delete load().qp[K(sid)]; save();
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
          load().bank[cid].prio = true; load().bank[cid].reason = "confident mistake"; save();
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
        load().board[id] = act === "rate-got" ? "got" : "need";
        if (act === "rate-need") bankAdd("b|" + CHID + "|" + id, "need practice"); else save();
        q.outerHTML = boardCard(getBoard(id), location.hash.slice(-5) === "board");
        return;
      case "drill-pick": return drillPick(dataI(t));
      case "drill-again": return drillStart(D.d.id);
      case "rv-pick":
        R.ds.picked = dataI(t); return reviewRender();
      case "rv-next": var pd = parseId(R.queue[R.i]); return reviewAdvance(R.ds.picked === stepOptions(getDeriv(pd.a), +pd.b).correct);
      case "rv-show": R.shown = true; return reviewRender();
      case "rv-got": return reviewAdvance(true);
      case "rv-need": return reviewAdvance(false);
      case "bank-remove": delete load().bank[t.getAttribute("data-id")]; save(); updateChrome(); return bankListView();
      case "print": return window.print();
      case "notes-copy": return copyText(notesText()).then(function (ok) { setNotesMsg(ok ? "Copied to the clipboard." : "Could not copy. Use Download instead."); });
      case "notes-dl": return setNotesMsg(downloadText("hsc-physics-ch1-notes.txt", notesText()) ? "Downloaded hsc-physics-ch1-notes.txt" : "Could not download on this device.");
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
  app.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("note-ta")) flushNote(); });
  window.addEventListener("pagehide", flushNote);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushNote(); });
  document.querySelector(".themebar").addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme-set]");
    if (!b) return;
    load().theme = b.getAttribute("data-theme-set"); save(); applyTheme(); route(true);
  });

  document.querySelector(".tabs").addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");     // tapping the tab you are already on restarts that page
    if (a && (location.hash || "#/") === a.getAttribute("href")) route(false);
  });

  /* ---------- router ---------- */
  function route(rerender) {
    flushNote();
    var parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!rerender) window.scrollTo(0, 0);
    redraw = null;
    var p0 = parts[0];
    if (!parts.length) return homeView();
    if (p0 === "review") {
      if (parts[1] === "all") return bankListView();
      if (rerender && R) { redraw = reviewRender; return reviewRender(); }
      return reviewStart();
    }
    if (p0 === "notes") return notesView();
    if (p0 === "formulas") return formulasView();
    if (p0 === SUBJ && parts[1] === CHID) {
      var p2 = parts[2], p3 = parts[3];
      if (!p2) return chapterView();
      if (p2 === "board") return boardView();
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
    window.addEventListener("hashchange", function () { route(false); });
    route(false);
  }).catch(function (e) {
    errorView("Could not load the portal (" + e.message + "). Check your connection and refresh.");
  });
})();
