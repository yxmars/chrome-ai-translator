import { useState } from "react";
import type { UsageRow } from "../shared/types";
export function UsagePanel({ rows }: { rows: UsageRow[] }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const filtered = rows.filter(
    (r) => (!from || r.date >= from) && (!to || r.date <= to),
  );
  const total = filtered.reduce(
    (a, r) => ({
      tokens: a.tokens + r.input + r.output,
      attempts: a.attempts + r.attempts,
      missing: a.missing + r.missingUsage,
      unpriced: a.unpriced + (r.cost === null ? r.attempts : 0),
    }),
    { tokens: 0, attempts: 0, missing: 0, unpriced: 0 },
  );
  function costs(list: UsageRow[]) {
    const map = new Map<string, number>();
    for (const r of list)
      if (r.price && r.cost !== null)
        map.set(r.price.currency, (map.get(r.price.currency) || 0) + r.cost);
    return (
      Array.from(
        map,
        ([currency, cost]) => `${currency} ${cost.toFixed(6)}`,
      ).join(" / ") || "未计价"
    );
  }
  const days = [...new Set(filtered.map((r) => r.date))].sort().reverse();
  return (
    <section aria-label="用量与费用">
      <h2>Token 用量与估算费用</h2>
      <p className="text-xs text-slate-500">
        按北京时间日期统计 · 从升级本版本后开始累计 · 自动更新
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label>
          开始日期
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <p className="text-sm" data-testid="usage-total">
        {from || to ? "所选日期" : "累计"} Token：
        {total.tokens.toLocaleString()} · 请求：{total.attempts}
      </p>
      <p className="text-sm">已计价部分估算：{costs(filtered)}</p>
      <p className="text-xs text-amber-700">
        无用量返回：{total.missing} 次；未配置单价：{total.unpriced}{" "}
        次。未知用量及未计价请求不包含在费用中；不同币种分列，不进行汇率换算。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr>
              <th>日期 / 模型</th>
              <th>输入 / 输出</th>
              <th>请求 / 失败</th>
              <th>估算费用</th>
            </tr>
          </thead>
          <tbody>
            {days.map((date) => {
              const group = filtered.filter((r) => r.date === date);
              return (
                <tr key={date} className="align-top border-t border-slate-100">
                  <td className="py-2">
                    {date}
                    <div className="text-slate-400">
                      {[...new Set(group.map((r) => r.model))].join(", ")}
                    </div>
                  </td>
                  <td>
                    {group.reduce((n, r) => n + r.input, 0)} /{" "}
                    {group.reduce((n, r) => n + r.output, 0)}
                    <div className="text-slate-400">
                      缓存读 {group.reduce((n, r) => n + r.cached, 0)} · 写{" "}
                      {group.reduce((n, r) => n + r.cacheWrite, 0)}
                    </div>
                  </td>
                  <td>
                    {group.reduce((n, r) => n + r.attempts, 0)} /{" "}
                    {group.reduce((n, r) => n + r.failures, 0)}
                  </td>
                  <td>{costs(group)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!days.length && <p className="text-xs text-slate-400">暂无用量记录</p>}
      <p className="text-xs text-slate-500">
        本地缓存命中不产生请求和
        Token。清除翻译缓存不删除统计；超时可能已经产生费用，服务端未返回 usage
        时无法确认。以服务商账单为准。
      </p>
    </section>
  );
}
