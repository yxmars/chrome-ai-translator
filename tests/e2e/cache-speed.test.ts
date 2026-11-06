import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { defaults } from "../../src/shared/types";
test("measures same-page cache completion and API calls", async () => {
  let requests = 0,
    block = false;
  let release = () => {};
  let gate = Promise.resolve();
  const count = 150;
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      requests++;
      let body = "";
      for await (const part of req) body += part;
      if (block && JSON.parse(body).text.includes("uncached changed"))
        await gate;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ text: "缓存性能测试译文", detectedLanguage: "en" }),
      );
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<main>" +
          Array.from(
            { length: count },
            (_, i) =>
              `<p>Paragraph ${i} provides enough ordinary source text for a cache performance measurement.</p>`,
          ).join("") +
          "</main>",
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile = await mkdtemp(resolve(tmpdir(), "cait-cache-speed-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
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
    const toggle = () =>
      worker.evaluate(
        async (id) => chrome.tabs.sendMessage(id, { type: "TOGGLE_PAGE" }),
        id,
      );
    const measure = async () => {
      const t = Date.now();
      await toggle();
      await expect(page.locator("[data-cait-progress]")).toContainText(
        "翻译完成",
        { timeout: 30000 },
      );
      return Date.now() - t;
    };
    const coldMs = await measure(),
      coldRequests = requests;
    await toggle();
    const warmMs = await measure();
    expect(requests).toBe(coldRequests);
    expect(coldRequests).toBe(count);
    console.log(
      JSON.stringify({
        paragraphs: count,
        coldMs,
        warmMs,
        warmNewApiRequests: requests - coldRequests,
      }),
    );
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "缓存 150",
    );
    await toggle();
    await page
      .locator("p")
      .first()
      .evaluate(
        (el) =>
          (el.textContent =
            "A newly uncached changed paragraph must wait for its model response."),
      );
    block = true;
    gate = new Promise<void>((r) => {
      release = r;
    });
    await toggle();
    await expect(
      page.locator("p").last().locator("xpath=following-sibling::*[1]"),
    ).toContainText("缓存性能测试译文");
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "缓存 149",
    );
    await expect(
      page.getByRole("progressbar", { name: "网页翻译进度" }),
    ).toHaveAttribute("value", "149");
    release();
    await expect(page.locator("[data-cait-progress]")).toContainText(
      "翻译完成",
    );
    expect(requests).toBe(coldRequests + 1);
  } finally {
    release();
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(profile, { recursive: true, force: true });
  }
});
