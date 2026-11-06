import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
test("selection retries a whole failed paragraph inline after automatic retries are exhausted", async () => {
  const seen: string[] = [];
  let failedCalls = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<main><p id="failed">Failed paragraph with a <em>selected phrase</em> and more original context <cite><a href="#bib">Smith (2025)</a></cite>.</p><p id="normal">Normal successfully translated paragraph remains a normal selection.</p></main>',
      );
      return;
    }
    let body = "";
    for await (const c of req) body += c;
    const text = JSON.parse(body).text;
    seen.push(text);
    res.setHeader("Content-Type", "application/json");
    if (text.startsWith("Failed paragraph") && ++failedCalls <= 3) {
      res.statusCode = 503;
      res.end("{}");
      return;
    }
    const tokens = text.match(/\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g) || [];
    res.end(
      JSON.stringify({
        text: "整段译文恢复成功 " + tokens.join(" "),
        detectedLanguage: "en",
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-selection-retry-"));
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
      { ...defaults, mode: "gateway", endpoint: origin },
    );
    const page = await context.newPage();
    await page.goto(origin);
    const original = await page.locator("#failed").innerHTML();
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
    await expect(page.getByRole("button", { name: "重试此段" })).toBeVisible();
    expect(failedCalls).toBe(3);
    await expect(page.locator("[data-cait-progress]")).toContainText("失败 1");
    await page.locator("#failed em").dblclick({position:{x:8,y:8}});
    await page
      .getByRole("button", { name: "重译失败段落", exact: true })
      .click({timeout:5000});
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.locator('#failed + [data-cait="translation"]'),
    ).toContainText("整段译文恢复成功");
    await expect(
      page.locator('#failed + [data-cait="translation"]'),
    ).toContainText("Smith (2025)");
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(2);
    expect(failedCalls).toBe(4);
    expect(seen.filter((t) => t.startsWith("Failed paragraph"))).toHaveLength(
      4,
    );
    expect(seen).not.toContain("selected");
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "翻译完成 2/2",
    );
    expect(await page.locator("#failed").innerHTML()).toBe(original);
    await page.locator("#normal").click({ clickCount: 3 });
    await page.getByRole("button", { name: "翻译选中文本" }).click();
    await expect(page.getByRole("dialog")).toContainText("整段译文恢复成功");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      id,
    );
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(0);
    expect(await page.locator("#failed").innerHTML()).toBe(original);
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
