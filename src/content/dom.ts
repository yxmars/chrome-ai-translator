const excluded =
  'pre,code,kbd,samp,textarea,input,select,button,script,style,noscript,svg,math,nav,header,footer,aside,blockquote,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-cait],[role="doc-bibliography"],[role="doc-biblioentry"],.ltx_bibliography,.ltx_biblist,.ltx_bibitem,#references,#bibliography,#article-notes';
const descendantExcluded = excluded.replace("code,kbd,samp,", "");
const isReferenceHeading = (text: string) =>
  /^(references|bibliography|works cited|literature cited|参考文献|引用文献|参考资料)$/i.test(
    text.trim().replace(/^\d+(?:\.\d+)*\.?\s*/, ""),
  );
export function paragraphs(
  root: ParentNode = document,
  minLength = 20,
): HTMLElement[] {
  const result: HTMLElement[] = [];
  let referenceLevel: number | undefined;
  for (const el of root.querySelectorAll<HTMLElement>(
    "p,li,blockquote,h1,h2,h3,h4,h5,h6",
  )) {
    if (el.closest(excluded + ',cite,[role="doc-biblioref"]')) continue;
    if (/^H[1-6]$/.test(el.tagName)) {
      const level = Number(el.tagName[1]);
      if (isReferenceHeading(el.textContent || "")) {
        referenceLevel =
          referenceLevel === undefined
            ? level
            : Math.min(referenceLevel, level);
        continue;
      }
      if (referenceLevel !== undefined && level <= referenceLevel)
        referenceLevel = undefined;
    }
    if (referenceLevel !== undefined || el.matches("h4,h5,h6")) continue;
    if (
      el.querySelector(descendantExcluded) ||
      el.querySelector("p,li,blockquote,h1,h2,h3")
    )
      continue;
    if (
      (el.textContent?.trim().length || 0) < minLength ||
      (el.textContent?.length || 0) > 12000 ||
      !el.getClientRects().length
    )
      continue;
    const prose = el.cloneNode(true) as HTMLElement;
    prose
      .querySelectorAll('code,kbd,samp,cite,[role="doc-biblioref"]')
      .forEach((node) => node.remove());
    if (!prose.textContent?.trim()) continue;
    result.push(el);
  }
  return result;
}

export function placeTranslation(el: HTMLElement, node: HTMLElement) {
  const parent = el.parentElement;
  const heading = /^H[1-6]$/.test(el.tagName);
  const grouped =
    parent &&
    /^(inline-)?(flex|grid)$/.test(getComputedStyle(parent).display) &&
    parent.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li").length === 1;
  if (heading && grouped) parent.after(node);
  else el.after(node);
}
