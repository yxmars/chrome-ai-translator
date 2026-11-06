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
  private cache: Record<string, Translation> = {};
  private pending = new Map<string, Promise<Translation>>();
  private history: HistoryItem[] = [];
  private epoch = 0;
  private usage = new UsageStore();
  private ready = this.restore();
  private async restore() {
    const d = await chrome.storage.local.get<{
      cache?: Record<string, Translation>;
      history?: HistoryItem[];
    }>(["cache", "history"]);
    this.cache = d.cache || {};
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
    };
  }
  async clear() {
    await this.ready;
    this.epoch++;
    this.cache = {};
    this.history = [];
    await chrome.storage.local.remove(["cache", "history"]);
  }
  async translate(text: string, force=false): Promise<Translation> {
    await this.ready;
    if (typeof text !== "string" || !text.trim() || text.length > 12000)
      throw new Error("请输入 1–12000 字符");
    const s = await this.settings();
    const key = JSON.stringify([
      s.provider,
      s.endpoint,
      s.model,
      s.source,
      s.target,
      s.domain,
      s.explainTerms,
      s.mode,
      text,
    ]);
    if (!force && this.cache[key]) return this.cache[key];
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
        this.cache[key] = result;
        const keys = Object.keys(this.cache);
        while (keys.length > 100) delete this.cache[keys.shift()!];
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
          cache: this.cache,
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
