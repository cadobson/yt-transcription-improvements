// Transcript Helper — content script.
// Finds YouTube's transcript panel, replaces its search box with our own toolbar, and
// highlights matches in place (no filtering) with next/previous navigation.

(() => {
  "use strict";

  const TAG = "[Transcript Helper]";
  const DEBUG = true;
  const log = (...args) => console.log(TAG, ...args);
  const debug = (...args) => DEBUG && console.log(TAG, ...args);

  // YouTube ships two transcript implementations. "modern" is the redesigned panel
  // (observed 2026-09-24 on Firefox 156); "classic" is the older Polymer one, kept as a
  // fallback in case YouTube serves it on some videos or accounts.
  const IMPLS = {
    modern: {
      panel: 'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
      segment: "transcript-segment-view-model", // content of one fragment
      item: "macro-markers-panel-item-view-model", // clickable wrapper (role=button)
      timestamp: ".ytwTranscriptSegmentViewModelTimestamp",
      text: "span.ytAttributedStringHost",
      activeItem: "macro-markers-panel-item-view-model[is-active]",
      searchBox: "yt-search-input-view-model",
    },
    classic: {
      panel: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      segment: "ytd-transcript-segment-renderer",
      item: "ytd-transcript-segment-renderer",
      timestamp: ".segment-timestamp",
      text: ".segment-text",
      activeItem: "ytd-transcript-segment-renderer.active",
      searchBox: "ytd-transcript-search-box-renderer",
    },
  };
  const PANEL_SELECTOR = Object.values(IMPLS).map((i) => i.panel).join(", ");
  const ANY_SEGMENT_SELECTOR = Object.values(IMPLS).map((i) => i.segment).join(", ");

  function implFor(panel) {
    for (const [name, impl] of Object.entries(IMPLS)) {
      if (panel.matches(impl.panel)) return { name, ...impl };
    }
    return null;
  }

  const isWatchPage = () => location.pathname === "/watch";

  function describe(el) {
    if (!el) return "(none)";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList.length) s += "." + [...el.classList].join(".");
    return s;
  }

  function ancestorChain(el) {
    const chain = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) chain.push(describe(n));
    return chain.reverse().join(" > ");
  }

  // ---------------------------------------------------------------------------
  // Highlighting. Prefers the CSS Custom Highlight API (paints ranges without touching
  // YouTube's DOM); falls back to wrapping matches in <mark> if it is unavailable.
  // ---------------------------------------------------------------------------

  const HAS_HIGHLIGHT_API = typeof Highlight === "function" && typeof CSS !== "undefined" && !!CSS.highlights;
  if (!HAS_HIGHLIGHT_API) log("CSS Custom Highlight API unavailable; using <mark> fallback");

  // Highlight names are page-global, and YouTube can render the same transcript panel
  // twice (one per layout), so highlighting is one page-level step that merges the
  // matches of every controller rather than something each controller owns.
  const highlighter = HAS_HIGHLIGHT_API
    ? {
        apply(jobs) {
          const pick = (pred) => new Highlight(...jobs.filter(pred).map((j) => j.range));
          const all = pick((j) => !j.current);
          const cur = pick((j) => j.current);
          const loose = pick((j) => !j.exact); // stacks on top: adds the dashed underline
          cur.priority = 1;
          loose.priority = 2;
          CSS.highlights.set("th-match", all);
          CSS.highlights.set("th-current", cur);
          CSS.highlights.set("th-loose", loose);
        },
        clear() {
          for (const name of ["th-match", "th-current", "th-loose"]) CSS.highlights.delete(name);
        },
      }
    : {
        marks: [],
        apply(jobs) {
          this.clear();
          // Wrap back-to-front so earlier ranges' offsets stay valid.
          const ordered = [...jobs].sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
          for (let i = ordered.length - 1; i >= 0; i--) {
            const mark = document.createElement("mark");
            mark.className = "th-mark" + (ordered[i].current ? " th-current" : "") + (ordered[i].exact ? "" : " th-loose");
            try {
              ordered[i].range.surroundContents(mark);
              this.marks.push(mark);
            } catch (e) {
              debug("could not wrap range", e);
            }
          }
        },
        clear() {
          for (const mark of this.marks) {
            if (!mark.isConnected) continue;
            const parent = mark.parentNode;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            mark.remove();
            parent.normalize();
          }
          this.marks = [];
        },
      };

  const controllers = new Map(); // panel element -> TranscriptPanel

  function refreshHighlights() {
    const jobs = [];
    for (const ctl of controllers.values()) {
      ctl.matches.forEach((m, i) =>
        m.ranges.forEach((range) => jobs.push({ range, current: i === ctl.current, exact: m.exact }))
      );
    }
    if (jobs.length) highlighter.apply(jobs);
    else highlighter.clear();
  }

  // ---------------------------------------------------------------------------
  // One controller per transcript panel.
  // ---------------------------------------------------------------------------

  class TranscriptPanel {
    constructor(panel, impl) {
      this.panel = panel;
      this.impl = impl;
      this.index = null;
      this.matches = [];
      this.current = -1;
      this.query = "";
      this.rebuildTimer = null;
      this.searchTimer = null;
    }

    mount() {
      this.panel.setAttribute("data-th-active", this.impl.name);
      this.buildToolbar();
      this.mountToolbar();
      this.rebuild();

      this.observer = new MutationObserver((records) => {
        // Ignore mutations we caused ourselves inside the toolbar.
        if (records.every((r) => this.toolbar.contains(r.target))) return;
        clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
          if (!this.toolbar.isConnected) this.mountToolbar();
          this.rebuild();
        }, 150);
      });
      this.observer.observe(this.panel, { subtree: true, childList: true, characterData: true });
      const copies = [...document.querySelectorAll(this.impl.panel)];
      log(`${this.impl.name} panel mounted (copy ${copies.indexOf(this.panel) + 1} of ${copies.length}) at`,
        ancestorChain(this.panel.parentElement));
    }

    buildToolbar() {
      const bar = document.createElement("div");
      bar.className = "th-toolbar";
      bar.setAttribute("role", "search");
      bar.innerHTML = `
        <input class="th-input" type="text" placeholder="Search transcript"
               aria-label="Search transcript" autocomplete="off" spellcheck="false">
        <span class="th-count" aria-live="polite"></span>
        <button class="th-prev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>
        </button>
        <button class="th-next" type="button" title="Next match (Enter)" aria-label="Next match">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>
        </button>`;
      this.toolbar = bar;
      this.input = bar.querySelector(".th-input");
      this.count = bar.querySelector(".th-count");

      // Keep YouTube's page-wide hotkeys (space, k, f, arrows...) from firing while typing.
      for (const type of ["keydown", "keyup", "keypress"]) {
        bar.addEventListener(type, (e) => e.stopPropagation());
      }
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.step(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.input.value = "";
          this.search("");
          this.input.blur();
        }
      });
      this.input.addEventListener("input", () => {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.search(this.input.value), 80);
      });
      bar.querySelector(".th-prev").addEventListener("click", () => this.step(-1));
      bar.querySelector(".th-next").addEventListener("click", () => this.step(1));
    }

    mountToolbar() {
      const box = this.panel.querySelector(this.impl.searchBox);
      if (box) {
        box.insertAdjacentElement("beforebegin", this.toolbar);
      } else {
        // Search box not rendered (yet); a later mutation will retry via mountToolbar().
        debug("search box not found; toolbar not mounted yet");
      }
    }

    collectSegments() {
      const segs = [];
      for (const seg of this.panel.querySelectorAll(this.impl.segment)) {
        const textEl = seg.querySelector(this.impl.text);
        if (!textEl) continue;
        segs.push({ item: seg.closest(this.impl.item) || seg, textEl });
      }
      return segs;
    }

    rebuild() {
      // Drop ranges into nodes that may be gone before the new index is built.
      this.matches = [];
      refreshHighlights();
      this.index = new TranscriptIndex(this.collectSegments());
      debug(`index rebuilt: ${this.index.segments.length} segments, ${this.index.raw.length} chars`);
      this.runQuery({ scroll: false });
    }

    search(query) {
      this.query = query;
      this.runQuery({ scroll: true });
    }

    runQuery({ scroll }) {
      this.matches = this.index ? this.index.find(this.query) : [];
      this.current = this.matches.length ? 0 : -1;
      this.render();
      if (scroll) this.scrollToCurrent();
    }

    step(delta) {
      if (!this.matches.length) return;
      this.current = (this.current + delta + this.matches.length) % this.matches.length;
      this.render();
      this.scrollToCurrent();
    }

    render() {
      refreshHighlights();
      if (!this.matches.length) {
        this.count.textContent = this.query.trim() ? "No matches" : "";
        this.toolbar.classList.toggle("th-no-matches", !!this.query.trim());
        return;
      }
      this.toolbar.classList.remove("th-no-matches");
      this.count.textContent = `${this.current + 1} / ${this.matches.length}`;
      const loose = this.matches.filter((m) => !m.exact).length;
      this.count.title = loose
        ? `${this.matches.length - loose} exact, ${loose} ignoring punctuation (dashed underline)`
        : "";
    }

    scrollToCurrent() {
      const m = this.matches[this.current];
      if (!m) return;
      const item = this.index.segments[m.segIndices[0]].item;
      const container = this.scrollContainer(item);
      if (!container) {
        item.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const cr = container.getBoundingClientRect();
      const ir = item.getBoundingClientRect();
      const top = container.scrollTop + (ir.top - cr.top) - (cr.height - ir.height) / 2;
      container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }

    scrollContainer(el) {
      for (let n = el.parentElement; n && n !== this.panel.parentElement; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    }

    destroy() {
      this.observer?.disconnect();
      this.matches = [];
      this.toolbar.remove();
      refreshHighlights();
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  function scan() {
    if (!isWatchPage()) return;
    for (const [panel, ctl] of controllers) {
      if (!panel.isConnected) {
        ctl.destroy();
        controllers.delete(panel);
      }
    }
    for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
      if (controllers.has(panel)) continue;
      const impl = implFor(panel);
      if (!impl) continue;
      const ctl = new TranscriptPanel(panel, impl);
      controllers.set(panel, ctl);
      ctl.mount();
    }
    // Segments rendered outside any known panel would mean our panel selector is wrong.
    const stray = [...document.querySelectorAll(ANY_SEGMENT_SELECTOR)].find(
      (seg) => ![...controllers.keys()].some((p) => p.contains(seg))
    );
    if (stray && !stray.dataset.thStrayLogged) {
      stray.dataset.thStrayLogged = "1";
      log("WARNING: segment found outside known panels:", ancestorChain(stray));
    }
  }

  // Panels can be created lazily, so watch the whole document. Scans are coalesced to
  // one per animation frame.
  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }).observe(document.documentElement, { subtree: true, childList: true });

  document.addEventListener("yt-navigate-finish", () => {
    debug("yt-navigate-finish", location.href);
    scan();
  });

  log("content script loaded on", location.href);
  scan();
})();
