import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
import { pricingKey } from "../../src/translation/usage";
test("retry failed paragraphs and persist daily tokens/cost without charging local cache", async () => {
  const seen = new Map<string, number>();
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<main><p id="first">A permanent failure followed by a manual retry.</p></main>',
      );
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const text = JSON.parse(body).text;
    const count = (seen.get(text) || 0) + 1;
    seen.set(text, count);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (count === 1) {
      res.statusCode = text === "Transient retry example." ? 503 : 401;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        text: "重试成功：翻译结果",
        detectedLanguage: "en",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_cache_hit_tokens: 40,
        },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-retry-"));
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
    const settings = {
      ...defaults,
      mode: "gateway" as const,
      endpoint: origin + "/translate",
      model: "mock",
    };
    settings.prices = {
      [pricingKey(settings)]: {
        currency: "CNY",
        input: 2,
        cachedInput: 0.2,
        cacheWrite: 2.5,
        output: 3,
      },
    };
    await worker.evaluate(
      async (s) => chrome.storage.local.set({ settings: s }),
      settings,
    );
    const article = await context.newPage();
    await article.goto(origin);
    const tabId = await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true });
      await chrome.scripting.executeScript({
        target: { tabId: t.id! },
        files: ["content.js"],
      });
      return t.id!;
    });
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      tabId,
    );
    await expect(
      article.getByRole("button", { name: "重试此段" }),
    ).toBeVisible();
    expect(seen.get("A permanent failure followed by a manual retry.")).toBe(1);
    await article.getByRole("button", { name: "重试此段" }).click();
    await expect(article.locator('[data-cait="translation"]')).toContainText(
      "重试成功",
    );
    const panel = await context.newPage();
    await panel.goto(
      `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
    );
    await expect(panel.getByTestId("usage-total")).toContainText("120");
    await expect(panel.getByLabel("用量与费用")).toContainText("CNY 0.000188");
    await panel.getByLabel("待翻译文本").fill("Transient retry example.");
    await panel.getByRole("button", { name: "翻译文本", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("识别源语言");
    expect(seen.get("Transient retry example.")).toBe(2);
    await expect(panel.getByTestId("usage-total")).toContainText("240");
    await panel.getByRole("button", { name: "翻译文本", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("识别源语言");
    expect(seen.get("Transient retry example.")).toBe(2);
    await expect(panel.getByLabel("用量与费用")).toContainText("CNY 0.000376");
    await panel.getByLabel("待翻译文本").fill("Manual side panel retry.");
    await panel.getByRole("button", { name: "翻译文本", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("401");
    await panel.getByRole("button", { name: "重试翻译", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("识别源语言");
    await expect(panel.getByTestId("usage-total")).toContainText("360");
    await expect(panel.getByLabel("用量与费用")).toContainText("CNY 0.000564");
    await panel.getByLabel("开始日期").fill("2099-01-01");
    await expect(panel.getByTestId("usage-total")).toContainText("Token：0");
    await panel.getByLabel("开始日期").fill("");
    await panel.getByRole("button", { name: "清除缓存与记录" }).click();
    await panel.reload();
    await expect(panel.getByTestId("usage-total")).toContainText("360");
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
