import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
test("Macrodata inline-code paragraphs translate, selection repairs inline, and reload reuses persistent cache", async () => {
  const snapshot = process.env.CAIT_MACRODATA_SNAPSHOT;
  const html = (
    await readFile(
      snapshot || resolve("tests/fixtures/macrodata-snippet.html"),
      "utf8",
    )
  ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let requests = 0;
  const texts: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const text = JSON.parse(body).text;
      texts.push(text);
      requests++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text:
            "正文译文：" +
            (text.match(/\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g) || []).join(" "),
          detectedLanguage: "en",
          usage: { inputTokens: 100, outputTokens: 20 },
        }),
      );
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-macrodata-"));
  const options = {
    channel: "chromium" as const,
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    let worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(
      async (s) => chrome.storage.local.set({ settings: s }),
      { ...defaults, endpoint: origin, mode: "gateway" },
    );
    let page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const start = async () =>
      worker.evaluate(async () => {
        const [t] = await chrome.tabs.query({ active: true });
        await chrome.scripting.executeScript({
          target: { tabId: t.id! },
          files: ["content.js"],
        });
        await chrome.tabs.sendMessage(t.id!, { type: "TOGGLE_PAGE" });
        return t.id!;
      });
    let id = await start();
    let baseline = page
        .locator("p")
        .filter({ hasText: "As a sanity-check baseline" }),
      similarity = page
        .locator("p")
        .filter({ hasText: "Our first non-trivial approach" });
    await expect(
      baseline.locator("xpath=following-sibling::*[1]"),
    ).toContainText("正文译文");
    await expect(
      similarity.locator("xpath=following-sibling::*[1]"),
    ).toContainText("正文译文");
    await expect(
      baseline.locator("xpath=following-sibling::*[1]").locator("code"),
    ).toHaveText(["5.77s", "0.070"]);
    await expect(
      similarity.locator("xpath=following-sibling::*[1]").locator("code"),
    ).toHaveText(["0.081"]);
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "翻译完成",
      { timeout: 20000 },
    );
    const initial = requests;
    expect(texts.some((t) => t.replace(/\s+/g," ").trim().startsWith("As a sanity-check baseline"))).toBe(
      true,
    );
    expect(
      texts.some((t) => t.replace(/\s+/g," ").trim().startsWith("Our first non-trivial approach")),
    ).toBe(true);
    // Remove a rendered result: it is not in the failed set, reproducing the reported missed-paragraph case.
    await baseline.evaluate((el) => el.nextElementSibling?.remove());
    await baseline.dblclick({ position: { x: 8, y: 8 } });
    await page
      .getByRole("button", { name: "翻译选中段落", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      baseline.locator("xpath=following-sibling::*[1]"),
    ).toContainText("正文译文");
    expect(requests).toBe(initial);
    const heading = page.getByRole("heading", {
      name: "Fixed-length baseline",
      exact: true,
    });
    if (await heading.count())
      expect(
        await heading.evaluate((el) =>
          el.nextElementSibling?.getAttribute("data-cait"),
        ),
      ).not.toBe("translation");
    await expect
      .poll(async () =>
        worker.evaluate(
          async () =>
            (
              (await chrome.storage.local.get("cacheInfo")).cacheInfo as
                { hits: number } | undefined
            )?.hits || 0,
        ),
      )
      .toBeGreaterThan(0);
    await baseline.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: "test-results/macrodata-fixed.png" });
    // Restart the entire browser/profile, not merely the document: cache must survive the worker.
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    id = await start();
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "翻译完成",
      { timeout: 20000 },
    );
    expect(requests).toBe(initial);
    console.log(
      JSON.stringify({
        page: snapshot
          ? "Macrodata live DOM snapshot"
          : "Macrodata paragraph fixture",
        firstPassRequests: initial,
        restartPassAdditionalRequests: requests - initial,
      }),
    );
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      id,
    );
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
