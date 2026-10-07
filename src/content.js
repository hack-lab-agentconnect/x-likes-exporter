(() => {
  "use strict";

  if (window.__XLE_LOADED__) return;
  window.__XLE_LOADED__ = true;

  const META_KEY = "xle_meta";
  const RECORDS_KEY = "xle_records";
  const GENERATOR = "X Likes Exporter v1.1.0";

  const state = {
    running: false,
    status: "idle",
    message: "Ready",
    kind: null,
    tweetId: null,
    tweetUrl: null,
    startedAt: null,
    finishedAt: null,
    rounds: 0,
    stagnant: 0,
    records: new Map(),
    config: { minDelay: 900, maxDelay: 2400, maxStagnant: 6 },
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

  // ── Page type ─────────────────────────────────────────────────────────────
  // "likers"      → x.com/<user>/status/<id>/likes   (people who liked a post)
  // "liked_posts" → x.com/<user>/likes               (posts you liked)
  function detectKind() {
    const p = location.pathname;
    if (/\/status\/\d+\/likes\/?$/.test(p)) return "likers";
    if (/\/likes\/?$/.test(p) && !/\/status\//.test(p)) return "liked_posts";
    return null;
  }

  function pageContext() {
    const m = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/likes\/?$/);
    if (m) return { kind: "likers", tweetId: m[2], tweetUrl: `https://x.com/${m[1]}/status/${m[2]}` };
    const p = location.pathname.match(/^\/([^/]+)\/likes\/?$/);
    if (p) return { kind: "liked_posts", tweetId: null, tweetUrl: `https://x.com/${p[1]}/likes` };
    return { kind: null, tweetId: null, tweetUrl: null };
  }

  // ── Scrolling the right element ───────────────────────────────────────────
  function isScrollable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const s = getComputedStyle(el);
    const oy = s.overflowY;
    return (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      el.scrollHeight > el.clientHeight + 8
    );
  }

  function getScrollRoot() {
    const known = document.querySelector('[aria-label="Timeline: Liked by"]');
    if (isScrollable(known)) return known;

    const modal = document.querySelector('[aria-modal="true"]');
    if (isScrollable(modal)) return modal;

    const anchor =
      document.querySelector('[data-testid="UserCell"]') ||
      document.querySelector('article[data-testid="tweet"]');
    let el = anchor;
    while (el && el !== document.body) {
      if (isScrollable(el)) return el;
      el = el.parentElement;
    }
    return null; // window/document scroll
  }

  function viewportHeight() {
    const root = getScrollRoot();
    return root ? root.clientHeight : window.innerHeight;
  }

  function atBottom() {
    const root = getScrollRoot();
    if (root) return root.scrollTop + root.clientHeight >= root.scrollHeight - 12;
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 12;
  }

  // One natural, human-sized step (not a teleport to the bottom).
  function stepScroll() {
    const root = getScrollRoot();
    const step = Math.max(
      320,
      Math.floor(viewportHeight() * (0.6 + Math.random() * 0.3))
    );
    const smooth = { top: step, behavior: "smooth" };
    if (root) root.scrollBy(smooth);
    else window.scrollBy(smooth);
  }

  function nudgeUp() {
    const root = getScrollRoot();
    const back = Math.floor(viewportHeight() * 0.5);
    const smooth = { top: -back, behavior: "smooth" };
    if (root) root.scrollBy(smooth);
    else window.scrollBy(smooth);
  }

  // ── Extraction: likers ────────────────────────────────────────────────────
  function extractUser(cell) {
    let handle = "";
    const anchors = cell.querySelectorAll('a[href^="/"]');
    for (const a of anchors) {
      const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m) {
        handle = m[1];
        break;
      }
    }

    const nameBlock = cell.querySelector('[data-testid="User-Name"]');
    let displayName = "";
    if (nameBlock) {
      displayName = (nameBlock.innerText || "").split("\n")[0].trim();
      if (!handle) {
        const at = (nameBlock.innerText || "").match(/@([A-Za-z0-9_]+)/);
        if (at) handle = at[1];
      }
    }
    if (!displayName) {
      const span = cell.querySelector('[dir="ltr"] span');
      displayName = span ? span.textContent.trim() : "";
    }
    if (!handle) return null;

    const bioEl = cell.querySelector('[data-testid="UserDescription"]');
    const avatarEl = cell.querySelector('img[src*="profile_images"]');
    const verified = !!cell.querySelector('[aria-label*="Verified" i]');

    return {
      handle: `@${handle}`,
      username: handle,
      displayName: displayName || null,
      bio: bioEl ? bioEl.innerText.trim() : null,
      verified,
      avatar: avatarEl ? avatarEl.src : null,
      profileUrl: `https://x.com/${handle}`,
    };
  }

  function collectLikers() {
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    let added = 0;
    cells.forEach((cell) => {
      const u = extractUser(cell);
      if (u && !state.records.has(u.username)) {
        state.records.set(u.username, u);
        added += 1;
      }
    });
    return { added, total: state.records.size };
  }

  // ── Extraction: liked posts ───────────────────────────────────────────────
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
    const raw = (node.getAttribute("aria-label") || node.innerText || "").trim() || null;
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
    article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => {
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
      const raw = (analytics.getAttribute("aria-label") || analytics.innerText || "").trim() || null;
      if (raw !== null) views = parseCount(raw) ?? raw;
    }

    return {
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
  }

  function collectPosts() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let added = 0;
    articles.forEach((article) => {
      const rec = extractTweet(article);
      if (rec && !state.records.has(rec.id)) {
        state.records.set(rec.id, rec);
        added += 1;
      }
    });
    return { added, total: state.records.size };
  }

  function collect() {
    return state.kind === "likers" ? collectLikers() : collectPosts();
  }

  // ── Bottom detection ──────────────────────────────────────────────────────
  function caughtUp() {
    const t = document.body.innerText || "";
    return /You're all caught up|You’ve reached the end|You've reached the end|You’re all caught up|No more results/i.test(
      t
    );
  }

  // ── State plumbing ────────────────────────────────────────────────────────
  function metaSnapshot() {
    return {
      running: state.running,
      status: state.status,
      message: state.message,
      kind: state.kind,
      tweetId: state.tweetId,
      tweetUrl: state.tweetUrl,
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
    const write = () =>
      storageSet({
        [META_KEY]: metaSnapshot(),
        [RECORDS_KEY]: Array.from(state.records.values()),
      });
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
        maxWidth: "290px",
        letterSpacing: ".1px",
      });
      document.documentElement.appendChild(badge);
    }
    const noun = state.kind === "liked_posts" ? "liked posts" : "likers";
    const phase = state.running ? "scrolling…" : state.status;
    badge.textContent = `X Likes Exporter — ${state.records.size} ${noun} · ${phase}`;
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  async function run() {
    if (state.running) return;
    const ctx = pageContext();
    if (!ctx.kind) {
      state.status = "error";
      state.message = "Open a post's /likes page (or a profile's Likes tab).";
      updateBadge();
      return;
    }
    state.kind = ctx.kind;
    state.tweetId = ctx.tweetId;
    state.tweetUrl = ctx.tweetUrl;

    state.running = true;
    state.status = "running";
    state.message = "Scrolling…";
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.rounds = 0;
    state.stagnant = 0;
    updateBadge();
    broadcast();

    let lastScroll = -1;

    while (state.running) {
      const before = state.records.size;
      collect();
      state.rounds += 1;

      const grew = state.records.size > before;
      const reachedBottom = atBottom();
      const scrollPos = (() => {
        const root = getScrollRoot();
        return root ? root.scrollTop : window.scrollY;
      })();
      const moved = scrollPos > lastScroll + 2;
      lastScroll = scrollPos;

      if (grew) state.stagnant = 0;
      else if (reachedBottom && !moved) state.stagnant += 1;
      else state.stagnant = 0;

      const noun = state.kind === "liked_posts" ? "liked posts" : "likers";
      state.message = `Collected ${state.records.size} ${noun} (round ${state.rounds})`;
      persist();
      updateBadge();
      broadcast();

      if (caughtUp() && state.stagnant >= 1) {
        state.message = "Reached the end of the list.";
        break;
      }
      if (state.stagnant >= state.config.maxStagnant) {
        state.message = "No more items loading — stopping.";
        break;
      }

      stepScroll();
      await sleep(randomDelay());
      if (!state.running) break;

      if (state.rounds % 5 === 0) {
        nudgeUp();
        await sleep(rand(200, 550));
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
        sendResponse({ ok: true, kind: detectKind() });
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
