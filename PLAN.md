# Transcript Helper — Firefox extension plan

Goal: improve the UX of YouTube's built-in video transcript panel on desktop Firefox.
Delivered in phases; each phase is installed and verified by hand before the next starts.

## How YouTube's transcript panel is built (confirmed 2026-09-24, Firefox 156)

YouTube ships two transcript implementations. The user's browser gets the **modern** one;
the **classic** one is still present in the page as an empty hidden panel, so the
extension supports both through a selector table (`IMPLS` in `src/content.js`).

### Modern (what we build against)
- Panel: `ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]`,
  in `#secondary > #secondary-inner > #panels` alongside six other engagement panels
  (comments, description, ads, search preview, classic transcript). Open panels carry
  `visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"`, closed ones `..._HIDDEN`.
- List: `yt-item-section-renderer > div#contents`, one plain `<div>` per row, each holding
  `macro-markers-panel-item-view-model` (role=button, the click-to-seek target; gains an
  `is-active` attribute when it matches the playhead) > `timeline-item-view-model` >
  `transcript-segment-view-model` with:
  - `div.ytwTranscriptSegmentViewModelTimestamp` — "0:16" (aria-hidden)
  - `div.ytwTranscriptSegmentViewModelTimestampA11yLabel` — "16 seconds" (screen-reader
    only; must be excluded from text extraction)
  - `span.ytAttributedStringHost` — the fragment text
- Search: `yt-search-input-view-model > form > textarea-shape > textarea`.
- No shadow DOM anywhere in this tree, so normal selectors and observers work.
- Seeking: keep YouTube's own click handler by never replacing item elements.

### Classic (used for videos WITH chapters — confirmed 2026-09-24)
- YouTube picks the implementation per video: videos with chapters get the classic
  "In this video" panel (Chapters / Transcript tabs); videos without chapters get modern.
- Panel: `...[target-id="engagement-panel-searchable-transcript"]`, segments
  `ytd-transcript-segment-renderer` with `.segment-timestamp` / `.segment-text`, active
  class `active`, search box `ytd-transcript-search-box-renderer`, chapter headings
  `ytd-transcript-section-header-renderer` between segments.
- YouTube renders this panel **twice** (both copies fully populated, one expanded), most
  likely one per layout. Consequences: highlighting is page-global and merges all
  controllers; the two toolbars do not share query state yet (see Later); Phase 4's
  reorder must handle both copies.

### Shared
- YouTube is a single-page app. Navigating to another video fires `yt-navigate-finish` and
  re-renders the list, so we watch the panel with a MutationObserver and rebuild our index
  whenever segments change.
- Ctrl+F reaches comments first because `#secondary` (which holds `#panels`) comes after
  `#primary` (player, description, comments) in DOM order.

## Architecture

- Manifest V3 WebExtension, no build step, no dependencies. Plain JS content script + CSS
  matched on `https://www.youtube.com/*` (run at `document_idle`). The match is site-wide
  because YouTube is a single-page app: a user who lands on the home page and clicks a
  video never gets a fresh page load, so a `/watch*` match would never inject. The script
  itself only acts when the path is `/watch`.
- Files:
  - `manifest.json`
  - `src/content.js` — finds the panel, observes it, injects the toolbar, owns search state
  - `src/transcript-index.js` — builds the joined-text index and maps matches back to segments
  - `src/styles.css` — toolbar styling, highlight styling, hides YouTube's search box
  - `icons/`
- Loading during development: `about:debugging#/runtime/this-firefox` → "Load Temporary
  Add-on" → pick `manifest.json`. Optional: `npx web-ext run` auto-reloads on file changes.

### The transcript index (core data model, used by Phases 2–4)

Build one string from all segments joined with a single space, plus an offset table that
maps every character of the joined string back to (segment index, offset inside segment).
Searching the joined string makes "straddling" matches natural: a match is just a
[start, end) range in the joined string, which maps to one or more segment ranges.

For punctuation-insensitive search, build a second "normalized" string (punctuation
removed, whitespace collapsed, lower-cased) with its own offset table back to the original.
The query is normalized the same way. A hit in the normalized string is mapped back to
original offsets and then to segments like any other match.

Highlighting: CSS Custom Highlight API (`CSS.highlights` + `::highlight()`), which paints
ranges without touching YouTube's DOM, so Polymer re-renders and click handlers are
unaffected. Target browser is Firefox 156 (user's version, 2026-09-24), which supports it.

## Phases

### Phase 0 — Minimum viable extension  ✅ verified 2026-09-24
- Scaffold manifest, content script, CSS, icon.
- Content script waits for the transcript panel, then adds a visible marker: a coloured
  border on the panel and a small "Transcript Helper" badge in its header.
- Includes a DOM probe (`console.log` of the panel's structure and a sample segment) so we
  can confirm every selector listed above from Firefox's console.
- User checks: extension loads in about:debugging with no errors; badge appears after
  clicking "Show transcript"; badge survives navigating to another video; console shows
  the probe output (paste it back so selectors can be corrected).

### Phase 1 — Own search toolbar with in-context highlighting and next/previous  ✅ verified 2026-09-24
- Hide YouTube's search box; inject our toolbar: text input, "n / total" counter,
  previous and next buttons. Enter = next, Shift+Enter = previous, Esc = clear.
- Matching segments are highlighted in place; nothing is hidden. Current match gets a
  stronger style and is scrolled into view within the panel.
- Clicking a highlighted segment still seeks the video (YouTube's handler untouched).
- Search runs against the joined index from the start, so Phase 2 is mostly verification.

### Phase 2 — Matches that straddle segments  ✅ verified 2026-09-24 (incl. across chapter headings)
- Verify and fix cases where the query crosses a segment boundary: highlight the tail of
  one segment and the head of the next as one match; next/previous treats it as one hit;
  clicking either segment seeks normally.
- Edge cases: chapter headers between segments, queries spanning three or more segments,
  double spaces / line breaks inside segment text.

### Phase 3 — Punctuation-insensitive search  ✅ verified 2026-09-24
- Add normalized matching (commas first; configurable set of punctuation).
- Present both result kinds: exact matches and punctuation-insensitive matches in one
  merged, ordered list, visually distinguished (e.g. solid vs. dashed underline / different
  tint), with the counter covering both. Decided 2026-09-24.
- Ignored punctuation: commas, periods, question marks, exclamation marks, colons,
  semicolons, quotes, apostrophes, dashes, parentheses, brackets, ellipses. Decided
  2026-09-24. Rule: apostrophes are dropped ("don't" = "dont"); every other mark counts
  as whitespace ("follow-up" = "follow up", "China. And" = "China And").
- Presentation: loose-only matches get a dashed underline on top of the normal highlight;
  the counter's tooltip gives the exact/loose breakdown.

### Phase 4 — Ctrl+F reaches the transcript first  ✅ verified 2026-09-24
Decision (2026-09-24): **DOM reorder.** Native Ctrl+F stays untouched; users are never
forced into our search box.
Confirmed layout: both implementations mount the panel in
`ytd-watch-flexy > #columns > #secondary > #secondary-inner > #panels`, and `#columns`
holds `#primary` (player, description, comments) before `#secondary`. Plan: move
`#secondary` before `#primary` inside `#columns` while the transcript is open, and restore
the visual order with CSS `order` on the two columns (flex `order` works in both the
side-by-side and the stacked theater layout). Find-in-page then visits the transcript
(and the related-videos list, which shares `#secondary`) before the primary column.
Resolved: clicking "Show transcript" on a chaptered video creates a second classic panel
copy in the same `#panels` container, so one container covers both.
Implementation: `layout.update()` in `src/content.js` moves `#secondary` only while a
panel is open AND `ytd-watch-flexy[is-two-columns_]` is set (stacked narrow layout is left
alone), restores otherwise, and re-runs every search afterwards because moving a subtree
collapses the highlight Ranges inside it.
Paint-order gotcha: with `#primary` later in the DOM, its ambient-glow canvas
(`#cinematics-full-bleed-container`) painted over the transcript. Fixed with `z-index: 1`
on `#secondary` as a flex item. `position: relative` must NOT be added: it activates a
YouTube offset rule that pushes the column off-screen.
Rejected: intercepting Ctrl+F to focus our toolbar. Not tried: the selection trick.

### Later / out of scope for now
- Share the search query between duplicate panel copies (classic renders two).
- Auto-open the transcript panel on every video.
- Keyboard shortcut to focus the transcript search.
- Support for youtube.com/embed, m.youtube.com, YouTube Music.
- Packaging/signing for permanent install (temporary add-on is enough while developing).

## Verification workflow
- Firefox only for now (a Chrome port may come later). No web-ext / hot reload.
- After each phase, load/reload the temporary add-on and test on a video with a transcript.
- Report: what worked, what didn't, console errors (Ctrl+Shift+K on the YouTube tab),
  and screenshots where the visual result matters.
