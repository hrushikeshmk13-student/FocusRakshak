// FocusRakshak service worker — Pomodoro nudge + Google Sheet sync transport.

const DEFAULTS = {
  pomodoroEnabled: true,
  pomodoroMinutes: 20,
  reminderSeconds: 3,
  reminderSize: 20,
  reminderText: "Quick reset \u2014 breathe, then back to focus."
};

/* ---------------- Pomodoro nudge ---------------- */

async function schedule() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  await chrome.alarms.clear("pomodoro");
  if (s.pomodoroEnabled && Number(s.pomodoroMinutes) >= 1) {
    chrome.alarms.create("pomodoro", { periodInMinutes: Number(s.pomodoroMinutes) });
  }
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "sync") schedule();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "pomodoro") fire();
});

async function fire() {
  const s = await chrome.storage.sync.get(DEFAULTS);

  let win = null;
  try {
    win = await chrome.windows.getLastFocused({ populate: true });
  } catch (e) {
    win = null;
  }
  const tab = win && win.tabs ? win.tabs.find((t) => t.active) : null;

  if (win && win.focused && tab && tab.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "pomodoro",
        text: s.reminderText,
        seconds: s.reminderSeconds,
        size: s.reminderSize
      });
      return; // overlay shown inside the page
    } catch (e) {
      /* no content script there — fall through to a notification */
    }
  }
  notify(s.reminderText);
}

function notify(text) {
  chrome.notifications.create("focusrakshak-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "FocusRakshak",
    message: text || DEFAULTS.reminderText,
    priority: 2
  });
}

/* ---------------- Google Sheet sync ---------------- */
// Runs in the service worker (extension origin), NOT the content script, so the
// request is not subject to the host page's CORS policy. Apps Script does not
// send CORS headers, so a page-origin fetch would be rejected.

async function doSync(payload) {
  const s = await chrome.storage.sync.get({ syncUrl: "" });
  const url = (s.syncUrl || "").trim();
  if (!url) return record({ ok: false, error: "No sync URL set \u2014 paste it and click Save first." });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    const text = await res.text();

    if (/<!doctype html|<html/i.test(text)) {
      return record({
        ok: false,
        status: res.status,
        error:
          "Endpoint returned an HTML page, not JSON. This almost always means the Apps Script deployment's 'Who has access' is not set to Anyone (you got a Google sign-in page).",
        body: text.slice(0, 160)
      });
    }

    let ok = res.ok;
    try {
      ok = ok && JSON.parse(text).ok === true;
    } catch (e) {
      /* keep res.ok if the body isn't JSON */
    }
    if (!ok) {
      return record({
        ok: false,
        status: res.status,
        error: "Endpoint replied but not with {ok:true}.",
        body: text.slice(0, 160)
      });
    }
    return record({ ok: true, status: res.status });
  } catch (e) {
    return record({
      ok: false,
      error:
        "Request failed before any response: " +
        String(e) +
        " (check the URL ends in /exec and is reachable)."
    });
  }
}

function record(result) {
  chrome.storage.local.set({ lastSync: { ...result, at: Date.now() } });
  return result;
}

function dateOf(ts) {
  const d = new Date(ts);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "sync") {
    doSync(msg.payload).then(sendResponse);
    return true;
  }

  if (msg.type === "syncTest") {
    doSync({
      type: "test",
      date: dateOf(Date.now()),
      ts: Date.now(),
      kind: "test",
      what: "FocusRakshak test row",
      why: "setup check",
      from: "popup"
    }).then(sendResponse);
    return true;
  }

  if (msg.type === "syncBackfill") {
    chrome.storage.local.get({ entries: [] }, async (d) => {
      const entries = d.entries || [];
      let sent = 0;
      let failed = 0;
      let last = null;
      for (const e of entries) {
        last = await doSync({
          type: "entry",
          date: dateOf(e.ts),
          ts: e.ts,
          kind: e.kind,
          what: e.what,
          why: e.why,
          from: e.from
        });
        if (last.ok) sent++;
        else failed++;
      }
      sendResponse({ ok: failed === 0, sent, failed, total: entries.length, last });
    });
    return true;
  }
});
