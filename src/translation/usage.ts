import type { Settings, TokenUsage, Price, UsageRow } from "../shared/types";
export function pricingKey(
  s: Pick<Settings, "provider" | "endpoint" | "model" | "mode">,
) {
  return JSON.stringify([s.mode, s.provider, s.endpoint, s.model]);
}
export function usageDay(time = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
export function readUsage(
  raw: unknown,
  anthropic = false,
): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return;
  const u = raw as Record<string, any>;
  const input = count(
    anthropic ? u.input_tokens : (u.prompt_tokens ?? u.inputTokens),
  );
  const output = count(
    anthropic ? u.output_tokens : (u.completion_tokens ?? u.outputTokens),
  );
  if (input === undefined || output === undefined) return;
  const cached =
    count(
      anthropic
        ? u.cache_read_input_tokens
        : (u.prompt_cache_hit_tokens ??
            u.prompt_tokens_details?.cached_tokens ??
            u.cachedInputTokens),
    ) || 0;
  const write =
    count(anthropic ? u.cache_creation_input_tokens : u.cacheWriteTokens) || 0;
  return {
    input: anthropic ? input + cached + write : input,
    output,
    cached: anthropic ? cached : Math.min(cached, input),
    cacheWrite: anthropic
      ? write
      : Math.min(write, Math.max(0, input - cached)),
  };
}
export function validPrice(p: unknown): p is Price {
  if (!p || typeof p !== "object") return false;
  const x = p as Price;
  return (
    ["CNY", "USD"].includes(x.currency) &&
    [x.input, x.cachedInput, x.cacheWrite, x.output].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1000000,
    )
  );
}
export function estimateCost(u: TokenUsage, p: Price) {
  return (
    ((u.input - u.cached - u.cacheWrite) * p.input +
      u.cached * p.cachedInput +
      u.cacheWrite * p.cacheWrite +
      u.output * p.output) /
    1000000
  );
}
export class UsageStore {
  private rows: Record<string, UsageRow> = {};
  private tail = Promise.resolve();
  private ready = this.restore();
  private async restore() {
    this.rows =
      (
        await chrome.storage.local.get<{
          usageStats?: Record<string, UsageRow>;
        }>("usageStats")
      ).usageStats || {};
  }
  async record(s: Settings, success: boolean, usage?: TokenUsage) {
    const job = this.tail.then(async () => {
      await this.ready;
      const identity = pricingKey(s),
        candidate = s.prices?.[identity],
        price = validPrice(candidate) ? { ...candidate } : undefined;
      const date = usageDay();
      const key = JSON.stringify([date, identity, price || null]);
      const row = this.rows[key] || {
        date,
        model: s.model,
        provider: s.provider,
        endpoint: s.endpoint,
        price,
        attempts: 0,
        successes: 0,
        failures: 0,
        missingUsage: 0,
        input: 0,
        output: 0,
        cached: 0,
        cacheWrite: 0,
        cost: price ? 0 : null,
      };
      row.attempts++;
      success ? row.successes++ : row.failures++;
      if (usage) {
        row.input += usage.input;
        row.output += usage.output;
        row.cached += usage.cached;
        row.cacheWrite += usage.cacheWrite;
        if (price) row.cost = (row.cost || 0) + estimateCost(usage, price);
      } else row.missingUsage++;
      this.rows[key] = row;
      await chrome.storage.local.set({ usageStats: this.rows });
    });
    this.tail = job.catch(() => {});
    await job;
  }
  async list() {
    await this.ready;
    await this.tail;
    return Object.values(this.rows).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }
}
