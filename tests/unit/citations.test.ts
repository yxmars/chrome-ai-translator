import { readFileSync } from "node:fs";
import { it, expect, vi, beforeEach } from "vitest";
import { paragraphs } from "../../src/content/dom";
import {
  protectCitations,
  renderTranslation,
} from "../../src/content/citations";
import { parseResult } from "../../src/translation/providers";
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
it("skips semantic arXiv bibliography and quoted blocks while keeping prose with inline citations", () => {
  document.body.innerHTML =
    '<p id="body">This ordinary prose cites <cite>Smith et al. (2025)</cite> and should translate.</p><section class="ltx_bibliography"><h2>References</h2><p>Smith. A sufficiently long research title.</p><ul><li>Jones. Another long reference entry here.</li></ul></section><blockquote><p>A quoted passage that should remain unchanged.</p></blockquote>';
  expect(paragraphs().map((n) => n.id)).toEqual(["body"]);
});
it("skips heading-delimited references and resumes at the next peer section", () => {
  document.body.innerHTML =
    '<h2>7 References</h2><p>Reference content that must not be translated.</p><h3>Additional source group</h3><p>Another reference entry to keep unchanged.</p><h2>Appendix A: Experimental Details</h2><p id="appendix">An ordinary appendix paragraph should translate.</p>';
  expect(paragraphs().some((n) => n.id === "appendix")).toBe(true);
  expect(
    paragraphs()
      .filter((n) => n.tagName === "P")
      .map((n) => n.id),
  ).toEqual(["appendix"]);
});
it("recognizes Chinese references and bibliography headings", () => {
  for (const heading of ["参考文献", "Bibliography", "Works Cited"]) {
    document.body.innerHTML = `<h2>${heading}</h2><p>A research reference entry remains in the original.</p>`;
    expect(paragraphs()).toHaveLength(0);
  }
});
it("protects citation elements, links, quotes and numeric markers using stable placeholders", () => {
  document.body.innerHTML =
    '<p>Models <cite><a href="#bib1">Smith (2025)</a></cite> support robots [2–4] and <q>quoted text</q>.</p>';
  const el = document.querySelector("p")!;
  const before = el.innerHTML;
  const prepared = protectCitations(el);
  expect(prepared.text).not.toContain("Smith");
  expect(prepared.text).not.toContain("[2–4]");
  expect(prepared.text).not.toContain("quoted text");
  expect(protectCitations(el).text).toBe(prepared.text);
  const target = document.createElement("div");
  renderTranslation(target, prepared.text, prepared);
  expect(target.textContent).toBe(el.textContent);
  expect(target.querySelector("a")?.getAttribute("href")).toContain("#bib1");
  expect(el.innerHTML).toBe(before);
});
it("never interprets translated HTML or copies citation event handlers", () => {
  document.body.innerHTML =
    '<p>Source <a href="#bib1" onclick="alert(1)">[1]</a></p>';
  const prepared = protectCitations(document.querySelector("p")!);
  const target = document.createElement("div");
  renderTranslation(
    target,
    prepared.text + "<img src=x onerror=alert(1)>",
    prepared,
  );
  expect(target.querySelector("img")).toBeNull();
  expect(target.querySelector("a")?.hasAttribute("onclick")).toBe(false);
});
it("rejects missing or duplicate placeholders so provider retries can preserve citations", () => {
  const text = "Example [CAIT_CITE_abc_0]";
  expect(() =>
    parseResult('{"text":"missing citation","detectedLanguage":"en"}', text),
  ).toThrow();
  expect(() =>
    parseResult(
      '{"text":"[CAIT_CITE_abc_0] [CAIT_CITE_abc_0]","detectedLanguage":"en"}',
      text,
    ),
  ).toThrow();
  expect(
    parseResult(JSON.stringify({ text, detectedLanguage: "en" }), text).text,
  ).toBe(text);
});

it("includes the reported RoboAtom paragraph and safely preserves inline MathML", () => {
  document.body.innerHTML = readFileSync("tests/fixtures/roboatom-paragraph.html", "utf8");
  const el = document.querySelector("p")!;
  const original = el.innerHTML;
  expect(paragraphs()).toEqual([el]);
  const prepared = protectCitations(el);
  expect(prepared.text).not.toContain("\\pi");
  expect(prepared.citations.size).toBe(10);
  const target = document.createElement("div");
  renderTranslation(target, prepared.text, prepared);
  expect(target.querySelector("math msub mi")?.textContent).toBe("π");
  expect(target.querySelector("math msub mn")?.textContent).toBe("0.5");
  expect(target.querySelector("annotation")).toBeNull();
  expect(target.querySelector("math")?.id).toBe("");
  expect(el.innerHTML).toBe(original);
});
it("skips math-only paragraphs and never copies active MathML content", () => {
  document.body.innerHTML = '<p><math><mi>longFormulaVariableName</mi></math></p><p id="prose">This paragraph has inline math <math onclick="alert(1)"><mi href="javascript:alert(1)">x</mi><annotation-xml><script>alert(1)</script></annotation-xml></math> and ordinary prose.</p>';
  expect(paragraphs().map(el => el.id)).toEqual([]); // script-containing paragraphs remain excluded
  const el = document.querySelector<HTMLElement>("#prose")!;
  const prepared = protectCitations(el);
  const target = document.createElement("div");
  renderTranslation(target, prepared.text, prepared);
  expect(target.querySelector("script,annotation-xml,[onclick],[href]")).toBeNull();
  expect(target.querySelector("math mi")?.textContent).toBe("x");
});
