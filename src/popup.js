"use strict";

const META_KEY = "xle_meta";
const RECORDS_KEY = "xle_records";
const GENERATOR = "X Likes Exporter v1.3.0";
const matchesX = (url) => /^https:\/\/(x|twitter)\.com\//.test(url || "");
const onLikesPage = (url) =>
  /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+\/likes/.test(url || "") ||
  /^https:\/\/(x|twitter)\.com\/[^/]+\/verified_followers/.test(url || "") ||
  /^https:\/\/(x|twitter)\.com\/[^/]+\/followers/.test(url || "") ||
  /^https:\/\/(x|twitter)\.com\/[^/]+\/likes(\/)?(\?|#|$)/.test(url || "");

const $ = (id) => document.getElementById(id);

function setHint(text, isError) {
  const el = $("hint");
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function applyMeta(meta) {
  if (!meta) return;
  $("count").textContent = meta.count ?? 0;
  $("countlabel").textContent =
    meta.kind === "liked_posts" ? "liked posts" : meta.kind === "followers" ? "followers" : "likers";
  $("status").textContent = meta.message || meta.status || "Ready";
  $("start").disabled = !!meta.running;
  $("stop").disabled = !meta.running;
}

async function loadMeta() {
  try {
    const store = await chrome.storage.local.get(META_KEY);
    applyMeta(store[META_KEY]);
  } catch {
    /* ignore */
  }
}

async function getRecords() {
  const store = await chrome.storage.local.get(RECORDS_KEY);
  return store[RECORDS_KEY] || [];
}

async function buildExport() {
  const [records, store] = await Promise.all([
    getRecords(),
    chrome.storage.local.get(META_KEY),
  ]);
  const meta = store[META_KEY] || {};
  const kind = meta.kind || "likers";
  const payload = {
    meta: {
      source: meta.source || null,
      type: kind,
      profile: meta.profile || null,
      list: meta.list || null,
      tweetId: meta.tweetId || null,
      tweetUrl: meta.tweetUrl || null,
      exportedAt: new Date().toISOString(),
      count: records.length,
      generator: GENERATOR,
    },
  };
  if (kind === "liked_posts") payload.likes = records;
  else if (kind === "followers") payload.followers = records;
  else payload.likers = records;
  return payload;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContent(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "XLE_PING" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content.js"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

$("start").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab || !matchesX(tab.url)) {
    return setHint("Open an X likes/followers page: /status/<id>/likes, /followers, or /verified_followers.", true);
  }
  if (!onLikesPage(tab.url)) {
    return setHint("Go to a post's /likes, or a profile's /followers or /verified_followers.", true);
  }
  const ok = await ensureContent(tab);
  if (!ok) {
    return setHint("Reload the X tab once, then press Start again.", true);
  }
  const config = {
    minDelay: Number($("minDelay").value) || 900,
    maxDelay: Number($("maxDelay").value) || 2600,
    maxStagnant: Number($("maxStagnant").value) || 8,
  };
  const mode = $("mode").value;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "XLE_START", config, mode });
    setHint(
      mode === "followers"
        ? "Extracting followers — it will open both /followers and /verified_followers automatically."
        : "Scrolling. The on-page badge shows live progress; keep the tab open."
    );
  } catch {
    setHint("Could not reach the page. Reload the X tab and try again.", true);
  }
});

$("stop").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab && matchesX(tab.url)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "XLE_STOP" });
    } catch {
      /* ignore */
    }
  }
  setHint("Stopped.");
});

const countOf = (data) => (data.likers || data.followers || data.likes || []).length;
const nounOf = (data) =>
  data.meta.type === "liked_posts" ? "liked posts" : data.meta.type === "followers" ? "followers" : "likers";

$("copy").addEventListener("click", async () => {
  const data = await buildExport();
  if (!countOf(data)) return setHint("Nothing to copy yet.", true);
  const json = JSON.stringify(data, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    setHint(`Copied ${countOf(data)} ${nounOf(data)} to clipboard.`);
  } catch {
    setHint("Clipboard was blocked — use Download JSON instead.", true);
  }
});

$("download").addEventListener("click", async () => {
  const data = await buildExport();
  if (!countOf(data)) return setHint("Nothing to download yet.", true);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  try {
    await chrome.downloads.download({
      url,
      filename: `x-likes-${stamp}.json`,
      saveAs: true,
    });
    setHint(`Downloaded ${countOf(data)} ${nounOf(data)}.`);
  } catch {
    setHint("Download failed.", true);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
});

$("clear").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab && matchesX(tab.url)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "XLE_CLEAR" });
    } catch {
      /* ignore */
    }
  }
  await chrome.storage.local.remove([META_KEY, RECORDS_KEY]);
  applyMeta({ count: 0, status: "idle", message: "Cleared.", running: false });
  setHint("Cleared collected data.");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "XLE_PROGRESS" && msg.state) applyMeta(msg.state);
});

loadMeta();
setInterval(loadMeta, 1000);
