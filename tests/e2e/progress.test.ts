import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
test("page status shows progress, collapses without blocking reading, and clears on restore", async () => {
  let release: () => void = () => {};
  let gate = new Promise<void>((r) => {
    release = r;
  });
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      await gate;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ text: "译文完成", detectedLanguage: "en" }));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<main><p>First paragraph contains enough ordinary text for translation.</p><p>Second paragraph also contains enough ordinary text for translation.</p><button id="read" onclick="this.textContent=\'still works\'">Keep reading</button></main>',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-progress-"));
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
    const status = page.locator("[data-cait-progress]");
    await expect(status).toContainText("翻译中 0/2");
    await expect(
      page.getByRole("progressbar", { name: "网页翻译进度" }),
    ).toHaveAttribute("max", "2");
    await expect(status).toHaveCSS("pointer-events", "none");
    await page.screenshot({ path: "test-results/page-translation-status.png" });
    await page.getByRole("button", { name: "收起翻译状态" }).click();
    await expect(page.getByRole("progressbar")).toBeHidden();
    await page.locator("#read").click();
    await expect(page.locator("#read")).toHaveText("still works");
    release();
    await expect(status).toContainText("翻译完成 2/2");
    await page.getByRole("button", { name: "展开翻译状态" }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.getByRole("button", { name: "隐藏翻译状态" }).click();
    await expect(status).toBeHidden();
    await worker.evaluate(
      async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
      id,
    );
    await expect(page.locator('[data-cait="translation"]')).toHaveCount(0);
    await expect(status).toBeHidden();
  } finally {
    release();
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
