import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { defaults, type Settings } from "../../src/shared/types";
import { TranslationService } from "../../src/translation/service";
import { ProviderError, retryDelay } from "../../src/translation/retry";
import {
  readUsage,
  usageDay,
  estimateCost,
  UsageStore,
  pricingKey,
} from "../../src/translation/usage";
let store: Record<string, any>;
beforeEach(() => {
  store = { settings: { ...defaults, mode: "direct", apiKey: "fake" } };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]),
          ),
        ),
        set: vi.fn(async (v: object) => {
          Object.assign(store, structuredClone(v));
        }),
        remove: vi.fn(async (keys: string[]) =>
          keys.forEach((k) => delete store[k]),
        ),
      },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const success = () =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: '{"text":"你好","detectedLanguage":"en"}' } },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 40,
      },
    }),
  );
it("normalizes OpenAI and DeepSeek usage without double counting cached input", () => {
  expect(
    readUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_cache_hit_tokens: 40,
    }),
  ).toEqual({ input: 100, output: 20, cached: 40, cacheWrite: 0 });
  expect(
    readUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 10 },
    })?.cached,
  ).toBe(10);
});
it("includes Anthropic cache read and creation in input total", () => {
  expect(
    readUsage(
      {
        input_tokens: 30,
        output_tokens: 10,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 20,
      },
      true,
    ),
  ).toEqual({ input: 100, output: 10, cached: 50, cacheWrite: 20 });
});
it("marks missing and invalid usage unknown", () => {
  expect(readUsage({})).toBeUndefined();
  expect(
    readUsage({ prompt_tokens: -1, completion_tokens: 1 }),
  ).toBeUndefined();
});
it("uses Asia/Shanghai calendar day at UTC rollover", () => {
  expect(usageDay(Date.parse("2026-11-05T16:00:00Z"))).toBe("2026-11-06");
  expect(usageDay(Date.parse("2026-11-05T15:59:59Z"))).toBe("2026-11-05");
});
it("prices normal, cache-read, cache-write and output separately", () => {
  expect(
    estimateCost(
      { input: 1000000, output: 100000, cached: 200000, cacheWrite: 100000 },
      {
        currency: "CNY",
        input: 2,
        cachedInput: 0.2,
        cacheWrite: 2.5,
        output: 3,
      },
    ),
  ).toBeCloseTo(1.99);
});
it("respects Retry-After and refuses excessively long waits and permanent errors", () => {
  expect(retryDelay(new ProviderError("429", true, 3000), 0)).toBe(3000);
  expect(retryDelay(new ProviderError("429", true, 60000), 0)).toBeNull();
  expect(retryDelay(new ProviderError("401"), 0)).toBeNull();
});
it("retries transient HTTP errors, records attempts, and excludes local cache hits", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockImplementation(async () => success()),
  );
  const service = new TranslationService();
  const task = service.translate("hello");
  await vi.runAllTimersAsync();
  expect((await task).text).toBe("你好");
  await service.translate("hello");
  expect(fetch).toHaveBeenCalledTimes(2);
  const rows = (await service.state()).usage;
  expect(rows[0]).toMatchObject({
    attempts: 2,
    failures: 1,
    successes: 1,
    input: 100,
    output: 20,
    missingUsage: 1,
    cost: null,
  });
});
it("does not retry invalid credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 401 })),
  );
  await expect(new TranslationService().translate("hello")).rejects.toThrow(
    "401",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("stops at configured retry limit", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
  const result = expect(
    new TranslationService().translate("hello"),
  ).rejects.toThrow("503");
  await vi.runAllTimersAsync();
  await result;
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("accounts for malformed billable model responses before retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "invalid json" } }],
            usage: { prompt_tokens: 50, completion_tokens: 5 },
          }),
        ),
      )
      .mockImplementation(async () => success()),
  );
  const service = new TranslationService();
  const task = service.translate("hello");
  await vi.runAllTimersAsync();
  await task;
  const [row] = (await service.state()).usage;
  expect(row.input).toBe(150);
  expect(row.output).toBe(25);
  expect(row.failures).toBe(1);
});
it("serializes concurrent usage writes and survives restart/cache clearing", async () => {
  const service = new UsageStore();
  const s = store.settings as Settings;
  const u = { input: 10, output: 5, cached: 0, cacheWrite: 0 };
  await Promise.all(
    Array.from({ length: 20 }, () => service.record(s, true, u)),
  );
  expect((await new UsageStore().list())[0]).toMatchObject({
    attempts: 20,
    input: 200,
    output: 100,
  });
  await new TranslationService().clear();
  expect((await new UsageStore().list())[0].attempts).toBe(20);
});
it("snapshots prices and separates currencies and dates", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  const s = store.settings as Settings;
  const identity = pricingKey(s);
  s.prices = {
    [identity]: {
      currency: "CNY",
      input: 2,
      cachedInput: 0,
      cacheWrite: 0,
      output: 4,
    },
  };
  const usage = new UsageStore();
  await usage.record(s, true, {
    input: 1000000,
    output: 0,
    cached: 0,
    cacheWrite: 0,
  });
  s.prices[identity] = {
    currency: "USD",
    input: 1,
    cachedInput: 0,
    cacheWrite: 0,
    output: 3,
  };
  vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
  await usage.record(s, true, {
    input: 1000000,
    output: 0,
    cached: 0,
    cacheWrite: 0,
  });
  const rows = await usage.list();
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.date === "2026-11-06")?.cost).toBe(2);
  expect(rows.find((r) => r.date === "2026-11-07")?.price?.currency).toBe(
    "USD",
  );
});
