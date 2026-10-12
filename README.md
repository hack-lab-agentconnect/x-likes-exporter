# X Likes Exporter

A small Chrome (Manifest V3) extension that **auto-scrolls an X / Twitter list page to the bottom, collects everything it renders, and lets you copy or download the result as JSON.**

It supports likers, followers, and liked posts — auto-detected from the URL, or chosen with the **Extract** dropdown in the popup. It works whether the list opens as a **full page or inside a modal** (e.g. clicking a post's likes, or a profile's Followers).

| URL | What it exports |
| --- | --- |
| `https://x.com/<user>/status/<id>/likes` | **The people who liked that post** (likers) |
| `https://x.com/<user>/followers` | **The profile's followers** |
| `https://x.com/<user>/verified_followers` | **The profile's verified followers** |
| `https://x.com/<user>/likes` | **The posts that user liked** |

Followers from the `followers` and `verified_followers` pages are collected into **one merged, de-duplicated list** (dedupe is by handle — the same method used for likers). Each record is tagged with which list it came from.

**One Start does both**: from either `/followers` or `/verified_followers`, the extension scrapes the list you are on, then automatically navigates to the other list, scrapes it too, and merges + de-duplicates the result into a single collection.

It runs entirely in your browser while you are already signed into X. No servers, no API keys, no network calls beyond X itself.

## Install (unpacked)

1. Download or clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Open a list page, e.g. `https://x.com/<user>/followers`.

> After updating the extension, click the reload icon on `chrome://extensions` and **hard-reload the X tab** so the new content script is injected.

## Use

1. Open one of the pages above (or open the same list as a modal from a profile/post).
2. Click the extension's toolbar icon.
3. In **Extract**, pick `Auto (from page)`, `Extract Likers`, `Extract Followers`, or `Extract Liked posts`, then press **Start scrolling**.
   - The list scrolls in **small, natural steps at randomized intervals** so X keeps lazy-loading the virtualized rows.
   - It stops automatically when the list stops growing (or you press **Stop**).
   - The on-page badge (bottom-right) shows how many items have been extracted so far.
4. Press **Copy JSON** to copy to your clipboard, or **Download JSON** to save a file.
5. The popup shows **how many items were extracted** (for followers: verified vs regular).

### Automatic regular + verified followers

Pick **Extract Followers** and press **Start** from either followers page. The extension will:
1. Scroll the current list to the bottom and collect it.
2. Automatically open the other followers list for the same profile.
3. Scroll and collect that too, **merging and de-duplicating by handle**.

You end up with one collection containing both groups (each record tagged `list` / `fromVerifiedList`). The badge and popup show progress like `… · next: verified_followers` while it works. Use **Clear** to start a fresh collection.

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Min delay (ms) | `900` | Shortest wait between scroll steps |
| Max delay (ms) | `2400` | Longest wait between scroll steps |
| Stop after stalled rounds | `6` | Consecutive scrolls with no new items before it calls the bottom |

Raise the delays if a very large list stops early — X needs time to load each batch.

## Output format

**Likers** (`/status/<id>/likes`) and **Followers** (`/followers`, `/verified_followers`) share a user shape:

```json
{
  "meta": {
    "source": "https://x.com/user/followers",
    "type": "followers",
    "profile": "user",
    "list": "followers",
    "exportedAt": "2026-10-07T18:50:00.000Z",
    "count": 812,
    "generator": "X Likes Exporter v1.3.1"
  },
  "followers": [
    {
      "handle": "@someone",
      "username": "someone",
      "displayName": "Someone",
      "bio": "Builder. Coffee. Code.",
      "verified": false,
      "avatar": "https://pbs.twimg.com/profile_images/…jpg",
      "profileUrl": "https://x.com/someone",
      "list": "followers",
      "fromVerifiedList": false
    }
  ]
}
```

For likers the key is `likers` and records omit `list`/`fromVerifiedList`.

**Profile Likes tab** (`/<user>/likes`) exports posts under `likes`:

```json
{
  "meta": { "type": "liked_posts", "count": 1234 },
  "likes": [
    {
      "id": "1840000000000000000",
      "url": "https://x.com/someone/status/1840000000000000000",
      "author": "Someone",
      "handle": "@someone",
      "text": "The full post text…",
      "timestamp": "2025-01-02T03:04:05.000Z",
      "repostedBy": "You reposted",
      "media": ["https://pbs.twimg.com/media/…jpg"],
      "metrics": { "replies": 12, "reposts": 34, "likes": 567, "bookmarks": 8, "views": 12345 }
    }
  ]
}
```

Missing values are `null`, or omitted (`repostedBy`, `media`).

## How it works

- `src/content.js` runs on `x.com` / `twitter.com`. It detects the page type, finds the correct scroll container, and repeatedly: reads the DOM → de-duplicates → scrolls one human-sized step (`~60–90%` of the viewport) → waits a random interval. It stops when the item count and scroll position stop changing.
  - Likers and followers are read from `[data-testid="UserCell"]`; liked posts from `article[data-testid="tweet"]`.
  - When the list is inside a modal, collection is scoped to the dialog (`[aria-modal="true"]` / `[role="dialog"]`) and the scroll container is auto-detected (`[aria-label="Timeline: Liked by"]`, the dialog, a scrollable ancestor of the rows, else the window) — so it works as a page or a modal.
  - On start it merges with a previous run against the same target (same tweet for likers, same profile for followers), so verified + regular followers build one de-duplicated collection.
  - For followers it stores a small plan in `chrome.storage.local` (`xle_plan`) so that, after finishing the first list, it can navigate to the other list and **auto-resume** the run there, then merge.
- `src/popup.{html,css,js}` is the control panel: mode select, start/stop, live count, copy, download, clear.
- Data is mirrored into `chrome.storage.local` (`xle_meta` + `xle_records`) so the popup can read it live.

## Notes & limits

- Keep the X tab **open and focused-ish** while it runs; backgrounded tabs throttle timers.
- X's lists are virtualized, so off-screen rows are removed from the DOM — that is why it scrolls step by step instead of jumping, and why a jump-to-bottom misses most rows.
- Extraction depends on X's current markup (`data-testid="UserCell"`, `data-testid="tweet"`). If X changes it, adjust the selectors in `src/content.js`.
- X only renders what your signed-in account can see.

## License

MIT — see [LICENSE](LICENSE).
