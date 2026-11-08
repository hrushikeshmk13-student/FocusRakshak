const DEFAULTS = {
  dwellMinutes: 5,
  alertMinutes: 10,
  limit: 10,
  alertEvery: 5,
  dailyPasses: 5,
  pauseSeconds: 15,
  quote: "You said you'd study. Is this moving you forward?",
  studyUrl: "https://www.google.com/",
  allowlist: ["allen.in", "vibrantacademy.com", "sarvam.ai"],
  allowUrls: [],
  blockUrls: [],
  targets: [],
  passMinutes: 5,
  cooldownAfterShorts: 10,
  cooldownMinutes: 30,
  passCutoffHour: 23,
  passResumeHour: 6,
  syncUrl: "",
  pomodoroEnabled: true,
  pomodoroMinutes: 20,
  reminderSeconds: 3,
  reminderSize: 20,
  reminderText: "Quick reset \u2014 breathe, then back to focus."
};

const $ = (id) => document.getElementById(id);
const lines = (v) => v.split("\n").map((l) => l.trim()).filter(Boolean);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("quote").value = s.quote;
  $("dailyPasses").value = s.dailyPasses;
  $("passMinutes").value = s.passMinutes;
  $("cooldownAfterShorts").value = s.cooldownAfterShorts;
  $("cooldownMinutes").value = s.cooldownMinutes;
  $("passCutoffHour").value = s.passCutoffHour;
  $("passResumeHour").value = s.passResumeHour;
  $("pauseSeconds").value = s.pauseSeconds;
  $("dwellMinutes").value = s.dwellMinutes;
  $("alertMinutes").value = s.alertMinutes;
  $("limit").value = s.limit;
  $("alertEvery").value = s.alertEvery;
  $("allowlist").value = (s.allowlist || []).join("\n");
  $("allowUrls").value = (s.allowUrls || []).join("\n");
  $("blockUrls").value = (s.blockUrls || []).join("\n");
  $("targets").value = (s.targets || []).map((t) => t.match + " | " + t.minutes).join("\n");
  $("studyUrl").value = s.studyUrl;
  $("pomodoroEnabled").checked = !!s.pomodoroEnabled;
  $("pomodoroMinutes").value = s.pomodoroMinutes;
  $("reminderSeconds").value = s.reminderSeconds;
  $("reminderSize").value = s.reminderSize;
  $("reminderText").value = s.reminderText;
  $("syncUrl").value = s.syncUrl || "";
});

$("title").textContent = "FocusRakshak v" + chrome.runtime.getManifest().version;

function parseTargets(text) {
  return lines(text)
    .map((line) => {
      const parts = line.split("|");
      const match = (parts[0] || "").trim();
      const minutes = Math.max(1, parseInt((parts[1] || "0").trim(), 10) || 0);
      return match ? { match, minutes } : null;
    })
    .filter(Boolean);
}

function renderProgress() {
  chrome.storage.local.get({ targetProgress: null }, (d) => {
    const tp = d.targetProgress;
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const targets = s.targets || [];
      if (!targets.length) {
        $("targetProgress").textContent = "";
        return;
      }
      const byKey = tp && tp.date === new Date().toISOString().slice(0, 10) ? tp.byKey || {} : {};
      $("targetProgress").textContent = targets
        .map((t) => {
          const mins = Math.floor((byKey[t.match] || 0) / 60);
          const done = mins >= t.minutes ? " \u2713" : "";
          return t.match + ": " + mins + "/" + t.minutes + " min today" + done;
        })
        .join("\n");
    });
  });
}

chrome.storage.local.get({ lastSync: null }, (d) => {
  const l = d.lastSync;
  if (!l) return;
  $("syncStatus").textContent = l.ok
    ? "Last sync OK."
    : "Last sync failed: " + (l.error || "HTTP " + l.status || "unknown") + (l.body ? " | " + l.body : "");
});

$("save").addEventListener("click", () => {
  const allowlist = $("allowlist")
    .value.split(/[\n,]+/)
    .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter(Boolean);

  chrome.storage.sync.set(
    {
      quote: $("quote").value.trim() || DEFAULTS.quote,
      dailyPasses: Math.max(0, Number($("dailyPasses").value) || 0),
      passMinutes: Math.max(1, Number($("passMinutes").value) || DEFAULTS.passMinutes),
      cooldownAfterShorts: Math.max(1, Number($("cooldownAfterShorts").value) || DEFAULTS.cooldownAfterShorts),
      cooldownMinutes: Math.max(1, Number($("cooldownMinutes").value) || DEFAULTS.cooldownMinutes),
      passCutoffHour: Math.max(0, Math.min(23, Number($("passCutoffHour").value) || 0)),
      passResumeHour: Math.max(0, Math.min(23, Number($("passResumeHour").value) || 0)),
      pauseSeconds: Math.max(0, Number($("pauseSeconds").value) || 0),
      dwellMinutes: Math.max(1, Number($("dwellMinutes").value) || DEFAULTS.dwellMinutes),
      alertMinutes: Math.max(1, Number($("alertMinutes").value) || DEFAULTS.alertMinutes),
      limit: Math.max(1, Number($("limit").value) || DEFAULTS.limit),
      alertEvery: Math.max(1, Number($("alertEvery").value) || DEFAULTS.alertEvery),
      allowlist,
      allowUrls: lines($("allowUrls").value),
      blockUrls: lines($("blockUrls").value),
      targets: parseTargets($("targets").value),
      studyUrl: $("studyUrl").value.trim() || DEFAULTS.studyUrl,
      pomodoroEnabled: $("pomodoroEnabled").checked,
      pomodoroMinutes: Math.max(1, Number($("pomodoroMinutes").value) || DEFAULTS.pomodoroMinutes),
      reminderSeconds: Math.max(1, Number($("reminderSeconds").value) || DEFAULTS.reminderSeconds),
      reminderSize: Math.max(10, Math.min(80, Number($("reminderSize").value) || DEFAULTS.reminderSize)),
      reminderText: $("reminderText").value.trim() || DEFAULTS.reminderText,
      syncUrl: $("syncUrl").value.trim()
    },
    () => {
      $("status").textContent = "Saved";
      renderProgress();
      setTimeout(() => ($("status").textContent = ""), 1500);
    }
  );
});

$("testSync").addEventListener("click", () => {
  const url = $("syncUrl").value.trim();
  chrome.storage.sync.set({ syncUrl: url }, () => {
    $("syncStatus").textContent = "Sending test row\u2026";
    chrome.runtime.sendMessage({ type: "syncTest" }, (r) => {
      if (chrome.runtime.lastError) {
        $("syncStatus").textContent = "Error: " + chrome.runtime.lastError.message;
        return;
      }
      if (!r) {
        $("syncStatus").textContent = "No response from the background worker.";
        return;
      }
      $("syncStatus").textContent = r.ok
        ? "Test row sent \u2014 check your sheet's Log tab."
        : "Failed: " + (r.error || "HTTP " + r.status) + (r.body ? " | " + r.body : "");
    });
  });
});

$("backfill").addEventListener("click", () => {
  const url = $("syncUrl").value.trim();
  chrome.storage.sync.set({ syncUrl: url }, () => {
    $("syncStatus").textContent = "Uploading existing entries\u2026";
    chrome.runtime.sendMessage({ type: "syncBackfill" }, (r) => {
      if (chrome.runtime.lastError) {
        $("syncStatus").textContent = "Error: " + chrome.runtime.lastError.message;
        return;
      }
      if (!r) {
        $("syncStatus").textContent = "No response";
        return;
      }
      $("syncStatus").textContent =
        "Uploaded " + r.sent + "/" + r.total + (r.failed ? " (" + r.failed + " failed)" : "");
    });
  });
});

$("reset").addEventListener("click", () => {
  chrome.storage.local.set(
    { daily: { date: "", passesUsed: 0, shortsViewed: 0 }, passState: { passUntil: 0, cooldownUntil: 0 } },
    () => {
      $("status").textContent = "Today reset";
      setTimeout(() => ($("status").textContent = ""), 1500);
    }
  );
});

$("journal").addEventListener("click", () => chrome.runtime.openOptionsPage());

renderProgress();
