import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
test("preserves inline citations and excludes references and quotations from API requests", async () => {
  const texts: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const text = JSON.parse(body).text;
      texts.push(text);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text:
            "机器人学习译文 " +
            (text.match(/\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g) || []).join(" "),
          detectedLanguage: "en",
        }),
      );
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<main><h1>Paper</h1><p id="body">Robots learn from demonstrations <cite><a href="#bib1" onclick="document.body.dataset.citationClicked=\'yes\'">Smith (2025)</a></cite> and datasets [2–4].</p><blockquote><p>Quoted passage should never be submitted to the translation API.</p></blockquote><h2>References</h2><p id="bib1">Smith. Reference title must remain in the original language.</p><h2>Appendix</h2><p id="appendix">Additional experiments should still be translated after references.</p></main>',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-citations-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(
      async (s) => chrome.storage.local.set({ settings: s }),
      { ...defaults, endpoint: origin, mode: "gateway" },
    );
    const page = await context.newPage();
    await page.goto(origin);
    const original = await page.locator("#body").innerHTML();
    const id = await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true });
      await chrome.scripting.executeScript({
        target: { tabId: t.id! },
        files: ["content.js"],
      });
      return t.id!;
    });
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      id,
    );
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(2);
    await expect(
      page.locator('[data-cait="translation"]').first(),
    ).toContainText("Smith (2025)");
    await expect(
      page.locator('[data-cait="translation"]').first(),
    ).toContainText("[2–4]");
    await expect(
      page.locator('[data-cait="translation"]').first().locator("a"),
    ).toHaveAttribute("href", origin + "/#bib1");
    expect(texts).toHaveLength(2);
    expect(texts.join(" ")).not.toContain("Smith");
    expect(texts.join(" ")).not.toContain("Reference title");
    expect(texts.join(" ")).not.toContain("Quoted passage");
    await page.locator("#body a").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-citation-clicked",
      "yes",
    );
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      id,
    );
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(0);
    expect(await page.locator("#body").innerHTML()).toBe(original);
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
