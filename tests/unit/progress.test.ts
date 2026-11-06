import { it, expect } from "vitest";
import { PageProgress } from "../../src/content/progress";
function fixture() {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  document.body.append(host);
  return {
    root,
    progress: new PageProgress(root),
    a: document.createElement("p"),
    b: document.createElement("p"),
  };
}
it("shows running progress and final failures, then updates on a manual retry", () => {
  const { root, progress, a, b } = fixture();
  progress.start([a, b]);
  progress.set(a, "running");
  expect(root.querySelector("[role=status]")?.textContent).toContain(
    "翻译中 0/2",
  );
  progress.set(a, "success");
  progress.set(b, "failed");
  expect(root.querySelector("[role=status]")?.textContent).toContain("失败 1");
  expect(root.querySelector("progress")?.value).toBe(2);
  progress.set(b, "running");
  expect(root.querySelector("[role=status]")?.textContent).toContain("翻译中");
  progress.set(b, "success");
  expect(root.querySelector("[role=status]")?.textContent).toContain(
    "翻译完成 2/2",
  );
});
it("collapses and hides without stopping the task, and resets on the next task", () => {
  const { root, progress, a } = fixture();
  progress.start([a]);
  (
    root.querySelector('[aria-label="收起翻译状态"]') as HTMLButtonElement
  ).click();
  expect(root.querySelector("progress")?.hidden).toBe(true);
  (
    root.querySelector('[aria-label="隐藏翻译状态"]') as HTMLButtonElement
  ).click();
  progress.set(a, "success");
  expect(
    (root.querySelector("[data-cait-progress]") as HTMLElement).hidden,
  ).toBe(true);
  progress.start([a]);
  expect(
    (root.querySelector("[data-cait-progress]") as HTMLElement).hidden,
  ).toBe(false);
  progress.clear();
  progress.set(a, "success");
  expect(
    (root.querySelector("[data-cait-progress]") as HTMLElement).hidden,
  ).toBe(true);
});
it("finishes skipped paragraphs and explains empty pages", () => {
  const { root, progress, a } = fixture();
  progress.start([a]);
  progress.set(a, "skipped");
  expect(root.querySelector("[role=status]")?.textContent).toContain("跳过 1");
  progress.start([]);
  expect(root.querySelector("[role=status]")?.textContent).toContain(
    "未找到可翻译正文",
  );
});

it('reports actual cache-rendered paragraphs and resets them on restore',()=>{const {root,progress,a,b}=fixture();progress.start([a,b]);progress.lookup(true);expect(root.querySelector('[role=status]')?.textContent).toContain('读取缓存');progress.set(a,'success',true);progress.lookup(false);expect(root.querySelector('[role=status]')?.textContent).toContain('缓存 1');progress.set(b,'success');expect(root.querySelector('[role=status]')?.textContent).toContain('翻译完成 2/2');progress.clear();progress.start([a]);expect(root.querySelector('[role=status]')?.textContent).toContain('缓存 0');});
