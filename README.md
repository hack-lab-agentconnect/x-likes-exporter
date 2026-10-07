# X Likes Exporter

A tiny Chrome (Manifest V3) extension that scrolls your **X / Twitter Likes timeline** to the very bottom, collects every liked post, and lets you **copy or download the whole set as JSON**.

It works entirely in your browser while you are already signed into X. Nothing is uploaded anywhere — no servers, no API keys, no network calls beyond X itself.

## Install (unpacked)

1. Download or clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Open your Likes page: `https://x.com/<your-handle>/likes` (or `https://twitter.com/...`).

## Use

1. Click the extension's toolbar icon.
2. Press **Start scrolling**. Look at the on-page badge (bottom-right) for live progress.
   - The page scrolls in **random intervals** so X keeps lazy-loading more posts.
   - It stops automatically once the timeline stops growing (or you press **Stop**).
3. Press **Copy JSON** to copy the result to your clipboard, or **Download JSON** to save a file.
4. The popup shows **how many liked posts were extracted**.

### Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Min delay (ms) | `900` | Shortest wait between scrolls |
| Max delay (ms) | `2600` | Longest wait between scrolls |
| Stop after stalled rounds | `8` | Rounds with no new posts before it calls it the bottom |

Slower, more random delays load more posts on very large accounts.

## Output format

```json
{
  "meta": {
    "source": "https://x.com/you/likes",
    "exportedAt": "2026-10-07T18:50:00.000Z",
    "count": 1234,
    "generator": "X Likes Exporter v1.0.0"
  },
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
      "metrics": {
        "replies": 12,
        "reposts": 34,
        "likes": 567,
        "bookmarks": 8,
        "views": 12345
      }
    }
  ]
}
```

Missing values are `null` (metrics) or omitted (`repostedBy`, `media`).

## How it works

- `src/content.js` runs on `x.com` / `twitter.com`. It repeatedly reads the DOM, extracts each `<article data-testid="tweet"]`, de-duplicates by status id, then scrolls to the bottom and waits a random interval. It stops when the document height and post count stop changing.
- `src/popup.{html,css,js}` is the control panel: start/stop, live count, copy, download, clear.
- Data lives in `chrome.storage.local` (mirrored live) so the popup can read it and the run survives closing the popup.

## Notes & limits

- Keep the X tab **open and visible-ish** while it runs; backgrounded tabs can throttle timers.
- X only loads what your account can see; this exports your own Likes page as rendered.
- The DOM selectors follow X's current markup. If X changes it, tweak the `data-testid` selectors in `src/content.js`.
- Very large accounts may need the delay settings raised, and the run can take a while — that's expected.

## License

MIT — see [LICENSE](LICENSE).
