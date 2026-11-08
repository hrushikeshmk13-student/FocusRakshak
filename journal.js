// Journal — a warm, private log of distractions. Everything lives in
// chrome.storage.local on this device; if a sync URL is set it is also pushed
// to your Google Sheet so the weekly analysis can read it.

const $ = (id) => document.getElementById(id);
let entries = [];

function load() {
  chrome.storage.local.get({ entries: [] }, (d) => {
    entries = d.entries || [];
    render();
  });
}

function save() {
  chrome.storage.local.set({ entries });
}

function syncPost(payload) {
  chrome.storage.sync.get({ syncUrl: "" }, (s) => {
    if (!(s.syncUrl || "").trim()) return;
    try {
      chrome.runtime.sendMessage({ type: "sync", payload }, () => void chrome.runtime.lastError);
    } catch (e) {
      /* ignore */
    }
  });
}

function todayKey() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function fmt(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function badge(kind) {
  const k = ["distraction", "traction", "note"].includes(kind) ? kind : "note";
  return '<span class="badge ' + k + '">' + k + "</span>";
}

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("list");
  const shown = entries.filter((e) =>
    !q ||
    [e.what, e.why, e.from].join(" ").toLowerCase().includes(q)
  );

  if (!shown.length) {
    list.innerHTML =
      '<div class="empty">' +
      (entries.length ? "Nothing matches that search." : "No entries yet. Your first honest note goes here.") +
      "</div>";
    return;
  }

  list.innerHTML = shown
    .map(
      (e) =>
        '<div class="card entry" data-id="' + esc(e.id) + '">' +
        '<button class="del" data-del="' + esc(e.id) + '" aria-label="Delete entry">delete</button>' +
        "<h3>" + esc(e.what || "(no title)") + "</h3>" +
        '<div class="meta">' + badge(e.kind) + "<span>" + esc(fmt(e.ts)) + "</span></div>" +
        (e.why ? '<div class="field"><div class="k">Why</div>' + esc(e.why) + "</div>" : "") +
        (e.from ? '<div class="field"><div class="k">From</div>' + esc(e.from) + "</div>" : "") +
        "</div>"
    )
    .join("");
}

$("add-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const what = $("f-what").value.trim();
  const why = $("f-why").value.trim();
  const from = $("f-from").value.trim();
  if (!what && !why && !from) return;
  const entry = {
    id: String(Date.now()) + Math.random().toString(16).slice(2),
    ts: Date.now(),
    kind: "note",
    what,
    why,
    from
  };
  entries.unshift(entry);
  save();
  syncPost({ type: "entry", date: todayKey(), ...entry });
  $("add-form").reset();
  render();
});

$("clear-form").addEventListener("click", () => $("add-form").reset());
$("search").addEventListener("input", render);

$("list").addEventListener("click", (ev) => {
  const id = ev.target.getAttribute && ev.target.getAttribute("data-del");
  if (!id) return;
  entries = entries.filter((e) => e.id !== id);
  save();
  render();
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "shorts-guard-journal.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("wipe").addEventListener("click", () => {
  if (!confirm("Delete every journal entry? This cannot be undone.")) return;
  entries = [];
  save();
  render();
});

$("ver").textContent = "FocusRakshak v" + chrome.runtime.getManifest().version;
chrome.storage.sync.get({ syncUrl: "" }, (s) => {
  $("syncState").textContent = (s.syncUrl || "").trim()
    ? "Stored in this browser \u00b7 new entries also sync to your Google Sheet"
    : "Stored in this browser \u00b7 no Google Sheet sync configured (set it in the toolbar popup)";
});

load();
