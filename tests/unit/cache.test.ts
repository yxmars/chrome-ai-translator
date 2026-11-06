import { it, expect } from "vitest";
import {
  TranslationCache,
  cacheIdentity,
  cacheKey,
} from "../../src/translation/cache";
import { defaults } from "../../src/shared/types";
const result = { text: "译文", detectedLanguage: "en" };
it("keeps substantially more than 100 entries across cache reopen", async () => {
  const cache = new TranslationCache();
  for (let i = 0; i < 160; i++) await cache.put("key" + i, result);
  expect((await cache.info()).entries).toBe(160);
  await cache.close();
  const reopened = new TranslationCache();
  expect(await reopened.get("key0")).toEqual(result);
  expect(await reopened.get("key159")).toEqual(result);
  expect((await reopened.info()).hits).toBe(2);
  await reopened.close();
});
it("evicts least recently used entries instead of frequently reused ones", async () => {
  const cache = new TranslationCache(2, 4096);
  await cache.put("a", result);
  await cache.put("b", result);
  await cache.get("a");
  await cache.put("c", result);
  expect(await cache.get("b")).toBeUndefined();
  expect(await cache.get("a")).toEqual(result);
  expect((await cache.info()).entries).toBe(2);
  await cache.close();
});
it("enforces byte limit and ignores oversized values", async () => {
  const cache = new TranslationCache(100, 300);
  for (let i = 0; i < 5; i++)
    await cache.put(String(i), {
      text: "x".repeat(100),
      detectedLanguage: "en",
    });
  expect((await cache.info()).bytes).toBeLessThanOrEqual(300);
  expect((await cache.info()).entries).toBeGreaterThan(0);
  await cache.put("huge", { text: "x".repeat(1000), detectedLanguage: "en" });
  expect(await cache.get("huge")).toBeUndefined();
  await cache.close();
});
it("normalizes spacing and language-code case but isolates models, target and domain", async () => {
  const a = await cacheKey(cacheIdentity(defaults, " Hello   world! "));
  expect(
    await cacheKey(
      cacheIdentity({ ...defaults, target: "ZH-cn" }, "Hello world!"),
    ),
  ).toBe(a);
  for (const s of [
    { ...defaults, model: "different" },
    { ...defaults, target: "ja" },
    { ...defaults, domain: "robotics" as const },
  ])
    expect(await cacheKey(cacheIdentity(s, "Hello world!"))).not.toBe(a);
});
it("migrates existing Storage API cache and clears without retaining hits", async () => {
  const cache = new TranslationCache();
  const old = JSON.stringify([
    defaults.provider,
    defaults.endpoint,
    defaults.model,
    defaults.source,
    defaults.target,
    defaults.domain,
    defaults.explainTerms,
    defaults.mode,
    "hello",
  ]);
  await cache.migrate({ [old]: result });
  expect(
    await cache.get(await cacheKey(cacheIdentity(defaults, "hello"))),
  ).toEqual(result);
  await cache.clear();
  expect((await cache.info()).entries).toBe(0);
  expect((await cache.info()).hits).toBe(0);
  await cache.close();
});

it("reads a whole page in one batch and preserves position/miss accounting", async () => {
  const cache = new TranslationCache();
  await cache.put("first", result);
  await cache.put("last", { text: "最后", detectedLanguage: "en" });
  expect(await cache.getMany(["first", "missing", "last", "first"])).toEqual([
    result,
    undefined,
    { text: "最后", detectedLanguage: "en" },
    result,
  ]);
  const info = await cache.info();
  expect(info.hits).toBe(3);
  expect(info.misses).toBe(1);
  await cache.close();
});
