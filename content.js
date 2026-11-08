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
  cooldownAfterShorts: 10, // once this many shorts seen in a session...
  cooldownMinutes: 30,     // ...a pass triggers this cooldown
  passCutoffHour: 23,      // no passes from this hour...
  passResumeHour: 6,       // ...until this hour

  syncUrl: "",
  pomodoroEnabled: true,
  pomodoroMinutes: 20,
  reminderSeconds: 3,
  reminderSize: 20,
  reminderText: "Quick reset \u2014 breathe, then back to focus."
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

const now = () => Date.now();
const todayKey = () => {
  const d = new Date();
  return (
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  );
};
const shortId = () => (location.pathname.match(/^\/shorts\/([^/?]+)/) || [])[1] || null;
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
  chrome.storage.local.get({ daily: null, passState: null, targetProgress: null }, (d) => {
    daily =
      d.daily && d.daily.date === todayKey()
        ? d.daily
        : { date: todayKey(), passesUsed: 0, shortsViewed: 0 };
    persistDaily();
    if (d.passState) {
      passUntil = d.passState.passUntil || 0;
      cooldownUntil = d.passState.cooldownUntil || 0;
    }
    targetProgress =
      d.targetProgress && d.targetProgress.date === todayKey()
        ? d.targetProgress
        : { date: todayKey(), byKey: {} };
    nextAlertAt = Math.max(1, settings.dwellMinutes || 1) * 60;
    nextShortAlertAt = Math.max(1, settings.limit || 1);
    tick = setInterval(beat, 1000);
  });
}

function rolloverIfNeeded() {
  if (!daily || daily.date !== todayKey()) {
    daily = { date: todayKey(), passesUsed: 0, shortsViewed: 0 };
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

  // Count-based trigger (YouTube Shorts).
  const sid = shortId();
  if (sid) {
    if (sid !== lastShortId) {
      lastShortId = sid;
      sessionViewed++;
      daily.shortsViewed = (daily.shortsViewed || 0) + 1;
      persistDaily();
    }
    if (!overlay && !inPassWindow() && sessionViewed >= nextShortAlertAt) return showAlert();
  } else if (lastShortId !== null) {
    lastShortId = null;
    sessionViewed = 0;
    nextShortAlertAt = Math.max(1, settings.limit || 1);
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

  card.append(quote, question, sub, timer, actions, passes, note, journal);
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

  // Time-boxed: the pass buys N minutes of quiet.
  passUntil = now() + Math.max(1, Number(settings.passMinutes) || 5) * 60000;

  // Cooldown: after a heavy session, the next pass waits.
  if (sessionViewed >= Math.max(1, Number(settings.cooldownAfterShorts) || 10)) {
    cooldownUntil = now() + Math.max(1, Number(settings.cooldownMinutes) || 30) * 60000;
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

function showPomodoro(text, seconds, size) {
  if (pomodoroEl) pomodoroEl.remove();
  if (pomodoroTimer) clearTimeout(pomodoroTimer);

  const el = document.createElement("div");
  el.id = "sg-pomodoro";
  const pct = Math.max(10, Math.min(80, Number(size) || 20));
  el.style.width = "max(240px, " + pct + "vw)";

  const label = document.createElement("div");
  label.className = "sg-pomo-label";
  label.textContent = "Pomodoro";

  const body = document.createElement("div");
  body.className = "sg-pomo-text";
  body.textContent = text || DEFAULTS.reminderText;

  el.append(label, body);
  el.addEventListener("click", dismissPomodoro);
  (document.body || document.documentElement).appendChild(el);
  pomodoroEl = el;

  pomodoroTimer = setTimeout(dismissPomodoro, Math.max(1, Number(seconds) || 3) * 1000);
}

function dismissPomodoro() {
  if (pomodoroTimer) {
    clearTimeout(pomodoroTimer);
    pomodoroTimer = null;
  }
  if (pomodoroEl) {
    pomodoroEl.remove();
    pomodoroEl = null;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pomodoro") showPomodoro(msg.text, msg.seconds, msg.size);
});
