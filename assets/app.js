/* HSC Board Prep — Multi-subject, multi-chapter portal.
   Shell, themes (Quest / Exam focus), quests, board questions, derivation/proof drills, formula card,
   mistake bank (spaced review), notes, Drive sync, and live Parent/Teacher view. Plain JS, no dependencies. */
(function () {
  "use strict";

  var HAS_DOM = typeof document !== "undefined";
  var HAS_WIN = typeof window !== "undefined";
  var PLAN_DEFAULT_STOPS = 14;     // estimated stops for chapters that have no content yet
  var STORE_KEY = "hscPrep.v2", OLD_KEY = "hscPrep.v1";
  var XP_FIRST = 10, XP_SECOND = 5, HINT_COST = 2, PASS_MARK = 2, TOL = 0.02;
  var SUBJ = "physics", CHID = "ch01";
  var BASE = "#/" + SUBJ + "/" + CHID;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var app = HAS_DOM ? document.getElementById("app") : null;
  var titleEl = HAS_DOM ? document.getElementById("title") : null;
  var backEl = HAS_DOM ? document.getElementById("back") : null;
  var xpEl = HAS_DOM ? document.getElementById("xp") : null;
  var dueEl = HAS_DOM ? document.getElementById("due-badge") : null;
  var syncPillEl = HAS_DOM ? document.getElementById("sync-pill") : null;
  var syncLabelEl = HAS_DOM ? document.getElementById("sync-label") : null;
  var previewBarEl = HAS_DOM ? document.getElementById("preview-bar") : null;
  var teacherBarEl = HAS_DOM ? document.getElementById("teacher-bar") : null;
  var teacherPillEl = HAS_DOM ? document.getElementById("teacher-pill") : null;
  var SYNC = HAS_WIN ? (window.HSCSync || null) : null;
  var catalog = null, CH = null;
  var LIVE_MAP = {};               // "subj/chId" -> { key, subj, subjTitle, chId, meta }
  var LIVE_LIST = [];              // ordered live entries from catalog
  var CHAPTERS = {};               // "subj/chId" -> loaded chapter JSON
  var CHAPTER_LIST = [];           // ordered loaded [{ key, subj, subjTitle, chId, ch }]
  var LOADING = {};                // "subj/chId" -> Promise
  var routeGen = 0;                // generation guard against stale async renders
  var homeSubj = "all";            // subject filter pill on Home
  var formulaChKey = "";           // selected chapter on Formulas page
  var notesChFilter = "all";       // selected chapter filter on Notes page
  var lastRoundChKey = "";         // chapter key for #/review/round
  var redraw = null;               // re-renders the interactive view currently on screen
  var Q = null, R = null, D = null, PR = null; // quest, review, drill, paper sessions (in memory)
  var revealed = {};               // board answers shown this session
  var bqDraft = {};                // qId -> { ticks: [...], err: "" }
  var TState = { loading: false, error: "", data: null, checkedAt: 0 };
  var TActionMsg = {};             // studentId -> { ok, text }
  var PREVIEW = null;              // { name, blankMode, savedMem, savedTeacher }
  var lastActivityAt = Date.now();
  var timerDirty = false;
  var timerTicks = 0;

  var KIND_LABEL = {
    mcq: "MCQ", vsa: "VSA", define: "Definition", distinguish: "Distinguish",
    numerical: "Numerical", derivation: "Derivation", proof: "Proof",
    theory: "Theory", diagram: "Diagram", problem: "Problem"
  };
  function kindLabel(k) { return KIND_LABEL[k] || String(k || ""); }

  var formulaQuiz = false, formulaQuizRev = {}, formulaQuizRes = {}, formulaMissOnly = false, offlineMsg = "";
  var BOARD_TIPS = {
    numerical: "Board tip: Given → Formula → Substitution → Final value + SI unit.",
    derivation: "Board tip: Neat labelled diagram → Statement → Steps → Box final formula.",
    proof: "Board tip: State theorem/formula clearly, show every substitution, conclude LHS = RHS.",
    distinguish: "Board tip: Draw a 2-column table with matching points (½ mark per correct pair).",
    define: "Board tip: Include exact Balbharati keywords and SI unit/formula if applicable.",
    problem: "Board tip: Write formula & each step clearly; rough sketch where needed (no graph paper in Maths)."
  };
  function boardTipHTML(q) {
    var tip = q && q.kind && BOARD_TIPS[q.kind];
    return tip ? '<p class="btip">' + esc(tip) + "</p>" : "";
  }
  function cmpTableHTML(q) {
    if (!q || !isObj(q.table) || !Array.isArray(q.table.headers) || !Array.isArray(q.table.rows)) return "";
    return '<div class="cmp-wrap"><table class="cmp-table"><thead><tr>' +
      q.table.headers.map(function (h) { return "<th>" + fm(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      q.table.rows.map(function (r) {
        return "<tr>" + (Array.isArray(r) ? r.map(function (c) { return "<td>" + fm(c) + "</td>"; }).join("") : "") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }
  function figWidgetHTML(obj) {
    if (!obj || !obj.fig) return "";
    var lbls = Array.isArray(obj.figLabels) && obj.figLabels.length
      ? '<div class="fig-labels"><span class="small muted">Check your sketch labels:</span><div class="err-pills">' +
        obj.figLabels.map(function (l) { return '<span class="err-pill">' + fm(l) + "</span>"; }).join("") + "</div></div>"
      : "";
    return '<details class="fig-box"><summary>Sketch this diagram on paper first, then tap to inspect &amp; check labels</summary>' +
      '<div class="fig-in"><img class="fig-img" src="' + esc(obj.fig) + '" alt="Diagram" loading="lazy">' + lbls + "</div></details>";
  }
  function modelAnswerHTML(q) {
    return '<div class="answer">' + boardTipHTML(q) + '<b>Model answer</b><p>' + fm(q.answer) + "</p>" + cmpTableHTML(q) + figWidgetHTML(q) + "</div>";
  }

  var ERR_TAGS = [
    { id: "concept", label: "Concept", tip: "Re-read the textbook section and In-short summary before retrying." },
    { id: "calc", label: "Calculation", tip: "Write intermediate values clearly and double-check powers of 10." },
    { id: "units", label: "Units / Cond.", tip: "Check SI unit on every final number, or reagent/conditions in Chemistry." },
    { id: "diagram", label: "Diagram", tip: "Sketch and label the figure neatly before step 1." },
    { id: "steps", label: "Steps / Format", tip: "State formula first, show substitution, box the final result." },
    { id: "time", label: "Time", tip: "Practice timed section drills to speed up recall." }
  ];
  function errTagById(id) {
    for (var i = 0; i < ERR_TAGS.length; i++) if (ERR_TAGS[i].id === id) return ERR_TAGS[i];
    return null;
  }
  function errPillsHTML(selectedId, actName, qIdAttr) {
    return '<div class="err-box"><span class="small muted">Why lost marks? (optional)</span><div class="err-pills" role="group" aria-label="Error reason">' +
      ERR_TAGS.map(function (t) {
        var on = selectedId === t.id;
        return '<button type="button" class="err-pill' + (on ? " on" : "") + '" data-act="' + actName + '" data-err="' + t.id + '"' +
          (qIdAttr ? ' data-q="' + esc(qIdAttr) + '"' : "") + ' aria-pressed="' + on + '">' + esc(t.label) + "</button>";
      }).join("") + "</div></div>";
  }
  function logError(id, chKey, errId, st) {
    if (!errId || !errTagById(errId)) return;
    st = st || load();
    if (!Array.isArray(st.errLog)) st.errLog = [];
    st.errLog.unshift({ at: Date.now(), date: today(), id: id, chKey: chKey || curChKey(), err: errId });
    if (st.errLog.length > 200) st.errLog = st.errLog.slice(0, 200);
  }
  function errorSummary(st, days) {
    st = st || load();
    var dCount = days || 14;
    var cutoff = addDays(today(), -(dCount - 1));
    var counts = {}, total = 0;
    (Array.isArray(st.errLog) ? st.errLog : []).forEach(function (e) {
      if (!e || !e.err || (e.date && e.date < cutoff)) return;
      counts[e.err] = (counts[e.err] || 0) + 1;
      total++;
    });
    var rows = Object.keys(counts).map(function (id) {
      var meta = errTagById(id) || { id: id, label: id, tip: "" };
      return { id: id, label: meta.label, tip: meta.tip, count: counts[id], pct: total ? Math.round(100 * counts[id] / total) : 0 };
    }).sort(function (a, b) { return b.count - a.count || (a.id < b.id ? -1 : 1); });
    return { total: total, rows: rows };
  }
  function errorBreakdownHTML(st, days, minTotal) {
    var sum = errorSummary(st, days || 14);
    if (sum.total < (minTotal || 2)) return "";
    var top = sum.rows.slice(0, 3);
    return '<div class="card err-card"><h2>Where marks are leaking</h2><p class="small muted">Top error patterns from the last ' + (days || 14) + ' days (' + sum.total + ' tagged):</p>' +
      '<div class="err-rows">' + top.map(function (r) {
        return '<div class="err-row"><div class="err-row-top"><b>' + esc(r.label) + '</b><span class="small muted">' + r.count + ' (' + r.pct + '%)</span></div>' +
          '<div class="bar thin amber"><i style="width:' + r.pct + '%"></i></div>' +
          (r.tip ? '<p class="small muted err-tip">' + esc(r.tip) + "</p>" : "") + "</div>";
      }).join("") + "</div></div>";
  }

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

  /* ---------- chapter context & lazy loader ---------- */
  function chKeyOf(subj, chid) { return subj + "/" + chid; }
  function curChKey() { return chKeyOf(SUBJ, CHID); }
  function chKeyFor(ch) { return ch ? chKeyOf(ch.subject, ch.id) : curChKey(); }
  function chBase(ch) { return "#/" + (ch ? ch.subject : SUBJ) + "/" + (ch ? ch.id : CHID); }
  function subjTitle(subjId) {
    if (!catalog) return subjId;
    var found = catalog.subjects.filter(function (s) { return s.id === subjId; })[0];
    return found ? found.title : subjId;
  }
  function chShortLabel(ch) { return subjTitle(ch.subject) + " · Ch " + ch.number; }
  function chShortFromMeta(e) { return e.subjTitle + " · Ch " + e.meta.number; }
  function rebuildChapterList() {
    CHAPTER_LIST = LIVE_LIST.filter(function (e) { return !!CHAPTERS[e.key]; })
      .map(function (e) { return { key: e.key, subj: e.subj, subjTitle: e.subjTitle, chId: e.chId, ch: CHAPTERS[e.key] }; });
  }
  function buildLiveCatalog(cat) {
    catalog = cat;
    LIVE_MAP = {};
    LIVE_LIST = [];
    if (!cat || !Array.isArray(cat.subjects)) return;
    cat.subjects.forEach(function (sub) {
      (sub.chapters || []).forEach(function (c) {
        if (!c.file) return;
        var key = chKeyOf(sub.id, c.id);
        var entry = { key: key, subj: sub.id, subjTitle: sub.title, chId: c.id, meta: c };
        LIVE_MAP[key] = entry;
        LIVE_LIST.push(entry);
      });
    });
    rebuildChapterList();
  }
  function ensureChapter(subj, chId) {
    var key = chKeyOf(subj, chId);
    if (CHAPTERS[key]) return Promise.resolve(CHAPTERS[key]);
    var entry = LIVE_MAP[key];
    if (!entry || !entry.meta || !entry.meta.file) return Promise.resolve(null);
    if (LOADING[key]) return LOADING[key];
    LOADING[key] = getJSON(entry.meta.file).then(function (ch) {
      CHAPTERS[key] = ch;
      rebuildChapterList();
      delete LOADING[key];
      return ch;
    }, function (err) {
      delete LOADING[key];
      throw err;
    });
    return LOADING[key];
  }
  function ensureChapters(keys) {
    var uniq = [], seen = {};
    (keys || []).forEach(function (k) {
      if (k && LIVE_MAP[k] && !CHAPTERS[k] && !seen[k]) { seen[k] = true; uniq.push(k); }
    });
    if (!uniq.length) return Promise.resolve([]);
    return Promise.all(uniq.map(function (k) {
      var sp = k.split("/");
      return ensureChapter(sp[0], sp[1]);
    }));
  }
  function ensureSubjectChapters(paperKey) {
    var keys = LIVE_LIST.filter(function (e) {
      if (paperKey === "maths") return e.subj === "maths1" || e.subj === "maths2";
      return e.subj === paperKey;
    }).map(function (e) { return e.key; });
    return ensureChapters(keys);
  }
  function ensureAllChapters() {
    return ensureChapters(LIVE_LIST.map(function (e) { return e.key; }));
  }
  function withChapters(keys, fn) {
    var missing = (keys || []).filter(function (k) { return k && LIVE_MAP[k] && !CHAPTERS[k]; });
    if (!missing.length) return fn();
    var myGen = routeGen;
    if (app) app.innerHTML = '<div class="card center"><p class="muted">Loading chapter…</p></div>';
    ensureChapters(missing).then(function () {
      if (myGen !== routeGen) return;
      fn();
    }, function (err) {
      if (myGen !== routeGen) return;
      errorView("Could not load chapter (" + err.message + ").");
    });
  }
  function updateMapTab() {
    if (!HAS_DOM) return;
    var link = document.querySelector('.tabs a[data-tab="map"]');
    if (link) link.setAttribute("href", BASE);
  }
  function setActiveChapter(subj, chid, persist) {
    var key = chKeyOf(subj, chid);
    if (!CHAPTERS[key]) return false;
    SUBJ = subj; CHID = chid; BASE = "#/" + subj + "/" + chid; CH = CHAPTERS[key];
    updateMapTab();
    if (persist) {
      var st = load();
      if (st.lastChapter !== key) { st.lastChapter = key; save({ silentSync: true }); }
    }
    return true;
  }

  /* ---------- storage (never throws) ---------- */
  var mem = null;
  function blank() {
    return {
      v: 2, done: {}, xp: 0, quest: {}, bank: {}, bankDel: {}, notes: {}, noteAt: {},
      board: {}, boardAt: {}, theme: "quest", lastChapter: "", qp: {}, qpDel: {}, drill: {},
      planStart: "", round: blankRound(), rounds: {}, roundHist: {}, boardPts: {},
      graduated: {}, errLog: [], papers: [], paperRun: null, paperRunDel: 0, predSummary: {},
      timeByDay: {}, timeByCh: {}, dismissedNoteAt: 0, updatedAt: 0
    };
  }
  function blankRound() { return { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null }; }
  function isObj(x) { return !!(x && typeof x === "object" && !Array.isArray(x)); }
  function normalizeRound(rd) {
    if (!isObj(rd)) rd = blankRound();
    var rb = blankRound();
    for (var rk in rb) if (rd[rk] === undefined || (rb[rk] !== null && typeof rd[rk] !== typeof rb[rk]) || (rb[rk] === null && rd[rk] !== null && !isObj(rd[rk]))) rd[rk] = rb[rk];
    if (!isObj(rd.modes)) rd.modes = {};
    return rd;
  }
  function normalizeState(s) {
    if (!isObj(s)) s = blank();
    var b = blank();
    for (var k in b) {
      if (Array.isArray(b[k])) { if (!Array.isArray(s[k])) s[k] = []; }
      else if (b[k] === null) { if (s[k] !== null && !isObj(s[k])) s[k] = null; }
      else if (s[k] == null || typeof s[k] !== typeof b[k] || Array.isArray(s[k])) s[k] = b[k];
    }
    if (s.theme !== "quest" && s.theme !== "focus") s.theme = "quest";
    s.v = 2;
    s.round = normalizeRound(s.round);
    if (!isObj(s.rounds)) s.rounds = {};
    for (var ck in s.rounds) s.rounds[ck] = normalizeRound(s.rounds[ck]);
    if (!isObj(s.roundHist)) s.roundHist = {};
    if (!isObj(s.boardPts)) s.boardPts = {};
    if (!isObj(s.graduated)) s.graduated = {};
    if (!isObj(s.predSummary)) s.predSummary = {};
    if (!isObj(s.timeByDay)) s.timeByDay = {};
    if (!isObj(s.timeByCh)) s.timeByCh = {};
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
    if (PREVIEW) return; // Teacher preview mode stays strictly in memory
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
  /* escape, turn _{x}/^{x} into sub/sup, and newlines into <br> */
  function fm(s) {
    return esc(s).replace(/_\{([^}]*)\}/g, "<sub>$1</sub>").replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>").replace(/\n/g, "<br>");
  }
  function plain(s) { return String(s == null ? "" : s).replace(/_\{([^}]*)\}/g, "$1").replace(/\^\{([^}]*)\}/g, "^$1"); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  /* The single source of "today". Tests can fake it with window.__TODAY = "YYYY-MM-DD" or ?today=YYYY-MM-DD */
  function today() {
    var o = null;
    try {
      o = (HAS_WIN ? window.__TODAY : (typeof global !== "undefined" ? global.__TODAY : null)) ||
        (typeof location !== "undefined" ? new URLSearchParams(location.search).get("today") : null);
    } catch (e) { o = null; }
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
  function K(stopId, ch) { return (ch ? ch.subject : SUBJ) + "/" + (ch ? ch.id : CHID) + "/" + stopId; }
  function isDone(stopId, st, ch) { return !!((st || load()).done[K(stopId, ch)]); }
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
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function sumDevMap(m) {
    if (!isObj(m)) return 0;
    var s = 0;
    for (var k in m) if (typeof m[k] === "number" && isFinite(m[k]) && m[k] > 0) s += m[k];
    return Math.round(s);
  }
  function timeOnDay(dateStr, st) {
    var s = st || load();
    return sumDevMap(s.timeByDay && s.timeByDay[dateStr]);
  }
  function timeLast7Days(st) {
    var s = st || load(), t = today(), days = [], total = 0, max = 0;
    for (var i = 6; i >= 0; i--) {
      var dStr = addDays(t, -i);
      var sec = timeOnDay(dStr, s);
      var wd = WEEKDAYS[parseDate(dStr).getDay()];
      days.push({ date: dStr, label: i === 0 ? "Today" : wd, sec: sec });
      total += sec;
      if (sec > max) max = sec;
    }
    return { days: days, totalSec: total, maxSec: max };
  }
  function timeForChapter(chKey, st) {
    var s = st || load();
    return sumDevMap(s.timeByCh && s.timeByCh[chKey]);
  }
  function fmtStudyTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec === 0) return "0m";
    if (sec < 60) return "<1m";
    var min = Math.round(sec / 60);
    if (min < 60) return min + "m";
    var hr = Math.floor(min / 60), rem = min % 60;
    return rem ? hr + "h " + rem + "m" : hr + "h";
  }
  function dayAchievements(dateStr, st) {
    st = st || load();
    var sec = timeOnDay(dateStr, st);
    var stops = [], drills = [], rounds = [];
    CHAPTER_LIST.forEach(function (e) {
      var ch = e.ch;
      ch.stops.forEach(function (s, idx) {
        if (st.done[K(s.id, ch)] === dateStr) stops.push({ ch: ch, s: s, idx: idx });
      });
      (ch.derivations || []).forEach(function (d) {
        if (st.drill[d.id] && st.drill[d.id].last === dateStr) drills.push({ ch: ch, d: d, clean: !!st.drill[d.id].clean });
      });
      var rs = RS(st, e.key);
      if (rs.last && rs.last.date === dateStr) rounds.push({ ch: ch, rec: rs.last });
    });
    return {
      date: dateStr,
      sec: sec,
      stops: stops,
      drills: drills,
      rounds: rounds,
      hasAny: sec > 0 || stops.length > 0 || drills.length > 0 || rounds.length > 0
    };
  }
  function flushTimer() {
    if (!timerDirty) return;
    timerDirty = false;
    save({ silentSync: true });
  }
  function startStudyTimer() {
    var bump = function () { lastActivityAt = Date.now(); };
    ["click", "keydown", "input", "touchstart", "scroll"].forEach(function (ev) {
      window.addEventListener(ev, bump, { passive: true });
    });
    setInterval(function () {
      if (PREVIEW || !LIVE_LIST.length) return;
      if (HAS_DOM && document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityAt > 120000) return;
      var h = (location.hash || "#/").split("?")[0];
      if (h === "#/teacher" || h === "#/sync") return;
      var devId = SYNC ? SYNC.getDeviceId() : "local";
      var st = load(), d = today();
      if (!isObj(st.timeByDay[d])) st.timeByDay[d] = {};
      st.timeByDay[d][devId] = (st.timeByDay[d][devId] || 0) + 15;
      var parts = h.replace(/^#\/?/, "").split("/").filter(Boolean);
      if (parts.length >= 2 && LIVE_MAP[chKeyOf(parts[0], parts[1])]) {
        var ck = chKeyOf(parts[0], parts[1]);
        if (!isObj(st.timeByCh[ck])) st.timeByCh[ck] = {};
        st.timeByCh[ck][devId] = (st.timeByCh[ck][devId] || 0) + 15;
      }
      timerDirty = true;
      timerTicks++;
      if (timerTicks % 4 === 0) flushTimer();
    }, 15000);
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function stopIndex(id, ch) {
    var list = (ch || CH).stops;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
  function stopById(id, ch) { var target = ch || CH, i = stopIndex(id, target); return i < 0 ? null : target.stops[i]; }
  function doneCount(st, chKey) {
    var prefix = chKey + "/", n = 0, d = (st || load()).done;
    for (var k in d) if (k.indexOf(prefix) === 0 && d[k]) n++;
    return n;
  }
  function chapterProgress(st, ch) {
    var target = ch || CH;
    var done = target.stops.filter(function (s) { return isDone(s.id, st, target); }).length;
    return { done: done, total: target.stops.length, pct: Math.round(100 * done / target.stops.length) };
  }
  function totalActiveProgress(st) {
    st = st || load();
    var done = 0, total = 0;
    LIVE_LIST.forEach(function (entry) {
      if (CHAPTERS[entry.key]) {
        var p = chapterProgress(st, CHAPTERS[entry.key]);
        done += p.done; total += p.total;
      } else {
        done += doneCount(st, entry.key);
        total += entry.meta.stopCount || 0;
      }
    });
    return { done: done, total: total, pct: total ? Math.round(100 * done / total) : 0 };
  }
  function pdfOf(p, bookId, ch) {
    var b = catalog.books[bookId];
    var off = (b && typeof b.pdfPageOffset === "number") ? b.pdfPageOffset : ((ch || CH) && (ch || CH).pdfPageOffset) || 10;
    return String(p).replace(/\d+/g, function (n) { return +n + off; });
  }
  function bookChip(bookId, page, label, cls, ch) {
    var b = catalog.books[bookId];
    if (!b) return "";
    var pdf = pdfOf(page, bookId, ch);
    return '<a class="chip ' + (cls || "") + '" href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener noreferrer" ' +
      'title="Opens the PDF in Google Drive. Go to PDF page ' + esc(pdf) + '.">' +
      esc(label || b.label) + " · p. " + esc(page) + " (PDF " + esc(pdf) + ")</a>";
  }
  function pageChip(p, ch) { var target = ch || CH; return bookChip(target.book, p, "Textbook", "", target); }
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
  function boardFor(stopId, ch) {
    return (ch || CH).board.filter(function (b) { return b.stop === stopId; }).sort(boardPriorityCmp);
  }
  function boardTag(b) {
    if (!isBoardPYQ(b)) return b.source || "Important";
    var base = b.year + " " + b.qno;
    return Array.isArray(b.alsoAsked) && b.alsoAsked.length ? base + " · " + b.alsoAsked.join(" · ") : base;
  }
  function askedCount(stopId, ch) {
    return (ch || CH).board.reduce(function (n, b) { return b.stop === stopId ? n + pyqAskCount(b) : n; }, 0);
  }
  function getBoard(id, ch) { return (ch || CH).board.filter(function (b) { return b.id === id; })[0]; }
  function getDeriv(id, ch) { return ((ch || CH).derivations || []).filter(function (d) { return d.id === id; })[0]; }

  /* ---------- plan worked back from the exam ---------- */
  function dayDiff(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function activeSubjects() {
    return catalog.subjects.filter(function (sub) {
      return sub.chapters.some(function (c) { return !!LIVE_MAP[chKeyOf(sub.id, c.id)]; });
    });
  }
  function planInfo(st, subjFilter) {
    var total = 0, done = 0, t = today();
    st = st || load();
    var subs = subjFilter && subjFilter !== "all"
      ? catalog.subjects.filter(function (s) { return s.id === subjFilter; })
      : activeSubjects();
    var subIds = {};
    subs.forEach(function (sub) {
      subIds[sub.id] = true;
      sub.chapters.forEach(function (c) {
        var loaded = CHAPTERS[chKeyOf(sub.id, c.id)];
        total += loaded ? loaded.stops.length : (c.stopCount || c.estStops || PLAN_DEFAULT_STOPS);
      });
    });
    for (var k in st.done) {
      var subId = k.split("/")[0];
      if (subIds[subId]) done++;
    }
    var left = Math.max(0, total - done);
    var pStart = /^\d{4}-\d{2}-\d{2}$/.test(st.planStart || "") ? st.planStart : t;
    var span = Math.max(1, dayDiff(pStart, catalog.planEnd));
    var since = Math.min(span, Math.max(0, dayDiff(pStart, t)));
    var daysLeft = Math.max(0, dayDiff(t, catalog.planEnd));
    var pace = Math.max(1, Math.ceil(left / Math.max(1, daysLeft)));
    var expected = total * since / span, diff = done - expected;
    var status = diff >= 1 ? "ahead" : diff <= -1 ? "behind" : "on";
    var scopeNames = subs.map(function (s) { return s.title; }).join(", ");
    return { total: total, done: done, left: left, span: span, since: since, daysLeft: daysLeft, pace: pace,
      expected: expected, status: status, n: Math.floor(Math.abs(diff)), scopeNames: scopeNames };
  }
  function planHTML(pl) {
    var label = pl.status === "on" ? "On track" : pl.status === "ahead" ? "Ahead by " + pl.n + (pl.n === 1 ? " stop" : " stops") : "Behind by " + pl.n + (pl.n === 1 ? " stop" : " stops");
    return '<div class="card plan-card plan-' + pl.status + '"><div class="row"><h2 class="grow">Your plan</h2><span class="pill plan-pill" data-plan="' + pl.status + '">' + esc(label) + "</span></div>" +
      '<p class="plan-line"><b>' + pl.pace + (pl.pace === 1 ? " stop" : " stops") + ' a day</b> to finish by ' + niceDate(catalog.planEnd) + ". " + pl.left + " of " + pl.total + " stops left, " + pl.daysLeft + (pl.daysLeft === 1 ? " day" : " days") + " to go.</p>" +
      '<p class="note">Counting ' + esc(pl.scopeNames) + '. The last 10 days are kept for revision.</p></div>';
  }

  /* ---------- predicted board marks ---------- */
  function drillClean(id, st) { var r = (st || load()).drill[id]; return !!(r && r.clean); }
  function stopMastery(s, st, ch) {
    st = st || load();
    var target = ch || CH;
    var done = isDone(s.id, st, target);
    var bq = boardFor(s.id, target);
    var ds = (target.derivations || []).filter(function (d) { return d.stop === s.id; });
    var wSum = 0, valSum = 0;

    if (s.quest) {
      var qr = st.quest && st.quest[K(s.id, target)];
      var qMax = s.quest.checks ? s.quest.checks.length : 0;
      var qScore = ((qr && qMax > 0 && qr.best >= qMax) || (done && qr && qr.plays >= 2)) ? 1.0 : (done ? 0.65 : 0);
      wSum += 0.20; valSum += 0.20 * qScore;
    } else {
      var wRev = (bq.length > 0 || ds.length > 0) ? 0.15 : 0.50;
      wSum += wRev; valSum += wRev * (done ? 1.0 : 0);
    }

    if (bq.length > 0) {
      var bSum = 0;
      bq.forEach(function (q) {
        var bp = st.boardPts && st.boardPts[q.id];
        var ba = (st.boardAt && st.boardAt[q.id]) || 0;
        var bv = st.board && st.board[q.id];
        if (bv === "need" && (!bp || ba > bp.at)) bSum += 0;
        else if (bp && bp.of > 0) bSum += Math.min(1, bp.got / bp.of);
        else if (bv === "got") bSum += 0.5;
      });
      var wB = s.quest ? 0.50 : (ds.length > 0 ? 0.55 : 0.85);
      wSum += wB; valSum += wB * (bSum / bq.length);
    }

    if (ds.length > 0) {
      var dSum = 0;
      ds.forEach(function (d) {
        var dr = st.drill && st.drill[d.id];
        dSum += (dr && dr.clean) ? 1.0 : (dr && dr.runs > 0 ? 0.5 : 0);
      });
      wSum += 0.30; valSum += 0.30 * (dSum / ds.length);
    }

    return wSum ? valSum / wSum : 0;
  }
  function stopWeight(s, ch) { return 1 + askedCount(s.id, ch); }
  function gaugeData(st, ch) {
    st = st || load();
    var target = ch || CH;
    var key = chKeyFor(target);
    var em = target.examMarks || { avg: 0, basis: "" }, tw = 0, sw = 0;
    var rows = target.stops.map(function (s, i) {
      var w = stopWeight(s, target), m = stopMastery(s, st, target);
      tw += w; sw += w * m;
      return { s: s, i: i, w: w, m: m };
    });
    var stopM = tw ? sw / tw : 0;
    var hist = (st.roundHist && Array.isArray(st.roundHist[key])) ? st.roundHist[key] : [];
    var fulls = hist.filter(function (r) { return r && (r.mode === "most" || r.mode === "mock" || r.full); });
    var M;
    if (fulls.length) {
      var latestPct = fulls[0].pct || 0;
      var bestPct = fulls.reduce(function (mx, r) { return Math.max(mx, r.pct || 0); }, 0);
      var recentPct = 0.6 * latestPct + 0.4 * bestPct;
      M = 0.7 * stopM + 0.3 * (recentPct / 100);
    } else {
      var rsBest = RS(st, key).bestFull || 0;
      if (rsBest > 0) M = 0.7 * stopM + 0.3 * (rsBest / 100);
      else M = Math.min(0.85, stopM);
    }
    rows.forEach(function (r) { r.gain = em.avg * r.w / tw * (1 - r.m); });
    var top = rows.filter(function (r) { return r.gain > 0.0001; })
      .sort(function (a, b) { return b.gain - a.gain || a.i - b.i; }).slice(0, 2);
    return { avg: em.avg, basis: em.basis, M: M, pred: Math.round(em.avg * M * 2) / 2, top: top };
  }
  function gaugeHTML(st, ch) {
    var target = ch || CH;
    if (!target || !target.examMarks) return "";
    var g = gaugeData(st, target), pct = Math.round(g.M * 1000) / 10;
    var line = "About " + g.pred + " of ~" + Math.round(g.avg) + " marks secured";
    var gain = g.top.length ? '<p class="small gain">Biggest gain next: <b>' + g.top.map(function (r) { return esc(r.s.title); }).join(", then ") + "</b></p>" : "";
    var how = '<details class="how"><summary>How this is worked out</summary><p class="small">An estimate based on past papers: the average marks this chapter carried (' + esc(g.basis) +
      ') times how much of the chapter you have mastered (20% quest, 50% written board answers, 30% drills, plus 30% from full board rounds — capped at 85% until you finish a full round).</p></details>';
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
  function paperPrediction(paperKey, st) {
    st = st || load();
    var pg = catalog && catalog.paperGroups && catalog.paperGroups[paperKey];
    if (!pg) return { key: paperKey, title: paperKey, pred: 0, of: 0, pct: 0 };
    var raw = 0;
    (pg.subjects || []).forEach(function (sid) {
      var sub = (catalog.subjects || []).filter(function (s) { return s.id === sid; })[0];
      if (!sub) return;
      (sub.chapters || []).forEach(function (c) {
        var chObj = CHAPTERS[chKeyOf(sid, c.id)];
        if (!chObj) return;
        raw += (c.marks || 0) * gaugeData(st, chObj).M;
      });
    });
    var pred = Math.min(pg.paperMarks, Math.max(0, Math.round(raw * 2) / 2));
    return { key: paperKey, title: pg.title, pred: pred, of: pg.paperMarks, pct: pg.paperMarks ? Math.round(100 * pred / pg.paperMarks) : 0 };
  }
  function subjectPartPrediction(subjId, st) {
    st = st || load();
    var sub = (catalog && catalog.subjects || []).filter(function (s) { return s.id === subjId; })[0];
    if (!sub) return { pred: 0, of: 40, pct: 0 };
    var raw = 0, tot = 0;
    (sub.chapters || []).forEach(function (c) {
      tot += c.marks || 0;
      var chObj = CHAPTERS[chKeyOf(subjId, c.id)];
      if (chObj) raw += (c.marks || 0) * gaugeData(st, chObj).M;
    });
    var pred = Math.min(tot, Math.max(0, Math.round(raw * 2) / 2));
    return { pred: pred, of: tot, pct: tot ? Math.round(100 * pred / tot) : 0 };
  }
  function syncPredSummary(st, pPhy, pChem, pMaths) {
    if (PREVIEW || !mem || st !== mem) return;
    var cur = st.predSummary || {};
    if (cur.physics !== pPhy.pred || cur.chemistry !== pChem.pred || cur.maths !== pMaths.pred) {
      st.predSummary = { physics: pPhy.pred, chemistry: pChem.pred, maths: pMaths.pred, at: Date.now() };
      save({ silentSync: true });
    }
  }
  function homeGaugeHTML(st, subjFilter) {
    st = st || load();
    var filter = subjFilter || "all";
    var pPhy = paperPrediction("physics", st);
    var pChem = paperPrediction("chemistry", st);
    var pMaths = paperPrediction("maths", st);
    syncPredSummary(st, pPhy, pChem, pMaths);

    var list = CHAPTER_LIST.filter(function (e) {
      return e.ch.examMarks && (filter === "all" || e.subj === filter);
    });
    var chRowsHTML = list.map(function (e) {
      var g = gaugeData(st, e.ch), pct = Math.round(g.M * 100);
      return '<a class="g-row" href="' + chBase(e.ch) + '"><div class="g-row-top"><b>' + esc(chShortLabel(e.ch)) + ' · ' + esc(e.ch.title) + '</b><span class="small muted"><b>' + g.pred + '</b> / ~' + Math.round(g.avg) + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></a>';
    }).join("");

    if (catalog && catalog.paperGroups) {
      var papersToShow = [];
      if (filter === "all") papersToShow = [pPhy, pChem, pMaths];
      else if (filter === "physics") papersToShow = [pPhy];
      else if (filter === "chemistry") papersToShow = [pChem];

      var h = '<div class="card gauge-card"><h2>Predicted board marks</h2>';
      if (filter === "maths1" || filter === "maths2") {
        var part = subjectPartPrediction(filter, st);
        h += '<div class="g-rows"><div class="g-row"><div class="g-row-top"><b>' + esc(subjTitle(filter)) + '</b><span><b>~' + part.pred + '</b> of ' + part.of + '</span></div>' +
          '<div class="bar"><i style="width:' + part.pct + '%"></i></div></div></div>' +
          '<p class="small muted" style="margin-top:8px"><span class="pill">Combined Maths paper: ~' + pMaths.pred + ' of ' + pMaths.of + '</span></p>';
      } else {
        h += '<div class="g-rows">' + papersToShow.map(function (p) {
          return '<div class="g-row"><div class="g-row-top"><b>' + esc(p.title) + '</b><span><b>~' + p.pred + '</b> of ' + p.of + '</span></div>' +
            '<div class="bar"><i style="width:' + p.pct + '%"></i></div></div>';
        }).join("") + '</div>';
      }
      if (list.length) {
        h += '<details class="how" style="margin-top:10px"><summary>Active chapters (' + list.length + ')</summary><div class="g-rows" style="margin-top:8px">' + chRowsHTML + '</div></details>';
      }
      h += '<p class="note">Honest estimate across the full syllabus (unstarted chapters count as 0).</p></div>';
      return h;
    }

    if (!list.length) return "";
    if (list.length === 1) return gaugeHTML(st, list[0].ch);
    return '<div class="card gauge-card"><h2>Predicted board marks</h2><div class="g-rows">' + chRowsHTML + '</div></div>';
  }

  /* ---------- mid-quest saving ---------- */
  function saveQuest() {
    if (!Q || Q.phase === "result") return;
    var ce = Q.ce;
    load().qp[K(Q.stop.id)] = { phase: Q.phase, ci: Q.ci, ki: Q.ki, results: Q.results, xp: Q.xp, added: Q.added, at: Date.now(),
      ce: ce ? { attempt: ce.attempt, hint: ce.hint, sel: ce.sel, val: ce.val, status: ce.status, gain: ce.gain, conf: ce.conf, flag: ce.flag || "" } : null };
    save();
  }
  function restoreQuest(s, ch) {
    if (!s || !s.quest) return null;
    var target = ch || CH;
    var r = load().qp[K(s.id, target)], cards = s.quest.cards, checks = s.quest.checks;
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
  function resumeInfoAll() {
    var qp = load().qp, best = null;
    for (var k in qp) {
      var parts = k.split("/");
      var ch = CHAPTERS[chKeyOf(parts[0], parts[1])];
      if (!ch) continue;
      var s = stopById(parts[2], ch);
      if (!s) continue;
      var q = restoreQuest(s, ch);
      if (!q) continue;
      if (!best || (qp[k].at || 0) > best.at) best = { ch: ch, s: s, q: q, at: qp[k].at || 0 };
    }
    return best;
  }
  function progressText(q) {
    return q.phase === "check" ? "check " + (q.ki + 1) + " of " + q.stop.quest.checks.length : "concept " + (q.ci + 1) + " of " + q.stop.quest.cards.length;
  }

  /* ---------- XP ---------- */
  function addXP(n) { if (n > 0) { load().xp += n; save(); updateChrome(); } }

  /* ---------- mistake bank (spaced review) ---------- */
  var REASON = { "guessed": "Guessed", "confident mistake": "Confident mistake", "missed": "Missed", "need practice": "Need practice", "slip": "Slip", "below full marks": "Below full marks", "teacher assigned": "Teacher assigned" };
  function bankChToken(ch) {
    var target = ch || CH;
    return (target.subject === "physics" && target.id === "ch01") ? "ch01" : target.subject + ":" + target.id;
  }
  function bankId(kind, a, b, ch) {
    return kind + "|" + bankChToken(ch) + "|" + a + (b != null ? "|" + b : "");
  }
  function bankAdd(id, reason, err) {
    var st = load(), b = st.bank, old = b[id];
    if (reason === "guessed" && old) return false;   // already in the bank: leave its schedule alone
    var keep = old && old.prio && reason !== "confident mistake";
    b[id] = { due: addDays(today(), 1), streak: 0, added: old ? old.added : today(),
      reason: keep ? old.reason : (reason || "missed"), prio: reason === "confident mistake" || !!keep,
      err: err || (old && old.err) || "", updatedAt: Date.now() };
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
  function subjectExamDate(chKey) {
    var subj = (chKey || "").split("/")[0];
    if (subj === "maths1" || subj === "maths2") subj = "maths";
    if (catalog && catalog.exams && catalog.exams[subj]) return catalog.exams[subj];
    return (catalog && catalog.examDate) || "";
  }
  // Spaced review ladder: after the n-th correct review in a row, next review is REVIEW_GAPS[n] days later.
  // An item graduates (leaves the bank) only after REVIEW_GAPS.length correct reviews in a row,
  // so material learnt in December keeps coming back until the exam. Gaps never push past exam eve.
  var REVIEW_GAPS = [1, 3, 7, 14, 30];
  function nextReviewDate(streakN, idOrChKey, isConfident) {
    var gap = REVIEW_GAPS[Math.min(streakN, REVIEW_GAPS.length - 1)];
    if (isConfident && streakN >= 1 && gap < 7) gap = 7;
    var due = addDays(today(), gap);
    var chKey = idOrChKey && idOrChKey.indexOf("|") >= 0 ? parseId(idOrChKey).chKey : idOrChKey;
    var exDate = subjectExamDate(chKey);
    var eve = exDate ? addDays(exDate, -2) : "";
    if (eve && due > eve) due = eve > today() ? eve : addDays(today(), 1);
    return due;
  }
  function bankReview(id, ok) {
    var st = load(), b = st.bank, it = b[id];
    if (!it) return;
    var now = Date.now();
    if (ok) {
      var wasConf = it.reason === "confident mistake";
      it.prio = false;
      it.streak = (it.streak || 0) + 1;
      if (it.streak >= REVIEW_GAPS.length) {
        if (!isObj(st.graduated)) st.graduated = {};
        st.graduated[id] = now;
        delete b[id];
        st.bankDel[id] = now;
      } else {
        it.due = nextReviewDate(it.streak, id, wasConf);
        it.updatedAt = now;
      }
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
  function parseId(id) {
    var p = id.split("|"), tok = p[1] || "ch01";
    var subj = "physics", chid = tok;
    if (tok.indexOf(":") >= 0) { var sp = tok.split(":"); subj = sp[0]; chid = sp[1]; }
    return { kind: p[0], ch: tok, subj: subj, chid: chid, chKey: chKeyOf(subj, chid), a: p[2], b: p[3] };
  }
  function itemChapter(id) { return CHAPTERS[parseId(id).chKey] || null; }
  function itemExists(id) {
    var p = parseId(id), ch = CHAPTERS[p.chKey];
    if (!ch) return false;
    if (p.kind === "c") { var s = stopById(p.a, ch); return !!(s && s.quest && s.quest.checks && s.quest.checks[+p.b]); }
    if (p.kind === "d") { var d = getDeriv(p.a, ch); return !!(d && d.steps[+p.b]); }
    if (p.kind === "b") return !!getBoard(p.a, ch);
    return false;
  }
  function itemStopInfo(id) {
    var p = parseId(id), ch = CHAPTERS[p.chKey];
    if (!ch) return null;
    var stopId = "";
    if (p.kind === "c") stopId = p.a;
    else if (p.kind === "d") { var d = getDeriv(p.a, ch); stopId = d ? d.stop : ""; }
    else if (p.kind === "b") { var b = getBoard(p.a, ch); stopId = b ? b.stop : ""; }
    var s = stopId ? stopById(stopId, ch) : null;
    return s ? { ch: ch, chKey: p.chKey, stop: s, kind: p.kind } : null;
  }

  function itemLiveOrExists(id) {
    var k = parseId(id).chKey;
    return !!LIVE_MAP[k] && (!CHAPTERS[k] || itemExists(id));
  }
  function countDue(st) { return dueIds(st).filter(itemLiveOrExists).length; }
  function countBank(st) { return bankIds(st).filter(itemLiveOrExists).length; }
  function keysInBank(st) {
    var seen = {}, out = [], b = (st || load()).bank;
    for (var id in b) { var k = parseId(id).chKey; if (LIVE_MAP[k] && !seen[k]) { seen[k] = true; out.push(k); } }
    return out;
  }
  function keysInNotes(st) {
    var seen = {}, out = [], n = (st || load()).notes;
    for (var nk in n) {
      if (!n[nk] || !n[nk].trim()) continue;
      var p = nk.split("/"), k = p.length >= 2 ? chKeyOf(p[0], p[1]) : "";
      if (LIVE_MAP[k] && !seen[k]) { seen[k] = true; out.push(k); }
    }
    return out;
  }

  /* ---------- teacher directives & preview mode ---------- */
  function activeTeacherData() {
    if (PREVIEW) return PREVIEW.savedTeacher || null;
    return SYNC ? SYNC.getTeacherData() : null;
  }
  function applyTeacherAssignments(teacherObj) {
    if (!isObj(teacherObj) || !Array.isArray(teacherObj.assigned) || !LIVE_LIST.length) return;
    var keys = [];
    teacherObj.assigned.forEach(function (entry) {
      var id = isObj(entry) ? entry.id : (typeof entry === "string" ? entry : "");
      if (id) { var k = parseId(id).chKey; if (LIVE_MAP[k]) keys.push(k); }
    });
    ensureChapters(keys).then(function () {
      var st = load(), changed = false;
      teacherObj.assigned.forEach(function (entry) {
        var id = isObj(entry) ? entry.id : (typeof entry === "string" ? entry : "");
        var at = isObj(entry) && typeof entry.at === "number" ? entry.at : 1;
        if (!id || !itemExists(id)) return;
        if (st.bank[id]) return;
        if ((st.bankDel[id] || 0) >= at) return;
        st.bank[id] = { due: today(), streak: 0, added: today(), reason: "teacher assigned", prio: true, updatedAt: at };
        delete st.bankDel[id];
        changed = true;
      });
      if (changed) { save({ silentSync: true }); updateChrome(); }
    });
  }
  function rewardProgress(reward, st) {
    if (!isObj(reward) || !reward.title) return null;
    st = st || load();
    var type = reward.type || "xp";
    if (type === "stops") {
      var ch = CHAPTERS[reward.chKey];
      if (!ch) return null;
      var p = chapterProgress(st, ch);
      return {
        label: "Finish all " + p.total + " stops in " + chShortLabel(ch),
        cur: p.done, target: p.total, pct: p.pct,
        text: p.done + " / " + p.total + " stops",
        done: p.done >= p.total
      };
    }
    if (type === "round") {
      var ch2 = CHAPTERS[reward.chKey];
      if (!ch2) return null;
      var best = RS(st, reward.chKey).bestFull || 0;
      var pct = Math.min(100, Math.round(100 * best / 80));
      return {
        label: "Score 80%+ in " + chShortLabel(ch2) + " Board round",
        cur: best, target: 80, pct: pct,
        text: best + "% / 80%",
        done: best >= 80
      };
    }
    var tgt = Math.max(50, parseInt(reward.target, 10) || 250);
    var cur = st.xp || 0;
    return {
      label: "Reach " + tgt + " XP",
      cur: cur, target: tgt, pct: Math.min(100, Math.round(100 * cur / tgt)),
      text: cur + " / " + tgt + " XP",
      done: cur >= tgt
    };
  }
  function renderPreviewBar() {
    if (!previewBarEl) return;
    if (!PREVIEW) { previewBarEl.hidden = true; previewBarEl.innerHTML = ""; return; }
    previewBarEl.hidden = false;
    previewBarEl.innerHTML = '<div class="preview-bar-in"><span>Previewing as <b>' + esc(PREVIEW.name) + '</b>' +
      (PREVIEW.blankMode ? " (blank view)" : "") + ' · Changes won\'t save or sync</span>' +
      '<button type="button" class="btn sm preview-exit" data-act="exit-preview">Exit preview</button></div>';
  }
  function renderTeacherBar() {
    if (!teacherBarEl) return;
    var h = (location.hash || "#/").split("?")[0];
    if (h === "#/teacher" || h === "#/sync") { teacherBarEl.hidden = true; teacherBarEl.innerHTML = ""; return; }
    var tData = activeTeacherData(), st = load();
    if (!tData || !tData.note || (tData.noteAt || 1) <= (st.dismissedNoteAt || 0)) {
      teacherBarEl.hidden = true; teacherBarEl.innerHTML = ""; return;
    }
    teacherBarEl.hidden = false;
    teacherBarEl.innerHTML = '<div class="teacher-bar-in"><div class="grow"><span class="pill">Note from teacher</span> <span class="tbar-txt">' + esc(tData.note) + '</span></div>' +
      '<button type="button" class="btn ghost sm" data-act="dismiss-t-note" data-at="' + esc(tData.noteAt || Date.now()) + '">Got it</button></div>';
  }
  function enterPreview(entry, blankMode) {
    var savedMem = PREVIEW ? PREVIEW.savedMem : load();
    var name = blankMode ? "New student" : ((entry && (entry.name || entry.id)) || "Student");
    var clonedState = (!blankMode && entry && entry.state) ? normalizeState(JSON.parse(JSON.stringify(entry.state))) : normalizeState(blank());
    if (!clonedState.planStart) clonedState.planStart = today();
    PREVIEW = {
      name: name,
      blankMode: !!blankMode,
      savedMem: savedMem,
      savedTeacher: (!blankMode && entry && isObj(entry.teacher)) ? JSON.parse(JSON.stringify(entry.teacher)) : null
    };
    mem = clonedState;
    Q = null; R = null; D = null;
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    RD = null;
    applyTeacherAssignments(PREVIEW.savedTeacher);
    renderPreviewBar();
    applyTheme();
    updateChrome();
    if (location.hash === "#/" || location.hash === "") route(false);
    else location.hash = "#/";
  }
  function exitPreview() {
    if (!PREVIEW) return;
    mem = PREVIEW.savedMem;
    PREVIEW = null;
    Q = null; R = null; D = null;
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    RD = null;
    renderPreviewBar();
    applyTheme();
    updateChrome();
    if (location.hash === "#/teacher") teacherView();
    else location.hash = "#/teacher";
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
    if (!HAS_DOM) return;
    xpEl.innerHTML = ICON.bolt + " " + load().xp + " XP";
    var n = 0;
    try { n = LIVE_LIST.length ? countDue() : 0; } catch (e) { n = 0; }
    if (n > 0) { dueEl.hidden = false; dueEl.textContent = n; dueEl.setAttribute("aria-label", n + " due"); } else dueEl.hidden = true;
    if (teacherPillEl && SYNC) teacherPillEl.hidden = !SYNC.hasTeacherConfig() || !!PREVIEW;
    updateSyncPill();
    renderTeacherBar();
  }
  function applyTheme() {
    if (!HAS_DOM) return;
    var t = load().theme;
    document.documentElement.setAttribute("data-theme", t);
    document.getElementById("th-quest").setAttribute("aria-pressed", String(t === "quest"));
    document.getElementById("th-focus").setAttribute("aria-pressed", String(t === "focus"));
  }
  function errorView(msg) {
    if (!HAS_DOM) return;
    setHeader("Something went wrong", "#/", {});
    app.innerHTML = '<div class="card"><h2>Something went wrong</h2><p class="muted">' + esc(msg) +
      '</p><a class="btn" href="#/">Go home</a></div>';
  }
  function isFocus() { return load().theme === "focus"; }

  /* ---------- home ---------- */
  function pickNextStop(subjFilter) {
    var st = load();
    // Prefer the chapter the student was most recently studying (if it matches the filter)
    var order = CHAPTER_LIST.slice();
    if (subjFilter && subjFilter !== "all") {
      order = order.filter(function (e) { return e.subj === subjFilter; });
    } else if (st.lastChapter && CHAPTERS[st.lastChapter]) {
      order.sort(function (a, b) { return a.key === st.lastChapter ? -1 : b.key === st.lastChapter ? 1 : 0; });
    }
    for (var i = 0; i < order.length; i++) {
      var ch = order[i].ch;
      var s = ch.stops.filter(function (x) { return !isDone(x.id, st, ch); })[0];
      if (s) return { ch: ch, s: s };
    }
    return null;
  }
  /* ---------- P5: Marks-weighted Today's Focus & Study Phases ---------- */
  function daysBetween(d1, d2) {
    var t1 = Date.parse(d1 + "T12:00:00"), t2 = Date.parse(d2 + "T12:00:00");
    if (isNaN(t1) || isNaN(t2)) return 0;
    return Math.round((t2 - t1) / 86400000);
  }
  function isWeekendDate(dStr) {
    var d = new Date(dStr + "T12:00:00").getDay();
    return d === 0 || d === 6;
  }
  function paperKeyForSubj(subjId) {
    return (subjId === "maths1" || subjId === "maths2") ? "maths" : subjId;
  }
  function studyPhase(paperKey, st) {
    st = st || load();
    var td = today(), dm = catalog.dailyMinutes || { weekday: 90, weekend: 180 };
    var tData = activeTeacherData() || {};
    var baseBudget = tData.dailyMin ? +tData.dailyMin : (isWeekendDate(td) ? (dm.weekend || 180) : (dm.weekday || 90));
    var pStart = catalog.practicalsStart || "2027-01-25";
    var pDiff = daysBetween(pStart, td);
    if (pDiff >= 0 && pDiff <= 10) {
      return { id: "practicals", label: "Practicals Week", budgetMin: Math.min(45, baseBudget), note: "Practicals week — keep theory light & protect your streak" };
    }
    var exams = catalog.exams || {};
    var targetDate = paperKey && exams[paperKey] ? exams[paperKey] : null;
    if (!targetDate) {
      var keys = Object.keys(exams);
      for (var i = 0; i < keys.length; i++) {
        var ed = exams[keys[i]];
        if (!targetDate || ed < targetDate) targetDate = ed;
      }
      targetDate = targetDate || catalog.examDate || "2027-02-15";
    }
    var left = daysBetween(td, targetDate);
    if (left >= 0 && left <= 10) {
      var title = (catalog.paperGroups && paperKey && catalog.paperGroups[paperKey]) ? catalog.paperGroups[paperKey].title : "Board";
      return { id: "sprint", label: "Final 10-Day Sprint", budgetMin: baseBudget, daysLeft: left, note: "Final 10-Day Sprint for " + title + " — focus on cockpit & past mistakes" };
    }
    if (left >= 0 && left <= 28) {
      return { id: "revise", label: "Revise & Mocks", budgetMin: baseBudget, daysLeft: left, note: "Target weak high-weightage chapters & timed papers" };
    }
    return { id: "learn", label: "Learn & Build", budgetMin: baseBudget, daysLeft: left, note: "Build concepts + daily Mistake Bank review + Mystery Drill" };
  }
  function todayFocusPlan(st, subjFilter) {
    st = st || load();
    var td = today(), pk = subjFilter && subjFilter !== "all" ? paperKeyForSubj(subjFilter) : null;
    var phase = studyPhase(pk, st), budget = phase.budgetMin;
    var da = dayAchievements(td, st);
    var tData = activeTeacherData() || {};
    var boost = tData.subjectBoost || "balanced";
    var blocks = [];
    var dueN = dueIds(st).length;
    if (dueN > 0) {
      blocks.push({
        id: "review",
        title: "Review Due (" + Math.min(10, dueN) + (dueN > 10 ? " of " + dueN : "") + ")",
        sub: "Clear Mistake Bank items before new topics",
        mins: Math.min(15, Math.max(10, Math.round(budget * 0.2))),
        done: da.reviews >= 1,
        href: "#/review"
      });
    }
    var bestStop = null, bestCh = null, bestScore = -1;
    if (tData.focus && CHAPTERS[tData.focus.chKey]) {
      var fc = CHAPTERS[tData.focus.chKey], fs = stopById(tData.focus.stopId, fc);
      if (fs && !isDone(fs.id, st, fc)) { bestCh = fc; bestStop = fs; }
    }
    if (!bestStop) {
      CHAPTER_LIST.forEach(function (e) {
        if (subjFilter && subjFilter !== "all" && e.subj !== subjFilter) return;
        var ch = e.ch;
        var nextS = ch.stops.filter(function (s) { return !isDone(s.id, st, ch); })[0];
        if (!nextS) return;
        var prog = chapterProgress(st, ch), m = prog.pct / 100;
        var mult = (boost !== "balanced" && paperKeyForSubj(e.subj) === boost) ? 1.5 : 1;
        var sc = (ch.examMarks ? (ch.examMarks.theory || 4) : 4) * (1 - m) * mult;
        if (sc > bestScore) { bestScore = sc; bestCh = ch; bestStop = nextS; }
      });
    }
    if (bestCh && bestStop) {
      blocks.push({
        id: "topic",
        title: bestStop.title,
        sub: chShortLabel(bestCh) + (bestStop.quest ? " · Quest" : " · Topic + PYQs"),
        mins: Math.min(35, Math.max(15, Math.round(budget * 0.35))),
        done: isDone(bestStop.id, st, bestCh) || da.stops >= 1,
        href: chBase(bestCh) + "/" + bestStop.id + (bestStop.quest ? "/quest" : "")
      });
    }
    var pracPk = pk || (bestCh ? paperKeyForSubj(bestCh.subject) : (boost !== "balanced" ? boost : "physics"));
    blocks.push({
      id: "practice",
      title: "Mystery Drill (6 Qs)",
      sub: ((catalog.paperGroups && catalog.paperGroups[pracPk]) ? catalog.paperGroups[pracPk].title : pracPk) + " · mixed chapters",
      mins: phase.id === "practicals" ? 15 : 25,
      done: da.rounds >= 1,
      href: "#/mix/" + pracPk
    });
    if (isWeekendDate(td) && budget >= 120) {
      var donePaperToday = Array.isArray(st.papers) && st.papers.some(function (p) { return p.date === td; });
      blocks.push({
        id: "mock",
        title: "Timed Section / Full Paper",
        sub: "Weekend 3-hr or 45-min section drill",
        mins: 60,
        done: donePaperToday,
        href: "#/paper/" + pracPk
      });
    }
    var doneCount = blocks.filter(function (b) { return b.done; }).length;
    return {
      date: td,
      phase: phase,
      budget: budget,
      blocks: blocks,
      doneCount: doneCount,
      totalCount: blocks.length,
      allDone: blocks.length > 0 && doneCount === blocks.length
    };
  }
  function subjectCountdownsHTML() {
    var exams = catalog.exams || {}, td = today();
    var pks = ["physics", "chemistry", "maths"];
    var h = '<div class="cd-strip" aria-label="Subject exam countdowns">';
    pks.forEach(function (pk) {
      if (!exams[pk]) return;
      var d = daysBetween(td, exams[pk]);
      var label = pk === "maths" ? "Maths" : pk.charAt(0).toUpperCase() + pk.slice(1);
      h += '<a class="cd-pill' + (d >= 0 && d <= 10 ? " urgent" : "") + '" href="#/revise/' + pk + '"><span>' + label + "</span><b>" + Math.max(0, d) + "d</b></a>";
    });
    h += "</div>";
    return h;
  }
  function todayFocusHTML(fp, pl) {
    var h = '<div class="card focus-card"><div class="row"><div class="grow"><h2>Today\'s Focus · ' + esc(fp.phase.label) + '</h2>' +
      '<p class="muted small">' + esc(fp.phase.note) + " · ~" + fp.budget + " min budget</p></div>" +
      '<span class="pill' + (fp.allDone ? " ok" : "") + '">' + fp.doneCount + "/" + fp.totalCount + "</span></div>";
    if (fp.allDone) h += '<div class="fb ok" style="margin-top:8px">Done for today ✓ — great consistency!</div>';
    h += '<div class="focus-list">' + fp.blocks.map(function (b) {
      return '<a class="focus-item' + (b.done ? " done" : "") + '" href="' + b.href + '">' +
        '<span class="num' + (b.done ? " ok" : "") + '">' + (b.done ? ICON.checkS : ICON.play) + '</span>' +
        '<span class="grow"><b>' + esc(b.title) + '</b><br><span class="muted small">' + esc(b.sub) + '</span></span>' +
        '<span class="focus-mins">' + b.mins + "m</span></a>";
    }).join("") + "</div>";
    h += '<details class="how" style="margin-top:10px"><summary>Full syllabus pace</summary>' + planHTML(pl) + "</details></div>";
    return h;
  }

  function homeView() {
    setHeader("HSC Board Prep", null, { tab: "home" });
    var st = load(), left = daysLeft(catalog.examDate), dt = doneToday(st);
    var pl = planInfo(st, homeSubj), remaining = Math.max(0, pl.pace - dt);
    var totProg = totalActiveProgress(st), due = countDue(st);
    var fp = todayFocusPlan(st, homeSubj);
    var h = "";

    // Subject filter pills
    h += '<div class="pills-row" role="group" aria-label="Filter by subject">' +
      '<button type="button" class="pill-btn" data-act="home-subj" data-subj="all" aria-pressed="' + (homeSubj === "all") + '">All</button>' +
      catalog.subjects.map(function (sub) {
        return '<button type="button" class="pill-btn" data-act="home-subj" data-subj="' + esc(sub.id) + '" aria-pressed="' + (homeSubj === sub.id) + '">' + esc(sub.title) + "</button>";
      }).join("") + "</div>";

    h += subjectCountdownsHTML();
    var sprintPk = null;
    ["physics", "chemistry", "maths"].forEach(function (pk) {
      if (!sprintPk && studyPhase(pk, st).id === "sprint") sprintPk = pk;
    });
    if (sprintPk) {
      var spTitle = (catalog.paperGroups && catalog.paperGroups[sprintPk]) ? catalog.paperGroups[sprintPk].title : sprintPk;
      h += '<a class="card cont-card sprint-card" href="#/revise/' + sprintPk + '"><span class="num amber">' + ICON.bolt + '</span><span class="grow"><b>Final 10-Day Sprint · ' + esc(spTitle) + ' Cockpit</b><br><span class="muted small">Formulas, Top 25 PYQs, Past Mistakes &amp; Exam Constants</span></span>' + ICON.chev + "</a>";
    }

    var tData = activeTeacherData();
    if (tData && isObj(tData.focus) && CHAPTERS[tData.focus.chKey]) {
      var fCh = CHAPTERS[tData.focus.chKey], fStop = stopById(tData.focus.stopId, fCh);
      if (fStop) {
        h += '<a class="card cont-card t-focus-card" href="' + chBase(fCh) + "/" + fStop.id + (fStop.quest ? "/quest" : "") + '"><span class="num">' + ICON.play + '</span><span class="grow"><b>Assigned by teacher: ' + esc(fStop.title) + '</b><br><span class="small">' + esc(chShortLabel(fCh)) + ' · Stop ' + (stopIndex(fStop.id, fCh) + 1) + ' · p. ' + esc(fStop.page) + (isDone(fStop.id, st, fCh) ? " · Done ✓" : "") + '</span></span>' + ICON.chev + "</a>";
      }
    }

    var ri = resumeInfoAll(), rr = roundRestoreAll(), nextPair = pickNextStop(homeSubj);
    var showRound = !!rr && (!ri || (rr.run.at || 0) > ri.at);
    if (showRound) {
      h += '<a class="card cont-card" href="' + chBase(rr.ch) + '/round/run"><span class="num">' + ICON.play + '</span><span class="grow"><b>Continue: ' + esc(chShortLabel(rr.ch)) + ' Board round · Q' + (rr.run.i + 1) + " of " + rr.run.ids.length + '</b><br><span class="small">Pick up where you stopped</span></span>' + ICON.chev + "</a>";
    } else if (ri) {
      h += '<a class="card cont-card" href="' + chBase(ri.ch) + "/" + ri.s.id + '/quest"><span class="num">' + ICON.play + '</span><span class="grow"><b>Continue: ' + esc(ri.s.title) + " · " + progressText(ri.q) + '</b><br><span class="small">' + esc(chShortLabel(ri.ch)) + ' · pick up where you stopped</span></span>' + ICON.chev + "</a>";
    } else if (nextPair) {
      h += '<a class="card cont-card" href="' + chBase(nextPair.ch) + "/" + nextPair.s.id + (nextPair.s.quest ? "/quest" : "") + '"><span class="num">' + ICON.play + '</span><span class="grow"><b>Next up: ' + esc(nextPair.s.title) + '</b><br><span class="small">' + esc(chShortLabel(nextPair.ch)) + ' · Stop ' + (stopIndex(nextPair.s.id, nextPair.ch) + 1) + " · p. " + esc(nextPair.s.page) + "</span></span>" + ICON.chev + "</a>";
    }
    if (tData && isObj(tData.reward)) {
      var rp = rewardProgress(tData.reward, st);
      if (rp) {
        h += '<div class="card reward-card' + (rp.done ? " done" : "") + '"><div class="row"><span class="ricon">' + ICON.trophy + '</span><div class="grow"><b>Reward: ' + esc(tData.reward.title) + '</b><div class="small muted">' + esc(rp.label) + '</div></div><span class="pill ' + (rp.done ? "ok" : "amber") + '">' + (rp.done ? "Unlocked!" : esc(rp.text)) + '</span></div>' +
          '<div class="bar' + (rp.done ? "" : " amber") + '" style="margin-top:10px"><i style="width:' + rp.pct + '%"></i></div></div>';
      }
    }
    if (isFocus()) {
      h += '<div class="card countdown"><div class="cd-num">' + left + '</div><div class="cd-lab">days to the board exam · ' + esc(niceDate(catalog.examDate)) + '</div>' +
        '<div class="bar thin amber" role="progressbar" aria-valuenow="' + totProg.pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Active chapters progress"><i style="width:' + totProg.pct + '%"></i></div>' +
        '<div class="cd-foot small muted"><span>Active chapters: ' + totProg.done + " of " + totProg.total + ' stops done</span><span>Streak ' + streak(st) + ' d · ' + st.xp + ' XP</span></div></div>';
    } else {
      h += '<div class="card streak">' + ICON.flame + '<div class="grow"><b class="s-big">' + streak(st) + '-day streak</b>' +
        '<div class="muted">' + (fp.allDone ? "Today's focus done ✓" : (fp.totalCount - fp.doneCount) + " focus blocks left today") + '</div></div>' +
        '<div class="s-days"><b>' + left + '</b><span>days to exam</span></div></div>';
    }
    if (due > 0) {
      h += '<a class="card review-card" href="#/review"><span class="num amber">' + due + '</span><span class="grow"><b>Review: ' + due + ' due</b><br><span class="muted small">Redo what you got wrong across subjects</span></span>' + ICON.chev + "</a>";
    }
    h += todayFocusHTML(fp, pl) + homeGaugeHTML(st, homeSubj) + errorBreakdownHTML(st, 14, 2);
    h += '<div class="card"><h2>Exam Practice</h2><p class="muted small">Interleaved 6-Q Mystery Drills (no chapter hint) &amp; full 3-hr MSBSHSE Board Papers.</p>' +
      '<div class="practice-grid">' +
      '<a class="btn ghost" href="#/mix/physics">Physics Mystery</a>' +
      '<a class="btn ghost" href="#/mix/chemistry">Chemistry Mystery</a>' +
      '<a class="btn ghost" href="#/mix/maths">Maths Mystery</a>' +
      '<a class="btn primary" href="#/paper">Board Paper Simulator</a>' +
      "</div></div>";

    // Subjects & Chapters
    var subsToShow = homeSubj === "all" ? catalog.subjects : catalog.subjects.filter(function (s) { return s.id === homeSubj; });
    subsToShow.forEach(function (sub) {
      var liveCount = sub.chapters.filter(function (c) { return !!c.file; }).length;
      h += '<div class="card"><div class="row"><h2 class="grow">' + esc(sub.title) + '</h2><span class="small muted">' + liveCount + ' of ' + sub.chapters.length + ' live</span></div><ul class="list">' +
        sub.chapters.map(function (c) {
          var key = chKeyOf(sub.id, c.id), chObj = CHAPTERS[key];
          if (!c.file) return '<li><div class="soon"><span class="num">' + c.number + '</span><span class="grow">' + esc(c.title) + '<br><span class="small">Coming soon</span></span></div></li>';
          var p = chObj ? chapterProgress(st, chObj) : { done: doneCount(st, key), total: c.stopCount || 0, pct: (c.stopCount ? Math.round(100 * doneCount(st, key) / c.stopCount) : 0) };
          var rc = roundComplete(st, key);
          var metaCh = chObj || { subject: sub.id, id: c.id, number: c.number };
          var baseHref = "#/" + sub.id + "/" + c.id;
          var boardN = chObj ? chObj.board.length : (c.boardCount || 0);
          var isLite = !!(c.lite || (chObj && chObj.lite));
          return '<li><a class="item" href="' + baseHref + '"><span class="num">' + c.number + '</span>' +
            '<span class="grow"><b>' + esc(c.title) + '</b>' + (isLite ? ' <span class="pill">PYQs + Formulas</span>' : "") + '<div class="bar" style="margin-top:6px"><i style="width:' + p.pct + '%"></i></div>' +
            '<span class="muted small">' + p.done + " of " + p.total + " stops</span></span>" + ICON.chev + "</a>" +
            '<a class="rlink" href="' + baseHref + '/round"><span class="ricon">' + ICON.trophy + '</span><span class="grow"><b>Board round</b><br><span class="muted small">' + boardN + " exam questions · open now</span>" + (rc ? "<br>" + badgeHTML("home", st, metaCh) : "") + "</span>" + ICON.chev + "</a></li>";
        }).join("") + "</ul></div>";
    });
    if (!isFocus()) {
      h += '<div class="stats"><div class="stat"><b>' + st.xp + '</b><span>XP</span></div><div class="stat"><b>' + totProg.done + "/" + totProg.total + '</b><span>stops done</span></div><div class="stat"><b>' + countBank(st) + '</b><span>in mistake bank</span></div></div>';
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
    setHeader(chShortLabel(CH) + " · " + CH.title, "#/", { xp: true, tab: "map" });
    var prog = chapterProgress();
    var firstOpen = CH.stops.filter(function (s) { return !isDone(s.id); })[0];
    var startPage = CH.startPage || 1;
    var h = '<div class="card"><div class="row"><div class="grow"><b>' + prog.done + " of " + prog.total + ' stops</b>' +
      (CH.lite ? ' <span class="pill">PYQs + Formulas</span>' : "") +
      '<div class="bar" style="margin-top:6px"><i style="width:' + prog.pct + '%"></i></div></div><b>' + prog.pct + '%</b></div>' +
      (roundComplete() ? '<div class="cb-row">' + badgeHTML("page") + "</div>" : "") +
      '<div class="chips">' + bookChip(CH.book, startPage, "Chapter in textbook") + "</div>" +
      '<p class="note">Textbook pages ' + esc(CH.printedPages) + ". The Drive viewer can't jump to a page, so use the PDF page number shown.</p></div>";
    h += gaugeHTML();
    var pyqN = CH.board.filter(isBoardPYQ).length, impN = CH.board.length - pyqN;
    var drillTitle = CH.drillLabel || "Derivation drills";
    var formTitle = CH.formulaLabel || "Formula card";
    var derivs = CH.derivations || [];
    h += '<div class="tiles"><a class="tile" href="' + BASE + '/board"><b>Board questions</b><span class="muted small">' + pyqN + ' PYQs' + (impN ? ' + ' + impN + ' imp' : '') + '</span></a>' +
      (derivs.length ? '<a class="tile" href="' + BASE + '/derive"><b>' + esc(drillTitle) + '</b><span class="muted small">' + derivs.length + ' drills</span></a>' :
        '<div class="tile muted" aria-disabled="true"><b>' + esc(drillTitle) + '</b><span class="muted small">Drills coming soon</span></div>') +
      '<a class="tile" href="#/formulas"><b>' + esc(formTitle) + '</b><span class="muted small">All of Ch ' + CH.number + '</span></a></div>';
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
  function getBqDraft(q, st) {
    var pts = qPoints(q);
    var d = bqDraft[q.id];
    if (!d || !Array.isArray(d.ticks) || d.ticks.length !== pts.length) {
      var bp = (st || load()).boardPts && (st || load()).boardPts[q.id];
      var allGot = !!(bp && bp.of > 0 && bp.got >= bp.of);
      d = { ticks: pts.map(function () { return allGot; }), err: (bp && bp.err) || "" };
      bqDraft[q.id] = d;
    }
    return d;
  }
  function boardCard(q, withStop) {
    var st = load();
    var bkey = bankId("b", q.id);
    var r = st.board[q.id], bp = st.boardPts && st.boardPts[q.id], inBank = !!st.bank[bkey], open = !!revealed[q.id];
    var s = stopById(q.stop);
    var h = '<article class="bq" data-q="' + esc(q.id) + '"><div class="bq-top">' + tag(boardTag(q)) +
      '<span class="marks">' + marksWord(q.marks) + "</span>" +
      (q.kind ? '<span class="kind">' + esc(kindLabel(q.kind)) + "</span>" : "") + "</div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>";
    if (q.options) h += '<ul class="bq-opts">' + q.options.map(function (o) { return "<li>" + fm(o) + "</li>"; }).join("") + "</ul>";
    if (withStop && s) h += '<p class="small muted">Stop ' + (stopIndex(s.id) + 1) + ': <a href="' + BASE + "/" + s.id + '">' + esc(s.title) + "</a></p>";

    if (!open) {
      h += '<div class="rate">' +
        '<button type="button" class="btn ghost" data-act="reveal" aria-expanded="false">Show model answer</button>' +
        '<button type="button" class="btn warn' + (r === "need" || r === "practice" ? "" : " ghost") + '" data-act="rate-need" aria-pressed="' + (r === "need" || r === "practice") + '">Need practice</button></div>';
      if (bp && bp.of > 0) h += '<p class="small muted"><span class="pill ' + (bp.got >= bp.of ? "ok" : "amber") + '">Saved: ' + bp.got + " / " + bp.of + " marks</span></p>";
      else if (r === "got") h += '<p class="small muted"><span class="pill ok">Marked Got it (tap Show model answer to point-mark)</span></p>';
      else h += '<p class="small muted">Write your answer on paper first, then open the model answer to mark examiner points.</p>';
    } else {
      var pts = qPoints(q), draft = getBqDraft(q, st), got = 0;
      pts.forEach(function (x, k) { if (draft.ticks[k]) got += +x.marks || 0; });
      var allOn = draft.ticks.every(Boolean);
      h += '<div class="rate"><button type="button" class="btn ghost" data-act="reveal" aria-expanded="true">Hide model answer</button>' +
        '<button type="button" class="btn ghost sm" data-act="bq-all" aria-pressed="' + allOn + '">' + (allOn ? "Clear ticks" : "All correct ✓") + "</button></div>";
      h += modelAnswerHTML(q);
      h += pointsHTML(q, draft.ticks, "bq-tick");
      if (got < q.marks) h += errPillsHTML(draft.err, "bq-err", q.id);
      h += '<div class="rate"><button type="button" class="btn primary" data-act="bq-save">Save score (' + got + " / " + q.marks + " marks)</button>" +
        '<button type="button" class="btn warn' + (r === "need" || r === "practice" ? "" : " ghost") + '" data-act="rate-need" aria-pressed="' + (r === "need" || r === "practice") + '">Need practice</button></div>';
      if (bp && bp.of > 0) h += '<p class="small muted"><span class="pill ' + (bp.got >= bp.of ? "ok" : "amber") + '">Saved: ' + bp.got + " / " + bp.of + " marks</span></p>";
    }
    if ((r === "need" || r === "practice") && inBank) h += '<p class="small muted">In your mistake bank. Review: ' + niceDate(st.bank[bkey].due) + ".</p>";
    return h + "</article>";
  }

  /* ---------- stop ---------- */
  function stopView(stopId) {
    var i = stopIndex(stopId);
    if (i < 0) return errorView("That stop doesn't exist.");
    var s = CH.stops[i], done = isDone(s.id), qr = load().quest[K(s.id)], sq = restoreQuest(s);
    setHeader((i + 1) + ". " + s.title, BASE, { xp: true, tab: "map" });
    var h = '<div class="card"><h2>In short</h2><p>' + fm(s.inShort) + "</p></div>";
    if (s.quest) {
      var nChecks = s.quest.checks.length;
      h += '<div class="card quest-card"><div class="row"><div class="grow"><h2>Quest' + (done ? ' <span class="pill ok">' + ICON.checkS + " Done</span>" : "") + "</h2>" +
        '<p class="muted small">' + s.quest.cards.length + " concept cards, then " + nChecks + " checks. Up to " + nChecks * XP_FIRST + " XP." +
        (qr ? " Best score: <b>" + qr.best + "/" + nChecks + "</b>." : "") + "</p></div></div>" +
        (sq ? '<a class="btn primary block" href="' + BASE + "/" + s.id + '/quest">Resume quest · ' + progressText(sq) + '</a><button type="button" class="btn ghost block" style="margin-top:8px" data-act="q-over" data-stop="' + esc(s.id) + '">Start over</button>' :
          '<a class="btn primary block" href="' + BASE + "/" + s.id + '/quest">' + (qr ? "Replay quest" : "Start quest") + "</a>") +
        (done ? '<p class="note">Completed ' + niceDate(load().done[K(s.id)]) + ". Finish with at least " + PASS_MARK + " of " + nChecks + " correct to count a stop as done.</p>" :
          '<p class="note">Finish with at least ' + PASS_MARK + " of " + nChecks + " correct to complete this stop. Read the textbook section first for the full story.</p>") + "</div>";
    } else {
      h += '<div class="card quest-card"><div class="row"><div class="grow"><h2>Topic revision' + (done ? ' <span class="pill ok">' + ICON.checkS + " Revised</span>" : "") + "</h2>" +
        '<p class="muted small">Read the textbook section, then mark this topic revised (+5 XP once) and practise its board questions.</p></div></div>' +
        '<button type="button" class="btn ' + (done ? "ghost" : "primary") + ' block" data-act="stop-revised" data-stop="' + esc(s.id) + '">' + (done ? "Revised on " + niceDate(load().done[K(s.id)]) : "Mark topic revised (+5 XP)") + "</button>" +
        '<a class="btn ' + (done ? "primary" : "ghost") + ' block" style="margin-top:8px" href="' + BASE + '/board">Practise board questions</a></div>';
    }
    h += '<div class="card"><h2>Textbook sections</h2><ul class="sections">' +
      s.sections.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<div class="chips">' + bookChip(CH.book, s.page, (catalog.books[CH.book] && catalog.books[CH.book].label) || "Std XII") +
      (s.figs || []).map(function (f) { return '<span class="chip">' + esc(f) + "</span>"; }).join("") + "</div></div>";
    if (s.xi && s.xi.length) {
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
  // Options are shown in a fresh random order on every attempt so the student learns the content, not the letter.
  // Selection is still stored as the ORIGINAL option index, so scoring and saved progress are unaffected.
  // Options that refer to other options by position ("both of the above", "option A") keep their order.
  var ORDER_BOUND = /\b(above|below|both of|none of|all of|options? [a-d]\b|\([a-d]\) and)/i;
  function shuffledOrder(n) {
    var o = [];
    for (var i = 0; i < n; i++) o.push(i);
    for (var j = n - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)), t = o[j]; o[j] = o[k]; o[k] = t; }
    return o;
  }
  function optionOrder(chk) {
    var opts = chk.type === "tf" ? null : chk.options;
    if (!Array.isArray(opts) || opts.length < 3) return null;
    for (var i = 0; i < opts.length; i++) if (ORDER_BOUND.test(String(opts[i]))) return null;
    return shuffledOrder(opts.length);
  }
  function newCE(chk, mode) {
    return {
      chk: chk, mode: mode, attempt: 0, hint: false, sel: null, val: "",
      unitSel: null, unitOrder: Array.isArray(chk.unitOpts) ? shuffledOrder(chk.unitOpts.length) : null, unitWrong: false,
      status: "ask", gain: 0, msg: "", conf: null, flag: "", order: optionOrder(chk)
    };
  }
  function ceOptions(chk) { return chk.type === "tf" ? ["True", "False"] : chk.options; }
  function ceAnswerIdx(chk) { return chk.type === "tf" ? (chk.answer ? 0 : 1) : chk.answer; }
  function ceAnswerText(chk) {
    if (chk.type === "num") return chk.answer + (chk.unit ? " " + chk.unit : "");
    return ceOptions(chk)[ceAnswerIdx(chk)];
  }
  var SUP_MAP = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
  function parseSingleTerm(t) {
    t = t.trim();
    if (!t) return NaN;
    if (/^[-+]?pi$/i.test(t)) return t.charAt(0) === "-" ? -Math.PI : Math.PI;
    var mpi = t.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\*?\s*pi$/i);
    if (mpi) return parseFloat(mpi[1]) * Math.PI;
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
    return NaN;
  }
  function parseNum(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return NaN;
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, function (m) {
      return "^" + m.split("").map(function (ch) { return SUP_MAP[ch] || ch; }).join("");
    });
    s = s.replace(/[×·]/g, "*").replace(/−/g, "-").replace(/π/g, "pi");
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    s = s.replace(/\s*\*\s*10\s*\^?\s*\(?\s*([-+]?\d+)\s*\)?/gi, "e$1");
    s = s.replace(/^([-+]?)10\s*\^\s*\(?\s*([-+]?\d+)\s*\)?$/i, "$11e$2");
    if (s.indexOf("/") >= 0) {
      var parts = s.split("/");
      if (parts.length !== 2) return NaN;
      var num = parseSingleTerm(parts[0]), den = parseSingleTerm(parts[1]);
      if (isNaN(num) || isNaN(den) || den === 0) return NaN;
      return num / den;
    }
    return parseSingleTerm(s);
  }
  function ceIsCorrect(ce) {
    var c = ce.chk;
    if (c.type === "num") {
      var v = parseNum(ce.val);
      var numOk = !isNaN(v) && (c.answer === 0 ? Math.abs(v) <= 1e-6 : Math.abs(v - c.answer) <= TOL * Math.abs(c.answer));
      if (Array.isArray(c.unitOpts) && c.unitOpts.length) {
        ce.unitWrong = numOk && ce.unitSel !== c.unit;
        return numOk && ce.unitSel === c.unit;
      }
      ce.unitWrong = false;
      return numOk;
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
      var hasUOpts = Array.isArray(c.unitOpts) && c.unitOpts.length > 0;
      h += '<div class="numrow"><input id="numin" class="numin" type="text" inputmode="decimal" autocomplete="off" aria-label="Your answer" placeholder="Your answer" value="' + esc(ce.val) + '"' + (locked ? " disabled" : "") + '>' +
        (hasUOpts ? "" : '<span class="unit">' + fm(c.unit || "") + "</span>") + "</div>";
      if (hasUOpts) {
        var uOrd = Array.isArray(ce.unitOrder) && ce.unitOrder.length === c.unitOpts.length ? ce.unitOrder : c.unitOpts.map(function (_, i) { return i; });
        h += '<div class="unit-box"><span class="small muted">Pick SI unit:</span><div class="err-pills">' +
          uOrd.map(function (ui) {
            var u = c.unitOpts[ui];
            return '<button type="button" class="err-pill' + (ce.unitSel === u ? " on" : "") + '" data-act="ce-unit" data-u="' + esc(u) + '" aria-pressed="' + (ce.unitSel === u) + '"' + (locked ? " disabled" : "") + ">" + fm(u) + "</button>";
          }).join("") + "</div></div>";
      }
    } else {
      var allOpts = ceOptions(c), ord = Array.isArray(ce.order) && ce.order.length === allOpts.length ? ce.order : allOpts.map(function (_, n) { return n; });
      h += '<div class="opts" role="radiogroup">' + ord.map(function (i, pos) {
        var o = allOpts[i], cls = "opt";
        if (ce.sel === i) cls += " sel";
        if (locked && st === "right" && ce.sel === i) cls += " right";
        if (locked && st !== "right" && ce.sel === i) cls += " wrong";
        if (st === "failed" && ceAnswerIdx(c) === i) cls += " right";
        return '<button type="button" class="' + cls + '" role="radio" aria-checked="' + (ce.sel === i) + '" data-act="ce-pick" data-i="' + i + '"' + (locked ? " disabled" : "") + '><span class="ltr">' + "ABCDEF".charAt(pos) + "</span><span>" + fm(o) + "</span></button>";
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
      h += '<div class="fb bad" role="status"><b>' + (ce.unitWrong ? "Number is right, but check the SI unit! Board exams deduct ½–1 mark for a wrong/missing unit." : "Not quite.") + "</b> " + (!ce.unitWrong && c.hint ? "Hint: " + fm(c.hint) : (!ce.unitWrong ? "Have another look." : "")) +
        ' <span class="small muted">Re-read textbook p. ' + esc(c.page) + ". The full working shows after your next try.</span></div>" +
        '<button type="button" class="btn primary block" data-act="ce-retry">Try again (' + XP_SECOND + " XP)</button>";
    } else if (st === "right") {
      h += '<div class="fb good" role="status"><b>Correct!' + (ce.mode === "quest" ? " +" + ce.gain + " XP" : "") + "</b> " + fm(c.explain) + '<div class="small muted">Textbook p. ' + esc(c.page) + "</div>" +
        (ce.flag === "guessed" ? '<div class="small">You were guessing, so this is saved to your mistake bank for tomorrow.</div>' : "") + "</div>" +
        '<button type="button" class="btn primary block" data-act="ce-next">Next</button>';
    } else {
      h += '<div class="fb bad" role="status"><b>' + (ce.unitWrong ? "Number is right, but check the SI unit! " : "") + "The answer is " + fm(ceAnswerText(c)) + ".</b> " + fm(c.explain) + '<div class="small muted">Textbook p. ' + esc(c.page) + "</div>" +
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
    if (!s.quest) return stopView(stopId);
    if (fresh) { var st = load(); delete st.qp[K(s.id)]; st.qpDel[K(s.id)] = Date.now(); save(); }
    Q = (fresh ? null : restoreQuest(s)) || { stop: s, chKey: curChKey(), phase: "cards", ci: 0, ki: 0, ce: null, results: [], xp: 0, added: 0 };
    Q.chKey = curChKey();
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
    setHeader("Board questions · " + chShortLabel(CH), BASE, { xp: true, tab: "map" });
    var note = CH.boardNote || "No 2024 paper available yet.";
    var h = '<div class="card"><p>Previously asked ' + esc(chShortLabel(CH)) + ' board questions come first in every marks group, followed by derived important textbook questions. No duplicates.</p>' +
      '<p class="note"><b>' + esc(note) + '</b> Tap “Need practice” to add a question to your mistake bank.</p></div>';
    [1, 2, 3, 4].forEach(function (m) {
      var list = CH.board.filter(function (b) { return b.marks === m; }).sort(boardPriorityCmp);
      if (!list.length) return;
      h += '<h2 class="grp">' + m + (m === 1 ? " mark" : " marks") + ' <span class="muted small">' + list.length + " question" + (list.length > 1 ? "s" : "") + "</span></h2>" +
        '<div class="card">' + list.map(function (q) { return boardCard(q, true); }).join("") + "</div>";
    });
    app.innerHTML = h;
  }


  /* ---------- board round (final stop of each chapter, per-chapter storage) ---------- */
  var RD = null;                   // { chKey, run, phase: "run" | "result" } for the round on screen
  var rTimer = null, tOff = 0;     // 1 s interval for the mock clock; test hook offset (ms)
  var MIN_PER_MARK = 90;           // seconds per mark in the timed mock
  var PASS_PCT = 80;
  var MODE_NAME = { m1: "1-mark questions", m2: "2-mark questions", m3: "3-mark questions", m4: "4-mark questions", most: "Most asked first", mock: "Timed mock" };
  function nowMs() { return Date.now() + tOff; }
  function RS(st, chKey) {
    var s = st || load(), key = chKey || curChKey();
    if (key === "physics/ch01") return s.round;
    if (!isObj(s.rounds)) s.rounds = {};
    if (!isObj(s.rounds[key])) s.rounds[key] = blankRound();
    return s.rounds[key];
  }
  function validMode(m) { return Object.prototype.hasOwnProperty.call(MODE_NAME, m); }
  function totalMarks(ids, ch) { return ids.reduce(function (a, id) { var q = getBoard(id, ch); return a + (q ? q.marks : 0); }, 0); }
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
  function roundComplete(st, chKey) { return !!(RS(st, chKey).complete); }
  function badgeText(st, ch) {
    var target = ch || CH, r = RS(st, chKeyFor(target));
    return "Chapter " + target.number + " complete · best board round " + r.bestFull + "%";
  }
  function badgeHTML(where, st, ch) {
    var target = ch || CH;
    return roundComplete(st, chKeyFor(target)) ? '<span class="cbadge" data-badge="' + where + '">' + ICON.trophy.replace('width="28" height="28"', 'width="16" height="16"') + " " + esc(badgeText(st, target)) + "</span>" : "";
  }

  /* clock: elapsed is counted from timestamps, so it stays right if the tab sleeps */
  function runElapsed(r) { return r.elapsed + (r.since ? nowMs() - r.since : 0); }
  function rebase(r) { if (r.since) { r.elapsed = runElapsed(r); r.since = nowMs(); } }
  function saveRound(silent) {
    var run = RD && RD.phase === "run" ? RD.run : null;
    if (!run) return;
    rebase(run); run.at = Date.now();
    RS(null, RD.chKey).run = run; save(silent ? { silentSync: true } : {});
  }
  function roundRestore(ch) {
    var target = ch || CH, key = chKeyFor(target), rs = RS(null, key), r = rs.run;
    if (!r) return null;
    var ok = isObj(r) && validMode(r.mode) && Array.isArray(r.ids) && r.ids.length && r.ids.every(function (id) { return !!getBoard(id, target); }) &&
      typeof r.i === "number" && r.i >= 0 && r.i < r.ids.length && Array.isArray(r.results) && r.results.length === r.i;
    if (!ok) { rs.run = null; rs.runDel = Date.now(); save(); return null; }
    var q = getBoard(r.ids[r.i], target), np = qPoints(q).length;
    if (!Array.isArray(r.ticks)) r.ticks = [];
    r.ticks = r.ticks.slice(0, np).map(function (x) { return !!x; });
    while (r.ticks.length < np) r.ticks.push(false);
    r.rev = !!r.rev;
    if (!(RD && RD.chKey === key && RD.run === r)) { r.since = 0; r.resumed = true; }   // a reloaded mock comes back paused
    r.elapsed = +r.elapsed > 0 ? +r.elapsed : 0;
    if (r.mode === "mock") { r.limit = totalMarks(r.ids, target) * MIN_PER_MARK; r.timeUp = !!r.timeUp; }
    return r;
  }
  function roundRestoreAll() {
    var best = null;
    CHAPTER_LIST.forEach(function (e) {
      var r = roundRestore(e.ch);
      if (r && (!best || (r.at || 0) > (best.run.at || 0))) best = { ch: e.ch, run: r };
    });
    return best;
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
  if (HAS_WIN) window.__roundAdvance = function (sec) { tOff += sec * 1000; roundTick(); };   // test hook: fake the passing of time

  function roundStart(mode) {
    if (!validMode(mode)) return;
    var ids = modeIds(mode);
    if (!ids.length) return;
    var run = { mode: mode, ids: ids, i: 0, results: [], ticks: qPoints(getBoard(ids[0])).map(function () { return false; }), rev: false,
      err: "", errs: {}, elapsed: 0, since: 0, at: Date.now() };
    if (mode === "mock") { run.limit = totalMarks(ids) * MIN_PER_MARK; run.timeUp = false; run.since = nowMs(); }
    RD = { chKey: curChKey(), run: run, phase: "run" };
    saveRound(false);
    if (location.hash === BASE + "/round/run") route(false); else location.hash = BASE + "/round/run";
  }
  function roundNext() {
    var run = RD.run, q = getBoard(run.ids[run.i]), pts = qPoints(q), got = 0;
    pts.forEach(function (x, k) { if (run.ticks[k]) got += +x.marks || 0; });
    run.results.push({ id: q.id, got: got, of: q.marks }); run.resumed = false;
    var st = load(), now = Date.now();
    var err = got < q.marks ? (run.err || "") : "";
    st.boardAt[q.id] = now;
    if (!isObj(st.boardPts)) st.boardPts = {};
    st.boardPts[q.id] = { got: got, of: q.marks, at: now, err: err };
    if (err) {
      if (!isObj(run.errs)) run.errs = {};
      run.errs[err] = (run.errs[err] || 0) + 1;
      logError(q.id, RD.chKey, err, st);
    }
    if (got >= q.marks) { st.board[q.id] = "got"; save(); }
    else { st.board[q.id] = "practice"; bankAdd(bankId("b", q.id), "below full marks", err); }
    run.err = "";
    if (run.i < run.ids.length - 1) {
      run.i++; run.rev = false; run.ticks = qPoints(getBoard(run.ids[run.i])).map(function () { return false; });
      saveRound(false); roundRender(true);
    } else roundFinish();
  }
  function roundFinish() {
    var run = RD.run, chKey = RD.chKey || curChKey(), ch = CHAPTERS[chKey] || CH, rs = RS(null, chKey), got = 0, of = 0, now = Date.now();
    run.results.forEach(function (r) { got += r.got; of += r.of; });
    rebase(run);
    var rec = { mode: run.mode, ids: run.ids, results: run.results, got: got, of: of, pct: pctOf(got, of), date: today(), at: now, newlyComplete: false };
    if (run.limit) { rec.secs = Math.min(Math.round(run.elapsed / 1000), run.limit); rec.limit = run.limit; rec.timeUp = !!run.timeUp; }
    var m = isObj(rs.modes[run.mode]) ? rs.modes[run.mode] : (rs.modes[run.mode] = {});
    m.last = { got: got, of: of, pct: rec.pct, date: rec.date, at: now };
    if (!isObj(m.best) || rec.pct > m.best.pct) m.best = { got: got, of: of, pct: rec.pct, date: rec.date };
    var full = run.ids.length === ch.board.length && (run.mode === "most" || run.mode === "mock");
    if (full) {
      rs.bestFull = Math.max(rs.bestFull, rec.pct);
      if (got * 100 >= PASS_PCT * of) { if (!rs.complete) rec.newlyComplete = true; rs.complete = true; }
    }
    rec.full = full;
    var st = load();
    if (!isObj(st.roundHist)) st.roundHist = {};
    if (!Array.isArray(st.roundHist[chKey])) st.roundHist[chKey] = [];
    var slim = { at: now, date: rec.date, mode: run.mode, got: got, of: of, pct: rec.pct };
    if (rec.secs) slim.secs = rec.secs;
    if (isObj(run.errs) && Object.keys(run.errs).length) slim.errs = run.errs;
    st.roundHist[chKey].unshift(slim);
    if (st.roundHist[chKey].length > 20) st.roundHist[chKey] = st.roundHist[chKey].slice(0, 20);
    lastRoundChKey = chKey;
    rs.last = rec; rs.run = null; rs.runDel = now; save({ immediate: true }); updateChrome();
    RD = { chKey: chKey, run: null, phase: "result", rec: rec };
    roundRender(true);
  }

  /* ---------- board round: pages ---------- */
  function roundPickerView() {
    setHeader("Board round · " + chShortLabel(CH), BASE, { tab: "map" });
    var rs = RS(), run = roundRestore(), f = isFocus(), n = CH.board.length, tm = totalMarks(modeIds("most"));
    var h = '<div class="card round-intro' + (f ? " dense" : "") + '">' + (f ? "" : '<div class="r-art" aria-hidden="true">' + ICON.trophy.replace('width="28" height="28"', 'width="64" height="64"') + "</div>") +
      '<div class="grow"><h2>Board round</h2><p class="small muted">' + n + " exam questions from " + esc(chShortLabel(CH)) + ", marked by you against examiner points. Try it any time.</p></div></div>";
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
    h += '<div class="card rmode" data-mode-card="most"><div class="row"><div class="grow"><h2>Most asked first</h2><p class="small muted">All ' + n + " questions. Previously asked PYQs come first.</p>" + scoreLine("most") +
      '</div></div><button type="button" class="btn primary block" data-act="round-start" data-mode="most">Start</button></div>';
    h += '<div class="card rmode" data-mode-card="mock"><div class="row"><div class="grow"><h2>Timed mock</h2><p class="small muted">All ' + n + ' questions, 1-mark ones first, then 2, 3 and 4. <b class="mockinfo">' + tm + " marks · " + fmtDur(tm * MIN_PER_MARK) + "</b> (1.5 minutes a mark).</p>" + scoreLine("mock") +
      '</div></div><button type="button" class="btn primary block" data-act="round-start" data-mode="mock">Start the clock</button></div>';
    if (run) h += '<p class="note">Starting a new round replaces the one in progress.</p>';
    app.innerHTML = h;
  }
  function roundRunRoute(rerender) {
    var key = curChKey(), run = roundRestore();
    if (RD && RD.chKey === key && RD.phase === "result" && !run) { redraw = function () { roundRender(false); }; return roundRender(true); }
    if (!run) {
      if (RS().last) { lastRoundChKey = key; RD = { chKey: key, run: null, phase: "result", rec: RS().last }; redraw = function () { roundRender(false); }; return roundRender(true); }
      location.hash = BASE + "/round"; return;
    }
    if (!(RD && RD.chKey === key && RD.phase === "run" && RD.run === run)) RD = { chKey: key, run: run, phase: "run" };
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
    if (!RD || RD.chKey !== curChKey()) return roundPickerView();
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
    h += '<article class="card rq" data-q="' + esc(q.id) + '"><div class="bq-top">' + tag(boardTag(q)) + '<span class="marks">' + marksWord(q.marks) + "</span>" + (q.kind ? '<span class="kind">' + esc(kindLabel(q.kind)) + "</span>" : "") + "</div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>" + roundOptionsHTML(q);
    if (!run.rev) {
      h += '<p class="rinst">Write your answer on paper first.</p><button type="button" class="btn primary block" data-act="round-reveal">I\'ve written my answer</button>';
    } else {
      var rGot = 0;
      qPoints(q).forEach(function (x, k) { if (run.ticks[k]) rGot += +x.marks || 0; });
      h += modelAnswerHTML(q) + pointsHTML(q, run.ticks, "round-tick") +
        (rGot < q.marks ? errPillsHTML(run.err || "", "round-err") : "") +
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
  // Salt changes on every drill/review start, so the correct line moves between attempts
  // but stays put within one attempt (render and pick must agree).
  var OPT_SALT = String(Date.now());
  function newOptSalt() { OPT_SALT = String(Date.now()) + Math.random(); }
  function shuffle3(id, idx, n) {   // position for the correct line, stable within one attempt
    var x = 0, s = id + idx + OPT_SALT;
    for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 9973;
    return x % n;
  }
  function stepOptions(d, idx) {
    var st = d.steps[idx], pos = shuffle3(d.id, idx, 3), opts = st.wrong.slice(0, 2);
    opts.splice(pos, 0, st.line);
    return { opts: opts, correct: pos };
  }
  function deriveListView() {
    var dLabel = CH.drillLabel || "Derivation drills";
    setHeader(dLabel + " · " + chShortLabel(CH), BASE, { xp: true, tab: "map" });
    var derivs = CH.derivations || [];
    if (!derivs.length) {
      app.innerHTML = '<div class="card"><h2>' + esc(dLabel) + '</h2><p class="muted">Drills coming soon for this chapter. Practise the board questions and formula recall meanwhile.</p><a class="btn primary block" style="margin-top:12px" href="' + BASE + '/board">Practise board questions</a></div>';
      return;
    }
    var h = '<div class="card"><p>Build each step-by-step solution one line at a time. At every step pick the correct next line from three. Slips go to your mistake bank.</p></div>';
    h += derivs.map(function (d) {
      var s = stopById(d.stop);
      return '<div class="card"><h2>' + fm(d.title) + "</h2>" +
        '<p class="small muted">Stop ' + (stopIndex(d.stop) + 1) + ": " + esc(s ? s.title : d.stop) + " · Textbook p. " + d.page + " · " + d.steps.length + " steps</p>" +
        (d.asked && d.asked.length ? '<div class="tags">' + d.asked.map(function (a) { return tag("Asked " + a); }).join("") + "</div>" :
          '<p class="small muted">High-yield Balbharati drill.' + (d.related ? " Related questions: " + d.related.join(", ") + "." : "") + "</p>") +
        '<a class="btn primary block" style="margin-top:12px" href="' + BASE + "/derive/" + d.id + '">Start drill</a></div>';
    }).join("");
    app.innerHTML = h;
  }
  function drillStart(id) {
    newOptSalt();
    var d = getDeriv(id);
    if (!d) return errorView("That drill doesn't exist.");
    D = { d: d, chKey: curChKey(), i: 0, slips: 0, slipped: false, wrongPicks: [], done: false };
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
      h += '<div class="card result pass"><h2>Complete solution</h2>' +
        '<ol class="dlines full">' + d.steps.map(function (s) { return "<li>" + fm(s.line) + (s.note ? '<div class="small muted">' + fm(s.note) + "</div>" : "") + "</li>"; }).join("") + "</ol>" +
        '<p class="muted">' + (D.slips ? D.slips + " step" + (D.slips > 1 ? "s" : "") + " needed another try. Added to your mistake bank." : "No slips. Well done.") + "</p>" +
        (d.asked && d.asked.length ? '<div class="tags">' + d.asked.map(function (a) { return tag("Asked " + a); }).join("") + "</div>" : "") + "</div>" +
        '<div class="stack"><button type="button" class="btn primary block" data-act="drill-again">Drill again</button><a class="btn ghost block" href="' + BASE + '/derive">All drills</a></div>';
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
      if (!D.slipped) { D.slipped = true; D.slips++; bankAdd(bankId("d", d.id, D.i), "slip"); }
    }
    drillRender();
  }

  /* ---------- formula card (multi-chapter) ---------- */
  function formulaItemId(chKey, gIdx, iIdx) { return chKey + "|" + gIdx + "|" + iIdx; }
  function formulaQuizStats(chList) {
    var total = 0, recalled = 0, marked = 0, missed = 0;
    chList.forEach(function (ch) {
      var ck = chKeyFor(ch);
      (ch.formulas || []).forEach(function (g, gi) {
        (g.items || []).forEach(function (f, ii) {
          total++;
          var fid = formulaItemId(ck, gi, ii);
          if (formulaQuizRes[fid] === true) { recalled++; marked++; }
          else if (formulaQuizRes[fid] === false) { missed++; marked++; }
        });
      });
    });
    return { total: total, recalled: recalled, marked: marked, missed: missed };
  }
  function formulaGroupsHTML(ch) {
    var ck = chKeyFor(ch);
    return (ch.formulas || []).map(function (g, gi) {
      var s = stopById(g.stop, ch);
      var itemsHTML = (g.items || []).map(function (f, ii) {
        var fid = formulaItemId(ck, gi, ii);
        if (formulaQuiz && formulaMissOnly && formulaQuizRes[fid] !== false) return "";
        var rev = !formulaQuiz || !!formulaQuizRev[fid];
        var res = formulaQuizRes[fid];
        return '<div class="frm' + (formulaQuiz && !rev ? " fq-hidden" : "") + (res === true ? " fq-ok" : res === false ? " fq-miss" : "") + '">' +
          '<div class="fn">' + esc(f.n) + '<span class="fp">p. ' + esc(f.p) + "</span></div>" +
          (rev ? '<div class="ff">' + fm(f.f) + "</div>" : '<div class="fq-cover noprint"><button type="button" class="btn ghost sm" data-act="formula-reveal" data-fid="' + esc(fid) + '">Tap to recall</button></div><div class="ff print-only">' + fm(f.f) + "</div>") +
          (f.s ? '<div class="fs">' + fm(f.s) + "</div>" : "") +
          (formulaQuiz && rev ? '<div class="fq-ctrl noprint">' +
            '<button type="button" class="btn sm ' + (res === true ? "ok" : "ok ghost") + '" data-act="formula-mark" data-fid="' + esc(fid) + '" data-ok="1" aria-pressed="' + (res === true) + '">Knew it ✓</button>' +
            '<button type="button" class="btn sm ' + (res === false ? "warn" : "warn ghost") + '" data-act="formula-mark" data-fid="' + esc(fid) + '" data-ok="0" aria-pressed="' + (res === false) + '">Missed</button>' +
            "</div>" : "") +
          "</div>";
      }).join("");
      if (!itemsHTML) return "";
      return '<section class="card fgroup"><h2><a href="' + chBase(ch) + "/" + g.stop + '">' + (stopIndex(g.stop, ch) + 1) + ". " + esc(s ? s.title : g.stop) + "</a></h2>" +
        itemsHTML + "</section>";
    }).join("");
  }
  function formulasView() {
    var showAll = formulaChKey === "all" && LIVE_LIST.length > 1;
    var fKey = !showAll && formulaChKey && CHAPTERS[formulaChKey] ? formulaChKey : curChKey();
    var ch = CHAPTERS[fKey] || CH;
    var label = ch.formulaLabel || "Formula card";
    setHeader(showAll ? "Formula sheet · All chapters" : label + " · " + chShortLabel(ch), null, { xp: true, tab: "formulas" });
    var h = "";
    if (LIVE_LIST.length > 1) {
      h += '<div class="pills-row noprint" role="group" aria-label="Choose chapter">' +
        '<button type="button" class="pill-btn" data-act="formula-ch" data-ch="all" aria-pressed="' + showAll + '">All chapters</button>' +
        LIVE_LIST.map(function (e) {
          return '<button type="button" class="pill-btn" data-act="formula-ch" data-ch="' + esc(e.key) + '" aria-pressed="' + (!showAll && e.key === fKey) + '">' + esc(chShortFromMeta(e)) + "</button>";
        }).join("") + "</div>";
    }
    var targetChs = showAll ? CHAPTER_LIST.filter(function (e) { return e.ch.formulas && e.ch.formulas.length; }).map(function (e) { return e.ch; }) : [ch];
    var fStats = formulaQuiz ? formulaQuizStats(targetChs) : null;
    var quizBtn = '<button type="button" class="btn ' + (formulaQuiz ? "primary" : "ghost") + ' sm noprint" data-act="formula-quiz" aria-pressed="' + formulaQuiz + '">' + (formulaQuiz ? "Exit quiz" : "Test yourself (hide formulas)") + "</button>";
    var quizBar = formulaQuiz ? '<div class="fq-bar noprint"><span class="pill ok">Recalled ' + fStats.recalled + " / " + fStats.total + "</span>" +
      (fStats.missed > 0 || formulaMissOnly ? '<button type="button" class="pill-btn" data-act="formula-miss" aria-pressed="' + formulaMissOnly + '">Show missed only (' + fStats.missed + ")</button>" : "") +
      "</div>" : "";

    if (showAll) {
      h += '<div class="card fhead"><div class="row"><p class="grow"><b>Formula sheet: all live chapters</b><br><span class="small muted">For last-week revision. Each chapter starts on a new printed page.</span></p>' +
        '<button type="button" class="btn ghost sm noprint" data-act="print">Print all</button></div>' +
        '<div class="fhead-acts">' + quizBtn + "</div>" + quizBar + "</div>";
      var bodyAll = targetChs.map(function (c, i) {
        var grp = formulaGroupsHTML(c);
        return grp ? '<div class="fchap' + (i ? " pbreak" : "") + '"><h2 class="fchap-h">' + esc(chShortLabel(c)) + ": " + esc(c.title) + "</h2>" + grp + "</div>" : "";
      }).join("");
      h += bodyAll || '<div class="card center"><p class="muted">No missed formulas in this filter.</p></div>';
      app.innerHTML = h;
      return;
    }
    h += '<div class="card fhead"><div class="row"><p class="grow"><b>' + esc(chShortLabel(ch)) + ": " + esc(ch.title) + '</b><br><span class="small muted">Grouped by stop, with textbook pages. Balbharati notation.</span></p>' +
      '<button type="button" class="btn ghost sm noprint" data-act="print">Print</button></div>' +
      '<div class="fhead-acts">' + quizBtn + "</div>" + quizBar + "</div>";
    var bodyOne = formulaGroupsHTML(ch);
    h += bodyOne || '<div class="card center"><p class="muted">No missed formulas in this filter.</p></div>';
    app.innerHTML = h;
  }

  /* ---------- review (unified across all subjects & chapters) ---------- */
  function itemLabel(id) {
    var p = parseId(id), ch = CHAPTERS[p.chKey];
    if (!ch) return id;
    var prefix = CHAPTER_LIST.length > 1 ? "[" + chShortLabel(ch) + "] " : "";
    if (p.kind === "c") { var s = stopById(p.a, ch), c = s && s.quest && s.quest.checks && s.quest.checks[+p.b]; return c ? prefix + "Stop " + (stopIndex(s.id, ch) + 1) + ", check " + (+p.b + 1) + ": " + plain(c.q) : id; }
    if (p.kind === "d") { var d = getDeriv(p.a, ch); return d ? prefix + "Drill: " + plain(d.title) + ", step " + (+p.b + 1) : id; }
    var b = getBoard(p.a, ch); return b ? prefix + "Board " + boardTag(b) + ": " + plain(b.text) : id;
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }
  function reviewStart() {
    newOptSalt();
    var ids = dueIds().filter(itemExists);
    R = { queue: ids, i: 0, ok: 0, bad: 0, ce: null, ds: null, shown: false };
    redraw = reviewRender;
    reviewSetup(); reviewRender();
  }
  function reviewSetup() {
    R.shown = false; R.ds = null; R.ce = null; R.ticks = []; R.err = "";
    if (R.i >= R.queue.length) return;
    var p = parseId(R.queue[R.i]), ch = CHAPTERS[p.chKey];
    if (!ch) return;
    if (p.kind === "c") {
      var stp = stopById(p.a, ch);
      if (stp && stp.quest && stp.quest.checks && stp.quest.checks[+p.b]) R.ce = newCE(stp.quest.checks[+p.b], "review");
    }
    if (p.kind === "d") R.ds = { picked: null };
    if (p.kind === "b") R.ticks = qPoints(getBoard(p.a, ch)).map(function () { return false; });
  }
  function reviewByPoints(id) { var it = load().bank[id]; return !!(it && it.reason === "below full marks"); }
  function reviewRoundStart() {
    newOptSalt();
    var key = lastRoundChKey && CHAPTERS[lastRoundChKey] ? lastRoundChKey : curChKey();
    var ch = CHAPTERS[key] || CH;
    var rec = RS(null, key).last, ids = [];
    if (rec && Array.isArray(rec.results)) {
      ids = rec.results.filter(function (r) { return r.got < r.of; })
        .map(function (r) { return bankId("b", r.id, null, ch); })
        .filter(function (id) { return itemExists(id) && load().bank[id]; });
    }
    R = { queue: ids, i: 0, ok: 0, bad: 0, ce: null, ds: null, shown: false, ticks: [], err: "" };
    redraw = reviewRender;
    reviewSetup(); reviewRender();
  }
  function reviewRender() {
    setHeader("Review", null, { tab: "review" });
    var h = "";
    if (!R.queue.length) {
      var nd = nextDueDate(), n = bankIds().filter(itemExists).length;
      h += '<div class="card center empty"><h2>' + (nd ? "Nothing due — next review on " + niceDate(nd) : "Nothing due") + "</h2>" +
        '<p class="muted">' + (n ? "Your mistake bank has " + n + " item" + (n > 1 ? "s" : "") + " waiting for their day." : "Your mistake bank is empty. Wrong answers and “Need practice” questions will show up here.") + "</p>" +
        (n ? '<a class="btn ghost" href="#/review/all">See all items in the bank</a>' : '<a class="btn primary" href="' + BASE + '">Go to the map</a>') + "</div>";
    } else if (R.i >= R.queue.length) {
      var nd2 = nextDueDate();
      h += '<div class="card result pass"><div class="score">' + R.ok + "/" + R.queue.length + "</div><h2>Review done</h2>" +
        '<p class="muted">' + R.ok + " correct" + (R.bad ? ", " + R.bad + " to try again tomorrow" : "") + ". " + (nd2 ? "Next review on " + niceDate(nd2) + "." : "Your mistake bank is now empty.") + "</p></div>" +
        '<div class="stack"><a class="btn primary block" href="#/">Home</a><a class="btn ghost block" href="#/review/all">See all items in the bank</a></div>';
    } else {
      var id = R.queue[R.i], p = parseId(id), ch = CHAPTERS[p.chKey];
      h += steps(R.queue.length, R.i);
      h += '<p class="muted small center">Item ' + (R.i + 1) + " of " + R.queue.length + "</p>";
      h += '<div class="rtags center">' + (ch ? '<span class="ch-tag">' + esc(chShortLabel(ch)) + '</span>' : "") + reasonTag(id) + (load().bank[id] && load().bank[id].prio ? ' <span class="small muted">You were sure but wrong, so this comes first.</span>' : "") + "</div>";
      if (p.kind === "c") h += ceHTML(R.ce, "Re-check");
      else if (p.kind === "d") h += reviewDrillHTML(getDeriv(p.a, ch), +p.b);
      else h += reviewBoardHTML(getBoard(p.a, ch), id);
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
  function reviewBoardHTML(q, id) {
    var h = '<div class="card"><div class="bq-top">' + tag(boardTag(q)) + '<span class="marks">' + q.marks + (q.marks === 1 ? " mark" : " marks") + "</span></div>" +
      '<p class="bq-text">' + fm(q.text) + "</p>";
    if (q.options) h += '<ul class="bq-opts">' + q.options.map(function (o) { return "<li>" + fm(o) + "</li>"; }).join("") + "</ul>";
    if (reviewByPoints(id)) {
      if (!R.shown) h += '<p class="rinst">Write your answer on paper first.</p><button type="button" class="btn primary block" data-act="rv-written">I\'ve written my answer</button>';
      else {
        var rvGot = 0;
        qPoints(q).forEach(function (x, k) { if (R.ticks[k]) rvGot += +x.marks || 0; });
        h += modelAnswerHTML(q) + pointsHTML(q, R.ticks, "rv-tick") +
          (rvGot < q.marks ? errPillsHTML(R.err || "", "rv-err") : "") +
          '<button type="button" class="btn primary block" data-act="rv-score">Done</button>';
      }
      return h + "</div>";
    }
    if (!R.shown) h += '<button type="button" class="btn primary block" data-act="rv-show">Show model answer</button>';
    else h += modelAnswerHTML(q) + '<p class="small muted">How did you do without looking?</p><div class="rate"><button type="button" class="btn ok" data-act="rv-got">Got it</button><button type="button" class="btn warn ghost" data-act="rv-need">Need practice</button></div>';
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
      h += '<div class="card"><p class="muted small">' + ids.length + " item" + (ids.length > 1 ? "s" : "") + '. Each correct review pushes an item further out (1 → 3 → 7 → 14 → 30 days, never past exam eve); five correct reviews in a row retire it.</p><ul class="list bank">' +
        ids.map(function (id) {
          var it = st.bank[id], due = it.due <= t ? "Due now" : "Due " + niceDate(it.due);
          return '<li class="bank-row"><div class="grow"><div class="bt">' + esc(trunc(itemLabel(id), 110)) + '</div><div class="small muted">' + reasonTag(id) + ' <span class="pill ' + (it.due <= t ? "amber" : "") + '">' + due + "</span> " + (it.streak || 0) + " of " + REVIEW_GAPS.length + " correct reviews</div></div>" +
            '<button type="button" class="btn ghost sm" data-act="bank-remove" data-id="' + esc(id) + '" aria-label="Remove from bank">Remove</button></li>';
        }).join("") + "</ul></div>";
    }
    app.innerHTML = h;
  }

  /* ---------- my notes (multi-chapter) ---------- */
  function notesEntries(st, chFilter) {
    st = st || load();
    var out = [];
    CHAPTER_LIST.forEach(function (e) {
      if (chFilter && chFilter !== "all" && e.key !== chFilter) return;
      e.ch.stops.forEach(function (s, idx) {
        var v = st.notes[K(s.id, e.ch)];
        if (v && v.trim()) out.push({ ch: e.ch, s: s, idx: idx, text: v.trim() });
      });
    });
    return out;
  }
  function notesText() {
    var st = load(), out = ["HSC Board Prep — My Notes", ""];
    CHAPTER_LIST.forEach(function (e) {
      var list = notesEntries(st, e.key);
      if (!list.length) return;
      out.push("=== " + chShortLabel(e.ch) + ": " + e.ch.title + " ===");
      list.forEach(function (it) {
        out.push((it.idx + 1) + ". " + it.s.title);
        out.push(it.text);
        out.push("");
      });
    });
    return out.join("\n");
  }
  function notesView() {
    setHeader("My notes", null, { tab: "notes" });
    var st = load(), allNotes = notesEntries(st, "all");
    var h = "";
    if (!allNotes.length) {
      h = '<div class="card center"><h2>No notes yet</h2><p class="muted">Open any stop and write in the notes box. ' + noteSyncCopy() + '.</p><a class="btn primary" href="' + BASE + '">Go to the map</a></div>';
    } else {
      var chWithNotes = CHAPTER_LIST.filter(function (e) { return notesEntries(st, e.key).length > 0; });
      if (chWithNotes.length > 1) {
        h += '<div class="pills-row noprint" role="group" aria-label="Filter notes by chapter">' +
          '<button type="button" class="pill-btn" data-act="notes-ch" data-ch="all" aria-pressed="' + (notesChFilter === "all") + '">All</button>' +
          chWithNotes.map(function (e) {
            return '<button type="button" class="pill-btn" data-act="notes-ch" data-ch="' + esc(e.key) + '" aria-pressed="' + (notesChFilter === e.key) + '">' + esc(chShortLabel(e.ch)) + "</button>";
          }).join("") + "</div>";
      } else {
        notesChFilter = "all";
      }
      var shown = notesEntries(st, notesChFilter);
      h += '<div class="card"><p class="muted small">' + (SYNC && SYNC.isLinked() ? "Synced across your devices." : "Saved on this device only. Nothing is uploaded.") + '</p><div class="actions two"><button type="button" class="btn primary" data-act="notes-copy">Copy all</button><button type="button" class="btn ghost" data-act="notes-dl">Download .txt</button></div><p id="notes-msg" class="small muted" role="status"></p></div>';
      h += shown.map(function (it) {
        return '<div class="card">' + (CHAPTER_LIST.length > 1 ? '<p class="small muted" style="margin-bottom:4px"><span class="ch-tag">' + esc(chShortLabel(it.ch)) + '</span></p>' : "") +
          '<h2><a href="' + chBase(it.ch) + "/" + it.s.id + '">' + (it.idx + 1) + ". " + esc(it.s.title) + "</a></h2><p class=\"note-text\">" + esc(it.text) + "</p></div>";
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
    h += '<div class="card"><div class="row"><div class="grow"><h2>Offline access</h2><p class="small muted">Cache all ' + LIVE_LIST.length + ' live chapters on this device so you can study without internet.</p></div>' +
      '<button type="button" class="btn ghost sm" data-act="sync-offline">Save all chapters offline</button></div>' +
      (offlineMsg ? '<p class="small muted" role="status" style="margin-top:8px">' + esc(offlineMsg) + "</p>" : "") + "</div>";
    // Teacher entry is shown only on a device that already holds the teacher key (owner's device).
    // Students never see a link to it; the owner uses the private one-tap teacher link to connect.
    if (SYNC.hasTeacherConfig()) h += '<div class="card"><div class="row"><div class="grow"><h2>Parent / Teacher view</h2><p class="small muted">Check live study progress, predicted marks, and mistake bank.</p></div><a class="btn ghost sm" href="#/teacher">Open</a></div></div>';
    app.innerHTML = h;
  }

  /* ---------- teacher / parent view (#/teacher, multi-chapter) ---------- */
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
  function findStudentEntry(sid) {
    if (!TState.data || !Array.isArray(TState.data.students)) return null;
    for (var i = 0; i < TState.data.students.length; i++) {
      if ((TState.data.students[i].id || "") === sid) return TState.data.students[i];
    }
    return null;
  }
  function saveTeacherPatch(sid, mutateFn, okMsg) {
    if (!SYNC) return;
    var entry = findStudentEntry(sid);
    if (!entry) return;
    var next = isObj(entry.teacher) ? JSON.parse(JSON.stringify(entry.teacher)) : {};
    mutateFn(next);
    next.updatedAt = Date.now();
    TActionMsg[sid] = { ok: true, text: "Saving…" };
    teacherView();
    SYNC.saveTeacherAction(sid, next).then(function (res) {
      if (!res.ok) {
        TActionMsg[sid] = { ok: false, text: res.error || "Could not save." };
      } else {
        entry.teacher = isObj(res.teacher) ? res.teacher : next;
        TActionMsg[sid] = { ok: true, text: okMsg || "Saved. Will appear on student's device on next sync." };
      }
      if (location.hash === "#/teacher") teacherView();
    });
  }
  function teacherStudyTimeHTML(st) {
    var todaySec = timeOnDay(today(), st);
    var t7 = timeLast7Days(st);
    var maxSec = Math.max(t7.maxSec, 60);
    var bars = t7.days.map(function (d) {
      var hPct = d.sec > 0 ? Math.max(8, Math.round(100 * d.sec / maxSec)) : 0;
      return '<div class="t-bar-col"><span class="t-bar-val">' + (d.sec > 0 ? esc(fmtStudyTime(d.sec)) : "") + '</span>' +
        '<div class="t-bar-track"><i style="height:' + hPct + '%"></i></div>' +
        '<span class="t-bar-lab">' + esc(d.label) + "</span></div>";
    }).join("");
    var chChips = CHAPTER_LIST.map(function (e) {
      var sec = timeForChapter(e.key, st);
      return '<span class="tag">' + esc(chShortLabel(e.ch)) + ": <b>" + esc(fmtStudyTime(sec)) + "</b></span>";
    }).join(" ");

    // Daily activity & achievements (last 7 days, newest first)
    var dayRows = [];
    for (var i = t7.days.length - 1; i >= 0; i--) {
      var dInfo = t7.days[i];
      var ach = dayAchievements(dInfo.date, st);
      if (!ach.hasAny) continue;
      var parts = [];
      if (ach.sec > 0) parts.push('<span class="tag">' + esc(fmtStudyTime(ach.sec)) + "</span>");
      if (ach.stops.length) parts.push('<span class="tag">' + ach.stops.length + (ach.stops.length === 1 ? " stop" : " stops") + "</span>");
      if (ach.drills.length) parts.push('<span class="tag">' + ach.drills.length + (ach.drills.length === 1 ? " drill" : " drills") + "</span>");
      ach.rounds.forEach(function (r) {
        parts.push('<span class="tag">' + esc(chShortLabel(r.ch)) + " round " + r.rec.pct + "%</span>");
      });
      var items = [];
      ach.stops.forEach(function (x) { items.push(chShortLabel(x.ch) + " · " + (x.idx + 1) + ". " + x.s.title); });
      ach.drills.forEach(function (x) { items.push(chShortLabel(x.ch) + " drill · " + x.d.title + (x.clean ? " ✓" : "")); });
      var dayLabel = dInfo.date === today() ? "Today" : (dInfo.label + " · " + niceDate(dInfo.date));
      dayRows.push('<li class="t-day-row"><div class="t-day-head"><b>' + esc(dayLabel) + '</b><span class="t-chips">' + parts.join("") + "</span></div>" +
        (items.length ? '<div class="small muted t-day-items">' + items.map(esc).join(" · ") + "</div>" : "") + "</li>");
    }

    return '<div class="card"><h2>Daily activity &amp; study time</h2>' +
      '<div class="t-time-top"><div><b>' + esc(fmtStudyTime(todaySec)) + '</b> <span class="small muted">today</span></div>' +
      '<div><b>' + esc(fmtStudyTime(t7.totalSec)) + '</b> <span class="small muted">last 7 days</span></div></div>' +
      '<div class="t-bars" aria-label="Last 7 days active study time">' + bars + '</div>' +
      '<p class="small muted" style="margin-top:10px">Time by chapter:</p><div class="t-chips">' + chChips + "</div>" +
      '<div class="t-act-sec"><p class="small muted" style="margin-bottom:4px"><b>Daily log (last 7 days)</b></p>' +
      (dayRows.length ? '<ul class="t-list">' + dayRows.join("") + "</ul>" : '<p class="small muted">No logged study activity in the last 7 days yet.</p>') +
      "</div></div>";
  }
  function teacherActionsHTML(entry, st) {
    var sid = entry.id || "student1";
    var td = isObj(entry.teacher) ? entry.teacher : {};
    var msg = TActionMsg[sid];
    var noteSeen = !!(td.note && st && (st.dismissedNoteAt || 0) >= (td.noteAt || 1));

    // Focus stop options
    var curFocus = isObj(td.focus) ? (td.focus.chKey + "|" + td.focus.stopId) : "";
    var focusOpts = '<option value="">— Select a stop to pin —</option>' + CHAPTER_LIST.map(function (e) {
      return '<optgroup label="' + esc(chShortLabel(e.ch) + ": " + e.ch.title) + '">' +
        e.ch.stops.map(function (s, idx) {
          var val = e.key + "|" + s.id;
          return '<option value="' + esc(val) + '"' + (val === curFocus ? " selected" : "") + '>' + (idx + 1) + ". " + esc(s.title) + "</option>";
        }).join("") + "</optgroup>";
    }).join("");

    // Reward goal options
    var curRew = isObj(td.reward) ? td.reward : null;
    var curRewGoal = curRew ? (curRew.type === "xp" ? ("xp|" + (curRew.target || 250)) : (curRew.type + "|" + (curRew.chKey || ""))) : "";
    var rewOpts = CHAPTER_LIST.map(function (e) {
      var v1 = "stops|" + e.key, v2 = "round|" + e.key;
      return '<option value="' + esc(v1) + '"' + (v1 === curRewGoal ? " selected" : "") + '>Finish all stops · ' + esc(chShortLabel(e.ch)) + "</option>" +
        '<option value="' + esc(v2) + '"' + (v2 === curRewGoal ? " selected" : "") + '>80%+ Board round · ' + esc(chShortLabel(e.ch)) + "</option>";
    }).join("") + [250, 500, 1000, 2000].map(function (xp) {
      var v = "xp|" + xp;
      return '<option value="' + esc(v) + '"' + (v === curRewGoal ? " selected" : "") + '>Reach ' + xp + " XP</option>";
    }).join("");
    var rp = curRew && st ? rewardProgress(curRew, st) : null;

    // Assign board question options
    var assignOpts = '<option value="">— Pick a board question —</option>' + CHAPTER_LIST.map(function (e) {
      return '<optgroup label="' + esc(chShortLabel(e.ch) + ": " + e.ch.title) + '">' +
        e.ch.board.map(function (b) {
          var bid = bankId("b", b.id, null, e.ch);
          return '<option value="' + esc(bid) + '">' + esc(boardTag(b)) + " (" + b.marks + "m) — " + esc(trunc(plain(b.text), 68)) + "</option>";
        }).join("") + "</optgroup>";
    }).join("");
    var assignedList = Array.isArray(td.assigned) ? td.assigned.filter(function (a) { return isObj(a) && a.id && itemExists(a.id); }) : [];

    var h = '<div class="card t-actions"><h2>Teacher actions</h2>' +
      '<p class="small muted">Send a note, pin a focus stop, set a reward goal, or assign a board question to Review. Delivered on the student\'s next sync.</p>';
    if (msg) h += '<div class="fb ' + (msg.ok ? "good" : "bad") + '" role="status">' + esc(msg.text) + "</div>";

    h += '<div class="t-act-sec"><div class="row" style="justify-content:space-between"><label for="ta-note-' + esc(sid) + '" style="margin-bottom:0">Message / encouragement</label>' +
      (td.note ? '<span class="pill ' + (noteSeen ? "ok" : "amber") + '">' + (noteSeen ? "Seen ✓" : "Sent · not seen yet") + "</span>" : "") + '</div>' +
      '<textarea id="ta-note-' + esc(sid) + '" class="fin t-ta" style="margin-top:6px" rows="2" maxlength="400" placeholder="e.g. Great job on Physics Ch 1! Finish Fluid Pressure before Friday.">' + esc(td.note || "") + "</textarea>" +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn primary sm" data-act="t-send-note" data-sid="' + esc(sid) + '">Send note</button>' +
      (td.note ? '<button type="button" class="btn ghost sm" data-act="t-clear-note" data-sid="' + esc(sid) + '">Clear</button>' : "") + "</div></div>";

    h += '<div class="t-act-sec"><label for="ta-focus-' + esc(sid) + '">Pin a focus stop (shows at top of Home)</label>' +
      '<select id="ta-focus-' + esc(sid) + '" class="fin">' + focusOpts + "</select>" +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn primary sm" data-act="t-set-focus" data-sid="' + esc(sid) + '">Pin stop</button>' +
      (curFocus ? '<button type="button" class="btn ghost sm" data-act="t-clear-focus" data-sid="' + esc(sid) + '">Clear pin</button>' : "") + "</div></div>";

    h += '<div class="t-act-sec"><label for="ta-rew-title-' + esc(sid) + '">Reward milestone</label>' +
      '<input id="ta-rew-title-' + esc(sid) + '" class="fin" type="text" maxlength="120" placeholder="e.g. Weekend movie or favourite treat" value="' + esc(curRew ? curRew.title : "") + '">' +
      '<select id="ta-rew-goal-' + esc(sid) + '" class="fin" style="margin-top:6px">' + rewOpts + "</select>" +
      (rp ? '<p class="small muted" style="margin-top:6px">Current progress: <b>' + (rp.done ? "Unlocked! ✓" : esc(rp.text)) + "</b></p>" : "") +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn primary sm" data-act="t-set-reward" data-sid="' + esc(sid) + '">Save reward</button>' +
      (curRew ? '<button type="button" class="btn ghost sm" data-act="t-clear-reward" data-sid="' + esc(sid) + '">Clear reward</button>' : "") + "</div></div>";

    h += '<div class="t-act-sec"><label for="ta-assign-' + esc(sid) + '">Assign a board question to Review (priority)</label>' +
      '<select id="ta-assign-' + esc(sid) + '" class="fin">' + assignOpts + "</select>" +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn primary sm" data-act="t-assign-q" data-sid="' + esc(sid) + '">Assign to Review</button></div>';
    if (assignedList.length) {
      h += '<ul class="t-list" style="margin-top:8px">' + assignedList.map(function (a) {
        return '<li><span>' + esc(trunc(itemLabel(a.id), 90)) + '</span><button type="button" class="btn ghost sm" data-act="t-unassign-q" data-sid="' + esc(sid) + '" data-id="' + esc(a.id) + '">Remove</button></li>';
      }).join("") + "</ul>";
    }
    h += "</div></div>";
    return h;
  }
  function teacherStudentHTML(entry) {
    var sid = entry.id || "student1";
    var name = entry.name || sid || "Student";
    if (!entry.state) {
      return '<div class="card"><div class="t-head"><div class="grow"><h2>' + esc(name) + '</h2><p class="muted">No progress synced yet. Link the student\'s device first.</p></div>' +
        '<button type="button" class="btn ghost sm" data-act="t-preview-blank" data-sid="' + esc(sid) + '">Test blank view</button></div></div>' +
        teacherActionsHTML(entry, null);
    }
    var st = normalizeState(entry.state);
    var pl = planInfo(st, "all"), dt = doneToday(st), strk = streak(st), left = daysLeft(catalog.examDate);
    var due = dueIds(st).filter(itemExists);
    var prio = bankIds(st).filter(function (id) { return itemExists(id) && st.bank[id] && st.bank[id].prio; });
    var planLabel = pl.status === "on" ? "On track" : pl.status === "ahead" ? "Ahead by " + pl.n : "Behind by " + pl.n;

    var h = '<div class="card"><div class="t-head"><div class="grow"><h2>' + esc(name) + '</h2>' +
      '<p class="small muted">Student last synced: <b>' + esc(relTime(entry.updatedAt)) + '</b>' + (entry.updatedAt ? " · " + esc(new Date(entry.updatedAt).toLocaleString()) : "") + "</p></div>" +
      '<span class="pill plan-pill" data-plan="' + pl.status + '">' + esc(planLabel) + "</span></div>" +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap">' +
      '<button type="button" class="btn primary sm" data-act="t-preview" data-sid="' + esc(sid) + '">Preview as student</button>' +
      '<button type="button" class="btn ghost sm" data-act="t-preview-blank" data-sid="' + esc(sid) + '">Test blank view</button></div></div>';

    h += '<div class="t-grid">' +
      '<div class="t-kpi"><b>' + Math.min(dt, pl.pace) + "/" + pl.pace + '</b><span>stops today</span></div>' +
      '<div class="t-kpi"><b>' + esc(fmtStudyTime(timeOnDay(today(), st))) + '</b><span>studied today</span></div>' +
      '<div class="t-kpi"><b>' + strk + ' d</b><span>streak</span></div>' +
      '<div class="t-kpi"><b>' + st.xp + '</b><span>XP · ' + left + 'd left</span></div></div>';

    h += teacherStudyTimeHTML(st);
    h += teacherActionsHTML(entry, st);
    h += homeGaugeHTML(st, "all");
    h += errorBreakdownHTML(st, 14, 1);

    CHAPTER_LIST.forEach(function (e) {
      var ch = e.ch, prog = chapterProgress(st, ch), rs = RS(st, e.key);
      var derivs = ch.derivations || [];
      var cleanDrills = derivs.filter(function (d) { return drillClean(d.id, st); }).length;
      var g = ch.examMarks ? gaugeData(st, ch) : null;
      var doneStops = ch.stops.filter(function (s) { return isDone(s.id, st, ch); });
      var chTime = timeForChapter(e.key, st);
      h += '<div class="card"><h2>' + esc(chShortLabel(ch)) + ": " + esc(ch.title) + '</h2>' +
        '<div class="row"><div class="grow"><div class="bar"><i style="width:' + prog.pct + '%"></i></div></div><b>' + prog.done + "/" + prog.total + ' stops (' + prog.pct + "%)</b></div>" +
        '<p class="small muted" style="margin-top:8px">' +
        (g ? "Predicted: <b>" + g.pred + " / ~" + Math.round(g.avg) + " marks</b> · " : "") +
        (derivs.length ? "Drills clean: <b>" + cleanDrills + "/" + derivs.length + "</b> · " : "") +
        "Board round best: <b>" + (rs.bestFull ? rs.bestFull + "%" : "Not tried") + "</b>" +
        (chTime ? " · Study time: <b>" + esc(fmtStudyTime(chTime)) + "</b>" : "") + "</p>" +
        (roundComplete(st, e.key) ? '<div class="cb-row">' + badgeHTML("teacher", st, ch) + "</div>" : "") +
        (rs.last ? '<p class="small muted" style="margin-top:6px">Last board round: ' + esc(MODE_NAME[rs.last.mode] || rs.last.mode) + " — <b>" + rs.last.got + "/" + rs.last.of + " (" + rs.last.pct + "%)</b> on " + esc(niceDate(rs.last.date)) + "</p>" : "");
      if (doneStops.length) {
        h += '<details class="how"><summary>Completed stops (' + doneStops.length + ')</summary><ul class="t-list">' +
          doneStops.map(function (s) {
            return '<li><span>' + (stopIndex(s.id, ch) + 1) + ". " + esc(s.title) + '</span><span class="small muted">' + esc(niceDate(st.done[K(s.id, ch)])) + "</span></li>";
          }).join("") + "</ul></details>";
      }
      h += "</div>";
    });

    var watchList = prio.length ? prio.slice(0, 10) : due.slice(0, 8);
    h += '<div class="card"><div class="t-head"><div class="grow"><h2>Mistake bank watchlist</h2>' +
      '<p class="small muted"><b>' + bankIds(st).filter(itemExists).length + "</b> items in bank · <b>" + due.length + "</b> due now · <b>" + prio.length + "</b> priority items</p></div>" +
      (due.length ? '<button type="button" class="btn ghost sm" data-act="t-nudge-review" data-sid="' + esc(sid) + '" data-due="' + due.length + '">Remind to review</button>' : "") + "</div>";
    if (watchList.length) {
      h += '<ul class="t-list t-watch">' + watchList.map(function (id) {
        var info = itemStopInfo(id);
        var pyqs = info ? boardFor(info.stop.id, info.ch) : [];
        var topPyqId = (info && info.kind !== "b" && pyqs.length) ? bankId("b", pyqs[0].id, null, info.ch) : "";
        var sub = info ? (chShortLabel(info.ch) + " · Stop " + (stopIndex(info.stop.id, info.ch) + 1) + ": " + info.stop.title) : "";
        return '<li class="t-watch-row"><div class="grow"><div class="bt">' + esc(trunc(itemLabel(id), 100)) + '</div>' +
          '<div class="small muted">' + reasonTag(id, st) + (sub ? " " + esc(sub) : "") + '</div>' +
          '<div class="row t-watch-acts">' +
          (info ? '<button type="button" class="btn ghost sm" data-act="t-quick-pin" data-sid="' + esc(sid) + '" data-ch="' + esc(info.chKey) + '" data-stop="' + esc(info.stop.id) + '" data-title="' + esc(info.stop.title) + '">Pin stop</button>' : "") +
          (topPyqId ? '<button type="button" class="btn ghost sm" data-act="t-quick-assign" data-sid="' + esc(sid) + '" data-id="' + esc(topPyqId) + '">Assign PYQ</button>' : "") +
          (info ? '<button type="button" class="btn ghost sm" data-act="t-quick-note" data-sid="' + esc(sid) + '" data-topic="' + esc(chShortLabel(info.ch) + " — " + info.stop.title) + '">Draft note</button>' : "") +
          "</div></div></li>";
      }).join("") + "</ul>";
    } else {
      h += '<p class="small muted">No priority or due items right now.</p>';
    }
    h += "</div>";

    var allNoted = notesEntries(st, "all");
    if (allNoted.length) {
      h += '<div class="card"><details class="t-notes"><summary>Student notes (' + allNoted.length + ' stops)</summary>' +
        allNoted.map(function (it) {
          return '<div style="margin-top:10px"><b>' + esc(chShortLabel(it.ch)) + " · " + (it.idx + 1) + ". " + esc(it.s.title) + '</b><p class="note-text small muted">' + esc(it.text) + "</p></div>";
        }).join("") + "</details></div>";
    }
    var curBoost = (entry.teacher && entry.teacher.subjectBoost) || "balanced";
    h += '<div class="card"><h2>This week\'s focus subject</h2><p class="small muted">Boosts a subject 1.5× in the student\'s Today\'s Focus plan.</p><div class="err-pills">' +
      [{ id: "balanced", l: "Balanced" }, { id: "physics", l: "Physics" }, { id: "chemistry", l: "Chemistry" }, { id: "maths", l: "Maths" }].map(function (b) {
        return '<button type="button" class="err-pill" data-act="t-boost" data-sid="' + esc(sid) + '" data-boost="' + b.id + '" aria-pressed="' + (curBoost === b.id) + '">' + b.l + "</button>";
      }).join("") + "</div></div>";
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
      var h = '<div class="card"><h2>Teacher sign-in</h2><p class="small muted">This page is only for the teacher. Students do not need it. If you are the teacher, open your private teacher link or enter your teacher key below.</p>';
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
    if (PREVIEW) return;
    var prevRounds = mem ? JSON.stringify({ r: mem.round, rs: mem.rounds }) : "";
    var prevPaperRun = mem ? JSON.stringify(mem.paperRun) : "";
    mem = normalizeState(merged);
    save({ fromRemote: true });
    if (RD && JSON.stringify({ r: mem.round, rs: mem.rounds }) !== prevRounds) {
      if (rTimer) { clearInterval(rTimer); rTimer = null; }
      RD = null;
    }
    if (PR && JSON.stringify(mem.paperRun) !== prevPaperRun) {
      PR = null;
    }
    updateChrome();
    if (!HAS_DOM) return;
    // Never clobber an active note textarea or sync/teacher form inputs
    var ae = document.activeElement;
    var editingInput = ae && (ae.id === "note" || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
    var hash = location.hash || "#/";
    var sy = window.scrollY;
    if (!editingInput && hash !== "#/sync" && hash !== "#/teacher") {
      route(true);
      window.scrollTo(0, sy);
    } else if (hash === "#/sync" && SYNC && SYNC.isLinked()) {
      syncView();
      window.scrollTo(0, sy);
    }
  }

  /* ---------- events ---------- */
  function dataI(t) { return +t.getAttribute("data-i"); }
  if (HAS_DOM) {
  app.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act]");
    if (!t || !app.contains(t)) return;
    var act = t.getAttribute("data-act"), ce, q;
    var ctxCE = function () { return R && R.ce && location.hash.indexOf("#/review") === 0 ? R.ce : Q && Q.ce; };
    switch (act) {
      case "home-subj":
        homeSubj = t.getAttribute("data-subj") || "all";
        return homeView();
      case "formula-ch":
        formulaChKey = t.getAttribute("data-ch") || curChKey();
        if (formulaChKey === "all") return withChapters(LIVE_LIST.map(function (x) { return x.key; }), formulasView);
        return withChapters([formulaChKey], formulasView);
      case "formula-quiz":
        formulaQuiz = !formulaQuiz;
        if (!formulaQuiz) formulaMissOnly = false;
        return formulasView();
      case "formula-reveal": {
        var fid1 = t.getAttribute("data-fid");
        if (fid1) formulaQuizRev[fid1] = true;
        var sy1 = window.scrollY;
        formulasView();
        window.scrollTo(0, sy1);
        return;
      }
      case "formula-mark": {
        var fid2 = t.getAttribute("data-fid");
        if (fid2) {
          formulaQuizRev[fid2] = true;
          formulaQuizRes[fid2] = t.getAttribute("data-ok") === "1";
        }
        var sy2 = window.scrollY;
        formulasView();
        window.scrollTo(0, sy2);
        return;
      }
      case "formula-miss":
        formulaMissOnly = !formulaMissOnly;
        return formulasView();
      case "notes-ch":
        notesChFilter = t.getAttribute("data-ch") || "all";
        return notesView();
      case "stop-revised": {
        var rsid = t.getAttribute("data-stop");
        if (rsid && !isDone(rsid)) {
          var rst = load();
          rst.done[K(rsid)] = today();
          addXP(5);
          save();
        }
        return stopView(rsid);
      }
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
      case "ce-unit": ce = ctxCE(); if (ce && ce.status === "ask") { syncNum(ce); ce.unitSel = t.getAttribute("data-u"); ce.msg = ""; if (ce.mode === "quest") saveQuest(); redraw(); } return;
      case "ce-conf": ce = ctxCE(); if (ce && ce.status === "ask") { syncNum(ce); ce.conf = t.getAttribute("data-v"); ce.msg = ""; if (ce.mode === "quest") saveQuest(); redraw(); } return;
      case "ce-hint": ce = ctxCE(); if (!ce || ce.status !== "ask") return; ce.hint = true; syncNum(ce); if (ce.mode === "quest") saveQuest(); return redraw();
      case "ce-check":
        ce = ctxCE(); if (!ce || ce.status !== "ask") return; syncNum(ce);
        if (ce.chk.type === "num" ? isNaN(parseNum(ce.val)) : ce.sel == null) { ce.msg = ce.chk.type === "num" ? "Type a number first." : "Pick an answer first."; return redraw(); }
        if (ce.chk.type === "num" && Array.isArray(ce.chk.unitOpts) && ce.chk.unitOpts.length && !ce.unitSel) { ce.msg = "Pick an SI unit first."; return redraw(); }
        if (!ce.conf) { ce.msg = "Choose Sure or Guessing first."; return redraw(); }
        ce.msg = "";
        var okNow = ceIsCorrect(ce), cid = ce.mode === "quest" ? bankId("c", Q.stop.id, Q.ki) : R.queue[R.i];
        var errTag = ce.unitWrong ? "units" : "";
        if (ce.mode === "quest") {
          if (ce.attempt === 0) {   // first try decides what goes to the mistake bank
            if (!okNow) { if (bankAdd(cid, ce.conf === "sure" ? "confident mistake" : "missed", errTag)) Q.added++; ce.flag = ce.conf === "sure" ? "sure" : ""; }
            else if (ce.conf === "guess") { if (bankAdd(cid, "guessed")) Q.added++; ce.flag = "guessed"; }
          }
        } else if (!okNow && ce.conf === "sure" && load().bank[cid]) {
          load().bank[cid].prio = true; load().bank[cid].reason = "confident mistake"; if (errTag) load().bank[cid].err = errTag; load().bank[cid].updatedAt = Date.now(); save();
        }
        ceSubmit(ce);
        if (ce.mode === "quest") saveQuest();
        return redraw();
      case "ce-retry": ce = ctxCE(); if (!ce || ce.status !== "wrong") return; ce.attempt = 1; ce.order = optionOrder(ce.chk); ce.sel = null; ce.val = ""; ce.unitSel = null; ce.unitWrong = false; ce.status = "ask"; ce.conf = null; if (ce.mode === "quest") saveQuest(); return redraw();
      case "ce-next":
        if (R && location.hash.indexOf("#/review") === 0) return reviewAdvance(R.ce.status === "right");
        return questNext();
      case "reveal":
        q = t.closest(".bq"); var qid = q.getAttribute("data-q");
        revealed[qid] = !revealed[qid];
        q.outerHTML = boardCard(getBoard(qid), location.hash.slice(-5) === "board");
        return;
      case "bq-tick": {
        q = t.closest(".bq"); var bqid = q.getAttribute("data-q"), bqObj = getBoard(bqid);
        var bqd = getBqDraft(bqObj), idx = dataI(t);
        bqd.ticks[idx] = !bqd.ticks[idx];
        q.outerHTML = boardCard(bqObj, location.hash.slice(-5) === "board");
        return;
      }
      case "bq-all": {
        q = t.closest(".bq"); var bqid2 = q.getAttribute("data-q"), bqObj2 = getBoard(bqid2);
        var bqd2 = getBqDraft(bqObj2), allOn2 = bqd2.ticks.every(Boolean);
        bqd2.ticks = bqd2.ticks.map(function () { return !allOn2; });
        if (!allOn2) bqd2.err = "";
        q.outerHTML = boardCard(bqObj2, location.hash.slice(-5) === "board");
        return;
      }
      case "bq-err": {
        q = t.closest(".bq"); var bqid3 = q.getAttribute("data-q"), bqObj3 = getBoard(bqid3);
        var bqd3 = getBqDraft(bqObj3), errVal = t.getAttribute("data-err") || "";
        bqd3.err = bqd3.err === errVal ? "" : errVal;
        q.outerHTML = boardCard(bqObj3, location.hash.slice(-5) === "board");
        return;
      }
      case "bq-save": {
        q = t.closest(".bq"); var bqid4 = q.getAttribute("data-q"), bqObj4 = getBoard(bqid4);
        var bqd4 = getBqDraft(bqObj4), pts4 = qPoints(bqObj4), got4 = 0;
        pts4.forEach(function (x, k) { if (bqd4.ticks[k]) got4 += +x.marks || 0; });
        var st4 = load(), now4 = Date.now(), err4 = got4 < bqObj4.marks ? (bqd4.err || "") : "";
        if (!isObj(st4.boardPts)) st4.boardPts = {};
        st4.boardPts[bqid4] = { got: got4, of: bqObj4.marks, at: now4, err: err4 };
        st4.board[bqid4] = got4 >= bqObj4.marks ? "got" : "practice";
        st4.boardAt[bqid4] = now4;
        if (got4 < bqObj4.marks) {
          if (err4) logError(bqid4, curChKey(), err4, st4);
          bankAdd(bankId("b", bqid4), "below full marks", err4);
        } else {
          save();
        }
        q.outerHTML = boardCard(bqObj4, location.hash.slice(-5) === "board");
        return;
      }
      case "rate-got": case "rate-need":
        q = t.closest(".bq"); var id = q.getAttribute("data-q");
        if (act === "rate-got" && !revealed[id]) return;   // must compare with the model answer first
        var bst = load();
        bst.board[id] = act === "rate-got" ? "got" : "need";
        bst.boardAt[id] = Date.now();
        if (act === "rate-need") bankAdd(bankId("b", id), "need practice"); else save();
        q.outerHTML = boardCard(getBoard(id), location.hash.slice(-5) === "board");
        return;
      case "drill-pick": return drillPick(dataI(t));
      case "drill-again": return drillStart(D.d.id);
      case "rv-pick":
        R.ds.picked = dataI(t); return reviewRender();
      case "rv-next":
        var pd = parseId(R.queue[R.i]), dch = CHAPTERS[pd.chKey];
        return reviewAdvance(R.ds.picked === stepOptions(getDeriv(pd.a, dch), +pd.b).correct);
      case "rv-show": case "rv-written": R.shown = true; return reviewRender();
      case "rv-tick": R.ticks[dataI(t)] = !R.ticks[dataI(t)]; return reviewKeep();
      case "rv-err": {
        var rErr = t.getAttribute("data-err") || "";
        R.err = R.err === rErr ? "" : rErr;
        return reviewKeep();
      }
      case "rv-score": {
        var pb = parseId(R.queue[R.i]), bch = CHAPTERS[pb.chKey];
        var rq = getBoard(pb.a, bch), rg = 0;
        qPoints(rq).forEach(function (x, k) { if (R.ticks[k]) rg += +x.marks || 0; });
        var rvSt = load(), rvNow = Date.now(), rvErr = rg < rq.marks ? (R.err || "") : "";
        if (!isObj(rvSt.boardPts)) rvSt.boardPts = {};
        rvSt.boardPts[rq.id] = { got: rg, of: rq.marks, at: rvNow, err: rvErr };
        rvSt.board[rq.id] = rg >= rq.marks ? "got" : "practice";
        rvSt.boardAt[rq.id] = rvNow;
        if (rg < rq.marks && rvErr) logError(rq.id, pb.chKey, rvErr, rvSt);
        return reviewAdvance(rg >= rq.marks);
      }
      case "round-start": return roundStart(t.getAttribute("data-mode"));
      case "round-reveal": RD.run.rev = true; saveRound(false); return roundRender(false);
      case "round-tick": RD.run.ticks[dataI(t)] = !RD.run.ticks[dataI(t)]; saveRound(false); return roundRender(false);
      case "round-err": {
        var rdErr = t.getAttribute("data-err") || "";
        RD.run.err = RD.run.err === rdErr ? "" : rdErr;
        saveRound(false);
        return roundRender(false);
      }
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
      case "notes-dl": return setNotesMsg(downloadText("hsc-study-notes.txt", notesText()) ? "Downloaded hsc-study-notes.txt" : "Could not download on this device.");
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
      case "sync-offline":
        offlineMsg = "Saving chapters for offline use…";
        syncView();
        ensureAllChapters().then(function () {
          offlineMsg = "All " + LIVE_LIST.length + " live chapters saved for offline use.";
          if (location.hash === "#/sync") syncView();
        }, function (err) {
          offlineMsg = "Could not save all chapters (" + err.message + ").";
          if (location.hash === "#/sync") syncView();
        });
        return;
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
        TActionMsg = {};
        return teacherView();
      case "dismiss-t-note":
        var nAt = parseInt(t.getAttribute("data-at"), 10) || Date.now();
        load().dismissedNoteAt = Math.max(load().dismissedNoteAt || 0, nAt);
        save();
        return homeView();
      case "t-preview":
        if (!SYNC || !SYNC.hasTeacherConfig()) return;
        return enterPreview(findStudentEntry(t.getAttribute("data-sid") || ""), false);
      case "t-preview-blank":
        if (!SYNC || !SYNC.hasTeacherConfig()) return;
        return enterPreview(findStudentEntry(t.getAttribute("data-sid") || ""), true);
      case "t-send-note": {
        var sid1 = t.getAttribute("data-sid") || "student1";
        var el1 = document.getElementById("ta-note-" + sid1);
        var txt1 = el1 ? el1.value.trim() : "";
        if (!txt1) { TActionMsg[sid1] = { ok: false, text: "Type a message first." }; return teacherView(); }
        return saveTeacherPatch(sid1, function (td) { td.note = txt1; td.noteAt = Date.now(); }, "Note sent to student.");
      }
      case "t-clear-note": {
        var sid2 = t.getAttribute("data-sid") || "student1";
        return saveTeacherPatch(sid2, function (td) { td.note = ""; td.noteAt = 0; }, "Note cleared.");
      }
      case "t-set-focus": {
        var sid3 = t.getAttribute("data-sid") || "student1";
        var sel3 = document.getElementById("ta-focus-" + sid3);
        var val3 = sel3 ? sel3.value : "";
        if (!val3 || val3.indexOf("|") < 0) { TActionMsg[sid3] = { ok: false, text: "Select a stop to pin first." }; return teacherView(); }
        var sp3 = val3.split("|");
        return saveTeacherPatch(sid3, function (td) { td.focus = { chKey: sp3[0], stopId: sp3[1], at: Date.now() }; }, "Focus stop pinned.");
      }
      case "t-clear-focus": {
        var sid4 = t.getAttribute("data-sid") || "student1";
        return saveTeacherPatch(sid4, function (td) { td.focus = null; }, "Focus pin cleared.");
      }
      case "t-set-reward": {
        var sid5 = t.getAttribute("data-sid") || "student1";
        var ti5 = document.getElementById("ta-rew-title-" + sid5);
        var gl5 = document.getElementById("ta-rew-goal-" + sid5);
        var rTitle = ti5 ? ti5.value.trim() : "";
        var gVal = gl5 ? gl5.value : "";
        if (!rTitle) { TActionMsg[sid5] = { ok: false, text: "Enter a reward description first." }; return teacherView(); }
        var gsp = gVal.split("|");
        var rewObj = gsp[0] === "xp"
          ? { title: rTitle, type: "xp", target: parseInt(gsp[1], 10) || 250, at: Date.now() }
          : { title: rTitle, type: gsp[0] || "stops", chKey: gsp[1] || "", at: Date.now() };
        return saveTeacherPatch(sid5, function (td) { td.reward = rewObj; }, "Reward milestone saved.");
      }
      case "t-clear-reward": {
        var sid6 = t.getAttribute("data-sid") || "student1";
        return saveTeacherPatch(sid6, function (td) { td.reward = null; }, "Reward cleared.");
      }
      case "t-assign-q": {
        var sid7 = t.getAttribute("data-sid") || "student1";
        var sel7 = document.getElementById("ta-assign-" + sid7);
        var qid7 = sel7 ? sel7.value : "";
        if (!qid7) { TActionMsg[sid7] = { ok: false, text: "Pick a board question first." }; return teacherView(); }
        return saveTeacherPatch(sid7, function (td) {
          var arr = Array.isArray(td.assigned) ? td.assigned.filter(function (a) { return isObj(a) && a.id !== qid7; }) : [];
          arr.push({ id: qid7, at: Date.now() });
          td.assigned = arr.slice(-20);
        }, "Board question assigned to Review.");
      }
      case "t-unassign-q": {
        var sid8 = t.getAttribute("data-sid") || "student1";
        var qid8 = t.getAttribute("data-id") || "";
        return saveTeacherPatch(sid8, function (td) {
          td.assigned = Array.isArray(td.assigned) ? td.assigned.filter(function (a) { return isObj(a) && a.id !== qid8; }) : [];
        }, "Removed from teacher assignments.");
      }
      case "t-nudge-review": {
        var sid9 = t.getAttribute("data-sid") || "student1";
        var nDue = parseInt(t.getAttribute("data-due"), 10) || 1;
        return saveTeacherPatch(sid9, function (td) {
          td.note = "You have " + nDue + (nDue === 1 ? " item" : " items") + " due in Review. Please clear your Review tab before starting a new topic!";
          td.noteAt = Date.now();
        }, "Review reminder sent to student.");
      }
      case "t-quick-pin": {
        var sid10 = t.getAttribute("data-sid") || "student1";
        var ch10 = t.getAttribute("data-ch") || "", st10 = t.getAttribute("data-stop") || "", ti10 = t.getAttribute("data-title") || "stop";
        if (!ch10 || !st10) return;
        return saveTeacherPatch(sid10, function (td) {
          td.focus = { chKey: ch10, stopId: st10, at: Date.now() };
        }, "Pinned \"" + ti10 + "\" to student's Home.");
      }
      case "t-quick-assign": {
        var sid11 = t.getAttribute("data-sid") || "student1";
        var qid11 = t.getAttribute("data-id") || "";
        if (!qid11) return;
        return saveTeacherPatch(sid11, function (td) {
          var arr = Array.isArray(td.assigned) ? td.assigned.filter(function (a) { return isObj(a) && a.id !== qid11; }) : [];
          arr.push({ id: qid11, at: Date.now() });
          td.assigned = arr.slice(-20);
        }, "Related board PYQ assigned to Review.");
      }
      case "t-quick-note": {
        var sid12 = t.getAttribute("data-sid") || "student1";
        var topic12 = t.getAttribute("data-topic") || "this topic";
        var ta12 = document.getElementById("ta-note-" + sid12);
        if (ta12) {
          ta12.value = "Please revise " + topic12 + " and clear it in your Review tab.";
          ta12.scrollIntoView({ behavior: "smooth", block: "center" });
          ta12.focus();
        }
        return;
      }
      case "mix-reveal":
        if (MIX && MIX.items[MIX.i]) { MIX.items[MIX.i].revealed = true; mixRender(); }
        return;
      case "mix-tick":
        if (MIX && MIX.items[MIX.i]) {
          var mit = MIX.items[MIX.i], mk = dataI(t);
          mit.ticks[mk] = !mit.ticks[mk];
          if (ptsGot(mit.q, mit.ticks) >= mit.q.marks) mit.err = "";
          mixRender();
        }
        return;
      case "mix-all":
        if (MIX && MIX.items[MIX.i]) {
          var mia = MIX.items[MIX.i], mpts = qPoints(mia.q);
          var allOn = mia.ticks.length === mpts.length && mia.ticks.every(Boolean);
          mia.ticks = mpts.map(function () { return !allOn; });
          if (!allOn) mia.err = "";
          mixRender();
        }
        return;
      case "mix-err":
        if (MIX && MIX.items[MIX.i]) {
          var mev = t.getAttribute("data-err") || "";
          MIX.items[MIX.i].err = MIX.items[MIX.i].err === mev ? "" : mev;
          mixRender();
        }
        return;
      case "mix-next": {
        if (!MIX || !MIX.items[MIX.i]) return;
        var mn = MIX.items[MIX.i], mgot = ptsGot(mn.q, mn.ticks), mof = mn.q.marks, mnow = Date.now();
        var mst = load();
        mst.boardPts[mn.q.id] = { got: mgot, of: mof, at: mnow, err: mgot < mof ? (mn.err || "") : "" };
        mst.board[mn.q.id] = mgot >= mof ? "got" : "practice";
        mst.boardAt[mn.q.id] = mnow;
        if (mgot < mof) {
          bankAdd(bankId("b", mn.q.id, null, mn.ch), "below full marks", mn.err || "");
          if (mn.err) logError(mn.q.id, chKeyOf(mn.ch.subject, mn.ch.id), mn.err, mst);
        }
        save();
        MIX.ok += mgot; MIX.total += mof; MIX.i++;
        return mixRender();
      }
      case "paper-start": {
        var pk1 = t.getAttribute("data-pk") || "physics";
        var mode1 = t.getAttribute("data-mode") || "full";
        var sec1 = t.getAttribute("data-sec") || "";
        var customChs = null;
        if (mode1 === "custom") {
          customChs = Array.prototype.slice.call(app.querySelectorAll('input[name="p-ch"]:checked')).map(function (el) { return el.value; });
          if (!customChs.length) return;
        }
        return paperStart(pk1, { sectionOnly: sec1 || undefined, chKeys: customChs });
      }
      case "pr-pick": {
        if (!PR || PR.phase !== "read") return;
        var psid = t.getAttribute("data-sec"), pqid = t.getAttribute("data-qid");
        var psec = PR.paper.sections.filter(function (s) { return s.id === psid; })[0];
        if (!psec) return;
        var picks = PR.picks[psid] || (PR.picks[psid] = []);
        var pidx = picks.indexOf(pqid);
        if (pidx >= 0) picks.splice(pidx, 1);
        else if (picks.length < psec.attempt) picks.push(pqid);
        savePaperRun();
        return paperRender();
      }
      case "pr-start-write":
        if (!PR) return;
        PR.phase = "write";
        PR.writeStart = Date.now();
        savePaperRun();
        return paperRender();
      case "pr-finish-write":
        if (!PR) return;
        if (pTimer) { clearInterval(pTimer); pTimer = null; }
        PR.phase = "mark";
        savePaperRun();
        return paperRender();
      case "pr-mcq": {
        if (!PR || PR.phase !== "mark") return;
        var mqid = t.getAttribute("data-qid"), mok = t.getAttribute("data-ok") === "1";
        PR.mcq[mqid] = mok;
        savePaperRun();
        return paperRender();
      }
      case "pr-tick": {
        if (!PR || PR.phase !== "mark") return;
        var tqid = t.getAttribute("data-qid"), ti = dataI(t);
        var arrT = PR.ticks[tqid] || [];
        arrT[ti] = !arrT[ti];
        PR.ticks[tqid] = arrT;
        savePaperRun();
        return paperRender();
      }
      case "pr-all": {
        if (!PR || PR.phase !== "mark") return;
        var aqid = t.getAttribute("data-qid");
        var aqItem = paperFindItem(aqid);
        if (!aqItem) return;
        var apts = qPoints(aqItem.q), aCur = PR.ticks[aqid] || [];
        var aAll = aCur.length === apts.length && aCur.every(Boolean);
        PR.ticks[aqid] = apts.map(function () { return !aAll; });
        if (!aAll) delete PR.errs[aqid];
        savePaperRun();
        return paperRender();
      }
      case "pr-err": {
        if (!PR || PR.phase !== "mark") return;
        var eqid = t.getAttribute("data-qid"), eVal = t.getAttribute("data-err") || "";
        PR.errs[eqid] = PR.errs[eqid] === eVal ? "" : eVal;
        savePaperRun();
        return paperRender();
      }
      case "pr-submit-marks":
        return paperSubmitMarks();
      case "t-boost": {
        var bsid = t.getAttribute("data-sid") || "student1";
        var bval = t.getAttribute("data-boost") || "balanced";
        return saveTeacherPatch(bsid, function (td) { td.subjectBoost = bval; }, "Weekly focus set to " + bval + ".");
      }
      case "revise-pack": {
        var rpk = t.getAttribute("data-pk") || "physics";
        var rpi = t.getAttribute("data-idx");
        try {
          var keyS = "hscPrep.pack." + rpk;
          var cur = JSON.parse(sessionStorage.getItem(keyS) || "{}");
          cur[rpi] = !cur[rpi];
          sessionStorage.setItem(keyS, JSON.stringify(cur));
        } catch (e) {}
        return;
      }
    }
  });
  if (previewBarEl) {
    previewBarEl.addEventListener("click", function (e) {
      if (e.target.closest('[data-act="exit-preview"]')) exitPreview();
    });
  }
  if (teacherBarEl) {
    teacherBarEl.addEventListener("click", function (e) {
      var btn = e.target.closest('[data-act="dismiss-t-note"]');
      if (!btn) return;
      var nAt = parseInt(btn.getAttribute("data-at"), 10) || Date.now();
      load().dismissedNoteAt = Math.max(load().dismissedNoteAt || 0, nAt);
      save();
      renderTeacherBar();
    });
  }
  function syncNum(ce) { var el = document.getElementById("numin"); if (el) ce.val = el.value; }
  app.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "numin") { var ce = R && R.ce && location.hash.indexOf("#/review") === 0 ? R.ce : Q && Q.ce; if (ce) { ce.val = t.value; if (ce.mode === "quest") saveQuest(); } }
    if (t.classList && t.classList.contains("note-ta")) onNoteInput(t);
  });
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "numin") { var b = app.querySelector('[data-act="ce-check"]'); if (b) b.click(); return; }
    var rg = e.target.closest && e.target.closest('.opts[role="radiogroup"]');
    if (!rg) return;
    var step = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 0;
    if (!step) return;
    var items = Array.prototype.slice.call(rg.querySelectorAll('[role="radio"]:not([disabled])'));
    if (!items.length) return;
    var idx = items.indexOf(e.target);
    if (idx < 0) return;
    e.preventDefault();
    items[(idx + step + items.length) % items.length].focus();
  });
  app.addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("note-ta")) flushNote(true); });
  window.addEventListener("pagehide", function () { flushNote(true); saveRound(false); flushTimer(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) { flushNote(true); saveRound(false); flushTimer(); } });
  document.querySelector(".themebar").addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme-set]");
    if (!b) return;
    load().theme = b.getAttribute("data-theme-set"); save({ silentSync: true }); applyTheme(); route(true);
  });

  document.querySelector(".tabs").addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");     // tapping the tab you are already on restarts that page
    if (a && (location.hash || "#/") === a.getAttribute("href")) route(false);
  });
  } // end if (HAS_DOM)

  /* ---------- P4: Interleaved Mystery Drill & Board Paper Simulator ---------- */
  var MIX = null, PR = null, pTimer = null;
  function ptsGot(q, ticks) {
    var g = 0;
    qPoints(q).forEach(function (x, k) { if (ticks && ticks[k]) g += +x.marks || 0; });
    return g;
  }
  function mulberry32(a) {
    var t = a >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function paperKeysList(paperKey) {
    var pg = (catalog.paperGroups || {})[paperKey];
    var subs = pg && Array.isArray(pg.subjects) ? pg.subjects : [paperKey];
    return LIVE_LIST.filter(function (e) { return subs.indexOf(e.subj) >= 0; }).map(function (e) { return e.key; });
  }
  function buildPaper(paperKey, opts) {
    opts = opts || {};
    var pat = (catalog.paperPatterns || {})[paperKey];
    var pg = (catalog.paperGroups || {})[paperKey];
    if (!pat || !pg) return null;
    var seed = (opts.seed != null ? opts.seed : Math.floor(Date.now() / 1000)) | 0;
    var rnd = mulberry32(seed);
    var st = load();
    var chFilter = Array.isArray(opts.chKeys) && opts.chKeys.length ? opts.chKeys : null;
    var pool = [];
    LIVE_LIST.forEach(function (e) {
      if ((pg.subjects || []).indexOf(e.subj) < 0) return;
      if (chFilter && chFilter.indexOf(e.key) < 0) return;
      var ch = CHAPTERS[e.key];
      if (!ch || !Array.isArray(ch.board)) return;
      ch.board.forEach(function (q) {
        pool.push({ q: q, chKey: e.key, ch: ch, rand: rnd() });
      });
    });

    function itemScore(it) {
      var bp = st.boardPts && st.boardPts[it.q.id];
      var isWeak = !bp || bp.got < bp.of || st.board[it.q.id] === "need";
      return (it.q.year ? 0 : 2) + (isWeak ? 0 : 1);
    }
    pool.sort(function (a, b) {
      var sa = itemScore(a), sb = itemScore(b);
      if (sa !== sb) return sa - sb;
      return a.rand - b.rand;
    });

    var used = {};
    var targetSecs = opts.sectionOnly ? pat.sections.filter(function (s) { return s.id === opts.sectionOnly; }) : pat.sections;
    var outSecs = [];
    var allFull = !opts.sectionOnly && !chFilter;
    targetSecs.forEach(function (sec) {
      var cands = pool.filter(function (it) {
        if (used[it.q.id]) return false;
        if (it.q.marks !== sec.marksEach) return false;
        if (sec.kind === "mcq") return it.q.kind === "mcq";
        return it.q.kind !== "mcq";
      });
      var picked = [], chCount = {};
      for (var pass = 0; pass < 2 && picked.length < sec.offer; pass++) {
        for (var i = 0; i < cands.length && picked.length < sec.offer; i++) {
          var it = cands[i];
          if (used[it.q.id]) continue;
          var cc = chCount[it.chKey] || 0;
          if (pass === 0 && cc >= 2) continue;
          used[it.q.id] = true;
          chCount[it.chKey] = cc + 1;
          picked.push({ q: it.q, chKey: it.chKey, chTitle: chShortLabel(it.ch) });
        }
      }
      if (sec.id === "D" && picked.length < sec.offer) {
        var twosA = pool.filter(function (it) { return !used[it.q.id] && it.q.marks === 2 && it.q.kind !== "mcq" && it.q.kind !== "numerical" && it.q.kind !== "problem"; });
        var twosB = pool.filter(function (it) { return !used[it.q.id] && it.q.marks === 2 && (it.q.kind === "numerical" || it.q.kind === "problem"); });
        while (picked.length < sec.offer && twosA.length && twosB.length) {
          var a2 = twosA.shift(), b2 = twosB.shift();
          used[a2.q.id] = true; used[b2.q.id] = true;
          var compQ = {
            id: a2.q.id + "+" + b2.q.id,
            marks: 4,
            kind: "theory",
            composite: true,
            page: a2.q.page,
            text: "(a) " + a2.q.text + "\n(b) " + b2.q.text,
            answer: "(a) " + a2.q.answer + "\n\n(b) " + b2.q.answer,
            points: qPoints(a2.q).concat(qPoints(b2.q))
          };
          picked.push({ q: compQ, chKey: a2.chKey, chTitle: chShortLabel(a2.ch) + " + " + chShortLabel(b2.ch) });
        }
      }
      if (picked.length < sec.attempt) allFull = false;
      outSecs.push({ id: sec.id, title: sec.title, marksEach: sec.marksEach, attempt: sec.attempt, offer: sec.offer, items: picked });
    });

    var maxMarks = outSecs.reduce(function (a, s) { return a + Math.min(s.attempt, s.items.length) * s.marksEach; }, 0);
    return {
      paperKey: paperKey,
      title: pg.title,
      totalMarks: pat.totalMarks,
      maxAttemptMarks: maxMarks,
      durationMin: opts.sectionOnly ? Math.max(20, Math.round(maxMarks * 2.2)) : pat.durationMin,
      readingMin: opts.sectionOnly ? 5 : pat.readingMin,
      seed: seed,
      full: allFull && maxMarks === pat.totalMarks,
      sectionOnly: opts.sectionOnly || "",
      sections: outSecs
    };
  }

  function mixStart(paperKey) {
    var keys = paperKeysList(paperKey);
    if (!keys.length) return errorView("No chapters available for " + paperKey);
    return withChapters(keys, function () {
      var st = load(), pool = [];
      keys.forEach(function (k) {
        var ch = CHAPTERS[k];
        if (!ch || !Array.isArray(ch.board)) return;
        ch.board.forEach(function (q) {
          var bp = st.boardPts && st.boardPts[q.id];
          var score = (!bp || bp.got < bp.of ? 0 : 2) + (q.year ? 0 : 1) + Math.random();
          pool.push({ q: q, ch: ch, score: score });
        });
      });
      pool.sort(function (a, b) { return a.score - b.score; });
      var chosen = [], chUsed = {};
      for (var pass = 0; pass < 2 && chosen.length < 6; pass++) {
        for (var i = 0; i < pool.length && chosen.length < 6; i++) {
          var it = pool[i];
          if (chosen.indexOf(it) >= 0) continue;
          var ck = chKeyOf(it.ch.subject, it.ch.id);
          if (pass === 0 && chUsed[ck]) continue;
          chUsed[ck] = true;
          chosen.push(it);
        }
      }
      MIX = {
        paperKey: paperKey,
        items: chosen.map(function (it) {
          return { q: it.q, ch: it.ch, revealed: false, ticks: qPoints(it.q).map(function () { return false; }), err: "" };
        }),
        i: 0, ok: 0, total: 0
      };
      redraw = mixRender;
      mixRender();
    });
  }
  function mixRender() {
    if (!MIX) return;
    var pg = (catalog.paperGroups || {})[MIX.paperKey] || { title: MIX.paperKey };
    setHeader("Mystery Drill · " + pg.title, "#/", { xp: true, tab: "home" });
    if (MIX.i >= MIX.items.length) {
      var pct = MIX.total ? Math.round(100 * MIX.ok / MIX.total) : 0;
      var chList = {};
      MIX.items.forEach(function (it) { chList[chShortLabel(it.ch) + ": " + it.ch.title] = true; });
      app.innerHTML = '<div class="card center"><h2>Mystery Drill Complete</h2>' +
        '<p class="big"><b>' + MIX.ok + " / " + MIX.total + " marks</b> (" + pct + "%)</p>" +
        '<p class="muted small">Chapters tested: ' + esc(Object.keys(chList).join(" · ")) + "</p>" +
        '<div class="actions two"><a class="btn primary" href="#/mix/' + esc(MIX.paperKey) + '">New Mystery Drill</a><a class="btn ghost" href="#/">Home</a></div></div>';
      return;
    }
    var it = MIX.items[MIX.i], q = it.q;
    var h = steps(MIX.items.length, MIX.i);
    h += '<div class="card"><div class="check-head"><span class="pill">Question ' + (MIX.i + 1) + " of " + MIX.items.length + '</span><span class="pill">' + q.marks + " mark" + (q.marks > 1 ? "s" : "") + ' · Chapter hidden</span></div>' +
      '<p class="q">' + fm(q.text) + "</p>" +
      (q.options && q.options.length ? '<ul class="muted small">' + q.options.map(function (o, idx) { return "<li>(" + String.fromCharCode(97 + idx) + ") " + fm(o) + "</li>"; }).join("") + "</ul>" : "") +
      (!it.revealed ? '<button type="button" class="btn primary block" data-act="mix-reveal">Show model answer &amp; reveal chapter</button>' :
        '<div class="mix-rev"><p class="note"><b>Chapter:</b> ' + esc(chShortLabel(it.ch) + " — " + it.ch.title) + " (p. " + esc(q.page) + ")</p>" +
        modelAnswerHTML(q, it.ch) +
        '<div class="pts-box"><div class="row"><b class="small">Mark your points:</b><button type="button" class="btn ghost sm" data-act="mix-all">All correct ✓</button></div>' +
        qPoints(q).map(function (pt, idx) {
          var on = !!it.ticks[idx];
          return '<label class="pt-row"><input type="checkbox" data-act="mix-tick" data-i="' + idx + '"' + (on ? " checked" : "") + '><span>' + fm(pt.text) + '</span><b class="pt-m">' + pt.marks + "m</b></label>";
        }).join("") + "</div>" +
        (ptsGot(q, it.ticks) < q.marks ? '<div class="err-box"><span class="small muted">Why lost marks? (optional)</span><div class="err-pills">' +
          ERR_TAGS.map(function (tg) { return '<button type="button" class="err-pill" data-act="mix-err" data-err="' + esc(tg.id) + '" aria-pressed="' + (it.err === tg.id) + '">' + esc(tg.label) + "</button>"; }).join("") + "</div></div>" : "") +
        '<button type="button" class="btn primary block" style="margin-top:10px" data-act="mix-next">Save (' + ptsGot(q, it.ticks) + "/" + q.marks + "m) &amp; Next</button></div>") +
      "</div>";
    app.innerHTML = h;
  }

  function savePaperRun() {
    if (!PR || PR.phase === "report") return;
    var st = load();
    st.paperRun = { paper: PR.paper, phase: PR.phase, picks: PR.picks, mcq: PR.mcq, ticks: PR.ticks, errs: PR.errs, elapsed: PR.elapsed || 0, at: Date.now() };
    save();
  }
  function paperFindItem(qid) {
    if (!PR || !PR.paper) return null;
    for (var i = 0; i < PR.paper.sections.length; i++) {
      var items = PR.paper.sections[i].items;
      for (var j = 0; j < items.length; j++) if (items[j].q.id === qid) return items[j];
    }
    return null;
  }
  function paperPickerView(paperKey) {
    var pk = paperKey && (catalog.paperGroups || {})[paperKey] ? paperKey : "physics";
    var pg = (catalog.paperGroups || {})[pk] || { title: pk, paperMarks: 70 };
    var pat = (catalog.paperPatterns || {})[pk] || { durationMin: 180, sections: [] };
    setHeader("Board Paper Simulator", "#/", { xp: true, tab: "home" });
    var st = load();
    var h = '<div class="pills-row">' + Object.keys(catalog.paperGroups || {}).map(function (k) {
      return '<a class="pill-btn" href="#/paper/' + esc(k) + '" aria-pressed="' + (k === pk) + '">' + esc(catalog.paperGroups[k].title) + "</a>";
    }).join("") + "</div>";
    if (st.paperRun && st.paperRun.paper && st.paperRun.paper.paperKey === pk) {
      h += '<div class="card cont-card"><div><b>Resume in-progress paper</b><br><span class="small muted">Phase: ' + esc(st.paperRun.phase) + '</span></div><a class="btn primary sm" href="#/paper/' + esc(pk) + '/run">Resume</a></div>';
    }
    h += '<div class="card"><h2>' + esc(pg.title) + " (" + pg.paperMarks + " marks · " + pat.durationMin + " min)</h2>" +
      '<p class="muted small">Authentic MSBSHSE pattern with 15-min reading &amp; selection phase, section pacing, and printable paper + key.</p>' +
      '<div class="actions two" style="margin-top:10px"><button type="button" class="btn primary" data-act="paper-start" data-pk="' + esc(pk) + '" data-mode="full">Start Full Paper</button>' +
      '<a class="btn ghost" href="#/paper/' + esc(pk) + '/print">Print Paper + Key</a></div></div>';
    h += '<div class="card"><h2>Section Drills (20–50 min)</h2><div class="practice-grid">' +
      (pat.sections || []).map(function (s) {
        return '<button type="button" class="btn ghost" data-act="paper-start" data-pk="' + esc(pk) + '" data-mode="sec" data-sec="' + esc(s.id) + '">' + esc(s.id + " (" + s.attempt + "×" + s.marksEach + "m)") + "</button>";
      }).join("") + "</div></div>";
    var chEntries = LIVE_LIST.filter(function (e) { return (pg.subjects || []).indexOf(e.subj) >= 0; });
    h += '<div class="card"><h2>Custom Paper (Choose Chapters)</h2><div class="ch-checks">' +
      chEntries.map(function (e) {
        return '<label class="ch-chk"><input type="checkbox" name="p-ch" value="' + esc(e.key) + '" checked><span>' + esc(e.title) + "</span></label>";
      }).join("") + '</div><button type="button" class="btn ghost block" style="margin-top:10px" data-act="paper-start" data-pk="' + esc(pk) + '" data-mode="custom">Start Custom Paper</button></div>';
    var hist = (st.papers || []).filter(function (p) { return p.paperKey === pk; }).slice(-5).reverse();
    if (hist.length) {
      h += '<div class="card"><h2>Recent Papers</h2><ul class="t-list">' + hist.map(function (p) {
        return '<li><span><b>' + esc(p.label) + "</b> · " + esc(niceDate(p.date)) + "</span><b>" + p.got + "/" + p.of + " (" + p.pct + "%)</b></li>";
      }).join("") + "</ul></div>";
    }
    app.innerHTML = h;
  }
  function paperStart(paperKey, opts) {
    var keys = paperKeysList(paperKey);
    return withChapters(keys, function () {
      var paper = buildPaper(paperKey, opts);
      if (!paper) return errorView("Could not build paper.");
      var picks = {};
      paper.sections.forEach(function (s) {
        picks[s.id] = s.items.slice(0, s.attempt).map(function (it) { return it.q.id; });
      });
      PR = { paper: paper, phase: "read", picks: picks, mcq: {}, ticks: {}, errs: {}, elapsed: 0, writeStart: Date.now() };
      savePaperRun();
      location.hash = "#/paper/" + paperKey + "/run";
    });
  }
  function paperActiveItems(sec) {
    var picks = (PR && PR.picks && PR.picks[sec.id]) || [];
    if (sec.offer <= sec.attempt) return sec.items;
    var chosen = sec.items.filter(function (it) { return picks.indexOf(it.q.id) >= 0; });
    return chosen.length ? chosen : sec.items.slice(0, sec.attempt);
  }
  function paperSubmitMarks() {
    if (!PR || !PR.paper) return;
    var st = load(), got = 0, of = 0, secBreak = [], errMap = {}, now = Date.now();
    PR.paper.sections.forEach(function (sec) {
      var act = paperActiveItems(sec).slice(0, sec.attempt);
      var sGot = 0, sOf = 0;
      act.forEach(function (it) {
        var q = it.q; sOf += q.marks;
        var qGot = 0;
        if (sec.id === "A1") {
          qGot = PR.mcq[q.id] === true ? q.marks : 0;
        } else {
          qGot = ptsGot(q, PR.ticks[q.id] || []);
        }
        sGot += qGot;
        var ch = CHAPTERS[it.chKey];
        if (!q.composite && ch) {
          st.boardPts[q.id] = { got: qGot, of: q.marks, at: now, err: qGot < q.marks ? (PR.errs[q.id] || "") : "" };
          st.board[q.id] = qGot >= q.marks ? "got" : "practice";
          st.boardAt[q.id] = now;
          if (qGot < q.marks) {
            bankAdd(bankId("b", q.id, null, ch), "below full marks", PR.errs[q.id] || "");
            if (PR.errs[q.id]) {
              logError(q.id, it.chKey, PR.errs[q.id], st);
              errMap[PR.errs[q.id]] = (errMap[PR.errs[q.id]] || 0) + 1;
            }
          }
        }
      });
      got += sGot; of += sOf;
      secBreak.push({ id: sec.id, got: sGot, of: sOf });
    });
    var pct = of ? Math.round(100 * got / of) : 0;
    var label = PR.paper.sectionOnly ? "Section " + PR.paper.sectionOnly : (PR.paper.full ? "Full Paper" : "Mini-Paper");
    if (!Array.isArray(st.papers)) st.papers = [];
    st.papers.push({ at: now, date: today(), paperKey: PR.paper.paperKey, label: label, full: !!PR.paper.full, got: got, of: of, pct: pct, secs: secBreak, errs: errMap });
    if (st.papers.length > 30) st.papers = st.papers.slice(-30);
    st.paperRun = null;
    save();
    PR.report = { got: got, of: of, pct: pct, label: label, secs: secBreak, errs: errMap };
    PR.phase = "report";
    paperRender();
  }
  function paperRender() {
    if (!PR || !PR.paper) return;
    var p = PR.paper;
    setHeader(p.title + " · " + (p.sectionOnly ? "Section " + p.sectionOnly : (p.full ? "Full Paper" : "Mini-Paper")), "#/paper/" + p.paperKey, { xp: true, tab: "home" });
    if (pTimer) { clearInterval(pTimer); pTimer = null; }
    var h = "";
    if (PR.phase === "read") {
      h += '<div class="paper-bar"><div class="row"><div class="grow"><b>Phase 1 · Reading &amp; Selection (' + p.readingMin + ' min)</b><br><span class="small muted">Pick your best questions in Sections B, C &amp; D before writing.</span></div><button type="button" class="btn primary sm" data-act="pr-start-write">Start writing now</button></div></div>';
      p.sections.forEach(function (sec) {
        var picks = PR.picks[sec.id] || [];
        h += '<div class="card"><div class="paper-sec-h"><h2>' + esc(sec.title) + '</h2><span class="pill">' + (sec.offer > sec.attempt ? picks.length + "/" + sec.attempt + " picked" : sec.items.length + " compulsory") + "</span></div>";
        sec.items.forEach(function (it, idx) {
          var isPicked = picks.indexOf(it.q.id) >= 0;
          h += '<div class="paper-q' + (sec.offer > sec.attempt && isPicked ? " picked" : "") + '"><div class="row"><b class="grow">Q' + (idx + 1) + ". (" + it.q.marks + "m)</b>" +
            (sec.offer > sec.attempt ? '<button type="button" class="btn sm ' + (isPicked ? "primary" : "ghost") + '" data-act="pr-pick" data-sec="' + esc(sec.id) + '" data-qid="' + esc(it.q.id) + '">' + (isPicked ? "Picked ✓" : "Pick") + "</button>" : "") +
            '</div><p>' + fm(it.q.text) + "</p></div>";
        });
        h += "</div>";
      });
    } else if (PR.phase === "write") {
      var totalSec = p.durationMin * 60, rem = Math.max(0, totalSec - (PR.elapsed || 0));
      var mm = Math.floor(rem / 60), ss = rem % 60;
      h += '<div class="paper-bar"><div class="row"><div class="grow"><b>Phase 2 · Writing · <span id="pr-clock">' + mm + ":" + (ss < 10 ? "0" : "") + ss + '</span> left</b><br><span class="small muted">Write on paper · Log table allowed · Calculator NOT allowed</span></div><button type="button" class="btn primary sm" data-act="pr-finish-write">Finish &amp; Mark</button></div>' +
        '<div class="paper-pace"><span>Suggested pace: Sec A 25m · Sec B 35m · Sec C 60m · Sec D 45m · Check 15m</span></div></div>';
      p.sections.forEach(function (sec) {
        var act = paperActiveItems(sec);
        h += '<div class="card"><h2>' + esc(sec.title) + "</h2>";
        act.forEach(function (it, idx) {
          h += '<div class="paper-q"><b>Q' + (idx + 1) + ". (" + it.q.marks + "m)</b><p>" + fm(it.q.text) + "</p>" +
            (it.q.options && it.q.options.length ? '<ul class="muted small">' + it.q.options.map(function (o, oi) { return "<li>(" + String.fromCharCode(97 + oi) + ") " + fm(o) + "</li>"; }).join("") + "</ul>" : "") + "</div>";
        });
        h += "</div>";
      });
      pTimer = setInterval(function () {
        if (!PR || PR.phase !== "write") { clearInterval(pTimer); pTimer = null; return; }
        PR.elapsed = (PR.elapsed || 0) + 1;
        var r = Math.max(0, p.durationMin * 60 - PR.elapsed);
        var el = document.getElementById("pr-clock");
        if (el) el.textContent = Math.floor(r / 60) + ":" + (r % 60 < 10 ? "0" : "") + (r % 60);
      }, 1000);
    } else if (PR.phase === "mark") {
      h += '<div class="paper-bar"><div class="row"><div class="grow"><b>Phase 3 · Self-Marking</b><br><span class="small muted">Fast MCQ strip + examiner point ticks.</span></div><button type="button" class="btn primary sm" data-act="pr-submit-marks">Submit Marks</button></div></div>';
      p.sections.forEach(function (sec) {
        var act = paperActiveItems(sec).slice(0, sec.attempt);
        h += '<div class="card"><h2>' + esc(sec.title) + "</h2>";
        if (sec.id === "A1") {
          h += '<div class="mcq-strip">' + act.map(function (it, idx) {
            var q = it.q, stM = PR.mcq[q.id];
            return '<div class="mcq-row"><div class="grow"><b>Q' + (idx + 1) + '.</b> ' + fm(q.answer) + '</div><div class="mcq-row-btns">' +
              '<button type="button" class="btn sm ' + (stM === true ? "ok" : "ok ghost") + '" data-act="pr-mcq" data-qid="' + esc(q.id) + '" data-ok="1">Right ✓</button>' +
              '<button type="button" class="btn sm ' + (stM === false ? "warn" : "warn ghost") + '" data-act="pr-mcq" data-qid="' + esc(q.id) + '" data-ok="0">Wrong ✗</button>' +
              "</div></div>";
          }).join("") + "</div>";
        } else {
          act.forEach(function (it, idx) {
            var q = it.q, ticks = PR.ticks[q.id] || [], gotQ = ptsGot(q, ticks);
            h += '<div class="paper-q"><div class="row"><b class="grow">Q' + (idx + 1) + ". (" + q.marks + 'm)</b><button type="button" class="btn ghost sm" data-act="pr-all" data-qid="' + esc(q.id) + '">All correct ✓</button></div>' +
              '<p class="small muted">' + fm(q.text) + "</p>" + modelAnswerHTML(q, CHAPTERS[it.chKey]) +
              qPoints(q).map(function (pt, pi) {
                return '<label class="pt-row"><input type="checkbox" data-act="pr-tick" data-qid="' + esc(q.id) + '" data-i="' + pi + '"' + (ticks[pi] ? " checked" : "") + '><span>' + fm(pt.text) + '</span><b class="pt-m">' + pt.marks + "m</b></label>";
              }).join("") +
              (gotQ < q.marks ? '<div class="err-pills">' + ERR_TAGS.map(function (tg) {
                return '<button type="button" class="err-pill" data-act="pr-err" data-qid="' + esc(q.id) + '" data-err="' + esc(tg.id) + '" aria-pressed="' + (PR.errs[q.id] === tg.id) + '">' + esc(tg.label) + "</button>";
              }).join("") + "</div>" : "") + "</div>";
          });
        }
        h += "</div>";
      });
    } else if (PR.phase === "report" && PR.report) {
      var rep = PR.report;
      h += '<div class="card center"><span class="pill">' + esc(rep.label) + '</span><h2>' + rep.got + " / " + rep.of + " marks (" + rep.pct + '%)</h2>' +
        '<p class="muted small">Time used: ' + Math.round((PR.elapsed || 0) / 60) + " min</p></div>" +
        '<div class="card"><h2>Section Breakdown</h2><ul class="t-list">' + rep.secs.map(function (s) {
          return "<li><b>Section " + esc(s.id) + "</b><span>" + s.got + " / " + s.of + " marks</span></li>";
        }).join("") + '</ul><div class="actions two" style="margin-top:12px"><a class="btn ghost" href="#/paper/' + esc(p.paperKey) + '/print">Print Paper + Key</a><a class="btn primary" href="#/paper/' + esc(p.paperKey) + '">Done</a></div></div>';
    }
    app.innerHTML = h;
  }
  function paperPrintView(paperKey) {
    var keys = paperKeysList(paperKey);
    return withChapters(keys, function () {
      var p = (PR && PR.paper && PR.paper.paperKey === paperKey) ? PR.paper : buildPaper(paperKey, { seed: 2027 });
      if (!p) return errorView("Could not generate printable paper.");
      setHeader("Print · " + p.title, "#/paper/" + paperKey, { tab: "home" });
      var h = '<div class="card noprint"><button type="button" class="btn primary block" onclick="window.print()">Print Question Paper + Answer Key</button></div>';
      h += '<div class="card"><div class="print-hdr"><h2>MAHARASHTRA HSC BOARD PRACTICE PAPER — ' + esc(p.title.toUpperCase()) + '</h2>' +
        '<div class="print-meta"><span>Time: ' + p.durationMin + ' min</span><span>Max. Marks: ' + p.maxAttemptMarks + '</span></div>' +
        '<p class="small">General Instructions: Use of log table is allowed. Use of calculator is not allowed.</p></div>';
      p.sections.forEach(function (sec) {
        h += "<h3>" + esc(sec.title) + "</h3>";
        sec.items.forEach(function (it, idx) {
          h += '<p><b>Q' + (idx + 1) + ".</b> " + fm(it.q.text) + " <b>[" + it.q.marks + "]</b></p>";
          if (it.q.options && it.q.options.length) h += '<p class="small">' + it.q.options.map(function (o, oi) { return "(" + String.fromCharCode(97 + oi) + ") " + fm(o); }).join(" &nbsp;&nbsp; ") + "</p>";
        });
      });
      h += "</div>";
      h += '<div class="card pbreak"><h2>Answer Key &amp; Marking Scheme</h2>';
      p.sections.forEach(function (sec) {
        h += "<h3>" + esc(sec.title) + "</h3>";
        sec.items.forEach(function (it, idx) {
          h += "<p><b>Q" + (idx + 1) + " (" + esc(it.chTitle) + "):</b> " + fm(it.q.answer) + "</p>";
        });
      });
      h += "</div>";
      app.innerHTML = h;
    });
  }
  if (typeof window !== "undefined") {
    window.__paperAdvance = function (sec) {
      if (!PR) return false;
      if (sec) PR.elapsed = (PR.elapsed || 0) + sec;
      if (PR.phase === "read") PR.phase = "write";
      else if (PR.phase === "write") PR.phase = "mark";
      savePaperRun();
      paperRender();
      return PR.phase;
    };
  }

  /* ---------- P6: Last-Week & Exam-Day Cockpit ---------- */
  var PHY_CONSTANTS = [
    ["g", "9.8 m/s²"], ["G", "6.67 × 10⁻¹¹ N·m²/kg²"], ["R", "8.314 J/(mol·K)"],
    ["N_A", "6.022 × 10²³ mol⁻¹"], ["h", "6.63 × 10⁻³⁴ J·s"], ["c", "3 × 10⁸ m/s"],
    ["e", "1.6 × 10⁻¹⁹ C"], ["ε₀", "8.85 × 10⁻¹² C²/(N·m²)"], ["μ₀", "4π × 10⁻⁷ Wb/(A·m)"],
    ["k_B", "1.38 × 10⁻²³ J/K"], ["F", "96500 C/mol"], ["σ", "5.67 × 10⁻⁸ W/(m²·K⁴)"]
  ];
  var PACK_ITEMS = [
    "Original HSC Hall Ticket + School/College ID",
    "2 blue/black ball pens + extra refills",
    "Sharpened pencil, eraser, 30 cm ruler & geometry box",
    "Clear water bottle (no calculators / smartwatches — log tables supplied by board)"
  ];
  function reviseView(paperKey) {
    var pk = paperKey && (catalog.paperGroups || {})[paperKey] ? paperKey : "physics";
    var pg = (catalog.paperGroups || {})[pk] || { title: pk, paperMarks: 70, subjects: [pk] };
    setHeader(pg.title + " · Exam Cockpit", "#/", { xp: true, tab: "home" });
    var st = load();
    var chKeys = paperKeysList(pk);
    var chObjs = chKeys.map(function (k) { return CHAPTERS[k]; }).filter(Boolean);
    var phase = studyPhase(pk, st);

    var h = '<div class="pills-row noprint">' + ["physics", "chemistry", "maths"].map(function (k) {
      return '<a class="pill-btn" href="#/revise/' + k + '" aria-pressed="' + (k === pk) + '">' + esc((catalog.paperGroups[k] || {}).title || k) + "</a>";
    }).join("") + "</div>";

    h += '<div class="card"><div class="row"><div class="grow"><h2>' + esc(pg.title) + " · Final Revision Cockpit</h2>" +
      '<p class="muted small">' + esc(phase.label) + (phase.daysLeft != null ? " · " + phase.daysLeft + " days to exam" : "") + " · " + chObjs.length + " chapters</p></div>" +
      '<button type="button" class="btn primary sm noprint" onclick="window.print()">Print Revision Pack</button></div></div>';

    // 1. Master Formula / Reaction Sheet
    var fGroups = [];
    chObjs.forEach(function (ch) {
      (ch.formulas || []).forEach(function (g) {
        (g.items || []).forEach(function (it) { fGroups.push({ ch: ch, it: it }); });
      });
    });
    h += '<div class="card rev-sec"><h2>1. Master ' + (pk === "chemistry" ? "Formula & Reaction" : "Formula") + " Sheet (" + fGroups.length + ")</h2>" +
      '<div class="noprint" style="margin-bottom:8px"><a class="btn ghost sm" href="#/formulas">Open Active-Recall Flashcards</a></div>' +
      '<div class="f-grid">' + fGroups.slice(0, 40).map(function (x) {
        return '<div class="frm"><div class="fn">' + esc(x.it.n) + '<span class="fp">' + esc(chShortLabel(x.ch)) + " p." + esc(x.it.p) + '</span></div><div class="ff">' + fm(x.it.f) + "</div>" + (x.it.s ? '<div class="fs">' + fm(x.it.s) + "</div>" : "") + "</div>";
      }).join("") + "</div></div>";

    // 2. Derivation & Proof Skeletons
    var derivs = [];
    chObjs.forEach(function (ch) {
      (ch.derivations || []).forEach(function (d) { derivs.push({ ch: ch, d: d }); });
    });
    h += '<div class="card rev-sec pbreak"><h2>2. Derivation &amp; Proof Skeletons (' + derivs.length + ")</h2>" +
      (derivs.length ? derivs.map(function (x) {
        return '<details class="how"><summary>' + fm(x.d.title) + " (" + esc(chShortLabel(x.ch)) + ", p. " + esc(x.d.page) + ')</summary><ol class="dlines">' +
          (x.d.steps || []).map(function (s) { return "<li>" + fm(s.line) + "</li>"; }).join("") + "</ol></details>";
      }).join("") : '<p class="muted small">See high-yield derivations in Top 25 PYQs below.</p>') + "</div>";

    // 3. Top 25 Most-Asked PYQs
    var pyqs = [];
    chObjs.forEach(function (ch) {
      (ch.board || []).forEach(function (q) {
        var askC = q.pyqAskCount || (Array.isArray(q.alsoAsked) ? q.alsoAsked.length + 1 : (q.year ? 1 : 0));
        pyqs.push({ ch: ch, q: q, askC: askC });
      });
    });
    pyqs.sort(function (a, b) {
      if (b.askC !== a.askC) return b.askC - a.askC;
      if (b.q.marks !== a.q.marks) return b.q.marks - a.q.marks;
      return (b.q.year || 0) - (a.q.year || 0);
    });
    h += '<div class="card rev-sec"><h2>3. Top 25 Most-Asked Board PYQs</h2>' +
      pyqs.slice(0, 25).map(function (x, idx) {
        return '<details class="how"><summary><b>#' + (idx + 1) + " [" + x.q.marks + "m · " + esc(boardTag(x.q)) + "]</b> " + fm(x.q.text) + "</summary>" +
          modelAnswerHTML(x.q, x.ch) + "</details>";
      }).join("") + "</div>";

    // 4. Resurfaced Past Mistakes (st.graduated + remaining st.bank)
    var pastIds = [];
    var seenM = {};
    Object.keys(st.graduated || {}).forEach(function (id) {
      var ck = parseId(id).chKey;
      if (chKeys.indexOf(ck) >= 0 && itemExists(id) && !seenM[id]) { seenM[id] = true; pastIds.push({ id: id, grad: true }); }
    });
    Object.keys(st.bank || {}).forEach(function (id) {
      var ck = parseId(id).chKey;
      if (chKeys.indexOf(ck) >= 0 && itemExists(id) && !seenM[id]) { seenM[id] = true; pastIds.push({ id: id, grad: false }); }
    });
    h += '<div class="card rev-sec noprint"><h2>4. Resurfaced Past Mistakes (' + pastIds.length + ")</h2>" +
      (pastIds.length ? '<ul class="t-list">' + pastIds.slice(0, 15).map(function (m) {
        return '<li><span>' + esc(trunc(itemLabel(m.id), 95)) + '</span><span class="pill' + (m.grad ? " ok" : "") + '">' + (m.grad ? "Graduated" : "In bank") + "</span></li>";
      }).join("") + "</ul>" : '<p class="muted small">No past mistakes logged for ' + esc(pg.title) + " yet.</p>") + "</div>";

    // 5. Weak Chapters Alert (< 50% mastery)
    var weakChs = chObjs.filter(function (ch) { return chapterProgress(st, ch).pct < 50; })
      .sort(function (a, b) { return ((b.examMarks && b.examMarks.theory) || 0) - ((a.examMarks && a.examMarks.theory) || 0); });
    h += '<div class="card rev-sec noprint"><h2>5. Weak Chapters Alert (' + weakChs.length + ")</h2>" +
      (weakChs.length ? '<ul class="list">' + weakChs.slice(0, 6).map(function (ch) {
        var topStops = ch.stops.filter(function (s) { return !isDone(s.id, st, ch); }).slice(0, 2);
        return '<li><a class="item" href="' + chBase(ch) + '"><span class="num">' + ch.number + '</span><span class="grow"><b>' + esc(ch.title) + '</b> (' + chapterProgress(st, ch).pct + '%)<br><span class="muted small">Top stops: ' + esc(topStops.map(function (s) { return s.title; }).join(", ") || "Board round") + "</span></span>" + ICON.chev + "</a></li>";
      }).join("") + "</ul>" : '<p class="muted small">All chapters above 50% mastery!</p>') + "</div>";

    // 6. Exam-Day Strategy, Physical Constants & Packing Checklist
    var packState = {};
    try { packState = JSON.parse(sessionStorage.getItem("hscPrep.pack." + pk) || "{}"); } catch (e) {}
    h += '<div class="card rev-sec pbreak"><h2>6. Exam-Day Strategy, Constants &amp; Checklist</h2>' +
      '<p class="small"><b>180-Min Time Budget:</b> Reading 15m (pick best B/C/D) → Sec A 25m → Sec B 35m → Sec C 60m → Sec D 45m → Final 15m (check SI units, diagrams, roll no.).</p>';
    if (pk === "physics" || pk === "chemistry") {
      h += '<h3 style="margin-top:10px">Physical Constants &amp; Log-Table Tips</h3><div class="const-grid">' +
        PHY_CONSTANTS.map(function (c) { return '<div class="const-item"><b>' + fm(c[0]) + "</b> = " + fm(c[1]) + "</div>"; }).join("") + "</div>" +
        '<p class="small muted" style="margin-top:8px"><b>Log-table tip:</b> Characteristic = (digits before decimal − 1) for ≥ 1, or −(leading zeros + 1) for &lt; 1. Mantissa is always positive from the 4-digit table. Calculators are strictly NOT allowed.</p>';
    } else {
      h += '<p class="small muted" style="margin-top:8px"><b>Maths Hall Rule:</b> Graph paper is NOT provided — draw neat rough sketches for LPP and Area under curves. State theorems &amp; substitutions clearly.</p>';
    }
    h += '<h3 style="margin-top:12px" class="noprint">Exam-Morning Packing Checklist</h3><div class="noprint">' +
      PACK_ITEMS.map(function (txt, idx) {
        return '<label class="pt-row"><input type="checkbox" data-act="revise-pack" data-pk="' + esc(pk) + '" data-idx="' + idx + '"' + (packState[idx] ? " checked" : "") + '><span>' + esc(txt) + "</span></label>";
      }).join("") + "</div></div>";

    app.innerHTML = h;
  }

  /* ---------- router ---------- */
  function route(rerender) {
    routeGen++;
    flushNote(false);
    var rawHash = (location.hash || "#/").split("?")[0];
    var parts = rawHash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!rerender) window.scrollTo(0, 0);
    redraw = null;
    var p0 = parts[0], p1 = parts[1];
    if (rTimer) { clearInterval(rTimer); rTimer = null; }
    if (pTimer) { clearInterval(pTimer); pTimer = null; }
    var stayingOnSameRun = RD && RD.phase === "run" && p0 && p1 && chKeyOf(p0, p1) === RD.chKey && parts[2] === "round" && parts[3] === "run";
    if (!stayingOnSameRun) roundLeave();
    if (!parts.length) return homeView();
    if (p0 === "sync") return syncView();
    if (p0 === "revise") return withChapters(paperKeysList(p1 || "physics"), function () { reviseView(p1 || "physics"); });
    if (p0 === "mix") return mixStart(p1 || "physics");
    if (p0 === "paper") {
      var pkR = p1 && (catalog.paperGroups || {})[p1] ? p1 : "physics";
      if (parts[2] === "run") {
        if (!PR && load().paperRun) {
          var sr = load().paperRun;
          PR = { paper: sr.paper, phase: sr.phase, picks: sr.picks || {}, mcq: sr.mcq || {}, ticks: sr.ticks || {}, errs: sr.errs || {}, elapsed: sr.elapsed || 0, writeStart: Date.now() };
        }
        if (PR && PR.paper && PR.paper.paperKey === pkR) {
          return withChapters(paperKeysList(pkR), paperRender);
        }
        return paperStart(pkR, {});
      }
      if (parts[2] === "print") return paperPrintView(pkR);
      return paperPickerView(pkR);
    }
    if (p0 === "teacher") {
      return withChapters(LIVE_LIST.map(function (e) { return e.key; }), function () {
        if (!rerender && SYNC && SYNC.hasTeacherConfig() && !TState.loading) return teacherFetch();
        return teacherView();
      });
    }
    if (p0 === "review") {
      var rKeys = keysInBank(load()).concat(lastRoundChKey ? [lastRoundChKey] : []);
      return withChapters(rKeys, function () {
        if (parts[1] === "all") return bankListView();
        if (parts[1] === "round") { if (rerender && R) { redraw = reviewRender; return reviewRender(); } return reviewRoundStart(); }
        if (rerender && R) { redraw = reviewRender; return reviewRender(); }
        return reviewStart();
      });
    }
    if (p0 === "notes") return withChapters(keysInNotes(load()), notesView);
    if (p0 === "formulas") {
      var fKeys = formulaChKey === "all" ? LIVE_LIST.map(function (e) { return e.key; }) : [formulaChKey && LIVE_MAP[formulaChKey] ? formulaChKey : curChKey()];
      return withChapters(fKeys, formulasView);
    }
    if (p0 && p1 && LIVE_MAP[chKeyOf(p0, p1)]) {
      var targetKey = chKeyOf(p0, p1);
      return withChapters([targetKey], function () {
        setActiveChapter(p0, p1, true);
        formulaChKey = curChKey();
        var p2 = parts[2], p3 = parts[3];
        if (!p2) return chapterView();
        if (p2 === "board") return boardView();
        if (p2 === "round") {
          if (!p3) { redraw = roundPickerView; return roundPickerView(); }
          if (p3 === "run") return roundRunRoute(rerender);
        }
        if (p2 === "derive") {
          if (!p3) return deriveListView();
          if (rerender && D && D.chKey === curChKey() && D.d.id === p3) { redraw = drillRender; return drillRender(); }
          return drillStart(p3);
        }
        if (p3 === "quest") {
          if (rerender && Q && Q.chKey === curChKey() && Q.stop.id === p2) { redraw = questRender; return questRender(); }
          return questStart(p2);
        }
        if (!p3) return stopView(p2);
        location.hash = "#/";
      });
    }
    location.hash = "#/";
  }

  /* ---------- boot: load catalog + only chapters needed for exact Home ---------- */
  function roundHasActivity(r) {
    if (!isObj(r)) return false;
    return !!(r.complete || r.bestFull > 0 || r.last || r.run || (isObj(r.modes) && Object.keys(r.modes).length));
  }
  function chKeyFromQid(qid) {
    for (var i = 0; i < LIVE_LIST.length; i++) {
      var e = LIVE_LIST[i];
      if (e.meta.prefix && qid.indexOf(e.meta.prefix) === 0) return e.key;
    }
    return LIVE_MAP["physics/ch01"] ? "physics/ch01" : "";
  }
  function bootNeededKeys(st, td) {
    var seen = {}, out = [];
    function add(k) { if (k && LIVE_MAP[k] && !seen[k]) { seen[k] = true; out.push(k); } }
    add(st.lastChapter && LIVE_MAP[st.lastChapter] ? st.lastChapter : (LIVE_LIST[0] && LIVE_LIST[0].key));
    [st.done, st.quest, st.qp].forEach(function (map) {
      if (!isObj(map)) return;
      for (var k in map) {
        var p = k.split("/");
        if (p.length >= 2) add(chKeyOf(p[0], p[1]));
      }
    });
    if (isObj(st.rounds)) {
      for (var rk in st.rounds) if (roundHasActivity(st.rounds[rk])) add(rk);
    }
    if (roundHasActivity(st.round)) add("physics/ch01");
    if (isObj(st.boardPts)) {
      for (var qid in st.boardPts) add(chKeyFromQid(qid));
    }
    if (isObj(td)) {
      if (isObj(td.focus)) add(td.focus.chKey);
      if (isObj(td.reward)) add(td.reward.chKey);
    }
    for (var i = 0; i < LIVE_LIST.length; i++) {
      var e = LIVE_LIST[i];
      if (doneCount(st, e.key) < (e.meta.stopCount || PLAN_DEFAULT_STOPS)) { add(e.key); break; }
    }
    return out;
  }

  if (HAS_DOM) {
    getJSON("content/catalog.json").then(function (cat) {
      buildLiveCatalog(cat);
      var st = load();
      var td = SYNC ? SYNC.getTeacherData() : null;
      var keys = bootNeededKeys(st, td);
      var rawHash = (location.hash || "#/").split("?")[0];
      var parts = rawHash.replace(/^#\/?/, "").split("/").filter(Boolean);
      if (parts.length >= 2 && LIVE_MAP[chKeyOf(parts[0], parts[1])]) keys.push(chKeyOf(parts[0], parts[1]));
      return ensureChapters(keys).then(function () { return st; });
    }).then(function (st) {
      var initKey = st.lastChapter && CHAPTERS[st.lastChapter] ? st.lastChapter : (CHAPTER_LIST[0] && CHAPTER_LIST[0].key);
      if (initKey) {
        var sp = initKey.split("/");
        setActiveChapter(sp[0], sp[1], false);
      }
      applyTheme();
      if (SYNC) {
        applyTeacherAssignments(SYNC.getTeacherData());
        SYNC.init({
          getState: function () { return load(); },
          applyState: applyRemoteState,
          onTeacherData: function (td) {
            if (PREVIEW) return;
            applyTeacherAssignments(td);
            renderTeacherBar();
            if ((location.hash || "#/") === "#/") homeView();
          },
          onStatus: function () {
            updateSyncPill();
            if (location.hash === "#/sync" && SYNC.isLinked()) syncView();
          }
        });
      }
      startStudyTimer();
      window.addEventListener("hashchange", function () { route(false); });
      route(false);
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(function () { /* ignore */ });
      }
    }).catch(function (e) {
      errorView("Could not load the portal (" + e.message + "). Check your connection and refresh.");
    });
  }

  /* ---------- test hook (browser & pure Node) ---------- */
  var testApi = {
    stopMastery: stopMastery,
    gaugeData: gaugeData,
    planInfo: planInfo,
    parseNum: parseNum,
    fm: fm,
    nextReviewDate: nextReviewDate,
    errorSummary: errorSummary,
    subjectExamDate: subjectExamDate,
    ERR_TAGS: ERR_TAGS,
    bankAdd: bankAdd,
    bankReview: bankReview,
    buildPaper: buildPaper,
    studyPhase: studyPhase,
    todayFocusPlan: todayFocusPlan,
    normalizeState: normalizeState,
    blank: blank,
    KIND_LABEL: KIND_LABEL,
    kindLabel: kindLabel,
    doneCount: doneCount,
    bootNeededKeys: bootNeededKeys,
    _setTestEnv: function (env) {
      if (!env) return;
      if (env.catalog) buildLiveCatalog(env.catalog);
      if (env.chapters) {
        CHAPTERS = {};
        for (var k in env.chapters) CHAPTERS[k] = env.chapters[k];
        rebuildChapterList();
        if (CHAPTER_LIST[0]) { SUBJ = CHAPTER_LIST[0].subj; CHID = CHAPTER_LIST[0].chId; BASE = "#/" + SUBJ + "/" + CHID; CH = CHAPTER_LIST[0].ch; }
      }
      if (env.state) mem = normalizeState(env.state);
      if (env.today !== undefined) {
        if (HAS_WIN) window.__TODAY = env.today;
        else if (typeof global !== "undefined") global.__TODAY = env.today;
      }
    }
  };
  if (HAS_WIN) window.__HSC_TEST = testApi;
  if (typeof module !== "undefined" && module.exports) module.exports = testApi;
})();
