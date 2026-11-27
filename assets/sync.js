/* HSC Board Prep — Drive Sync & Merge Engine.
   Plain JS, zero dependencies. Works offline-first alongside localStorage (hscPrep.v2).
   Device sync credentials live in a separate key (hscPrep.sync.v1) and are never uploaded. */
(function (root) {
  "use strict";

  var SYNC_KEY = "hscPrep.sync.v1";
  var GAS_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TOMBSTONE_TTL_MS = 30 * 86400000;
  var DEBOUNCE_MS = 2500;
  var FOCUS_PULL_GAP_MS = 30000;
  var MAX_CONFLICT_RETRIES = 2;

  var hooks = null;          // { getState, applyState, onStatus }
  var cfg = null;
  var status = { state: "idle", error: "", syncing: false };
  var localSeq = 0;
  var debounceTimer = null;
  var inFlight = false;
  var queuedMode = null;     // "pull" | "push" | "both"
  var linkNotice = "";       // transient feedback after one-tap link capture

  /* ---------- small helpers ---------- */
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function safeKey(k) { return k !== "__proto__" && k !== "constructor" && k !== "prototype"; }
  function isDate(s) { return typeof s === "string" && DATE_RE.test(s); }
  function num(x) { return typeof x === "number" && isFinite(x) ? x : 0; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function isValidSyncUrl(u) { return typeof u === "string" && GAS_URL_RE.test(u.trim()); }

  function unionKeys(a, b) {
    var seen = Object.create(null), out = [], k;
    if (isObj(a)) for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && safeKey(k) && !seen[k]) { seen[k] = true; out.push(k); }
    if (isObj(b)) for (k in b) if (Object.prototype.hasOwnProperty.call(b, k) && safeKey(k) && !seen[k]) { seen[k] = true; out.push(k); }
    out.sort();
    return out;
  }

  function earlierDate(a, b) {
    var va = isDate(a), vb = isDate(b);
    if (va && vb) return a <= b ? a : b;
    return va ? a : vb ? b : "";
  }
  function laterDate(a, b) {
    var va = isDate(a), vb = isDate(b);
    if (va && vb) return a >= b ? a : b;
    return va ? a : vb ? b : "";
  }

  /* ---------- sync config storage (device-only, never uploaded) ---------- */
  function genDeviceId() {
    return "d_" + Math.random().toString(36).slice(2, 10);
  }
  function blankCfg() {
    return { url: "", code: "", teacherKey: "", rev: 0, lastSync: 0, dirty: false, studentName: "", deviceId: "", teacherData: null };
  }
  function loadCfg() {
    if (cfg) return cfg;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch (e) { raw = null; }
    var c = blankCfg();
    if (isObj(raw)) {
      if (typeof raw.url === "string" && isValidSyncUrl(raw.url)) c.url = raw.url.trim();
      if (typeof raw.code === "string") c.code = raw.code.trim();
      if (typeof raw.teacherKey === "string") c.teacherKey = raw.teacherKey.trim();
      if (typeof raw.rev === "number" && isFinite(raw.rev) && raw.rev >= 0) c.rev = Math.floor(raw.rev);
      if (typeof raw.lastSync === "number" && isFinite(raw.lastSync) && raw.lastSync >= 0) c.lastSync = raw.lastSync;
      c.dirty = !!raw.dirty;
      if (typeof raw.studentName === "string") c.studentName = raw.studentName;
      if (typeof raw.deviceId === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(raw.deviceId)) c.deviceId = raw.deviceId;
      if (isObj(raw.teacherData)) c.teacherData = clone(raw.teacherData);
    }
    cfg = c;
    return cfg;
  }
  function saveCfg() {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(loadCfg())); } catch (e) { /* ignore */ }
  }
  function getDeviceId() {
    var c = loadCfg();
    if (!c.deviceId) {
      c.deviceId = genDeviceId();
      saveCfg();
    }
    return c.deviceId;
  }
  function getTeacherData() {
    var c = loadCfg();
    return isObj(c.teacherData) ? clone(c.teacherData) : null;
  }
  function isLinked() {
    var c = loadCfg();
    return !!(c.url && c.code && isValidSyncUrl(c.url));
  }
  function hasTeacherConfig() {
    var c = loadCfg();
    return !!(c.url && c.teacherKey && isValidSyncUrl(c.url));
  }

  /* ---------- synchronous one-tap link capture & URL scrubbing ---------- */
  function captureHashParams(hashStr) {
    var h = typeof hashStr === "string" ? hashStr : (typeof location !== "undefined" ? location.hash : "");
    var m = h.match(/^#\/(sync|teacher)\?(.+)$/);
    if (!m) return null;
    var route = m[1], qs = m[2];
    var params;
    try { params = new URLSearchParams(qs); } catch (e) { return null; }
    var url = (params.get("url") || "").trim();
    var code = (params.get("code") || "").trim();
    var key = (params.get("key") || "").trim();
    var c = loadCfg();
    var result = { route: route, ok: false, error: "" };

    if (url) {
      if (!isValidSyncUrl(url)) {
        result.error = "Invalid sync URL. Must be a Google Apps Script /exec link.";
        linkNotice = result.error;
      } else {
        if (c.url !== url) { c.rev = 0; c.lastSync = 0; }
        c.url = url;
        if (route === "sync" && code) {
          if (c.code !== code) { c.rev = 0; c.lastSync = 0; }
          c.code = code;
          result.ok = true;
          linkNotice = "Device linked. Syncing your progress…";
        } else if (route === "teacher" && key) {
          c.teacherKey = key;
          result.ok = true;
          linkNotice = "Teacher view connected.";
        }
        saveCfg();
      }
    }
    // Scrub secrets from the URL bar and history immediately
    if (typeof history !== "undefined" && history.replaceState && typeof location !== "undefined") {
      try {
        history.replaceState(null, "", location.pathname + location.search + "#/" + route);
      } catch (e) { /* ignore */ }
    }
    return result;
  }

  /* ---------- deterministic, commutative state merge ---------- */
  var BOARD_RANK = { got: 3, practice: 2, need: 1 };
  function boardRank(v) { return BOARD_RANK[v] || 0; }

  function pickRoundRec(a, b) {
    if (!isObj(a)) return isObj(b) ? clone(b) : null;
    if (!isObj(b)) return clone(a);
    var ta = num(a.at), tb = num(b.at);
    if (ta !== tb) return ta > tb ? clone(a) : clone(b);
    var da = isDate(a.date) ? a.date : "", db = isDate(b.date) ? b.date : "";
    if (da !== db) return da > db ? clone(a) : clone(b);
    return num(a.pct) >= num(b.pct) ? clone(a) : clone(b);
  }

  function pickBestRec(a, b) {
    if (!isObj(a)) return isObj(b) ? clone(b) : null;
    if (!isObj(b)) return clone(a);
    var pa = num(a.pct), pb = num(b.pct);
    if (pa !== pb) return pa > pb ? clone(a) : clone(b);
    var da = isDate(a.date) ? a.date : "", db = isDate(b.date) ? b.date : "";
    if (da && db && da !== db) return da < db ? clone(a) : clone(b);
    return clone(a);
  }

  function pickBankItem(a, b) {
    var ua = num(a.updatedAt), ub = num(b.updatedAt);
    if (ua !== ub) return ua > ub ? clone(a) : clone(b);
    var sa = num(a.streak), sb = num(b.streak);
    if (sa !== sb) return sa > sb ? clone(a) : clone(b);
    if (!!a.prio !== !!b.prio) return a.prio ? clone(a) : clone(b);
    var da = isDate(a.due) ? a.due : "9999-99-99", db = isDate(b.due) ? b.due : "9999-99-99";
    if (da !== db) return da < db ? clone(a) : clone(b);
    return String(a.reason || "") >= String(b.reason || "") ? clone(a) : clone(b);
  }

  function pickQP(a, b) {
    var ta = num(a.at), tb = num(b.at);
    if (ta !== tb) return ta > tb ? clone(a) : clone(b);
    var pa = a.phase === "check" ? 1 : 0, pb = b.phase === "check" ? 1 : 0;
    if (pa !== pb) return pa > pb ? clone(a) : clone(b);
    var ka = num(a.ki) * 100 + num(a.ci), kb = num(b.ki) * 100 + num(b.ci);
    return ka >= kb ? clone(a) : clone(b);
  }

  function mergeRoundObj(ra, rb) {
    ra = isObj(ra) ? ra : {};
    rb = isObj(rb) ? rb : {};
    var res = {
      modes: {},
      complete: !!(ra.complete || rb.complete),
      bestFull: Math.max(num(ra.bestFull), num(rb.bestFull)),
      run: null,
      runDel: Math.max(num(ra.runDel), num(rb.runDel)),
      last: pickRoundRec(ra.last, rb.last)
    };
    unionKeys(ra.modes, rb.modes).forEach(function (m) {
      var ma = isObj(ra.modes && ra.modes[m]) ? ra.modes[m] : {};
      var mb = isObj(rb.modes && rb.modes[m]) ? rb.modes[m] : {};
      var best = pickBestRec(ma.best, mb.best);
      var last = pickRoundRec(ma.last, mb.last);
      if (best || last) {
        res.modes[m] = {};
        if (best) res.modes[m].best = best;
        if (last) res.modes[m].last = last;
      }
    });
    var runA = isObj(ra.run) ? ra.run : null;
    var runB = isObj(rb.run) ? rb.run : null;
    var winRun = null, fromRemoteRun = false;
    if (runA && runB) {
      var rta = num(runA.at), rtb = num(runB.at);
      if (rtb > rta) { winRun = clone(runB); fromRemoteRun = true; }
      else if (rta > rtb) { winRun = clone(runA); }
      else if (num(runB.i) > num(runA.i) || (num(runB.i) === num(runA.i) && !!runB.rev && !runA.rev)) {
        winRun = clone(runB); fromRemoteRun = true;
      } else {
        winRun = clone(runA);
      }
    } else if (runA) {
      winRun = clone(runA);
    } else if (runB) {
      winRun = clone(runB);
      fromRemoteRun = true;
    }
    if (winRun && !(res.runDel > 0 && num(winRun.at) <= res.runDel)) {
      if (fromRemoteRun) { winRun.since = 0; winRun.resumed = true; }
      res.run = winRun;
    }
    return res;
  }

  function mergeCounterMap(a, b) {
    var out = {};
    unionKeys(a, b).forEach(function (outer) {
      var oa = isObj(a && a[outer]) ? a[outer] : null;
      var ob = isObj(b && b[outer]) ? b[outer] : null;
      var sub = {};
      var hasAny = false;
      unionKeys(oa, ob).forEach(function (dev) {
        var va = oa ? Math.max(0, Math.floor(num(oa[dev]))) : 0;
        var vb = ob ? Math.max(0, Math.floor(num(ob[dev]))) : 0;
        var m = Math.max(va, vb);
        if (m > 0) { sub[dev] = m; hasAny = true; }
      });
      if (hasAny) out[outer] = sub;
    });
    return out;
  }

  function mergeState(local, remote, nowMs) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var cutoff = now - TOMBSTONE_TTL_MS;
    var A = isObj(local) ? local : {};
    var B = isObj(remote) ? remote : {};

    var out = {
      v: 2,
      done: {},
      xp: Math.max(num(A.xp), num(B.xp)),
      quest: {},
      bank: {},
      bankDel: {},
      notes: {},
      noteAt: {},
      board: {},
      boardAt: {},
      theme: A.theme === "focus" ? "focus" : "quest", // stays device-local
      lastChapter: typeof A.lastChapter === "string" ? A.lastChapter : "",
      qp: {},
      qpDel: {},
      drill: {},
      planStart: earlierDate(A.planStart, B.planStart),
      round: { modes: {}, complete: false, bestFull: 0, run: null, runDel: 0, last: null },
      rounds: {},
      timeByDay: mergeCounterMap(A.timeByDay, B.timeByDay),
      timeByCh: mergeCounterMap(A.timeByCh, B.timeByCh),
      dismissedNoteAt: Math.max(num(A.dismissedNoteAt), num(B.dismissedNoteAt)),
      updatedAt: Math.max(num(A.updatedAt), num(B.updatedAt))
    };

    // done: union, keep earlier valid date
    unionKeys(A.done, B.done).forEach(function (k) {
      var d = earlierDate(A.done && A.done[k], B.done && B.done[k]);
      if (d) out.done[k] = d;
    });

    // quest: max best & plays, latest date
    unionKeys(A.quest, B.quest).forEach(function (k) {
      var qa = isObj(A.quest && A.quest[k]) ? A.quest[k] : null;
      var qb = isObj(B.quest && B.quest[k]) ? B.quest[k] : null;
      if (!qa && !qb) return;
      out.quest[k] = {
        best: Math.max(qa ? num(qa.best) : 0, qb ? num(qb.best) : 0),
        plays: Math.max(qa ? num(qa.plays) : 0, qb ? num(qb.plays) : 0),
        last: laterDate(qa && qa.last, qb && qb.last)
      };
    });

    // drill: max runs, OR clean, latest date
    unionKeys(A.drill, B.drill).forEach(function (k) {
      var da = isObj(A.drill && A.drill[k]) ? A.drill[k] : null;
      var db = isObj(B.drill && B.drill[k]) ? B.drill[k] : null;
      if (!da && !db) return;
      out.drill[k] = {
        runs: Math.max(da ? num(da.runs) : 0, db ? num(db.runs) : 0),
        clean: !!(da && da.clean) || !!(db && db.clean),
        last: laterDate(da && da.last, db && db.last)
      };
    });

    // board + boardAt
    var bKeys = unionKeys(A.board, B.board);
    unionKeys(A.boardAt, B.boardAt).forEach(function (k) { if (bKeys.indexOf(k) < 0) bKeys.push(k); });
    bKeys.sort().forEach(function (k) {
      var va = A.board && typeof A.board[k] === "string" ? A.board[k] : "";
      var vb = B.board && typeof B.board[k] === "string" ? B.board[k] : "";
      var ta = num(A.boardAt && A.boardAt[k]), tb = num(B.boardAt && B.boardAt[k]);
      var win = "";
      if (ta !== tb) {
        win = ta > tb ? va : vb;
      } else if (va && vb) {
        win = boardRank(va) >= boardRank(vb) ? va : vb;
      } else {
        win = va || vb;
      }
      if (win) out.board[k] = win;
      var mt = Math.max(ta, tb);
      if (mt > 0) out.boardAt[k] = mt;
    });

    // notes + noteAt (respects deletions when noteAt is newer)
    var nKeys = unionKeys(A.notes, B.notes);
    unionKeys(A.noteAt, B.noteAt).forEach(function (k) { if (nKeys.indexOf(k) < 0) nKeys.push(k); });
    nKeys.sort().forEach(function (k) {
      var va = A.notes && typeof A.notes[k] === "string" ? A.notes[k] : "";
      var vb = B.notes && typeof B.notes[k] === "string" ? B.notes[k] : "";
      var ta = num(A.noteAt && A.noteAt[k]), tb = num(B.noteAt && B.noteAt[k]);
      var win = "";
      if (ta !== tb) {
        win = ta > tb ? va : vb;
      } else if (va && vb) {
        if (va.length !== vb.length) win = va.length > vb.length ? va : vb;
        else win = va >= vb ? va : vb;
      } else {
        win = va || vb;
      }
      if (win && win.trim()) out.notes[k] = win;
      var mt = Math.max(ta, tb);
      if (mt > 0) out.noteAt[k] = mt;
    });

    // bank + bankDel tombstones (legacy updatedAt === 0 items preserved when delAt === 0)
    var bkKeys = unionKeys(A.bank, B.bank);
    unionKeys(A.bankDel, B.bankDel).forEach(function (k) { if (bkKeys.indexOf(k) < 0) bkKeys.push(k); });
    bkKeys.sort().forEach(function (k) {
      var ia = isObj(A.bank && A.bank[k]) ? A.bank[k] : null;
      var ib = isObj(B.bank && B.bank[k]) ? B.bank[k] : null;
      var delAt = Math.max(num(A.bankDel && A.bankDel[k]), num(B.bankDel && B.bankDel[k]));
      if (delAt > cutoff) out.bankDel[k] = delAt;
      var chosen = ia && ib ? pickBankItem(ia, ib) : (ia ? clone(ia) : ib ? clone(ib) : null);
      if (chosen) {
        var itemTs = num(chosen.updatedAt);
        if (!(delAt > 0 && itemTs <= delAt)) {
          out.bank[k] = chosen;
        }
      }
    });

    // qp + qpDel tombstones
    var qpKeys = unionKeys(A.qp, B.qp);
    unionKeys(A.qpDel, B.qpDel).forEach(function (k) { if (qpKeys.indexOf(k) < 0) qpKeys.push(k); });
    qpKeys.sort().forEach(function (k) {
      var qa = isObj(A.qp && A.qp[k]) ? A.qp[k] : null;
      var qb = isObj(B.qp && B.qp[k]) ? B.qp[k] : null;
      var delAt = Math.max(num(A.qpDel && A.qpDel[k]), num(B.qpDel && B.qpDel[k]));
      if (delAt > cutoff) out.qpDel[k] = delAt;
      var chosen = qa && qb ? pickQP(qa, qb) : (qa ? clone(qa) : qb ? clone(qb) : null);
      if (chosen) {
        if (!(delAt > 0 && num(chosen.at) <= delAt)) {
          out.qp[k] = chosen;
        }
      }
    });

    // round (physics/ch01 backward-compatible) + rounds (all other chapters)
    out.round = mergeRoundObj(A.round, B.round);
    unionKeys(A.rounds, B.rounds).forEach(function (chKey) {
      out.rounds[chKey] = mergeRoundObj(A.rounds && A.rounds[chKey], B.rounds && B.rounds[chKey]);
    });

    return out;
  }

  /* Semantic equality ignoring device-local theme, lastChapter & top-level updatedAt */
  function canonicalForCompare(st) {
    if (!isObj(st)) return "";
    var c = clone(st);
    delete c.theme;
    delete c.lastChapter;
    delete c.updatedAt;
    if (isObj(c.round) && isObj(c.round.run)) {
      delete c.round.run.resumed;
    }
    if (isObj(c.rounds)) {
      Object.keys(c.rounds).forEach(function (k) {
        if (isObj(c.rounds[k]) && isObj(c.rounds[k].run)) delete c.rounds[k].run.resumed;
      });
    } else {
      c.rounds = {};
    }
    if (!isObj(c.timeByDay)) c.timeByDay = {};
    if (!isObj(c.timeByCh)) c.timeByCh = {};
    c.dismissedNoteAt = num(c.dismissedNoteAt);
    return canonicalJSON(c);
  }
  function canonicalJSON(val) {
    if (val === null || typeof val !== "object") return JSON.stringify(val);
    if (Array.isArray(val)) return "[" + val.map(canonicalJSON).join(",") + "]";
    var keys = Object.keys(val).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonicalJSON(val[k]); }).join(",") + "}";
  }
  function statesEqual(a, b) {
    return canonicalForCompare(a) === canonicalForCompare(b);
  }

  /* ---------- HTTP transport (CORS-simple POST, text/plain) ---------- */
  function postAPI(url, payload) {
    if (!isValidSyncUrl(url)) {
      return Promise.reject(new Error("Invalid sync URL. Must be a Google Apps Script /exec link."));
    }
    var fetchFn = root.fetch;
    if (typeof fetchFn !== "function") {
      return Promise.reject(new Error("Fetch API unavailable."));
    }
    return fetchFn(url, {
      method: "POST",
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data;
        try {
          data = JSON.parse(txt);
        } catch (e) {
          if (/<!doctype|<html/i.test(txt)) {
            throw new Error("Google Apps Script returned a web page instead of JSON. Check that you used the /exec URL and deployed with 'Who has access: Anyone'.");
          }
          throw new Error("Unexpected response from sync server (HTTP " + r.status + ").");
        }
        if (!isObj(data)) throw new Error("Invalid response from sync server.");
        return data;
      });
    });
  }

  /* ---------- status notifications ---------- */
  function setStatus(nextState, errMsg) {
    status.state = nextState;
    status.syncing = nextState === "syncing";
    status.error = errMsg || "";
    if (hooks && typeof hooks.onStatus === "function") {
      try { hooks.onStatus(getStatus()); } catch (e) { /* ignore */ }
    }
  }
  function getStatus() {
    var c = loadCfg();
    return {
      linked: isLinked(),
      teacherReady: hasTeacherConfig(),
      state: status.state,
      syncing: status.syncing,
      error: status.error,
      dirty: c.dirty,
      rev: c.rev,
      lastSync: c.lastSync,
      studentName: c.studentName,
      url: c.url,
      notice: linkNotice
    };
  }
  function clearNotice() { linkNotice = ""; }

  /* ---------- serialized sync runner ---------- */
  function enqueue(mode) {
    if (!isLinked() || !hooks) return Promise.resolve({ ok: false, skipped: true });
    if (inFlight) {
      if (queuedMode === "both" || mode === "both" || (queuedMode && queuedMode !== mode)) queuedMode = "both";
      else queuedMode = mode;
      return Promise.resolve({ ok: true, queued: true });
    }
    inFlight = true;
    setStatus("syncing", "");
    return runCycle(mode).then(function (res) {
      inFlight = false;
      if (queuedMode) {
        var next = queuedMode;
        queuedMode = null;
        return enqueue(next);
      }
      return res;
    }, function (err) {
      inFlight = false;
      queuedMode = null;
      var offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setStatus(offline ? "offline" : "error", offline ? "Offline · saved on this device" : (err && err.message ? err.message : "Sync failed."));
      return { ok: false, error: status.error };
    });
  }

  function runCycle(mode) {
    var c = loadCfg();
    // Always pull first if rev === 0 (fresh link) or mode asks for pull/both
    var needPull = mode === "pull" || mode === "both" || c.rev === 0;
    var p = needPull ? doPull() : Promise.resolve({ ok: true, needsPush: c.dirty });
    return p.then(function (res) {
      if (!res || !res.ok) return res;
      var shouldPush = (mode === "push" || mode === "both") ? (loadCfg().dirty || res.needsPush) : res.needsPush;
      if (shouldPush) return doPush(0);
      setStatus("synced", "");
      return { ok: true };
    });
  }

  function applyTeacherPayload(c, data) {
    if (typeof data.teacher === "undefined") return;
    var next = isObj(data.teacher) ? clone(data.teacher) : null;
    var changed = canonicalJSON(c.teacherData) !== canonicalJSON(next);
    c.teacherData = next;
    if (changed && hooks && typeof hooks.onTeacherData === "function") {
      try { hooks.onTeacherData(getTeacherData()); } catch (e) { /* ignore */ }
    }
  }

  function doPull() {
    var c = loadCfg();
    var seqBefore = localSeq;
    return postAPI(c.url, { action: "pull", code: c.code }).then(function (data) {
      if (!data.ok) {
        setStatus("error", data.error || "Could not pull progress.");
        return { ok: false, error: data.error };
      }
      c.rev = typeof data.rev === "number" ? data.rev : 0;
      c.lastSync = Date.now();
      if (typeof data.studentName === "string" && data.studentName) c.studentName = data.studentName;
      applyTeacherPayload(c, data);

      var local = hooks.getState();
      if (isObj(data.state)) {
        var merged = mergeState(local, data.state);
        var localChanged = !statesEqual(local, merged);
        var remoteChanged = !statesEqual(data.state, merged);
        if (localChanged) {
          hooks.applyState(merged);
        }
        // Only push if merged actually differs from remote (prevents redundant rev+1 on fresh tablet)
        if (remoteChanged || localSeq !== seqBefore) {
          c.dirty = true;
          saveCfg();
          return { ok: true, needsPush: true };
        }
        c.dirty = false;
        saveCfg();
        return { ok: true, needsPush: false };
      } else {
        // Remote is empty (first sync from existing device): upload local state!
        c.dirty = true;
        saveCfg();
        return { ok: true, needsPush: true };
      }
    });
  }

  function doPush(attempt) {
    var c = loadCfg();
    var seqAtSend = localSeq;
    var stateToSend = hooks.getState();
    return postAPI(c.url, {
      action: "push",
      code: c.code,
      baseRev: c.rev,
      state: stateToSend
    }).then(function (data) {
      if (data.ok) {
        c.rev = typeof data.rev === "number" ? data.rev : c.rev + 1;
        c.lastSync = Date.now();
        if (typeof data.studentName === "string" && data.studentName) c.studentName = data.studentName;
        applyTeacherPayload(c, data);
        // Only clear dirty if no new local edits happened while push was in-flight
        if (localSeq === seqAtSend) c.dirty = false;
        saveCfg();
        setStatus("synced", "");
        if (c.dirty) return doPush(0);
        return { ok: true, rev: c.rev };
      }
      if (data.conflict && attempt < MAX_CONFLICT_RETRIES) {
        c.rev = typeof data.rev === "number" ? data.rev : c.rev;
        var currentLocal = hooks.getState();
        var merged = isObj(data.state) ? mergeState(currentLocal, data.state) : currentLocal;
        if (!statesEqual(currentLocal, merged)) {
          hooks.applyState(merged);
        }
        saveCfg();
        return doPush(attempt + 1);
      }
      setStatus("error", data.error || "Sync conflict. Tap Sync now to retry.");
      return { ok: false, error: status.error };
    });
  }

  /* ---------- public API ---------- */
  function init(appHooks) {
    hooks = appHooks;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", function () {
        if (!isLinked()) return;
        if (document.hidden) {
          if (loadCfg().dirty) flushNow();
        } else {
          var gap = Date.now() - (loadCfg().lastSync || 0);
          if (loadCfg().dirty || gap > FOCUS_PULL_GAP_MS) enqueue("both");
        }
      });
    }
    if (typeof root.addEventListener === "function") {
      root.addEventListener("online", function () {
        if (isLinked()) enqueue("both");
      });
      root.addEventListener("offline", function () {
        if (isLinked()) setStatus("offline", "Offline · saved on this device");
      });
      root.addEventListener("pagehide", function () {
        if (isLinked() && loadCfg().dirty) flushNow();
      });
    }
    if (isLinked()) {
      setStatus("idle", "");
      enqueue("both");
    }
  }

  function onLocalSave(opts) {
    opts = opts || {};
    if (opts.fromRemote) return;
    localSeq++;
    if (!isLinked()) return;
    var c = loadCfg();
    c.dirty = true;
    saveCfg();
    if (opts.silentSync) return;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (opts.immediate) {
      enqueue("push");
    } else {
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        enqueue("push");
      }, DEBOUNCE_MS);
    }
  }

  function flushNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (!isLinked()) return Promise.resolve({ ok: false, skipped: true });
    return enqueue(loadCfg().dirty ? "both" : "pull");
  }

  function linkStudent(url, code) {
    url = String(url || "").trim();
    code = String(code || "").trim();
    if (!isValidSyncUrl(url)) return Promise.resolve({ ok: false, error: "Invalid sync URL. Must be a Google Apps Script /exec link." });
    if (!code) return Promise.resolve({ ok: false, error: "Enter your student code." });
    var c = loadCfg();
    if (c.url !== url || c.code !== code) {
      c.rev = 0;
      c.lastSync = 0;
      c.studentName = "";
    }
    c.url = url;
    c.code = code;
    saveCfg();
    return enqueue("both");
  }

  function unlinkStudent() {
    var c = loadCfg();
    c.code = "";
    c.rev = 0;
    c.lastSync = 0;
    c.dirty = false;
    c.studentName = "";
    c.teacherData = null;
    if (!c.teacherKey) c.url = "";
    saveCfg();
    setStatus("idle", "");
  }

  function buildStudentLink() {
    var c = loadCfg();
    if (!isLinked() || typeof location === "undefined") return "";
    return location.origin + location.pathname + "#/sync?url=" + encodeURIComponent(c.url) + "&code=" + encodeURIComponent(c.code);
  }

  function setTeacherConfig(url, key) {
    url = String(url || "").trim();
    key = String(key || "").trim();
    if (!isValidSyncUrl(url)) return { ok: false, error: "Invalid sync URL. Must be a Google Apps Script /exec link." };
    if (!key) return { ok: false, error: "Enter your teacher key." };
    var c = loadCfg();
    c.url = url;
    c.teacherKey = key;
    saveCfg();
    return { ok: true };
  }

  function clearTeacherConfig() {
    var c = loadCfg();
    c.teacherKey = "";
    if (!c.code) c.url = "";
    saveCfg();
  }

  function fetchTeacher() {
    var c = loadCfg();
    if (!hasTeacherConfig()) return Promise.resolve({ ok: false, error: "Teacher view not connected." });
    return postAPI(c.url, { action: "teacher", key: c.teacherKey }).then(function (data) {
      if (!data.ok) return { ok: false, error: data.error || "Could not load student status." };
      return data;
    }, function (err) {
      return { ok: false, error: err && err.message ? err.message : "Could not reach sync server." };
    });
  }

  function saveTeacherAction(studentId, teacherObj) {
    var c = loadCfg();
    if (!hasTeacherConfig()) return Promise.resolve({ ok: false, error: "Teacher view not connected." });
    return postAPI(c.url, {
      action: "teacherUpdate",
      key: c.teacherKey,
      studentId: String(studentId || ""),
      teacher: isObj(teacherObj) ? teacherObj : {}
    }).then(function (data) {
      if (!data.ok) {
        var msg = data.error || "Could not save teacher update.";
        if (/unknown action/i.test(msg)) {
          msg = "Apps Script needs a version update to save Teacher Actions: in Apps Script click Deploy → Manage deployments → Edit → Version: New version → Deploy.";
        }
        return { ok: false, error: msg };
      }
      return data;
    }, function (err) {
      return { ok: false, error: err && err.message ? err.message : "Could not reach sync server." };
    });
  }

  /* Run synchronous URL scrubbing immediately on load (and on hashchange before app.js) */
  if (typeof location !== "undefined") {
    captureHashParams(location.hash);
  }
  if (typeof root.addEventListener === "function") {
    root.addEventListener("hashchange", function () {
      var res = captureHashParams(location.hash);
      if (res && res.ok && res.route === "sync" && hooks) enqueue("both");
    });
  }

  var api = {
    init: init,
    onLocalSave: onLocalSave,
    flushNow: flushNow,
    syncNow: flushNow,
    linkStudent: linkStudent,
    unlinkStudent: unlinkStudent,
    buildStudentLink: buildStudentLink,
    setTeacherConfig: setTeacherConfig,
    clearTeacherConfig: clearTeacherConfig,
    fetchTeacher: fetchTeacher,
    saveTeacherAction: saveTeacherAction,
    getDeviceId: getDeviceId,
    getTeacherData: getTeacherData,
    getStatus: getStatus,
    getConfig: function () { return clone(loadCfg()); },
    clearNotice: clearNotice,
    isLinked: isLinked,
    hasTeacherConfig: hasTeacherConfig,
    isValidSyncUrl: isValidSyncUrl,
    captureHashParams: captureHashParams,
    mergeState: mergeState,
    statesEqual: statesEqual,
    _resetForTest: function () {
      cfg = null; hooks = null; localSeq = 0; inFlight = false; queuedMode = null; linkNotice = "";
      status = { state: "idle", error: "", syncing: false };
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }
  };

  root.HSCSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
