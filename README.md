# FocusRakshak — README

A Chrome/Edge extension (Manifest V3, unpacked) that:

- interrupts you with a centred **"traction or distraction?"** card on any site
  except your exemptions;
- sells you **time-boxed passes** (default 5 minutes) with a cooldown and a
  nightly cutoff;
- lets you **allow specific video URLs** and **strictly block others**;
- tracks **focus targets** ("be on this site for N minutes");
- shows a periodic **Pomodoro nudge**;
- keeps a **local journal** of what pulled you away;
- optionally **syncs to a Google Sheet** so a weekly analysis can read it.

Current version: **7.4** (shown in the popup title and journal footer).

> There is a separate Android build of this project. It is **not** covered by this
> document.

---

## Contents

1. [Install](#1-install)
2. [First run](#2-first-run)
3. [How the guard decides](#3-how-the-guard-decides)
4. [Settings reference](#4-settings-reference)
5. [Passes, cooldown and the nightly cutoff](#5-passes-cooldown-and-the-nightly-cutoff)
6. [Allow, block and targets](#6-allow-block-and-targets)
7. [Pomodoro nudge](#7-pomodoro-nudge)
8. [The journal](#8-the-journal)
9. [Where data lives (and what syncs)](#9-where-data-lives-and-what-syncs)
10. [Google Sheet sync](#10-google-sheet-sync)
11. [Weekly analysis with Sarvam AI](#11-weekly-analysis-with-sarvam-ai)
12. [Moving to a new device or account](#12-moving-to-a-new-device-or-account)
13. [Troubleshooting](#13-troubleshooting)
14. [Honest limits](#14-honest-limits)
15. [File map](#15-file-map)

---

## 1. Install

Unpacked extensions are not in the Chrome Web Store, so there is no account that
"owns" them. You install them per browser profile, from a folder on disk.

1. Unzip `shorts-guard.zip`. You get a folder named **`shorts-guard`**.
2. Put it somewhere permanent (e.g. Desktop or Documents). Chrome re-reads this
   folder on every launch — **do not move or delete it** or the extension breaks.
3. Open `chrome://extensions` (Edge: `edge://extensions`).
4. Turn **Developer mode** ON (top-right).
5. Click **Load unpacked** and select the **`shorts-guard`** folder (the one that
   contains `manifest.json`).
6. Chrome warns it can *read and change all your data on all websites*. That is
   expected — the guard runs on every site except your exemptions. Allow it.
7. Pin the extension from the puzzle-piece menu so its toolbar icon is visible.

**Why the folder must stay:** an unpacked extension is not copied into the
profile. Chrome stores the absolute path to the source directory and loads
`manifest.json`, scripts and assets from disk each time. Move it and the load path
dangles.

---

## 2. First run

Open the popup (toolbar icon). Work top to bottom:

1. Set **Your quote** — the line shown on the alert.
2. Set the **Triggers** (time-based and count-based).
3. Set the **allow-list / allow-URLs / block-URLs / targets** for your exemptions.
4. Set the **Passes & cooldown** numbers.
5. Optionally configure **Pomodoro**.
6. Optionally paste your **Sync webhook URL** (see §10).
7. Click **Save**.

Nothing runs on an allow-listed or exempt surface; everything else is guarded.

---

## 3. How the guard decides

Every second (only while the tab is visible) the content script evaluates, in this
**precedence order**:

1. **Strict block** — if the URL matches `blockUrls`, show the "Blocked" card and
   stop. No Traction button, no pass can override it.
2. **Exempt** — if the URL matches `allowUrls`, or the host is in `allowlist`
   (domains), or the URL matches an active **target** → stay silent. On a target,
   also accumulate time toward the daily goal.
3. **Count trigger** — on YouTube Shorts, after `limit` shorts, then every
   `alertEvery` shorts.
4. **Time trigger** — on any other page, after `dwellMinutes`, then every
   `alertMinutes`.

An **active pass window** suppresses triggers 3 and 4 until it expires.

**Distraction is never delayed.** The Distraction button is enabled the instant the
card appears and opens the note form immediately. Only **Traction** waits out the
forced pause (`pauseSeconds`) and is then subject to pass availability.

---

## 4. Settings reference

| Setting | Default | Meaning |
|---|---|---|
| Your quote | "You said you'd study…" | Large line on the alert card |
| **Passes per day** | 5 | Traction passes allowed per calendar day |
| **Each pass buys (min)** | 5 | Minutes of quiet granted by one pass |
| **Cooldown after N Shorts** | 10 | Session shorts count that arms the cooldown |
| **Cooldown (min)** | 30 | Cooldown applied when a pass is taken after arming |
| **No passes after (hour)** | 23 | Start of the nightly pass block |
| **Passes resume (hour)** | 6 | End of the nightly pass block |
| **Forced pause (seconds)** | 15 | Delay before Traction unlocks (Distraction never waits) |
| **First alert after (min)** | 5 | Time-based first trigger |
| **Re-alert every (min)** | 10 | Time-based repeat |
| **Shorts before first alert** | 10 | Count-based first trigger |
| **Re-alert every N Shorts** | 5 | Count-based repeat |
| **Allow domains** | allen.in, vibrantacademy.com, sarvam.ai | Domains exempt (subdomains included) |
| **Allow specific URLs** | — | Full/partial URL substrings exempt (e.g. one lecture video) |
| **Strictly block URLs** | — | Full/partial URL substrings hard-blocked |
| **Focus targets** | — | `match \| minutes` lines; silent + time-tracked |
| **Pomodoro enabled** | on | Periodic nudge on/off |
| **Every N minutes** | 20 | Pomodoro interval |
| **Show for (seconds)** | 3 | How long the nudge stays |
| **Size (% of screen width)** | 20 | Nudge width (min 240 px) |
| **Reminder text** | "Quick reset — breathe…" | Nudge text |
| **Sync webhook URL** | empty | Google Apps Script `/exec` URL (§10) |
| **"Back to study" goes to** | https://www.google.com/ | Where the stop button sends you |

All settings are stored in `chrome.storage.sync`.

---

## 5. Passes, cooldown and the nightly cutoff

A pass is **time-boxed**, not counted in shorts:

- Choosing **Traction** sets `passUntil = now + passMinutes`. While
  `now < passUntil`, both triggers are suppressed — you get that many minutes of
  quiet.
- The pass window is an **absolute timestamp** persisted in `chrome.storage.local`
  (`passState`), so it survives navigation, new tabs and reloads.
- **Cooldown:** if `sessionViewed >= cooldownAfterShorts` at the moment you take a
  pass, it also sets `cooldownUntil = now + cooldownMinutes`. Until then, Traction
  is disabled and the card reads "Cooling down — N min left."
- **Nightly cutoff:** passes are unavailable in the window
  `passCutoffHour → passResumeHour`, wrapping midnight. With the defaults that is
  **23:00–06:00**. During it the card reads "No passes after 23:00 — time to rest."
  (If you meant only the 23:00–24:00 hour, set **Passes resume (hour)** to 0.)
- **Daily cap:** `dailyPasses` limits passes per day; the counter resets on the
  calendar date changing.

Order of checks when you press Traction: nightly window → cooldown → daily cap →
grant.

---

## 6. Allow, block and targets

Matching is **substring, case-insensitive, against the full URL** (`location.href`).

- **Allow domains** (`allowlist`): matched against the hostname, subdomains
  included. `allen.in` also exempts `learn.allen.in`.
- **Allow specific URLs** (`allowUrls`): e.g.
  `https://www.youtube.com/watch?v=ABC123` exempts exactly that video. Deliberately
  *not* domain-collapsed — a bare `youtube.com` here would match all of YouTube.
- **Strict block** (`blockUrls`): evaluated first, above everything. Shows a
  "Blocked" card with only "Back to study" and "Open my journal". No pass can
  override it, even during a pass window.
- **Focus targets** (`targets`): one per line, `match | minutes`, e.g.
  `vibrantacademy.com | 60`. While the URL matches, the guard is silent and
  accumulates visible seconds toward the target; the popup shows
  `match: X/Y min today ✓` when met. Progress resets daily and is stored locally.

---

## 7. Pomodoro nudge

Driven by the service worker (`chrome.alarms`, `periodInMinutes`), not a content
timer — MV3 service workers are killed aggressively, so `setInterval` is not
usable there.

On each alarm:

- If Chrome is **focused** and the active tab has a content script → the content
  script draws a small centred card inside the page (width = your %, min 240 px),
  auto-dismissing after the set seconds or on click.
- Otherwise (Chrome in the background, or a `chrome://` / Web Store tab) → a
  **system notification** via `chrome.notifications`, which the OS draws above
  other windows.

**A browser extension cannot paint a custom overlay over other desktop apps.** The
notification is the closest an extension can get; a true overlay would need a
native desktop build.

---

## 8. The journal

Open it from the popup (**Open my journal**) or from the alert card. It supports:

- adding an entry by hand (what / why / from what);
- search;
- deleting one entry, or all (confirmed);
- **Export** to JSON.

Entries saved from the alert are tagged **distraction**; hand-written ones are
**note**. There is currently **no Import** — see §12.

---

## 9. Where data lives (and what syncs)

| Data | Store | Crosses devices? | Crosses Google accounts? |
|---|---|---|---|
| Extension code | a folder on disk | No | No |
| Settings | `chrome.storage.sync` | Only same Chrome account **and** same extension ID | No |
| Journal entries | `chrome.storage.local` | No | No |
| Pass state, daily counters, target progress | `chrome.storage.local` | No | No |
| Google Sheet + Apps Script | the Google account that made them | No | No |
| Weekly analysis cron | the Sarvam AI account | No | No |

**The extension-ID catch:** for an *unpacked* extension Chrome derives the ID from
the folder's absolute path. A different device or path yields a different ID, so
`chrome.storage.sync` will not match and **settings do not carry over**. Even on
the same path, `storage.sync` is scoped to the Chrome account, so a different
Google account sees nothing.

The extension reads only the page address and tab visibility. It does not read or
transmit page content. The optional Google Sheet sync is the only path by which
anything leaves the device.

---

## 10. Google Sheet sync

Purpose: the journal and counters live on your machine, which the weekly analysis
cannot read. The Sheet is the bridge — one outbound channel.

### 10.1 Make the sheet and script

1. Create a blank sheet at `https://sheets.new`, name it **Shorts Guard Log**.
2. In that sheet: **Extensions → Apps Script**.
3. Replace the editor contents with `apps-script/Code.gs` and **Save**.
4. **Deploy → New deployment →** gear → **Web app**.
5. Set **Execute as: Me** and **Who has access: Anyone**.
6. **Deploy**, then **Authorize access** and approve (it writes only to this one
   spreadsheet).
7. Copy the **Web app URL** — it ends in **`/exec`**.

### 10.2 Wire it into the extension

1. Open the popup → **Weekly analysis sync**.
2. Paste the `/exec` URL into **Sync webhook URL** → **Save**.
3. Click **Send test row**. It must say "Test row sent".
4. Check the sheet's **Log** tab for the row.
5. **Upload existing entries** pushes whatever is already in your journal.

### 10.3 How the transport works

- The POST is made from the **service worker** (extension origin), not the content
  script, so it is **not subject to the host page's CORS policy**. Apps Script does
  not send CORS headers; a page-origin fetch would be rejected.
- `Content-Type: text/plain` keeps it a CORS-simple request (no preflight, which
  Apps Script's `doPost` does not handle).
- The `host_permissions: ["<all_urls>"]` you granted makes the cross-origin POST
  legal from the extension.
- The 302 redirect to `script.googleusercontent.com` is followed transparently.
- Each save appends a row: `receivedAt, type, date, ts, kind, what, why, from,
  passesUsed, shortsViewed`.

**Security note:** with *Who has access: Anyone*, anyone holding the URL can append
rows to that sheet. Keep the URL private. It cannot read your sheet or touch
anything else.

**Leave the field blank** to stay fully local — the extension works fine without
sync; the weekly job then has nothing to read.

---

## 11. Weekly analysis with Sarvam AI

The Saturday analysis is a **scheduled job on a Sarvam AI account**, not part of
the extension.

To set it up (on any Sarvam AI account):

1. In that chat, click the **Google Sheets** connect card and approve access to the
   Google account that owns the sheet.
2. Ask the assistant to schedule a weekly job along these lines:

   > Every Saturday at 10:00 IST, read my "Shorts Guard Log" sheet (the Log tab),
   > analyse the last 7 days — entries, top triggers, what I was pulled from,
   > time-of-day patterns, traction vs distraction, passes per day, week-on-week
   > trend — and suggest one tweak. Don't change code until I approve.

3. The job reads the sheet under your authorization. It touches nothing else.

The cron does **not** transfer between Sarvam AI accounts, and it needs the Sheets
integration authorized on whichever account runs it.

---

## 12. Moving to a new device or account

### 12.1 What carries

| Thing | Carries automatically? | How to move it |
|---|---|---|
| Extension code | No | Copy the `shorts-guard` folder (or the zip) and Load unpacked |
| Settings | **No** | Re-enter manually (no export/import yet) |
| Journal | **No** | **Export** JSON as a backup; re-add entries manually (no import yet) |
| Pass/counter/target state | No | Resets; nothing to move |
| Google Sheet + Apps Script | No | Recreate on the target Google account (§10.1) |
| Weekly cron | No | Recreate on the target Sarvam AI account (§11) |

> **Known gap:** settings and journal have no Import yet. On a new device you must
> re-enter settings, and re-add journal entries by hand (keeping the exported JSON
> as your record). Adding Export/Import of settings + journal would reduce a
> migration to: load unpacked → Import → paste webhook URL.

### 12.2 Same Google account, new device

1. Copy the `shorts-guard` folder to the new device (or unzip it there).
2. `chrome://extensions` → Developer mode → **Load unpacked** → select the folder.
3. Allow the all-sites permission.
4. Re-enter your settings (they will not have synced — see §9).
5. Reuse the **same** Sheet and the **same** `/exec` URL; paste it into the popup.
6. The journal starts empty on this device (local store).

### 12.3 Different Google account (and/or different Sarvam AI account)

1. Do §12.2 steps 1–3 on the new device.
2. On the **new Google account**, create a fresh **Shorts Guard Log** sheet and
   deploy `Code.gs` as a Web app (Execute as Me, Access Anyone). Copy its `/exec`
   URL.
   - Alternatively, share the existing sheet with the new account and redeploy the
     script under it — but the deployment belongs to whoever deploys it.
3. Paste the new `/exec` URL into the popup → **Save** → **Send test row**.
4. In the **new Sarvam AI account**, connect **Google Sheets** to that Google
   account and recreate the weekly job (§11).
5. Re-enter settings on the new device.

### 12.4 Two devices at once

Both can run independently. If both point at the **same** Sheet, both append to the
same `Log` tab — the analysis simply sees rows from both. They do not share
settings, journal, pass state or cooldowns; those are per-device local/sync data.

---

## 13. Troubleshooting

**Nothing lands in the Sheet.**
- The **Sync webhook URL** is in the **popup**, not the journal page.
- Press **Send test row** and read the exact message:
  - *"No sync URL set"* → the field didn't save.
  - *"Endpoint returned an HTML page"* → the deployment's **Who has access** is not
    **Anyone** (you got a Google sign-in page).
  - *"Request failed before any response"* → wrong URL; it must end in `/exec`.
  - *"Endpoint replied but not with {ok:true}"* → the script errored; check the
    Apps Script **Executions** log.
- Edited `Code.gs` after deploying? You must **Deploy → Manage deployments → New
  version**; the old `/exec` serves the old code.
- Raw errors: `chrome://extensions` → the extension card → **service worker** →
  Console.

**The alert never appears.**
- The site may be exempt (allow domain / allow URL / active target) or strictly
  blocked (which shows the Blocked card instead).
- A pass window may be active, or you may be inside the nightly cutoff window.
- The tab must be **visible**; the timer pauses when hidden.

**Traction is greyed out.** Read the line under the buttons — it states the reason
(cooling down / no passes after HH:00 / daily cap reached).

**No Pomodoro notification when Chrome is in the background.** Check the OS
Do-Not-Disturb / Focus Assist, and that Chrome is allowed to send notifications.

**Permission missing.** Re-grant *read and change all sites* from the extension
card if Chrome reset it after an update.

---

## 14. Honest limits

- It is **friction, not a lock** — you can disable the extension at any time. It
  works because removing it is a deliberate act.
- A browser extension **cannot draw over other desktop applications**; the
  Pomodoro fallback is an OS notification, subject to Do-Not-Disturb.
- **Count-based detection is YouTube-Shorts-specific** (URL shape `/shorts/<id>`).
  Other infinite feeds are covered only by the time-based trigger.
- Settings do **not** survive a device/account move (see §9); journal has Export
  but no Import.
- Desktop Chrome-family browsers only (Chrome, Edge, Brave, Opera).

---

## 15. File map

```
manifest.json      MV3 manifest (storage, alarms, notifications, <all_urls>)
background.js      service worker: Pomodoro alarm; Google Sheet POST transport
content.js         page guard: triggers, alert, block card, targets, nudge
styles.css         overlay + nudge styling
popup.html/js      settings UI + sync test/backfill
journal.html/js    the local journal
icons/             extension + notification icons
apps-script/
  Code.gs          Google Sheets webhook (paste into Apps Script)
  README.md        one-time sync setup
```
