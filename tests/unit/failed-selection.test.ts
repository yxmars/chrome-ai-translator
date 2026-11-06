import { it, expect, beforeEach } from "vitest";
import { failedParagraphsInRange } from "../../src/content/failed-selection";
beforeEach(() => {
  document.body.innerHTML =
    '<p id="a">First <em>failed phrase</em> in the original paragraph.</p><div id="error">Translation failed. Retry.</div><p id="b">Second failed original paragraph.</p><p id="ok">Successful normal paragraph.</p>';
});
it("matches a selected phrase nested inside a failed original paragraph", () => {
  const a = document.querySelector<HTMLElement>("#a")!;
  const range = document.createRange();
  range.selectNodeContents(a.querySelector("em")!);
  expect(failedParagraphsInRange(range, [a])).toEqual([a]);
});
it("supports selecting multiple failed originals but ignores error UI and unrelated paragraphs", () => {
  const a = document.querySelector<HTMLElement>("#a")!,
    b = document.querySelector<HTMLElement>("#b")!;
  const range = document.createRange();
  range.setStart(a.firstChild!, 0);
  range.setEnd(b.firstChild!, 6);
  expect(failedParagraphsInRange(range, [a, b])).toEqual([a, b]);
  range.selectNodeContents(document.querySelector("#error")!);
  expect(failedParagraphsInRange(range, [a, b])).toEqual([]);
  range.selectNodeContents(document.querySelector("#ok")!);
  expect(failedParagraphsInRange(range, [a, b])).toEqual([]);
});
it("ignores collapsed selections and removed source paragraphs", () => {
  const a = document.querySelector<HTMLElement>("#a")!;
  const range = document.createRange();
  range.selectNodeContents(a);
  range.collapse(true);
  expect(failedParagraphsInRange(range, [a])).toEqual([]);
  a.remove();
  expect(failedParagraphsInRange(range, [a])).toEqual([]);
});
