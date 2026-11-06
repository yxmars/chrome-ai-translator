import { it, expect, vi, beforeEach } from "vitest";
import { paragraphs, placeTranslation } from "../../src/content/dom";
beforeEach(() => vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList));
it("collects arXiv, HTML figure and table captions once, including nested paragraphs", () => {
  document.body.innerHTML = '<figure><figcaption id="arxiv" class="ltx_caption"><span>Figure 4:</span> Scale and diversity of RoboAtom-Data. (a) Annotation word cloud.</figcaption></figure><figure><figcaption id="nested"><p>Figure 5: This caption contains nested paragraphs.</p><p>Additional panel description belongs to the same caption.</p></figcaption></figure><table><caption id="table">Table 1: Results on robot learning benchmarks.</caption><tbody><tr><td>Values</td></tr></tbody></table><div id="legacy" class="ltx_caption">Table 2: Legacy LaTeXML table caption.</div><section class="ltx_bibliography"><figcaption>Reference caption must not be translated.</figcaption></section>';
  expect(paragraphs().map(el => el.id)).toEqual(["arxiv", "nested", "table", "legacy"]);
});
it("places translation below caption text without changing table structure or source nodes", () => {
  document.body.innerHTML = '<table><caption>Table 1: Results on robot learning benchmarks.</caption><tbody><tr><td>Value</td></tr></tbody></table>';
  const el = document.querySelector("caption")!;
  const original = el.firstChild;
  const translation = document.createElement("div");
  translation.dataset.cait = "translation";
  translation.textContent = "表1：机器人学习基准测试结果";
  placeTranslation(el, translation);
  expect(el.firstChild).toBe(original);
  expect(translation.parentElement).toBe(el);
  expect(document.querySelector("table > div")).toBeNull();
  expect(paragraphs()).toHaveLength(0);
  translation.remove();
  expect(el.textContent).toBe("Table 1: Results on robot learning benchmarks.");
  expect(paragraphs()).toEqual([el]);
});
