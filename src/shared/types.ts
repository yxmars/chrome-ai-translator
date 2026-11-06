export type ProviderName = "openai" | "anthropic" | "compatible";
export type Domain = "general" | "computing" | "ai" | "robotics";
export interface Settings {
  provider: ProviderName;
  endpoint: string;
  model: string;
  source: string;
  target: string;
  domain: Domain;
  explainTerms: boolean;
  mode: "gateway" | "direct";
  apiKey: string;
  retryCount: number;
  prices: Record<string, Price>;
}
export const defaults: Settings = {
  provider: "openai",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  source: "auto",
  target: "zh-CN",
  domain: "general",
  explainTerms: true,
  mode: "gateway",
  apiKey: "",
  retryCount: 2,
  prices: {},
};
export interface Translation {
  text: string;
  detectedLanguage: string;
  cacheHit?: boolean;
}
export interface HistoryItem extends Translation {
  original: string;
  time: number;
}
export type Request =
  | { type: "TRANSLATE"; text: string; force?: boolean }
  | { type: "GET_CACHED"; texts: string[] }
  | { type: "GET_STATE" }
  | { type: "SAVE_SETTINGS"; settings: Settings }
  | { type: "CLEAR" };
export type Reply = { ok: true; data: unknown } | { ok: false; error: string };
export async function send<T>(message: Request): Promise<T> {
  const r: Reply = await chrome.runtime.sendMessage(message);
  if (!r?.ok) throw new Error(r?.error || "后台未响应");
  return r.data as T;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}
export interface Price {
  currency: "CNY" | "USD";
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}
export interface UsageRow extends TokenUsage {
  date: string;
  model: string;
  provider: string;
  endpoint: string;
  price?: Price;
  attempts: number;
  successes: number;
  failures: number;
  missingUsage: number;
  cost: number | null;
}
export interface ProviderResult extends Translation {
  usage?: TokenUsage;
}

export interface CacheInfo {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  maxEntries: number;
  maxBytes: number;
}
