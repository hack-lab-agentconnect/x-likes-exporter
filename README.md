# X Likes Exporter

A small Chrome (Manifest V3) extension that **auto-scrolls an X / Twitter likes page to the bottom, collects everything it renders, and lets you copy or download the result as JSON.**

It supports two kinds of likes page, auto-detected from the URL:

| URL | What it exports |
| --- | --- |
| `https://x.com/<user>/status/<id>/likes` | **The people who liked that post** (likers: handle, name, bio, verified, avatar, profile URL) |
| `https://x.com/<user>/likes` | **The posts that user liked** (author, text, timestamp, media, engagement counts) |

It runs entirely in your browser while you are already signed into X. No servers, no API keys, no network calls beyond X itself.

## Install (unpacked)

1. Download or clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Open a likes page, e.g. `https://x.com/<user>/status/<id>/likes`.

> After updating the extension, click the reload icon on `chrome://extensions` and **hard-reload the X tab** so the new content script is injected.

## Use

1. Open a post's likes page (`…/status/<id>/likes`) or a profile's Likes tab (`…/<user>/likes`).
2. Click the extension's toolbar icon and press **Start scrolling**.
   - The page scrolls in **small, natural steps at randomized intervals** so X keeps lazy-loading the virtualized list.
   - It stops automatically when the list stops growing (or you press **Stop**).
   - The on-page badge (bottom-right) shows how many items have been extracted so far.
3. Press **Copy JSON** to copy to your clipboard, or **Download JSON** to save a file.
4. The popup shows **how many items were extracted**.

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Min delay (ms) | `900` | Shortest wait between scroll steps |
| Max delay (ms) | `2400` | Longest wait between scroll steps |
| Stop after stalled rounds | `6` | Consecutive scrolls with no new items before it calls the bottom |

Raise the delays if a very large list stops early — X needs time to load each batch.

## Output format

**Likers page** (`/status/<id>/likes`):

```json
{
  "meta": {
    "source": "https://x.com/user/status/123/likes",
    "type": "likers",
    "tweetId": "123",
    "tweetUrl": "https://x.com/user/status/123",
    "exportedAt": "2026-10-07T18:50:00.000Z",
    "count": 421,
    "generator": "X Likes Exporter v1.1.0"
  },
  "likers": [
    {
      "handle": "@someone",
      "username": "someone",
      "displayName": "Someone",
      "bio": "Builder. Coffee. Code.",
      "verified": false,
      "avatar": "https://pbs.twimg.com/profile_images/…jpg",
      "profileUrl": "https://x.com/someone"
    }
  ]
}
```

**Profile Likes tab** (`/<user>/likes`):

```json
{
  "meta": { "type": "liked_posts", "count": 1234, "…": "…" },
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

- `src/content.js` runs on `x.com` / `twitter.com`. It detects the page type, finds the correct scroll container, and repeatedly: reads the DOM → de-duplicates → scrolls one human-sized step (`~60–90%` of the viewport) → waits a random interval. It stops when the item count, scroll position and document height stop changing.
  - On a likers page it reads `[data-testid="UserCell"]`; on a profile Likes tab it reads `article[data-testid="tweet"]`.
  - The scroll container is auto-detected (`[aria-label="Timeline: Liked by"]`, the dialog, a scrollable ancestor of the rows, else the window), so it works whether the list opens as a page or a modal.
- `src/popup.{html,css,js}` is the control panel: start/stop, live count, copy, download, clear.
- Data is mirrored into `chrome.storage.local` (`xle_meta` + `xle_records`) so the popup can read it live.

## Notes & limits

- Keep the X tab **open and focused-ish** while it runs; backgrounded tabs throttle timers.
- X's lists are virtualized, so off-screen rows are removed from the DOM — that is why it scrolls step by step instead of jumping, and why a jump-to-bottom misses most rows.
- Extraction depends on X's current markup (`data-testid="UserCell"`, `data-testid="tweet"`). If X changes it, adjust the selectors in `src/content.js`.
- X only renders what your signed-in account can see.

## License

MIT — see [LICENSE](LICENSE).
