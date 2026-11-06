import { it, expect, vi, beforeEach } from "vitest";
import { paragraphs, placeTranslation } from "../../src/content/dom";
import {
  protectCitations,
  renderTranslation,
} from "../../src/content/citations";
import { bilingualTargetsInRange } from "../../src/content/failed-selection";
beforeEach(() =>
  vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList),
);
it("includes prose with inline code while excluding standalone code blocks", () => {
  document.body.innerHTML =
    '<p id="baseline">As a baseline, the duration is <code>5.77s</code> with score <code>0.070</code>.</p><p id="similarity">Similarity approach <a href="#ref-a">Suzuki (2026)</a> reaches <code>0.081</code> F1.</p><pre><code>This source code should never be translated.</code></pre><p><code>Standalone source snippet must remain unchanged.</code></p><section id="article-notes"><div>References</div><ol><li>Macrodata reference entry should not be translated.</li></ol></section>';
  expect(paragraphs().map((el) => el.id)).toEqual(["baseline", "similarity"]);
  const el = document.querySelector<HTMLElement>("#baseline")!;
  const prepared = protectCitations(el);
  expect(prepared.text).not.toContain("5.77s");
  const target = document.createElement("div");
  renderTranslation(
    target,
    "译文 " + Array.from(prepared.citations.keys()).join(" "),
    prepared,
  );
  expect(target.querySelectorAll("code")).toHaveLength(2);
  expect(target.textContent).toContain("5.77s");
});
it("a partial phrase in an untracked/missed paragraph is an inline bilingual target", () => {
  document.body.innerHTML =
    '<p id="missed">The missed paragraph contains <em>some selected words</em> and <code>0.081</code>.</p>';
  const el = document.querySelector<HTMLElement>("#missed")!;
  const range = document.createRange();
  range.selectNodeContents(el.querySelector("em")!);
  expect(bilingualTargetsInRange(range, paragraphs())).toEqual([el]);
});
it("places heading translations below the flex heading wrapper without modifying its layout", () => {
  document.body.innerHTML =
    '<div id="wrapper" style="display:flex"><h3>Fixed-length baseline heading</h3><button>Link</button></div><p>Normal article paragraph with enough prose.</p>';
  const wrapper = document.querySelector<HTMLElement>("#wrapper")!,
    heading = wrapper.querySelector("h3")!,
    node = document.createElement("div");
  placeTranslation(heading, node);
  expect(wrapper.nextElementSibling).toBe(node);
  expect(wrapper.style.display).toBe("flex");
  expect(wrapper.contains(node)).toBe(false);
});
it("uses stable protected tokens across harmless whitespace variations", () => {
  const a = document.createElement("p"),
    b = document.createElement("p");
  a.innerHTML = "Baseline  <code>5.77s</code> value.";
  b.innerHTML = "Baseline <code>5.77s</code> value.";
  const tokens = (el: HTMLElement) => [
    ...protectCitations(el).citations.keys(),
  ];
  expect(tokens(a)).toEqual(tokens(b));
});
