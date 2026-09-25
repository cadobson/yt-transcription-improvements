// Transcript Helper — text index over the transcript segments.
//
// Joins every segment's text into one string (segments separated by a single space) and
// keeps a table of which DOM text node owns which slice of that string. Searching the
// joined string means a match can start in one segment and end in the next; the index
// then maps the match back to DOM ranges, one per text node, so it can be highlighted.
//
// Matching is case-insensitive and whitespace-insensitive: a "normalized" copy of the
// joined text (lower-cased, whitespace runs collapsed to one space) is what gets searched,
// with a per-character map back to the raw offsets.

globalThis.TranscriptIndex = class TranscriptIndex {
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
    const { text, map } = TranscriptIndex.normalize(raw);
    this.norm = text;
    this.normToRaw = map;
  }

  /**
   * Lower-case and collapse whitespace. Returns the normalized text plus, for each
   * normalized character, the index of the raw character it came from.
   */
  static normalize(raw) {
    let text = "";
    const map = [];
    let pendingSpace = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
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
   * @returns {{start:number, end:number, segIndices:number[], ranges:Range[]}[]}
   *   Matches in document order. start/end are raw offsets.
   */
  find(query) {
    const q = TranscriptIndex.normalize(query).text;
    if (!q) return [];
    const matches = [];
    for (let pos = this.norm.indexOf(q); pos !== -1; pos = this.norm.indexOf(q, pos + q.length)) {
      const start = this.normToRaw[pos];
      const end = this.normToRaw[pos + q.length - 1] + 1;
      matches.push(this.rawRangeToMatch(start, end));
    }
    return matches;
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
    return { start, end, segIndices, ranges };
  }
};
