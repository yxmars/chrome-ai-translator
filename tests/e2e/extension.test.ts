import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
let context: BrowserContext,
  worker: Worker,
  server: Server,
  origin: string,
  profile: string;
let requests = 0;
let extensionPath: string;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Content-Type",
      req.url === "/translate" ? "application/json" : "text/html",
    );
    if (req.url === "/translate") {
      requests++;
      setTimeout(
        () =>
          res.end(
            JSON.stringify({
              text: "译文：Transformer（变换器架构）让阅读更简单。<img src=x onerror=alert(1)>",
              detectedLanguage: "en",
            }),
          ),
        100,
      );
    } else
      res.end(
        '<!doctype html><html><body><main><h1>A practical guide to machine learning systems</h1><p id="first">Transformer models help engineers build useful translation systems.</p><p id="second">Robots can navigate complex environments with modern sensors.</p><pre><code id="code">Never translate this source code sample.</code></pre><textarea>Never translate this editable text.</textarea><div contenteditable="true">Never translate this editor content.</div><button id="original" onclick="this.textContent=\'Original listener works\'">Original button</button></main></body></html>',
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  profile = await mkdtemp(resolve(tmpdir(), "cait-e2e-"));
  extensionPath = resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      "--enable-unsafe-extension-debugging",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async (endpoint) => {
    await chrome.storage.local.set({
      settings: {
        provider: "openai",
        endpoint,
        model: "mock",
        source: "auto",
        target: "zh-CN",
        domain: "ai",
        explainTerms: true,
        mode: "gateway",
        apiKey: "",
      },
    });
  }, `${origin}/translate`);
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (profile) await rm(profile, { recursive: true, force: true });
});
test("real extension: selection, popup, safe text, outside dismissal, bilingual restore", async () => {
  const page = await context.newPage();
  await page.goto(origin);
  await page.bringToFront();
  // A stale overlay left after extension reload must not block reinjection.
  await page.evaluate(() => {
    const old = document.createElement("div");
    old.dataset.cait = "host";
    document.documentElement.append(old);
  });
  await worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true });
    await chrome.scripting.executeScript({
      target: { tabId: t.id! },
      files: ["content.js"],
    });
  });
  await expect(page.locator('[data-cait="host"]')).toHaveCount(1);
  const p = page.locator("#first");
  await p.click({ clickCount: 3 });
  await page.getByRole("button", { name: "翻译选中文本" }).click();
  await expect(page.getByRole("dialog")).toContainText("译文：Transformer");
  await expect(page.getByRole("dialog").locator("img")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("<img");
  await expect(
    page.getByRole("button", { name: "复制", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  await page.locator("h1").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tabId = await worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true });
    return t.id!;
  });
  await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
    tabId,
  );
  await expect(page.locator('[data-cait="translation"]')).toHaveCount(3);
  await expect(page.locator('[data-cait="translation"]').first()).toContainText(
    "译文",
  );
  await expect(page.locator("pre [data-cait]")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveValue(
    "Never translate this editable text.",
  );
  await page.locator("#original").click();
  await expect(page.locator("#original")).toHaveText("Original listener works");
  await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
    tabId,
  );
  await expect(page.locator('[data-cait="translation"]')).toHaveCount(0);
  await expect(p).toHaveText(
    "Transformer models help engineers build useful translation systems.",
  );
  const before = requests;
  await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
    tabId,
  );
  await expect(page.locator('[data-cait="translation"]')).toHaveCount(3);
  await expect(page.locator('[data-cait="translation"]').last()).toContainText(
    "译文",
  );
  expect(requests).toBe(before);
  await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
    tabId,
  );
  await page.locator("main").evaluate((el) => {
    el.textContent = "";
  });
  const empty = await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
    tabId,
  );
  expect(empty.enabled).toBe(false);
  expect(empty.error).toContain("未找到可翻译");
  await page.close();
});
test("side panel renders saved settings, history and clears local data", async () => {
  const id = new URL(worker.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await expect(
    panel.getByRole("heading", { name: "让语言不再是边界" }),
  ).toBeVisible();
  await expect(panel.getByLabel("待翻译文本")).toBeVisible();
  await expect(
    panel.getByText(
      "Transformer models help engineers build useful translation systems.",
      { exact: true },
    ),
  ).toBeVisible();
  await panel
    .getByLabel("待翻译文本")
    .fill("A new text entered from the side panel.");
  await panel.getByRole("button", { name: "翻译文本", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("识别源语言：en");
  await expect(
    panel.getByRole("button", { name: "复制译文", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "清除缓存与记录" }).click();
  await expect(panel.getByText("还没有翻译记录")).toBeVisible();
  await panel.getByRole("button", { name: "使用 DeepSeek V4.1 Flash" }).click();
  await expect(panel.getByLabel("Model", { exact: true })).toHaveValue(
    "deepseek-flash",
  );
  await expect(panel.getByLabel("API Endpoint（完整请求地址）")).toHaveValue(
    "https://api.deepseek.com/chat/completions",
  );
  await expect(
    panel.getByLabel("个人 API Key", { exact: true }),
  ).toHaveAttribute("type", "password");
  await panel.close();
});
