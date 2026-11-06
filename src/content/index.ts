import { send, type Translation } from "../shared/types";
import { paragraphs, placeTranslation } from "./dom";
import { protectCitations, renderTranslation } from "./citations";
import { PageProgress } from "./progress";
import {
  paragraphTargetsInRange,
  bilingualTargetsInRange,
} from "./failed-selection";
// Isolated world: no window messaging bridge and no page-visible API keys.
const context = globalThis as typeof globalThis & {
  __caitInitialized?: boolean;
};
if (!context.__caitInitialized) {
  context.__caitInitialized = true;
  document.querySelector('[data-cait="host"]')?.remove();
  const host = document.createElement("div");
  host.dataset.cait = "host";
  host.style.cssText =
    "all:initial;position:fixed;z-index:2147483647;left:0;top:0";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    ":host{font:14px system-ui}button{cursor:pointer;border:0;border-radius:8px;padding:8px 12px;background:#2563eb;color:white;font:inherit}section{position:fixed;box-sizing:border-box;max-height:65vh;overflow:auto;background:white;color:#172033;border:1px solid #dbe3ee;border-radius:12px;box-shadow:0 8px 32px #0003;padding:14px;width:320px;line-height:1.6;white-space:pre-wrap}p{margin:8px 0}";
  shadow.append(style);
  const progress = new PageProgress(shadow);
  const button = document.createElement("button");
  button.textContent = "翻译";
  button.setAttribute("aria-label", "翻译选中文本");
  button.style.position = "fixed";
  button.hidden = true;
  shadow.append(button);
  let text = "",
    selectionVersion = 0;
  let popup: HTMLElement | undefined;
  let selectedParagraphs: HTMLElement[] = [];
  let selectedGeneration = 0;
  function hide() {
    selectionVersion++;
    popup?.remove();
    popup = undefined;
    button.hidden = true;
    selectedParagraphs = [];
  }
  document.addEventListener("pointerdown", (e) => {
    if (!e.composedPath().includes(host)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener("mouseup", (e) => {
    if (e.composedPath().includes(host)) return;
    const selection = getSelection();
    const parent = selection?.anchorNode?.parentElement;
    if (
      !selection?.rangeCount ||
      !parent ||
      parent.closest(
        'input,textarea,[contenteditable]:not([contenteditable="false"]),pre,code',
      )
    )
      return;
    text = selection.toString().trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    selectedParagraphs = enabled
      ? bilingualTargetsInRange(range, paragraphs(document, 1))
      : [];
    if (!selectedParagraphs.length && text.length > 12000) return;
    selectedGeneration = generation;
    const retryingFailed = selectedParagraphs.some((el) => failed.has(el));
    const paragraphLabel = retryingFailed ? "重译失败段落" : "翻译选中段落";
    button.textContent = selectedParagraphs.length ? paragraphLabel : "翻译";
    button.setAttribute(
      "aria-label",
      selectedParagraphs.length ? paragraphLabel : "翻译选中文本",
    );
    button.title = selectedParagraphs.length
      ? "重新翻译完整段落，显示在原文下方"
      : "";
    const rect = range.getBoundingClientRect();
    button.style.left = `${Math.max(8, Math.min(rect.right, innerWidth - 85))}px`;
    button.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 45))}px`;
    button.hidden = false;
  });
  button.addEventListener("pointerdown", (e) => e.preventDefault());
  button.addEventListener("click", async () => {
    if (selectedParagraphs.length) {
      const targets = [...selectedParagraphs],
        current = selectedGeneration;
      hide();
      if (current !== generation) return;
      if (!enabled) {
        enabled = true;
        progress.start(targets);
      } else progress.include(targets);
      await Promise.all(
        targets.map(async (el) => {
          if (!el.isConnected) return;
          let node = inserted.get(el);
          if (!node) {
            node = createTranslationNode();
            inserted.set(el, node);
          }
          if (!node.isConnected) placeTranslation(el, node);
          await translateNode(el, node, current);
        }),
      );
      return;
    }
    const version = ++selectionVersion;
    popup?.remove();
    popup = document.createElement("section");
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "翻译结果");
    popup.style.left = `${Math.max(8, Math.min(parseFloat(button.style.left), innerWidth - 328))}px`;
    popup.style.top = `${Math.max(8, Math.min(parseFloat(button.style.top) + 40, innerHeight - 230))}px`;
    const result = document.createElement("p");
    result.textContent = "翻译中…";
    popup.append(result);
    shadow.append(popup);
    button.hidden = true;
    try {
      const translated = await send<Translation>({ type: "TRANSLATE", text });
      if (version !== selectionVersion) return;
      result.textContent = translated.text;
      const language = document.createElement("small");
      language.textContent = `源语言：${translated.detectedLanguage}`;
      const copy = document.createElement("button");
      copy.textContent = "复制";
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(translated.text);
          copy.textContent = "已复制";
        } catch {
          copy.textContent = "复制失败";
        }
      };
      popup?.append(language, document.createElement("br"), copy);
    } catch (e) {
      if (version === selectionVersion) {
        result.textContent = e instanceof Error ? e.message : "翻译失败";
        const retry = document.createElement("button");
        retry.textContent = "重试翻译";
        retry.onclick = () => button.click();
        popup?.append(retry);
      }
    }
  });
  let enabled = false,
    generation = 0;
  const inserted = new Map<HTMLElement, HTMLElement>();
  const failed = new Set<HTMLElement>();
  function createTranslationNode() {
    const node = document.createElement("div");
    node.dataset.cait = "translation";
    node.textContent = "翻译中…";
    node.style.cssText =
      "display:block;clear:both;width:100%;box-sizing:border-box;padding:8px 0;color:#2563eb;font-size:0.95em;line-height:1.65;white-space:pre-wrap";
    return node;
  }
  async function translateNode(
    el: HTMLElement,
    node: HTMLElement,
    current: number,
    force = false,
  ) {
    if (current !== generation) return;
    if (!node.isConnected) {
      progress.set(el, "skipped");
      return;
    }
    failed.delete(el);
    progress.set(el, "running");
    node.textContent = "翻译中…";
    try {
      const protectedText = protectCitations(el);
      const r = await send<Translation>({
        type: "TRANSLATE",
        text: protectedText.text,
        force,
      });
      if (current === generation && node.isConnected) {
        renderTranslation(node, r.text, protectedText);
        progress.set(el, "success", r.cacheHit === true);
      } else if (current === generation) progress.set(el, "skipped");
    } catch (e) {
      if (current !== generation) return;
      if (!node.isConnected) {
        progress.set(el, "skipped");
        return;
      }
      failed.add(el);
      progress.set(el, "failed");
      node.textContent = `翻译失败：${e instanceof Error ? e.message : "未知错误"} `;
      const retry = document.createElement("button");
      retry.textContent = "重试此段";
      retry.type = "button";
      retry.onclick = () => {
        retry.disabled = true;
        void translateNode(el, node, current);
      };
      node.append(retry);
    }
  }
  async function toggle() {
    enabled = !enabled;
    const current = ++generation;
    if (!enabled) {
      inserted.forEach((node) => node.remove());
      inserted.clear();
      failed.clear();
      hide();
      progress.clear();
      return { enabled };
    }
    const candidates = paragraphs();
    progress.start(candidates);
    if (!candidates.length) {
      enabled = false;
      return {
        enabled,
        total: 0,
        error:
          "未找到可翻译的正文段落。请在含正文的普通网页重试，或使用划词翻译。",
      };
    }
    void (async () => {
      progress.lookup(true);
      const remaining: HTMLElement[] = [];
      // Cached paragraphs render first and never wait behind a model request.
      for (let i = 0; i < candidates.length; i += 32) {
        if (current !== generation) return;
        const batch = candidates.slice(i, i + 32);
        const prepared = batch.map((el) => protectCitations(el));
        let cached: (Translation | null)[] = [];
        try {
          cached = await send<(Translation | null)[]>({
            type: "GET_CACHED",
            texts: prepared.map((p) => p.text),
          });
        } catch {
          /* A cache read failure falls back to normal translation. */
        }
        if (current !== generation) return;
        for (let j = 0; j < batch.length; j++) {
          const el = batch[j];
          if (!el.isConnected) {
            progress.set(el, "skipped");
            continue;
          }
          const result = cached[j];
          if (!result) {
            remaining.push(el);
            continue;
          }
          const node = inserted.get(el) || createTranslationNode();
          try {
            renderTranslation(node, result.text, prepared[j]);
            placeTranslation(el, node);
            inserted.set(el, node);
            progress.set(el, "success", true);
          } catch {
            remaining.push(el);
          }
        }
      }
      if (current !== generation) return;
      progress.lookup(false);
      let next = 0;
      // Background still limits actual model requests to 3; independent jobs avoid batch barriers.
      await Promise.all(
        Array.from({ length: Math.min(3, remaining.length) }, async () => {
          while (next < remaining.length) {
            if (current !== generation) return;
            const el = remaining[next++];
            if (!el.isConnected) {
              progress.set(el, "skipped");
              continue;
            }
            let node = inserted.get(el);
            if (!node) {
              node = createTranslationNode();
              inserted.set(el, node);
              placeTranslation(el, node);
            }
            await translateNode(el, node, current);
          }
        }),
      );
    })();
    return { enabled, total: candidates.length };
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === "TOGGLE_PAGE") {
      void toggle().then(reply);
      return true;
    }
    if (message.type === "PAGE_STATE") reply({ enabled });
  });
}
