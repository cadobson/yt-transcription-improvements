// Transcript Helper — text index over the transcript segments.
//
// Joins every segment's text into one string (segments separated by a single space) and
// keeps a table of which DOM text node owns which slice of that string. Searching the
// joined string means a match can start in one segment and end in the next; the index
// then maps the match back to DOM ranges, one per text node, so it can be highlighted.
//
// Two normalized views of the joined text are searched:
//   strict — lower-cased, whitespace runs collapsed to one space.
//   loose  — strict plus punctuation ignored: apostrophes are dropped ("don't" = "dont"),
//            every other listed punctuation mark counts as whitespace ("follow-up" =
//            "follow up", "China. And" = "China And").
// Each view keeps a per-character map back to raw offsets.

globalThis.TranscriptIndex = class TranscriptIndex {
  static APOSTROPHES = /['‘’ʼ]/;
  static PUNCTUATION = /[,.?!:;"“”„«»\-‐-―…()\[\]{}]/;

  /**
   * @param {{item: Element, textEl: Element}[]} segments in document order.
   *   `item` is the clickable row, `textEl` the element holding the fragment text.
   */
  constructor(segments) {
    this.segments = [];
    this.nodes = []; // { node, start, end, segIndex } — slices of `raw`, in order
    let raw = "";

    segments.forEach((seg, segIndex) => {
      if (segIndex > 0) raw += " ";
      const start = raw.length;
      const walker = document.createTreeWalker(seg.textEl, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data) continue;
        this.nodes.push({ node, start: raw.length, end: raw.length + node.data.length, segIndex });
        raw += node.data;
      }
      this.segments.push({ item: seg.item, textEl: seg.textEl, start, end: raw.length });
    });

    this.raw = raw;
    this.strict = TranscriptIndex.normalize(raw, false);
    this.loose = TranscriptIndex.normalize(raw, true);
  }

  /**
   * Lower-case and collapse whitespace; with `loose`, also ignore punctuation.
   * Returns { text, map } where map[i] is the raw index of normalized character i.
   */
  static normalize(raw, loose) {
    let text = "";
    const map = [];
    let pendingSpace = false;
    for (let i = 0; i < raw.length; i++) {
      let ch = raw[i];
      if (loose) {
        if (TranscriptIndex.APOSTROPHES.test(ch)) continue;
        if (TranscriptIndex.PUNCTUATION.test(ch)) ch = " ";
      }
      if (/\s/.test(ch)) {
        if (text.length && !pendingSpace) {
          pendingSpace = true;
          map.push(i);
        }
        continue;
      }
      if (pendingSpace) {
        text += " ";
        pendingSpace = false;
      }
      const lower = ch.toLowerCase();
      text += lower.length === 1 ? lower : ch;
      map.push(i);
    }
    // A pending trailing space was recorded in `map` but never emitted; drop it.
    if (pendingSpace) map.pop();
    return { text, map };
  }

  /**
   * Find every occurrence of `query`, merging strict and loose matches into one list in
   * document order. Each match carries `exact: true` when the text matches with its
   * punctuation intact, `exact: false` when it only matches with punctuation ignored.
   *
   * @returns {{start:number, end:number, exact:boolean, segIndices:number[], ranges:Range[]}[]}
   */
  find(query) {
    const strictHits = this.scan(this.strict, TranscriptIndex.normalize(query, false).text);
    const looseHits = this.scan(this.loose, TranscriptIndex.normalize(query, true).text);

    // Loose hits normally cover every strict hit (same span, give or take trailing
    // punctuation). Classify each loose hit by whether a strict hit overlaps it, and keep
    // any strict hit that no loose hit covers (e.g. the query is pure punctuation).
    const overlaps = (a, b) => a.start < b.end && b.start < a.end;
    const merged = looseHits.map((h) => ({ ...h, exact: strictHits.some((s) => overlaps(s, h)) }));
    for (const s of strictHits) {
      if (!looseHits.some((h) => overlaps(s, h))) merged.push({ ...s, exact: true });
    }
    merged.sort((a, b) => a.start - b.start);
    return merged.map((m) => ({ ...m, ...this.rawRangeToMatch(m.start, m.end) }));
  }

  /** Raw-offset spans of every occurrence of `q` in a normalized view. */
  scan(view, q) {
    if (!q) return [];
    const hits = [];
    for (let pos = view.text.indexOf(q); pos !== -1; pos = view.text.indexOf(q, pos + q.length)) {
      hits.push({ start: view.map[pos], end: view.map[pos + q.length - 1] + 1 });
    }
    return hits;
  }

  rawRangeToMatch(start, end) {
    const ranges = [];
    const segIndices = [];
    for (const n of this.nodes) {
      if (n.end <= start) continue;
      if (n.start >= end) break;
      const r = document.createRange();
      r.setStart(n.node, Math.max(start, n.start) - n.start);
      r.setEnd(n.node, Math.min(end, n.end) - n.start);
      if (r.collapsed) continue;
      ranges.push(r);
      if (segIndices[segIndices.length - 1] !== n.segIndex) segIndices.push(n.segIndex);
    }
    return { segIndices, ranges };
  }
};
