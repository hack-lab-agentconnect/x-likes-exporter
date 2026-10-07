(() => {
  "use strict";

  if (window.__XLE_LOADED__) return;
  window.__XLE_LOADED__ = true;

  const META_KEY = "xle_meta";
  const RECORDS_KEY = "xle_records";
  const GENERATOR = "X Likes Exporter v1.0.0";

  const state = {
    running: false,
    status: "idle",
    message: "Ready",
    startedAt: null,
    finishedAt: null,
    rounds: 0,
    stagnant: 0,
    records: new Map(),
    config: { minDelay: 900, maxDelay: 2600, maxStagnant: 8 },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomDelay = () => rand(state.config.minDelay, state.config.maxDelay);

  function absolute(url) {
    try {
      return new URL(url, location.origin).href;
    } catch {
      return url;
    }
  }

  function parseCount(label) {
    if (!label) return null;
    const m = String(label).replace(/,/g, "").match(/(\d[\d.]*)\s*([KMB])?/i);
    if (!m) return null;
    let n = parseFloat(m[1]);
    const suffix = (m[2] || "").toUpperCase();
    if (suffix === "K") n *= 1e3;
    else if (suffix === "M") n *= 1e6;
    else if (suffix === "B") n *= 1e9;
    return Math.round(n);
  }

  function metric(article, testid) {
    const node = article.querySelector(`[data-testid="${testid}"]`);
    if (!node) return null;
    const raw =
      (node.getAttribute("aria-label") || node.innerText || "").trim() || null;
    return raw === null ? null : parseCount(raw) ?? raw;
  }

  function extractTweet(article) {
    const timeEl = article.querySelector("time");

    let statusHref = null;
    if (timeEl) {
      const a = timeEl.closest("a");
      statusHref = a ? a.getAttribute("href") : null;
    }
    if (!statusHref) {
      const a = article.querySelector('a[href*="/status/"]');
      statusHref = a ? a.getAttribute("href") : null;
    }

    let id = null;
    let handleFromUrl = null;
    let url = null;
    if (statusHref) {
      url = absolute(statusHref);
      const m = statusHref.match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) {
        handleFromUrl = m[1];
        id = m[2];
      }
    }
    if (!id) id = timeEl ? timeEl.getAttribute("datetime") : null;
    if (!id) return null;

    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    let author = "";
    let handle = "";
    if (nameBlock) {
      const txt = nameBlock.innerText || "";
      const at = txt.match(/@([A-Za-z0-9_]+)/);
      if (at) handle = at[1];
      author = txt.split("\n")[0].trim();
    }
    if (!handle && handleFromUrl) handle = handleFromUrl;

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : "";

    const media = [];
    article
      .querySelectorAll('[data-testid="tweetPhoto"] img')
      .forEach((img) => {
        if (img.src) media.push(img.src);
      });
    article.querySelectorAll("video").forEach((v) => {
      if (v.poster) media.push(v.poster);
    });

    const socialContext = article.querySelector('[data-testid="socialContext"]');
    const repostedBy = socialContext ? socialContext.innerText.trim() : null;

    let views = null;
    const analytics = article.querySelector('a[href$="/analytics"]');
    if (analytics) {
      const raw =
        (analytics.getAttribute("aria-label") || analytics.innerText || "").trim() ||
        null;
      if (raw !== null) views = parseCount(raw) ?? raw;
    }

    const record = {
      id,
      url,
      author: author || null,
      handle: handle ? `@${handle}` : null,
      text,
      timestamp: timeEl ? timeEl.getAttribute("datetime") : null,
      repostedBy: repostedBy || undefined,
      media: media.length ? media : undefined,
      metrics: {
        replies: metric(article, "reply"),
        reposts: metric(article, "retweet"),
        likes: metric(article, "like"),
        bookmarks: metric(article, "bookmark"),
        views,
      },
    };
    return record;
  }

  function collect() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let added = 0;
    articles.forEach((article) => {
      const rec = extractTweet(article);
      if (rec && !state.records.has(rec.id)) {
        state.records.set(rec.id, rec);
        added += 1;
      }
    });
    return { added, total: state.records.size, scanned: articles.length };
  }

  function caughtUp() {
    const t = document.body.innerText || "";
    return /You're all caught up|You’ve reached the end|You've reached the end|That's every post|You’re all caught up/i.test(
      t
    );
  }

  function scrollBottom() {
    const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
    const last = cells[cells.length - 1];
    if (last) last.scrollIntoView({ block: "end" });
    window.scrollTo(0, document.documentElement.scrollHeight);
    window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
  }

  function metaSnapshot() {
    return {
      running: state.running,
      status: state.status,
      message: state.message,
      count: state.records.size,
      rounds: state.rounds,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      updatedAt: Date.now(),
      source: location.href,
      generator: GENERATOR,
    };
  }

  function storageSet(obj) {
    try {
      const p = chrome.storage.local.set(obj);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  let persistTimer = null;
  function persist(immediate) {
    clearTimeout(persistTimer);
    const write = () => {
      storageSet({
        [META_KEY]: metaSnapshot(),
        [RECORDS_KEY]: Array.from(state.records.values()),
      });
    };
    if (immediate) write();
    else persistTimer = setTimeout(write, 500);
  }

  function broadcast() {
    try {
      chrome.runtime.sendMessage({ type: "XLE_PROGRESS", state: metaSnapshot() }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      /* popup closed */
    }
  }

  let badge = null;
  function updateBadge() {
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "xle-badge";
      Object.assign(badge.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "2147483647",
        background: "rgba(15,20,25,.92)",
        color: "#fff",
        font: "600 12px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        padding: "8px 12px",
        borderRadius: "10px",
        boxShadow: "0 6px 20px rgba(0,0,0,.45)",
        pointerEvents: "none",
        maxWidth: "280px",
        letterSpacing: ".1px",
      });
      document.documentElement.appendChild(badge);
    }
    const phase = state.running
      ? "scrolling…"
      : state.status === "done"
        ? "done"
        : state.status;
    badge.textContent = `X Likes Exporter — ${state.records.size} liked posts · ${phase}`;
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.status = "running";
    state.message = "Scrolling your Likes…";
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.rounds = 0;
    state.stagnant = 0;
    updateBadge();
    broadcast();

    while (state.running) {
      const before = state.records.size;
      collect();
      state.rounds += 1;

      if (state.records.size === before) state.stagnant += 1;
      else state.stagnant = 0;

      state.message = `Collected ${state.records.size} liked posts (round ${state.rounds})`;
      persist();
      updateBadge();
      broadcast();

      if (caughtUp() && state.stagnant >= 2) {
        state.message = "Reached the end of your Likes.";
        break;
      }
      if (state.stagnant >= state.config.maxStagnant) {
        state.message = "No more posts loading — stopping.";
        break;
      }

      scrollBottom();
      await sleep(randomDelay());
      if (!state.running) break;

      // Occasional nudge up then back down to coax lazy loading.
      if (state.rounds % 5 === 0) {
        window.scrollBy(0, -Math.floor(window.innerHeight * 0.6));
        await sleep(rand(180, 550));
        scrollBottom();
        await sleep(rand(180, 550));
      }
    }

    state.running = false;
    state.status = "done";
    state.finishedAt = Date.now();
    persist(true);
    updateBadge();
    broadcast();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "XLE_PING":
        sendResponse({ ok: true });
        break;
      case "XLE_START":
        if (msg.config) Object.assign(state.config, msg.config);
        if (!state.running) run();
        sendResponse({ ok: true, running: true });
        break;
      case "XLE_STOP":
        state.running = false;
        state.status = "done";
        state.message = "Stopped.";
        persist(true);
        updateBadge();
        broadcast();
        sendResponse({ ok: true });
        break;
      case "XLE_GET":
        sendResponse({ ok: true, state: metaSnapshot() });
        break;
      case "XLE_CLEAR":
        state.records.clear();
        state.running = false;
        state.status = "idle";
        state.message = "Cleared.";
        state.rounds = 0;
        state.stagnant = 0;
        state.startedAt = null;
        state.finishedAt = null;
        persist(true);
        updateBadge();
        broadcast();
        sendResponse({ ok: true });
        break;
      default:
        break;
    }
    return true;
  });
})();
