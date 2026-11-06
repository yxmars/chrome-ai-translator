import { normalizeText } from "../shared/text";
const citationSelector =
  'math,code,kbd,samp,cite,q,[role="doc-biblioref"],.ltx_cite,.citation,[data-citation],a[href*="#bib"],a[href*="#ref"]';
export interface ProtectedText {
  text: string;
  citations: Map<string, Node>;
}
/** Never move or replace the original citation nodes. */
export function protectCitations(el: HTMLElement): ProtectedText {
  const citations = new Map<string, Node>();
  let hash = 2166136261;
  for (const ch of normalizeText(el.textContent || ""))
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  let nonce = (hash >>> 0).toString(16);
  while ((el.textContent || "").includes(`[CAIT_CITE_${nonce}_`)) nonce += "x";
  function save(node: Node) {
    const token = `[CAIT_CITE_${nonce}_${citations.size}]`;
    citations.set(token, node);
    return token;
  }
  function walk(node: Node): string {
    if (node instanceof Element && node.matches(citationSelector))
      return save(node);
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(
        /\[\d+(?:\s*[,;–—-]\s*\d+)*\]/g,
        (s) => save(document.createTextNode(s)),
      );
    }
    return Array.from(node.childNodes, walk).join("");
  }
  return { text: walk(el), citations };
}
const mathTags = new Set("math semantics mrow mi mn mo mtext mspace msub msup msubsup mfrac msqrt mroot mover munder munderover mmultiscripts mprescripts none mtable mtr mtd menclose mpadded mphantom mstyle".split(" "));
function safeMath(node: Element): Element {
  const copy = document.createElementNS("http://www.w3.org/1998/Math/MathML", node.localName);
  for (const attr of ["display", "mathvariant", "mathsize", "stretchy", "fence", "separator", "accent", "accentunder", "columnalign", "rowalign", "columnspacing", "rowspacing", "linethickness", "notation"])
    if (node.hasAttribute(attr)) copy.setAttribute(attr, node.getAttribute(attr)!);
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) copy.append(document.createTextNode(child.textContent || ""));
    else if (child instanceof Element && mathTags.has(child.localName)) copy.append(safeMath(child));
  }
  return copy;
}
function safeCitation(node: Node): Node {
  if (node instanceof Element && node.localName === "math") return safeMath(node);
  if (node.nodeType === Node.TEXT_NODE)
    return document.createTextNode(node.textContent || "");
  if (node instanceof HTMLAnchorElement) {
    try {
      const url = new URL(node.href, document.baseURI);
      if (["http:", "https:"].includes(url.protocol)) {
        const link = document.createElement("a");
        link.href = url.href;
        link.textContent = node.textContent;
        link.rel = "noopener noreferrer";
        return link;
      }
    } catch {
      /* Render unsafe links as text. */
    }
  }
  const tag =
    node instanceof HTMLElement &&
    ["CODE", "KBD", "SAMP", "Q"].includes(node.tagName)
      ? node.tagName.toLowerCase()
      : "span";
  const span = document.createElement(tag);
  if (node instanceof HTMLElement && tag !== "span")
    span.className = node.className;
  for (const child of node.childNodes) span.append(safeCitation(child));
  return span;
}
export function renderTranslation(
  target: HTMLElement,
  text: string,
  protectedText: ProtectedText,
) {
  const tokens = [...protectedText.citations.keys()];
  for (const token of tokens)
    if (text.split(token).length !== 2)
      throw new Error("引用标记未完整保留，请重试");
  target.replaceChildren();
  const pattern = /\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(offset, match.index)));
    const original = protectedText.citations.get(match[0]);
    target.append(
      original ? safeCitation(original) : document.createTextNode(match[0]),
    );
    offset = match.index! + match[0].length;
  }
  target.append(document.createTextNode(text.slice(offset)));
}
