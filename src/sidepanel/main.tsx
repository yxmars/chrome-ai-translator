import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  defaults,
  send,
  type Settings,
  type HistoryItem,
  type Translation,
  type UsageRow,
  type Price,
} from "../shared/types";
import { endpointOrigin } from "../translation/providers";
import { pricingKey } from "../translation/usage";
import { UsagePanel } from "./usage-panel";
import "./style.css";
function App() {
  const [s, setS] = useState<Settings>(defaults),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [text, setText] = useState(""),
    [result, setResult] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pageEnabled, setPageEnabled] = useState(false),
    [pageBusy, setPageBusy] = useState(false),
    [usage, setUsage] = useState<UsageRow[]>([]),
    [manualFailed, setManualFailed] = useState(false);
  const update = (key: keyof Settings, value: string | boolean | number) =>
    setS((v) => ({ ...v, [key]: value }));
  async function refresh() {
    const d = await send<{
      settings: Settings;
      history: HistoryItem[];
      usage: UsageRow[];
    }>({
      type: "GET_STATE",
    });
    setS(d.settings);
    setHistory(d.history);
    setUsage(d.usage || []);
  }
  useEffect(() => {
    void refresh().catch((e) => setNotice(e.message));
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes.usageStats)
        setUsage(
          Object.values(changes.usageStats.newValue || {}) as UsageRow[],
        );
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function save() {
    const origin = endpointOrigin(s.endpoint);
    if (!(await chrome.permissions.contains({ origins: [origin] })))
      throw new Error("请在 Chrome 扩展设置中允许网站访问权限");
    await send({ type: "SAVE_SETTINGS", settings: s });
    setNotice("配置已保存");
  }
  async function action(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function currentTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error("请打开普通网页");
    if (tab.url && !/^https?:/.test(tab.url))
      throw new Error("此页面不支持翻译，请打开普通 HTTP/HTTPS 网页。");
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch {
      throw new Error(
        "无法访问当前网页。请在 Chrome 扩展详情中将网站访问权限设为“在所有网站上”，然后刷新网页。Chrome 内部页面和应用商店不允许翻译。",
      );
    }
    return tab.id;
  }
  return (
    <main className="mx-auto max-w-xl p-4 space-y-4">
      <header className="py-2">
        <div className="text-xs font-semibold tracking-widest text-blue-600">
          CHROME AI TRANSLATOR
        </div>
        <h1 className="mt-1 text-2xl font-bold">让语言不再是边界</h1>
        <p className="mt-2 text-sm text-slate-500">
          划词即译 · 双语阅读 · 保留专业术语
        </p>
      </header>
      <section>
        <h2>当前网页</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              void action(async () => {
                await currentTab();
                setNotice("划词翻译已启用，请在网页中选中文字");
              })
            }
          >
            启用划词翻译
          </button>
          <button
            className="secondary"
            disabled={pageBusy}
            onClick={() =>
              void action(async () => {
                setPageBusy(true);
                setNotice("正在检查当前网页…");
                try {
                  const id = await currentTab();
                  const state = await chrome.tabs.sendMessage(id, {
                    type: "PAGE_STATE",
                  });
                  if (!state.enabled) {
                    if (s.mode === "direct" && !s.apiKey.trim())
                      throw new Error(
                        "请先向下滚动到服务配置，选择 DeepSeek、填写个人 API Key，再保存配置。",
                      );
                    await save();
                  }
                  const r = await chrome.tabs.sendMessage(id, {
                    type: "TOGGLE_PAGE",
                  });
                  setPageEnabled(r.enabled);
                  setNotice(
                    r.error ||
                      (r.enabled
                        ? `已开始翻译，共 ${r.total} 段。译文会显示在网页原文下方。`
                        : "已恢复原文"),
                  );
                } finally {
                  setPageBusy(false);
                }
              })
            }
          >
            {pageEnabled ? "恢复原文" : "切换网页双语翻译"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          已默认申请所有 HTTP/HTTPS
          网页访问权限，无需逐站授权。刷新后需重新启用翻译。
        </p>
      </section>
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 whitespace-pre-wrap"
        >
          {notice}
        </p>
      )}
      <section>
        <h2>文本翻译</h2>
        <textarea
          aria-label="待翻译文本"
          rows={5}
          maxLength={12000}
          placeholder="输入文本，开始翻译…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          disabled={busy || !text.trim()}
          onClick={() =>
            void action(async () => {
              setBusy(true);
              try {
                await save();
                const r = await send<Translation>({ type: "TRANSLATE", text });
                setResult(r.text);
                setManualFailed(false);
                setNotice(`识别源语言：${r.detectedLanguage}`);
                await refresh();
              } catch (e) {
                setManualFailed(true);
                throw e;
              } finally {
                setBusy(false);
              }
            })
          }
        >
          {busy
            ? "翻译中（临时失败会自动重试）…"
            : manualFailed
              ? "重试翻译"
              : "翻译文本"}
        </button>
        {result && (
          <div className="whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm">
            <p>{result}</p>
            <button
              className="secondary mt-3"
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(result);
                  setNotice("已复制");
                })
              }
            >
              复制译文
            </button>
          </div>
        )}
      </section>
      <section>
        <h2>服务配置</h2>
        <label>
          自动重试次数
          <select
            value={s.retryCount}
            onChange={(e) => update("retryCount", Number(e.target.value))}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} 次
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => {
            setS((v) => ({
              ...v,
              provider: "compatible",
              endpoint: "https://api.deepseek.com/chat/completions",
              model: "deepseek-flash",
              mode: "direct",
            }));
            setNotice(
              "已选择 DeepSeek V4.1 Flash，请填写个人 Key 并保存授权。",
            );
          }}
        >
          使用 DeepSeek V4.1 Flash
        </button>
        <label>
          连接模式
          <select
            value={s.mode}
            onChange={(e) => update("mode", e.target.value)}
          >
            <option value="gateway">生产后端网关</option>
            <option value="direct">本地开发：个人 Key 直连</option>
          </select>
        </label>
        {s.mode === "direct" && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            风险提示：个人 API Key 以明文存于本机 Chrome
            Storage，可被本机访问者读取。仅供开发测试，请使用限额专用
            Key。生产环境必须使用后端网关，禁止打包开发者密钥。
          </p>
        )}
        <label>
          翻译服务
          <select
            value={s.provider}
            onChange={(e) => {
              const provider = e.target.value;
              setS((v) => ({
                ...v,
                provider: provider as Settings["provider"],
                endpoint:
                  provider === "anthropic"
                    ? "https://api.anthropic.com/v1/messages"
                    : provider === "openai"
                      ? "https://api.openai.com/v1/chat/completions"
                      : v.endpoint,
                model:
                  provider === "anthropic"
                    ? "claude-sonnet-4-5"
                    : provider === "openai"
                      ? "gpt-4.1-mini"
                      : v.model,
              }));
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="compatible">OpenAI Compatible</option>
          </select>
        </label>
        <label>
          API Endpoint（完整请求地址）
          <input
            value={s.endpoint}
            onChange={(e) => update("endpoint", e.target.value)}
          />
        </label>
        <label>
          Model
          <input
            value={s.model}
            onChange={(e) => update("model", e.target.value)}
          />
        </label>
        {s.mode === "direct" && (
          <label>
            个人 API Key
            <input
              type="password"
              autoComplete="off"
              value={s.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label>
            源语言
            <input
              aria-label="源语言"
              value={s.source}
              onChange={(e) => update("source", e.target.value)}
            />
            <span>auto 自动识别</span>
          </label>
          <label>
            目标语言
            <input
              aria-label="目标语言"
              value={s.target}
              onChange={(e) => update("target", e.target.value)}
            />
            <span>例如 zh-CN、en、ja</span>
          </label>
        </div>
        <label>
          专业领域
          <select
            value={s.domain}
            onChange={(e) => update("domain", e.target.value)}
          >
            <option value="general">通用</option>
            <option value="computing">计算机</option>
            <option value="ai">人工智能</option>
            <option value="robotics">机器人</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            className="w-auto"
            type="checkbox"
            checked={s.explainTerms}
            onChange={(e) => update("explainTerms", e.target.checked)}
          />
          首次出现添加术语解释（每段）
        </label>
        <PriceEditor settings={s} onChange={setS} />
        <button onClick={() => void action(save)}>保存配置</button>
      </section>
      <UsagePanel rows={usage} />
      <section>
        <div className="flex items-center justify-between">
          <h2>最近翻译</h2>
          <button
            className="secondary"
            onClick={() =>
              void action(async () => {
                await send({ type: "CLEAR" });
                await refresh();
                setResult("");
                setNotice("缓存和历史已清除");
              })
            }
          >
            清除缓存与记录
          </button>
        </div>
        {!history.length ? (
          <p className="text-xs text-slate-400">还没有翻译记录</p>
        ) : (
          history.map((h, i) => (
            <article key={i} className="border-t border-slate-100 pt-3 text-xs">
              <p className="text-slate-400 line-clamp-2">{h.original}</p>
              <p className="mt-1 whitespace-pre-wrap">{h.text}</p>
            </article>
          ))
        )}
        <p className="text-xs text-slate-400">
          最多保存 30 条本地记录与 100 条缓存。所选文本将发送至配置的服务。
        </p>
      </section>
    </main>
  );
}
function PriceEditor({
  settings: s,
  onChange,
}: {
  settings: Settings;
  onChange: React.Dispatch<React.SetStateAction<Settings>>;
}) {
  const key = pricingKey(s),
    price = s.prices?.[key];
  function setPrice(p: Price | undefined) {
    onChange((v) => {
      const prices = { ...v.prices };
      if (p) prices[key] = p;
      else delete prices[key];
      return { ...v, prices };
    });
  }
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <label className="flex items-center gap-2">
        <input
          className="w-auto"
          type="checkbox"
          checked={!!price}
          onChange={(e) =>
            setPrice(
              e.target.checked
                ? {
                    currency: "CNY",
                    input: 0,
                    cachedInput: 0,
                    cacheWrite: 0,
                    output: 0,
                  }
                : undefined,
            )
          }
        />
        启用费用估算（当前模型）
      </label>
      {price && (
        <>
          <label>
            计费币种
            <select
              value={price.currency}
              onChange={(e) =>
                setPrice({
                  ...price,
                  currency: e.target.value as Price["currency"],
                })
              }
            >
              <option>CNY</option>
              <option>USD</option>
            </select>
          </label>
          {(
            [
              ["input", "输入单价（未命中缓存）"],
              ["cachedInput", "输入单价（缓存命中）"],
              ["cacheWrite", "缓存写入单价"],
              ["output", "输出单价"],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min="0"
                max="1000000"
                step="any"
                value={price[field]}
                onChange={(e) =>
                  setPrice({ ...price, [field]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </>
      )}
      <p className="text-xs text-slate-500">
        单价单位：所选币种 / 百万
        Token。请按服务商当前账单填写；未配置时显示未计价。价格按模型及接口分别保存，修改单价仅影响后续请求。估算不含税费、优惠或未知用量。
      </p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
