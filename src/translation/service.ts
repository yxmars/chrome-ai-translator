import {
  defaults,
  type Settings,
  type Translation,
  type HistoryItem,
} from "../shared/types";
import {
  OpenAIProvider,
  AnthropicProvider,
  OpenAICompatibleProvider,
  GatewayProvider,
} from "./providers";
import { UsageStore } from "./usage";
import { ProviderError, retryDelay, sleep } from "./retry";
import { TranslationCache, cacheIdentity, cacheKey } from "./cache";
export class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit = 3) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((r) => this.waiting.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
const queue = new Semaphore(3);
export class TranslationService {
  private cache = new TranslationCache();
  private pending = new Map<string, Promise<Translation>>();
  private history: HistoryItem[] = [];
  private epoch = 0;
  private usage = new UsageStore();
  private ready = this.restore();
  private publishTimer?: ReturnType<typeof setTimeout>;
  private publishCache() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      void this.cache
        .info()
        .then((cacheInfo) => chrome.storage.local.set({ cacheInfo }))
        .catch(() => {});
    }, 250);
  }
  private async restore() {
    const d = await chrome.storage.local.get<{
      cache?: Record<string, Translation>;
      history?: HistoryItem[];
    }>(["cache", "history"]);
    if (d.cache) {
      await this.cache.migrate(d.cache);
      await chrome.storage.local.remove(["cache"]);
    }
    this.history = d.history || [];
  }
  async settings(): Promise<Settings> {
    return {
      ...defaults,
      ...(await chrome.storage.local.get<{ settings?: Settings }>("settings"))
        .settings,
    };
  }
  async state() {
    await this.ready;
    return {
      settings: await this.settings(),
      history: this.history,
      usage: await this.usage.list(),
      cacheInfo: await this.cache.info(),
    };
  }
  async clear() {
    await this.ready;
    this.epoch++;
    await this.cache.clear();
    this.publishCache();
    this.history = [];
    await chrome.storage.local.remove(["cache", "history"]);
  }
  async cached(texts: string[]): Promise<(Translation | null)[]> {
    await this.ready;
    if (
      !Array.isArray(texts) ||
      texts.length > 64 ||
      texts.some(
        (text) =>
          typeof text !== "string" || !text.trim() || text.length > 12000,
      ) ||
      texts.reduce((n, t) => n + t.length, 0) > 512000
    )
      throw new Error("缓存查询内容超出限制");
    const settings = await this.settings();
    const keys = await Promise.all(
      texts.map((text) => cacheKey(cacheIdentity(settings, text))),
    );
    const values = await this.cache.getMany(keys);
    this.publishCache();
    return values.map((value) => (value ? { ...value, cacheHit: true } : null));
  }
  async translate(text: string, force = false): Promise<Translation> {
    await this.ready;
    if (typeof text !== "string" || !text.trim() || text.length > 12000)
      throw new Error("请输入 1–12000 字符");
    const s = await this.settings();
    const key = await cacheKey(cacheIdentity(s, text));
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (!force) {
      const cached = await this.cache.get(key);
      if (cached) {
        this.publishCache();
        return { ...cached, cacheHit: true };
      }
    }
    if (this.pending.has(key)) return this.pending.get(key)!;
    const epoch = this.epoch;
    const task = queue.run(async () => {
      if (s.mode === "direct" && !s.apiKey)
        throw new Error("请先配置个人 API Key，或使用后端网关");
      const provider =
        s.mode === "gateway"
          ? new GatewayProvider()
          : s.provider === "anthropic"
            ? new AnthropicProvider()
            : s.provider === "compatible"
              ? new OpenAICompatibleProvider()
              : new OpenAIProvider();
      let result: Translation | undefined;
      const retryCount = Number.isInteger(s.retryCount)
        ? Math.min(3, Math.max(0, s.retryCount))
        : 2;
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        let response;
        try {
          response = await provider.translate(text, s);
        } catch (error) {
          await this.usage.record(
            s,
            false,
            error instanceof ProviderError ? error.usage : undefined,
          );
          const delay = retryDelay(error, attempt);
          if (attempt >= retryCount || delay === null) throw error;
          await sleep(delay);
          continue;
        }
        await this.usage.record(s, true, response.usage);
        result = {
          text: response.text,
          detectedLanguage: response.detectedLanguage,
        };
        break;
      }
      if (!result) throw new Error("翻译失败，请重试");
      if (epoch === this.epoch) {
        await this.cache.put(key, result);
        this.publishCache();
        this.history = [
          {
            ...result,
            text: result.text.replace(
              /\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g,
              "[引用]",
            ),
            original: text.replace(/\[CAIT_CITE_[a-zA-Z0-9]+_\d+\]/g, "[引用]"),
            time: Date.now(),
          },
          ...this.history,
        ].slice(0, 30);
        await chrome.storage.local.set({
          history: this.history,
        });
      }
      return result;
    });
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }
}
