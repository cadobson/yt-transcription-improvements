// Paste into the Firefox web console after right-clicking a transcript line and
// choosing "Inspect", so that $0 is the selected element. Prints the chain of
// ancestors from the document root down to $0, crossing shadow-DOM boundaries.
(function () {
  const out = [];
  let n = $0;
  while (n && n !== document) {
    if (n.nodeType === 11) { // shadow root
      out.push("  #shadow-root");
      n = n.host;
      continue;
    }
    let s = n.tagName ? n.tagName.toLowerCase() : n.nodeName;
    if (n.id) s += "#" + n.id;
    if (n.classList && n.classList.length) s += "." + [...n.classList].join(".");
    if (n.shadowRoot) s += "  [has shadow root]";
    out.push(s);
    n = n.parentNode;
  }
  console.log(out.reverse().join("\n"));
  console.log("selected element outerHTML:\n" + $0.outerHTML.slice(0, 2500));
})();
