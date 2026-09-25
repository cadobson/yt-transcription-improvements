// Transcript Helper — Phase 0 content script.
// Finds YouTube's transcript panel, marks it visibly, and logs its DOM structure so the
// selectors in PLAN.md can be confirmed or corrected.

(() => {
  "use strict";

  const TAG = "[Transcript Helper]";
  const log = (...args) => console.log(TAG, ...args);

  // YouTube currently ships two transcript implementations. "modern" is the redesigned
  // panel (observed 2026-09-24 on Firefox 156); "classic" is the older Polymer one, kept
  // as a fallback in case YouTube serves it on some videos or accounts.
  const IMPLS = {
    modern: {
      panel: 'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
      segment: "transcript-segment-view-model", // content of one fragment
      item: "macro-markers-panel-item-view-model", // clickable wrapper (role=button)
      timestamp: ".ytwTranscriptSegmentViewModelTimestamp",
      text: "span.ytAttributedStringHost",
      activeItem: "macro-markers-panel-item-view-model[is-active]",
      searchBox: "yt-search-input-view-model",
      searchInput: "yt-search-input-view-model textarea",
    },
    classic: {
      panel: 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      segment: "ytd-transcript-segment-renderer",
      item: "ytd-transcript-segment-renderer",
      timestamp: ".segment-timestamp",
      text: ".segment-text",
      activeItem: "ytd-transcript-segment-renderer.active",
      searchBox: "ytd-transcript-search-box-renderer",
      searchInput: "ytd-transcript-search-box-renderer input",
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

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  // ---------------------------------------------------------------------------
  // Probe: describe the panel so we can verify selectors from the console.
  // ---------------------------------------------------------------------------

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

  function tree(el, depth, maxDepth, out, indent = "") {
    if (depth > maxDepth) return;
    const kids = [...el.children];
    out.push(indent + describe(el) + (kids.length ? ` (${kids.length} children)` : ""));
    let shown = 0;
    for (const k of kids) {
      if (shown >= 6) {
        out.push(indent + "  ... " + (kids.length - shown) + " more");
        break;
      }
      tree(k, depth + 1, maxDepth, out, indent + "  ");
      shown++;
    }
  }

  function probe(panel, impl, reason) {
    const segments = panel.querySelectorAll(impl.segment);
    const searchBox = panel.querySelector(impl.searchBox);
    const first = segments[0];
    const activeItem = panel.querySelector(impl.activeItem);

    console.groupCollapsed(`${TAG} probe (${reason}, ${impl.name}) — ${segments.length} segments`);
    log("panel attributes:", Object.fromEntries([...panel.attributes].map((a) => [a.name, a.value])));
    log("ancestor chain:", ancestorChain(panel));
    log("rendered size:", panel.offsetWidth + "x" + panel.offsetHeight);
    const lines = [];
    tree(panel, 0, 5, lines);
    log("structure:\n" + lines.join("\n"));
    log("search box:", searchBox ? searchBox.outerHTML.slice(0, 1500) : "(not found)");
    log("search input:", describe(panel.querySelector(impl.searchInput)));
    if (first) {
      const item = first.closest(impl.item);
      log("first item:", item ? item.outerHTML.slice(0, 1500) : "(no item wrapper)");
      log("first timestamp:", first.querySelector(impl.timestamp)?.textContent.trim());
      log("first text:", first.querySelector(impl.text)?.textContent.trim());
      // What else lives alongside segments? (chapter headers, ads, etc.)
      const listParent = item?.parentElement?.parentElement;
      if (listParent) {
        const kinds = new Map();
        for (const child of listParent.children) {
          const key = describe(child) + " > " + describe(child.firstElementChild);
          kinds.set(key, (kinds.get(key) || 0) + 1);
        }
        log("list container:", describe(listParent), "child kinds:", Object.fromEntries(kinds));
      }
    } else {
      log("first segment: (not found)");
    }
    log("active item:", activeItem ? activeItem.querySelector(impl.text)?.textContent.trim() : "(none)");
    const video = document.querySelector("video.html5-main-video");
    log("video element:", video ? `${describe(video)} currentTime=${video.currentTime.toFixed(1)}` : "(not found)");
    console.groupEnd();
  }

  // ---------------------------------------------------------------------------
  // Panel setup
  // ---------------------------------------------------------------------------

  const knownPanels = new Set();

  function setupPanel(panel) {
    if (knownPanels.has(panel)) return;
    const impl = implFor(panel);
    if (!impl) return;
    knownPanels.add(panel);

    panel.setAttribute("data-th-active", impl.name);
    if (!panel.querySelector(".th-badge")) {
      const badge = document.createElement("span");
      badge.className = "th-badge";
      badge.textContent = "Transcript Helper";
      panel.appendChild(badge);
    }
    log(`${impl.name} panel found; visibility =`, panel.getAttribute("visibility"));
    probe(panel, impl, "initial");

    // Log when the panel opens/closes and when the segment list is rebuilt.
    let lastCount = panel.querySelectorAll(impl.segment).length;
    let timer = null;
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.target === panel && r.attributeName === "visibility") {
          log(`${impl.name} panel visibility ->`, panel.getAttribute("visibility"),
            "| segments:", panel.querySelectorAll(impl.segment).length);
        }
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const count = panel.querySelectorAll(impl.segment).length;
        if (count !== lastCount) {
          lastCount = count;
          probe(panel, impl, "segments changed");
        }
      }, 300);
    }).observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ["visibility"] });
  }

  function scan() {
    if (!isWatchPage()) return;
    for (const p of knownPanels) if (!p.isConnected) knownPanels.delete(p);
    document.querySelectorAll(PANEL_SELECTOR).forEach(setupPanel);
    // Segments rendered outside any known panel would mean our panel selector is wrong.
    const stray = [...document.querySelectorAll(ANY_SEGMENT_SELECTOR)].find(
      (seg) => ![...knownPanels].some((p) => p.contains(seg))
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
    log("yt-navigate-finish", location.href);
    scan();
  });

  log("content script loaded on", location.href);
  scan();
})();
