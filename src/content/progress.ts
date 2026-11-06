export type ParagraphState =
  "pending" | "running" | "success" | "failed" | "skipped";
export class PageProgress {
  private panel = document.createElement("div");
  private text = document.createElement("span");
  private meter = document.createElement("progress");
  private toggle = document.createElement("button");
  private hidden = false;
  private compact = false;
  private cacheHits = new Set<HTMLElement>();
  private lookingUp = false;
  private states = new Map<HTMLElement, ParagraphState>();
  constructor(root: ShadowRoot) {
    const style = document.createElement("style");
    style.textContent =
      ".cait-progress{position:fixed;right:16px;bottom:16px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:9px 12px;border:1px solid #dbe3ee;border-radius:12px;background:rgba(255,255,255,.94);color:#334155;box-shadow:0 2px 12px #0001;font:12px/1.5 system-ui;pointer-events:none;display:flex;align-items:center;gap:8px}.cait-progress[hidden]{display:none}.cait-progress progress{display:block;width:130px;height:5px;margin-top:4px;accent-color:#2563eb}.cait-progress progress[hidden]{display:none}.cait-progress button{flex-shrink:0;white-space:nowrap;pointer-events:auto;background:transparent;color:#64748b;padding:3px 5px;font:12px system-ui;border:0;border-radius:4px}.cait-progress button:focus-visible{outline:2px solid #2563eb}.cait-progress .cait-copy{min-width:0;flex:1}";
    root.append(style);
    this.panel.className = "cait-progress";
    this.panel.dataset.caitProgress = "";
    this.panel.hidden = true;
    const copy = document.createElement("div");
    copy.className = "cait-copy";
    this.text.setAttribute("role", "status");
    this.text.setAttribute("aria-live", "polite");
    this.meter.setAttribute("aria-label", "网页翻译进度");
    copy.append(this.text, this.meter);
    this.toggle.type = "button";
    this.toggle.textContent = "收起";
    this.toggle.setAttribute("aria-label", "收起翻译状态");
    this.toggle.onclick = () => {
      this.compact = !this.compact;
      this.render();
    };
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "隐藏翻译状态");
    close.onclick = () => {
      this.hidden = true;
      this.panel.hidden = true;
    };
    this.panel.append(copy, this.toggle, close);
    root.append(this.panel);
  }
  start(elements: HTMLElement[]) {
    this.states = new Map(elements.map((el) => [el, "pending"]));
    this.cacheHits.clear();
    this.lookingUp = false;
    this.hidden = false;
    this.compact = false;
    this.render();
  }
  include(elements: HTMLElement[]) {
    for (const el of elements)
      if (!this.states.has(el)) this.states.set(el, "pending");
    this.render();
  }
  lookup(active: boolean) {
    this.lookingUp = active;
    this.render();
  }
  set(el: HTMLElement, state: ParagraphState, cacheHit = false) {
    if (!this.states.has(el)) return;
    this.states.set(el, state);
    if (cacheHit) this.cacheHits.add(el);
    else this.cacheHits.delete(el);
    this.render();
  }
  clear() {
    this.states.clear();
    this.cacheHits.clear();
    this.lookingUp = false;
    this.hidden = true;
    this.panel.hidden = true;
  }
  private render() {
    let success = 0,
      failed = 0,
      skipped = 0,
      running = 0,
      pending = 0;
    for (const state of this.states.values()) {
      if (state === "success") success++;
      else if (state === "failed") failed++;
      else if (state === "skipped") skipped++;
      else if (state === "running") running++;
      else pending++;
    }
    const total = this.states.size,
      done = success + failed + skipped,
      active = running + pending > 0;
    const label = !total
      ? "未找到可翻译正文"
      : this.lookingUp
        ? "读取缓存"
        : active
          ? "翻译中"
          : failed
            ? "翻译结束"
            : "翻译完成";
    this.text.textContent = this.compact
      ? `${label} ${done}/${total}`
      : `${label} ${done}/${total} 段${failed ? ` · 失败 ${failed}` : ""}${skipped ? ` · 跳过 ${skipped}` : ""} · 缓存 ${this.cacheHits.size}`;
    this.meter.max = Math.max(total, 1);
    this.meter.value = done;
    this.meter.hidden = this.compact || !total;
    this.toggle.textContent = this.compact ? "展开" : "收起";
    this.toggle.setAttribute(
      "aria-label",
      this.compact ? "展开翻译状态" : "收起翻译状态",
    );
    this.toggle.setAttribute("aria-expanded", String(!this.compact));
    this.panel.style.width = this.compact ? "auto" : "260px";
    this.panel.hidden = this.hidden;
  }
}
