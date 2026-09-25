# Transcript Helper

Firefox extension that improves YouTube's transcript panel. See `PLAN.md` for the design
notes and the record of what YouTube's markup looks like.

## What it does

- Replaces YouTube's transcript search box with one that **highlights matches in place**
  instead of hiding every non-matching line. Up/down buttons, Enter and Shift+Enter step
  through matches; the counter shows the current position; Escape clears.
- Matches **across fragment boundaries**, so a phrase split over two timestamps is found.
- Matches **ignoring punctuation** (commas, periods, hyphens, apostrophes, quotes, ...).
  Exact and punctuation-insensitive matches appear in one list; the latter get a dashed
  underline.
- Makes **Ctrl+F reach the transcript first** by moving the right-hand column ahead of
  the video column in the DOM while a transcript is open (visual layout is unchanged).
- Clicking a fragment still seeks the video exactly as before.

Supports both of YouTube's transcript implementations: the modern panel (videos without
chapters) and the classic "In this video" panel (videos with chapters).

## Load as a temporary add-on (development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
3. Open a YouTube video that has a transcript, expand the description (`...more`), click
   **Show transcript**.

After editing files, go back to `about:debugging` and click **Reload** next to the
extension, then reload the YouTube tab. Set `DEBUG = true` at the top of
`src/content.js` for verbose console output (filter the console on `Transcript Helper`).

## Files

- `manifest.json` — Manifest V3, content script on `https://www.youtube.com/*`
- `src/transcript-index.js` — joined-text index, strict and loose matching, DOM ranges
- `src/content.js` — panel discovery, toolbar, highlighting, Ctrl+F column reorder
- `src/styles.css` — toolbar, highlights, reorder CSS
- `tools/inspect-ancestors.js` — console snippet for inspecting YouTube's markup
