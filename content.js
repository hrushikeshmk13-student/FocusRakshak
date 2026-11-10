// FocusRakshak v7.4 — page guard (time + count triggers), time-boxed passes with
// cooldown and a nightly cutoff, per-URL allow/block, focus targets, pomodoro.

const DEFAULTS = {
  dwellMinutes: 5,
  alertMinutes: 10,
  limit: 10,
  alertEvery: 5,
  dailyPasses: 5,
  pauseSeconds: 15,
  quote: "You said you'd study. Is this moving you forward?",
  studyUrl: "https://www.google.com/",

  // Exemptions and blocks
  allowlist: ["allen.in", "vibrantacademy.com", "sarvam.ai"], // domains
  allowUrls: [],   // specific URLs (substring match on the full href)
  blockUrls: [],   // strictly blocked URLs (substring match)
  targets: [],     // [{ match, minutes }] — silent + time-tracked

  // Pass economy
  passMinutes: 5,          // each Traction pass buys this many minutes
  passCooldownMinutes: 20, // every pass locks the next one for this long
  cooldownAfterShorts: 10, // once this many shorts seen in a session...
  cooldownMinutes: 30,     // ...a pass triggers this cooldown
  passCutoffHour: 23,      // no passes from this hour...
  passResumeHour: 6,       // ...until this hour

  syncUrl: "",
  pomodoroEnabled: true,
  pomodoroMinutes: 20,
  reminderSeconds: 15,
  reminderSize: 70,
  reminderText: "Quick reset \u2014 breathe, then back to focus.",

  // Display-only: the pomodoro's "non-allowed time today" figure is shown at
  // this multiple. The stored and synced value stays the true one.
  pomoDisplayMultiplier: 1.5,
  pomoMinSeconds: 15,

  // Adaptive risk: learn which hours of the day you actually slip, then move
  // the leash there. Silent until an hour has earned enough evidence.
  adaptiveRisk: true,
  riskWindowDays: 14,      // trailing days the model looks at
  riskMinSamples: 8,       // active days an hour needs before it counts
  riskMaxShift: 0.5        // the leash may move by at most ±50%
};

let settings = { ...DEFAULTS };
let visibleSeconds = 0;
let nextAlertAt = null;
let sessionViewed = 0;
let nextShortAlertAt = null;
let lastShortId = null;
let daily = null;
let overlay = null;
let blockEl = null;
let pauseLeft = 0;
let pauseTimer = null;
let tick = null;
let passUntil = 0;
let cooldownUntil = 0;
let targetProgress = null;
let shortWatchSeconds = 0;
let countedShorts = new Set();
let lastPersistAt = 0;
let history = {};
let lastHistFlush = 0;

const now = () => Date.now();
const currentHour = () => new Date().getHours();
const dateKey = (d) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const todayKey = () => dateKey(new Date());
const shortId = () => (location.pathname.match(/^\/shorts\/([^/?]+)/) || [])[1] || null;

// Dwell state is keyed on host+path so a refresh resumes the same clock
// instead of handing out a fresh grace period.
const pageKey = () => location.host + location.pathname;

function fmtDuration(sec) {
  const m = Math.floor(Math.max(0, Number(sec) || 0) / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

// One Short counts when you land on it, and again for every further 15s of
// playback on the same one, so looping a Short is not a free pass.
function countShort(key) {
  if (countedShorts.has(key)) return;
  if (countedShorts.size > 500) countedShorts.clear();
  countedShorts.add(key);
  sessionViewed++;
  daily.shortsViewed = (daily.shortsViewed || 0) + 1;
  histAdd("s", 1);
  persistDaily();
}

// ---- Hour-of-day history ------------------------------------------------
// history[YYYY-MM-DD].hours[h] = { p: passes, s: shorts, t: seconds here }

const emptyDay = () => ({ hours: Array.from({ length: 24 }, () => ({ p: 0, s: 0, t: 0 })) });

function histAdd(field, n) {
  const k = todayKey();
  const day = history[k] || (history[k] = emptyDay());
  if (!Array.isArray(day.hours) || day.hours.length !== 24) day.hours = emptyDay().hours;
  day.hours[currentHour()][field] += n;
  if (now() - lastHistFlush > 5000) {
    lastHistFlush = now();
    persistHistory();
  }
}

function persistHistory() {
  const keys = Object.keys(history).sort();
  const keep = Math.max(7, Number(settings.riskWindowDays) || 14) * 2;
  if (keys.length > keep) keys.slice(0, keys.length - keep).forEach((k) => delete history[k]);
  chrome.storage.local.set({ history });
}

// Per-hour pass rate against your own baseline. Needs real evidence before it
// says anything: an hour with fewer than riskMinSamples active days is ignored.
function riskProfile() {
  const days = Object.keys(history).sort().slice(-Math.max(7, Number(settings.riskWindowDays) || 14));
  if (days.length < 3) return { ok: false, days: days.length };
  const perHour = Array.from({ length: 24 }, () => ({ samples: 0, passes: 0 }));
  let totalPasses = 0;
  let activeHours = 0;
  days.forEach((k) => {
    const hrs = history[k] && history[k].hours;
    if (!Array.isArray(hrs)) return;
    hrs.forEach((b, i) => {
      if (!b) return;
      if ((b.p || 0) > 0 || (b.s || 0) > 0 || (b.t || 0) > 0) {
        perHour[i].samples++;
        activeHours++;
      }
      perHour[i].passes += b.p || 0;
      totalPasses += b.p || 0;
    });
  });
  const baseline = activeHours ? totalPasses / activeHours : 0;
  return { ok: true, days: days.length, perHour, baseline };
}

// 1 = your average hour. Capped by riskMaxShift so a bad week cannot lock you out.
function riskMultiplier(hour) {
  if (!settings.adaptiveRisk) return 1;
  const rp = riskProfile();
  if (!rp.ok || !rp.baseline) return 1;
  const b = rp.perHour[hour];
  if (!b || b.samples < Math.max(1, Number(settings.riskMinSamples) || 8)) return 1;
  if (b.passes < 3) return 1;
  const ratio = b.passes / b.samples / rp.baseline;
  const shift = Math.max(0, Math.min(1, Number(settings.riskMaxShift) || 0.5));
  return Math.max(1 - shift, Math.min(1 + shift, 1 + shift * (ratio - 1)));
}

function riskNote() {
  if (!settings.adaptiveRisk) return "";
  const rp = riskProfile();
  if (!rp.ok || !rp.baseline) return "";
  const h = currentHour();
  const b = rp.perHour[h];
  if (!b || b.samples < Math.max(1, Number(settings.riskMinSamples) || 8)) return "";
  if (riskMultiplier(h) <= 1.1) return "";
  return (
    "Danger hour \u00b7 " + (b.passes / b.samples).toFixed(1) + "/hr vs your " +
    rp.baseline.toFixed(1) + " average"
  );
}

// Dwell grace, moved by the risk of the hour you are in.
function graceSeconds() {
  const base = Math.max(1, Number(settings.dwellMinutes) || 1) * 60;
  return Math.max(30, Math.round(base * riskMultiplier(currentHour())));
}

const passesLeft = () => Math.max(0, (settings.dailyPasses || 0) - (daily ? daily.passesUsed || 0 : 0));
const normDomain = (d) =>
  String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

function isAllowlisted(host) {
  host = normDomain(host);
  if (!host) return false;
  return (settings.allowlist || []).some((d) => {
    const dom = normDomain(d);
    return dom && (host === dom || host.endsWith("." + dom));
  });
}

const hrefLower = () => location.href.toLowerCase();
const hasAny = (list, h) =>
  (list || []).some((p) => p && h.includes(String(p).trim().toLowerCase()));

const isBlocked = () => hasAny(settings.blockUrls, hrefLower());
const isUrlAllowed = () => hasAny(settings.allowUrls, hrefLower());
const activeTarget = () => {
  const h = hrefLower();
  return (settings.targets || []).find((t) => t && t.match && h.includes(String(t.match).trim().toLowerCase())) || null;
};

const inPassWindow = () => now() < passUntil;
const inCooldown = () => now() < cooldownUntil;

function passesBlockedByHour() {
  const h = new Date().getHours();
  const cut = Number(settings.passCutoffHour);
  const res = Number(settings.passResumeHour);
  if (isNaN(cut) || isNaN(res) || cut === res) return false;
  return cut < res ? h >= cut && h < res : h >= cut || h < res;
}

function passAvailability() {
  if (passesBlockedByHour())
    return { ok: false, reason: "No passes after " + settings.passCutoffHour + ":00 \u2014 time to rest." };
  if (inCooldown()) {
    const m = Math.ceil((cooldownUntil - now()) / 60000);
    return { ok: false, reason: "Cooling down \u2014 " + m + " min left." };
  }
  if (passesLeft() <= 0) return { ok: false, reason: "No passes left today. That's the signal to stop." };
  return { ok: true };
}

function persistDaily() {
  chrome.storage.local.set({ daily });
}
function persistPass() {
  chrome.storage.local.set({ passState: { passUntil, cooldownUntil } });
}

function syncPost(payload) {
  if (!(settings.syncUrl || "").trim()) return;
  try {
    chrome.runtime.sendMessage({ type: "sync", payload }, () => void chrome.runtime.lastError);
  } catch (e) {
    /* ignore */
  }
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  settings = s;
  start();
});

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "sync") chrome.storage.sync.get(DEFAULTS, (s) => { settings = s; });
});

function start() {
  if (tick) return;
  chrome.storage.local.get(
    { daily: null, passState: null, targetProgress: null, pageState: null, history: {} },
    (d) => {
    history = d.history && typeof d.history === "object" ? d.history : {};
    daily =
      d.daily && d.daily.date === todayKey()
        ? d.daily
        : { date: todayKey(), passesUsed: 0, shortsViewed: 0, nonAllowedSeconds: 0 };
    if (typeof daily.nonAllowedSeconds !== "number") daily.nonAllowedSeconds = 0;
    persistDaily();
    if (d.passState) {
      passUntil = d.passState.passUntil || 0;
      cooldownUntil = d.passState.cooldownUntil || 0;
    }
    targetProgress =
      d.targetProgress && d.targetProgress.date === todayKey()
        ? d.targetProgress
        : { date: todayKey(), byKey: {} };

    // Resume this page's dwell clock if we were already here today.
    const ps = d.pageState;
    const resume = ps && ps.key === pageKey() && ps.date === todayKey();
    const grace = graceSeconds();
    visibleSeconds = resume ? Math.max(0, Number(ps.visibleSeconds) || 0) : 0;
    nextAlertAt = resume ? Number(ps.nextAlertAt) || grace : grace;
    lastPersistAt = visibleSeconds;

    nextShortAlertAt = Math.max(1, settings.limit || 1);
    tick = setInterval(beat, 1000);
    }
  );
}

function rolloverIfNeeded() {
  if (!daily || daily.date !== todayKey()) {
    daily = { date: todayKey(), passesUsed: 0, shortsViewed: 0, nonAllowedSeconds: 0 };
    persistDaily();
  }
}

function trackTarget(tgt) {
  if (!targetProgress || targetProgress.date !== todayKey())
    targetProgress = { date: todayKey(), byKey: {} };
  const key = String(tgt.match);
  targetProgress.byKey[key] = (targetProgress.byKey[key] || 0) + 1;
  if (visibleSeconds % 10 === 0) chrome.storage.local.set({ targetProgress });
}

function beat() {
  if (document.visibilityState !== "visible") return;
  rolloverIfNeeded();
  visibleSeconds++;

  // Keep the dwell clock on disk so a refresh continues it.
  if (visibleSeconds - lastPersistAt >= 10) {
    lastPersistAt = visibleSeconds;
    chrome.storage.local.set({
      pageState: { key: pageKey(), date: todayKey(), visibleSeconds, nextAlertAt }
    });
  }

  // Strict block wins over everything.
  if (isBlocked()) {
    hideAlert();
    showBlock();
    return;
  }
  hideBlock();

  // Exempt surfaces: allow-URL, allow-domain, or an active target.
  const tgt = activeTarget();
  if (isUrlAllowed() || isAllowlisted(location.hostname) || tgt) {
    hideAlert();
    if (tgt) trackTarget(tgt);
    return;
  }

  // Time spent on non-allowed pages today (allowlist/target pages returned above).
  daily.nonAllowedSeconds = (daily.nonAllowedSeconds || 0) + 1;
  histAdd("t", 1);
  if (daily.nonAllowedSeconds % 10 === 0) persistDaily();

  // Count-based trigger (YouTube Shorts). Counting is by viewing, not only by
  // scrolling: landing on a Short counts it, and so does staying on one.
  const sid = shortId();
  if (sid) {
    if (sid !== lastShortId) {
      lastShortId = sid;
      shortWatchSeconds = 0;
      countShort(sid);
    } else {
      shortWatchSeconds++;
      if (shortWatchSeconds % 15 === 0) countShort(sid + "#" + shortWatchSeconds);
    }
    if (!overlay && !inPassWindow() && sessionViewed >= nextShortAlertAt) return showAlert();
  } else if (lastShortId !== null) {
    lastShortId = null;
    shortWatchSeconds = 0;
    // The count carries over; only the alert re-arms.
    nextShortAlertAt = sessionViewed + Math.max(1, settings.limit || 1);
  }

  // Time-based trigger (everywhere else).
  if (!overlay && !inPassWindow() && nextAlertAt != null && visibleSeconds >= nextAlertAt) showAlert();
}

function passesLine() {
  return (
    "Passes left today: " + passesLeft() + "/" + settings.dailyPasses +
    (shortId() ? " \u00b7 Shorts: " + sessionViewed : "") +
    " \u00b7 " + Math.floor(visibleSeconds / 60) + " min here"
  );
}

function showAlert() {
  if (overlay && document.body.contains(overlay)) return;

  // Advance the time-based threshold when the alert fires, so a persisted
  // past-due value cannot re-fire the instant this one is dismissed.
  nextAlertAt = visibleSeconds + Math.max(1, settings.alertMinutes || 1) * 60;

  overlay = document.createElement("div");
  overlay.id = "sg-overlay";

  const card = document.createElement("div");
  card.className = "sg-card";

  const quote = document.createElement("div");
  quote.className = "sg-quote";
  quote.textContent = settings.quote;

  const question = document.createElement("div");
  question.className = "sg-question";
  question.textContent = "Are you here by traction or distraction?";

  const sub = document.createElement("div");
  sub.className = "sg-sub";
  sub.textContent = "Traction moves you forward. Distraction only feels like it.";

  const timer = document.createElement("div");
  timer.className = "sg-timer";

  const actions = document.createElement("div");
  actions.className = "sg-actions";

  const traction = document.createElement("button");
  traction.className = "sg-traction";
  traction.textContent = "Traction";
  traction.disabled = true; // gated only by the pause, then by pass availability
  traction.addEventListener("click", onTraction);

  const distraction = document.createElement("button");
  distraction.className = "sg-distraction";
  distraction.textContent = "Distraction";
  distraction.disabled = false; // never gated — you can always stop and write
  distraction.addEventListener("click", onDistraction);

  actions.append(traction, distraction);

  const passes = document.createElement("div");
  passes.className = "sg-passes";
  passes.textContent = passesLine();

  const note = buildNoteForm();

  const journal = document.createElement("button");
  journal.className = "sg-link";
  journal.textContent = "Open my journal";
  journal.addEventListener("click", () => window.open(chrome.runtime.getURL("journal.html"), "_blank"));

  const risk = document.createElement("div");
  risk.className = "sg-risk";
  risk.textContent = riskNote();
  if (!risk.textContent) risk.style.display = "none";

  card.append(quote, question, sub, risk, timer, actions, passes, note, journal);
  overlay.appendChild(card);
  (document.body || document.documentElement).appendChild(overlay);

  startPause(traction, timer);
}

function buildNoteForm() {
  const wrap = document.createElement("div");
  wrap.className = "sg-note";
  wrap.style.display = "none";

  const field = (ph) => {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "sg-input";
    i.placeholder = ph;
    return i;
  };

  const what = field("What pulled you away?");
  const why = field("Why, honestly?");
  const from = field("From what were you distracted?");

  const row = document.createElement("div");
  row.className = "sg-note-actions";

  const save = document.createElement("button");
  save.className = "sg-save";
  save.textContent = "Save note";
  save.addEventListener("click", () => {
    if (!what.value.trim() && !why.value.trim() && !from.value.trim()) return;
    const entry = {
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      ts: Date.now(),
      kind: wrap.dataset.kind || "note",
      what: what.value.trim(),
      why: why.value.trim(),
      from: from.value.trim()
    };
    chrome.storage.local.get({ entries: [] }, (d) => {
      const entries = d.entries || [];
      entries.unshift(entry);
      chrome.storage.local.set({ entries }, () => {
        save.textContent = "Saved";
        what.value = why.value = from.value = "";
        setTimeout(() => (save.textContent = "Save note"), 1500);
      });
    });
    syncPost({ type: "entry", date: todayKey(), ...entry });
  });

  const back = document.createElement("button");
  back.className = "sg-back";
  back.textContent = "Back to study";
  back.addEventListener("click", () => {
    window.location.href = settings.studyUrl || DEFAULTS.studyUrl;
  });

  row.append(save, back);
  wrap.append(what, why, from, row);
  return wrap;
}

function startPause(traction, timerEl) {
  pauseLeft = Math.max(0, settings.pauseSeconds || 0);
  const applyAvail = () => {
    const av = passAvailability();
    traction.disabled = !av.ok;
    if (!av.ok) {
      const p = overlay && overlay.querySelector(".sg-passes");
      if (p) p.textContent = av.reason;
    }
  };
  if (pauseLeft <= 0) {
    timerEl.textContent = "Decide.";
    applyAvail();
    return;
  }
  const tickFn = () => {
    if (pauseLeft <= 0) {
      clearInterval(pauseTimer);
      pauseTimer = null;
      timerEl.textContent = "Decide.";
      applyAvail();
      return;
    }
    timerEl.textContent = "Take a breath \u00b7 " + pauseLeft + "s";
    pauseLeft--;
  };
  tickFn();
  pauseTimer = setInterval(tickFn, 1000);
}

function onTraction() {
  const av = passAvailability();
  if (!av.ok) {
    const p = overlay && overlay.querySelector(".sg-passes");
    if (p) p.textContent = av.reason;
    return;
  }

  daily.passesUsed = (daily.passesUsed || 0) + 1;
  persistDaily();
  histAdd("p", 1);
  persistHistory();

  // Time-boxed: the pass buys N minutes of quiet.
  passUntil = now() + Math.max(1, Number(settings.passMinutes) || 5) * 60000;

  // Cooldown: every pass locks the next one, whatever the page. A heavy Shorts
  // session stacks a longer lock on top.
  const risk = riskMultiplier(currentHour());
  cooldownUntil =
    now() + Math.max(1, Math.round((Number(settings.passCooldownMinutes) || 20) * risk)) * 60000;
  if (sessionViewed >= Math.max(1, Number(settings.cooldownAfterShorts) || 10)) {
    cooldownUntil = Math.max(
      cooldownUntil,
      now() + Math.max(1, Number(settings.cooldownMinutes) || 30) * 60000
    );
  }
  persistPass();

  syncPost({
    type: "pass",
    date: daily.date,
    passesUsed: daily.passesUsed,
    minutes: settings.passMinutes,
    shortsViewed: daily.shortsViewed || 0
  });

  nextAlertAt = visibleSeconds + Math.max(1, settings.alertMinutes || 1) * 60;
  nextShortAlertAt = sessionViewed + Math.max(1, settings.alertEvery || 1);
  hideAlert();
}

function onDistraction() {
  const wrap = overlay.querySelector(".sg-note");
  if (wrap) {
    wrap.style.display = "flex";
    wrap.dataset.kind = "distraction";
  }
  const q = overlay.querySelector(".sg-question");
  if (q) q.textContent = "Good that you noticed. Write it down, then step away.";
}

function hideAlert() {
  if (pauseTimer) {
    clearInterval(pauseTimer);
    pauseTimer = null;
  }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function showBlock() {
  if (blockEl && document.body.contains(blockEl)) return;

  blockEl = document.createElement("div");
  blockEl.id = "sg-overlay";

  const card = document.createElement("div");
  card.className = "sg-card";

  const title = document.createElement("div");
  title.className = "sg-quote";
  title.textContent = "Blocked";

  const msg = document.createElement("div");
  msg.className = "sg-question";
  msg.textContent = "This page is on your strict block list.";

  const sub = document.createElement("div");
  sub.className = "sg-sub";
  sub.textContent = settings.quote;

  const actions = document.createElement("div");
  actions.className = "sg-actions";

  const back = document.createElement("button");
  back.className = "sg-traction";
  back.textContent = "Back to study";
  back.addEventListener("click", () => {
    window.location.href = settings.studyUrl || DEFAULTS.studyUrl;
  });
  actions.append(back);

  const journal = document.createElement("button");
  journal.className = "sg-link";
  journal.textContent = "Open my journal";
  journal.addEventListener("click", () => window.open(chrome.runtime.getURL("journal.html"), "_blank"));

  card.append(title, msg, sub, actions, journal);
  blockEl.appendChild(card);
  (document.body || document.documentElement).appendChild(blockEl);
}

function hideBlock() {
  if (blockEl) {
    blockEl.remove();
    blockEl = null;
  }
}

// ---- Pomodoro nudge -------------------------------------------------------

let pomodoroEl = null;
let pomodoroTimer = null;
let pomodoroHold = null;

function showPomodoro(text, seconds, size) {
  if (pomodoroEl) pomodoroEl.remove();
  if (pomodoroTimer) clearTimeout(pomodoroTimer);
  if (pomodoroHold) clearInterval(pomodoroHold);

  const el = document.createElement("div");
  el.id = "sg-pomodoro";
  const pct = Math.max(10, Math.min(90, Number(size) || 70));
  el.style.width = "max(320px, " + pct + "vw)";

  const label = document.createElement("div");
  label.className = "sg-pomo-label";
  label.textContent = "Pomodoro";

  const body = document.createElement("div");
  body.className = "sg-pomo-text";
  body.textContent = text || DEFAULTS.reminderText;

  // Non-allowed time today, shown at the display multiple. The stored value
  // (and what syncs to the sheet) is untouched by this.
  const spent = document.createElement("div");
  spent.className = "sg-pomo-spent";
  const trueSec = (daily && daily.nonAllowedSeconds) || 0;
  const mult = Math.max(1, Number(settings.pomoDisplayMultiplier) || 1.5);
  spent.textContent =
    "On non-allowed sites today: " + fmtDuration(Math.round(trueSec * mult));

  const hint = document.createElement("div");
  hint.className = "sg-pomo-hold";

  el.append(label, body, spent, hint);

  // No dismissals inside the floor — the point is that it stays long enough to land.
  const holdMs = Math.max(
    Math.max(1, Number(settings.pomoMinSeconds) || 15),
    Number(seconds) || 15
  ) * 1000;
  const openedAt = now();
  el.addEventListener("click", () => {
    if (now() - openedAt >= holdMs) dismissPomodoro();
  });

  let left = Math.ceil(holdMs / 1000);
  hint.textContent = "Hold on \u00b7 " + left + "s";
  pomodoroHold = setInterval(() => {
    left--;
    if (left > 0) {
      hint.textContent = "Hold on \u00b7 " + left + "s";
      return;
    }
    hint.textContent = "Tap to dismiss";
    clearInterval(pomodoroHold);
    pomodoroHold = null;
  }, 1000);

  (document.body || document.documentElement).appendChild(el);
  pomodoroEl = el;

  pomodoroTimer = setTimeout(dismissPomodoro, holdMs);
}

function dismissPomodoro() {
  if (pomodoroTimer) {
    clearTimeout(pomodoroTimer);
    pomodoroTimer = null;
  }
  if (pomodoroHold) {
    clearInterval(pomodoroHold);
    pomodoroHold = null;
  }
  if (pomodoroEl) {
    pomodoroEl.remove();
    pomodoroEl = null;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pomodoro") showPomodoro(msg.text, msg.seconds, msg.size);
});
