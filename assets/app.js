/* HSC Board Prep — Feature 1: shell, countdown, today's target, chapter map, textbook chips.
   Plain JS, no dependencies. Progress is stored on this device (Drive sync comes in Feature 7). */
(function () {
  "use strict";

  var DAILY_TARGET = 2;          // stops per day
  var STORE_KEY = "hscPrep.v1";
  var app = document.getElementById("app");
  var titleEl = document.getElementById("title");
  var backEl = document.getElementById("back");
  var catalog = null;
  var chapterCache = {};

  /* ---------- storage (never throws) ---------- */
  var memoryState = null;
  function load() {
    if (memoryState) return memoryState;
    var s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    memoryState = s && typeof s === "object" ? s : {};
    memoryState.done = memoryState.done || {};
    return memoryState;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(memoryState)); } catch (e) { /* keep in memory */ }
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysLeft(dateStr) {
    var p = dateStr.split("-");
    var exam = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((exam - now) / 86400000));
  }
  function key(subject, chapter, stop) { return subject + "/" + chapter + "/" + stop; }
  function isDone(k) { return !!load().done[k]; }
  function doneToday() {
    var t = today(), n = 0, d = load().done;
    for (var k in d) if (d[k] === t) n++;
    return n;
  }
  function streak() {
    var days = {}, d = load().done;
    for (var k in d) days[d[k]] = true;
    var cur = new Date(), n = 0;
    function fmt(x) { return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
    if (!days[fmt(cur)]) cur.setDate(cur.getDate() - 1);   // streak still alive until end of today
    while (days[fmt(cur)]) { n++; cur.setDate(cur.getDate() - 1); }
    return n;
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function loadChapter(subject, chId) {
    var ck = subject + "/" + chId;
    if (chapterCache[ck]) return Promise.resolve(chapterCache[ck]);
    var sub = findSubject(subject);
    var meta = sub && sub.chapters.filter(function (c) { return c.id === chId; })[0];
    if (!meta || !meta.file) return Promise.reject(new Error("Chapter not available yet"));
    return getJSON(meta.file).then(function (ch) { chapterCache[ck] = ch; return ch; });
  }
  function findSubject(id) { return catalog.subjects.filter(function (s) { return s.id === id; })[0]; }
  function chapterProgress(subject, ch) {
    var done = ch.stops.filter(function (s) { return isDone(key(subject, ch.id, s.id)); }).length;
    return { done: done, total: ch.stops.length, pct: Math.round(100 * done / ch.stops.length) };
  }
  function bookChip(bookId, page, label, cls) {
    var b = catalog.books[bookId];
    var pdf = page + (b.pdfPageOffset || 0);
    return '<a class="chip ' + (cls || "") + '" href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener" ' +
      'title="Opens the PDF in Google Drive. Go to PDF page ' + pdf + '.">' +
      esc(label || b.label) + " · p. " + page + " (PDF " + pdf + ")</a>";
  }
  function setHeader(title, backHref) {
    titleEl.textContent = title;
    document.title = title + " · HSC Board Prep";
    if (backHref) { backEl.hidden = false; backEl.setAttribute("href", backHref); } else { backEl.hidden = true; }
  }
  function errorView(msg) {
    app.innerHTML = '<div class="card"><h2>Something went wrong</h2><p class="muted">' + esc(msg) +
      '</p><a class="btn" href="#/">Go home</a></div>';
  }

  /* ---------- views ---------- */
  function homeView() {
    setHeader("HSC Board Prep", null);
    var left = daysLeft(catalog.examDate);
    var dt = doneToday();
    var phy = findSubject("physics");
    loadChapter("physics", "ch01").then(function (ch) {
      var next = ch.stops.filter(function (s) { return !isDone(key("physics", ch.id, s.id)); }).slice(0, Math.max(0, DAILY_TARGET - dt) || 1);
      var targetMet = dt >= DAILY_TARGET;
      var h = "";
      h += '<div class="stats">' +
        '<div class="stat"><b>' + left + '</b><span>days to exam</span></div>' +
        '<div class="stat"><b>' + Math.min(dt, DAILY_TARGET) + "/" + DAILY_TARGET + '</b><span>today\'s stops</span></div>' +
        '<div class="stat"><b>' + streak() + '</b><span>day streak</span></div></div>';
      h += '<p class="muted small center">Board exam: 1 February 2027</p>';

      h += '<div class="card"><h2>' + (targetMet ? "Target done for today ✓" : "Today's target") + "</h2>";
      if (targetMet) h += '<p class="muted">Great work. Keep going if you like — here\'s what\'s next.</p>';
      if (!next.length) h += '<p>Chapter 1 complete. More chapters are coming soon.</p>';
      h += '<ul class="list">' + next.map(function (s) {
        var n = ch.stops.indexOf(s) + 1;
        return '<li><a class="item" href="#/physics/ch01/' + s.id + '"><span class="num">' + n + '</span>' +
          '<span class="grow"><b>' + esc(s.title) + '</b><br><span class="muted small">Textbook p. ' + s.page + '</span></span><span aria-hidden="true">›</span></a></li>';
      }).join("") + "</ul></div>";

      var prog = chapterProgress("physics", ch);
      h += '<div class="card"><h2>Physics</h2><ul class="list">' + phy.chapters.map(function (c) {
        if (!c.file) return '<li><div class="soon"><span class="num">' + c.number + '</span><span class="grow">' + esc(c.title) + '<br><span class="small">Coming soon</span></span></div></li>';
        return '<li><a class="item" href="#/physics/' + c.id + '"><span class="num">' + c.number + '</span>' +
          '<span class="grow"><b>' + esc(c.title) + '</b><div class="bar" style="margin-top:6px"><i style="width:' + prog.pct + '%"></i></div>' +
          '<span class="muted small">' + prog.done + " of " + prog.total + ' stops</span></span><span aria-hidden="true">›</span></a></li>';
      }).join("") + "</ul></div>";
      app.innerHTML = h;
    }).catch(function (e) { errorView("Could not load chapter content (" + e.message + "). Check your connection and refresh."); });
  }

  function chapterView(subject, chId) {
    loadChapter(subject, chId).then(function (ch) {
      setHeader("Ch " + ch.number + " · " + ch.title, "#/");
      var prog = chapterProgress(subject, ch);
      var firstOpen = ch.stops.filter(function (s) { return !isDone(key(subject, ch.id, s.id)); })[0];
      var h = '<div class="card"><div class="row"><div class="grow"><b>' + prog.done + " of " + prog.total + ' stops</b>' +
        '<div class="bar" style="margin-top:6px"><i style="width:' + prog.pct + '%"></i></div></div><b>' + prog.pct + '%</b></div>' +
        '<div class="chips">' + bookChip(ch.book, 1, "Chapter in textbook") + "</div>" +
        '<p class="note">Textbook pages ' + esc(ch.printedPages) + '. The Drive viewer can\'t jump to a page, so use the PDF page number shown.</p></div>';
      h += '<div class="card"><ol class="path">' + ch.stops.map(function (s, i) {
        var done = isDone(key(subject, ch.id, s.id));
        var cls = done ? "done" : (s === firstOpen ? "next" : "");
        return '<li><a href="#/' + subject + "/" + ch.id + "/" + s.id + '"><span class="node ' + cls + '">' + (done ? "✓" : i + 1) + "</span>" +
          '<span class="grow"><span class="t">' + esc(s.title) + '</span><br><span class="muted small">p. ' + s.page +
          (s.xi.length ? " · builds on Std XI" : "") + (s === firstOpen ? " · up next" : "") + "</span></span></a></li>";
      }).join("") + "</ol></div>";
      app.innerHTML = h;
    }).catch(function (e) { errorView(e.message); });
  }

  function stopView(subject, chId, stopId) {
    loadChapter(subject, chId).then(function (ch) {
      var i = -1;
      ch.stops.forEach(function (s, j) { if (s.id === stopId) i = j; });
      if (i < 0) return errorView("That stop doesn't exist.");
      var s = ch.stops[i], k = key(subject, ch.id, s.id), done = isDone(k);
      setHeader((i + 1) + ". " + s.title, "#/" + subject + "/" + ch.id);
      var h = '<div class="card"><h2>In short</h2><p>' + esc(s.inShort) + "</p>" +
        '<p class="note">Read the full section in your textbook before marking this done.</p></div>';
      h += '<div class="card"><h2>Textbook sections</h2><ul class="sections">' +
        s.sections.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
        '<div class="chips">' + bookChip(ch.book, s.page, "Std XII") +
        s.figs.map(function (f) { return '<span class="chip">' + esc(f) + "</span>"; }).join("") + "</div></div>";
      if (s.xi.length) {
        h += '<div class="card"><h2>Builds on Std XI</h2><p class="muted small">Quick revision if this feels unfamiliar.</p><div class="chips">' +
          s.xi.map(function (x) { return bookChip("xi", x.page, x.label, "xi"); }).join("") + "</div></div>";
      }
      h += '<button id="toggle" class="btn block ' + (done ? "ghost" : "ok") + '">' + (done ? "✓ Done — tap to undo" : "Mark as done") + "</button>";
      var prev = ch.stops[i - 1], next = ch.stops[i + 1];
      h += '<div class="nav2" style="margin-top:12px">' +
        (prev ? '<a class="btn ghost" href="#/' + subject + "/" + ch.id + "/" + prev.id + '">‹ Previous</a>' : "<span></span>") +
        (next ? '<a class="btn ghost" href="#/' + subject + "/" + ch.id + "/" + next.id + '">Next ›</a>' : '<a class="btn ghost" href="#/' + subject + "/" + ch.id + '">Chapter map</a>') + "</div>";
      app.innerHTML = h;
      document.getElementById("toggle").addEventListener("click", function () {
        var st = load();
        if (st.done[k]) delete st.done[k]; else st.done[k] = today();
        save();
        if (!done && next) location.hash = "#/" + subject + "/" + ch.id + "/" + next.id; else route();
      });
    }).catch(function (e) { errorView(e.message); });
  }

  /* ---------- router ---------- */
  function route() {
    var parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
    window.scrollTo(0, 0);
    if (parts.length === 0) return homeView();
    if (parts.length === 2) return chapterView(parts[0], parts[1]);
    if (parts.length === 3) return stopView(parts[0], parts[1], parts[2]);
    location.hash = "#/";
  }

  getJSON("content/catalog.json").then(function (c) {
    catalog = c;
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (e) {
    errorView("Could not load the portal (" + e.message + "). Check your connection and refresh.");
  });
})();
