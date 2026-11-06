import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
test("production manifest: all websites accessible without per-site authorization", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(resolve(tmpdir(), "cait-permissions-"));
  const api = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(
      JSON.stringify({
        text: "【测试译文】机器人奖励模型。",
        detectedLanguage: "en",
      }),
    );
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
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
    // Controlled document at the user's exact origin; no real model calls.
    if (process.env.CAIT_LIVE_ARXIV !== "1")
      await context.route("https://arxiv.org/html/2601.00675", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<main><p id="abstract">Reward models enable robots to learn from diverse demonstrations.</p></main>',
        }),
      );
    const article = await context.newPage();
    await article.goto("https://arxiv.org/html/2601.00675", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const tabId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      return tab.id!;
    });
    const denied = await worker.evaluate(async (id) => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: id },
          files: ["content.js"],
        });
        return false;
      } catch {
        return true;
      }
    }, tabId);
    expect(denied).toBe(false);
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
    );
    await expect(panel.getByLabel("网站地址", { exact: true })).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "授权网站", exact: true }),
    ).toHaveCount(0);
    expect(
      await worker.evaluate(() =>
        chrome.permissions.contains({ origins: ["https://arxiv.org/*"] }),
      ),
    ).toBe(true);
    await worker.evaluate(
      async (id) =>
        chrome.scripting.executeScript({
          target: { tabId: id },
          files: ["content.js"],
        }),
      tabId,
    );
    await expect(article.locator('[data-cait="host"]')).toHaveCount(1);
    await worker.evaluate(
      async (endpoint) =>
        chrome.storage.local.set({
          settings: {
            provider: "compatible",
            mode: "gateway",
            endpoint,
            model: "mock",
            source: "auto",
            target: "zh-CN",
            domain: "robotics",
            explainTerms: true,
            apiKey: "",
          },
        }),
      apiUrl,
    );
    const started = await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      tabId,
    );
    expect(started.enabled).toBe(true);
    expect(started.total).toBeGreaterThan(0);
    await expect(
      article.locator('[data-cait="translation"]').first(),
    ).toContainText("【测试译文】");
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      tabId,
    );
    await expect(article.locator('[data-cait="translation"]')).toHaveCount(0);
  } finally {
    await context.close();
    await new Promise<void>((r) => api.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
