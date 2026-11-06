import { TranslationService } from "../translation/service";
import { endpointOrigin } from "../translation/providers";
import { validPrice } from "../translation/usage";
import type { Request, Reply, Settings } from "../shared/types";
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const service = new TranslationService();
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(console.error);
// Explicit action handling preserves the user invocation used by activeTab.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
});
chrome.runtime.onMessage.addListener(
  (message: Request, sender, reply: (r: Reply) => void) => {
    if (sender.id !== chrome.runtime.id) return;
    (async () => {
      if (
        !sender.url?.startsWith(chrome.runtime.getURL("")) &&
        message.type !== "TRANSLATE"
      )
        throw new Error("网页无权修改配置");
      switch (message.type) {
        case "TRANSLATE":
          return service.translate(message.text,message.force===true);
        case "GET_STATE":
          return service.state();
        case "CLEAR":
          return service.clear();
        case "SAVE_SETTINGS": {
          const s = message.settings as Settings;
          endpointOrigin(s.endpoint);
          if (
            !Number.isInteger(s.retryCount) ||
            s.retryCount < 0 ||
            s.retryCount > 3 ||
            !s.prices ||
            Object.values(s.prices).some((p) => !validPrice(p))
          )
            throw new Error("重试次数或计费单价无效");
          if (
            !["openai", "anthropic", "compatible"].includes(s.provider) ||
            !["general", "computing", "ai", "robotics"].includes(s.domain) ||
            !["gateway", "direct"].includes(s.mode) ||
            !s.model ||
            !s.target ||
            !s.source
          )
            throw new Error("配置无效");
          if (
            !(await chrome.permissions.contains({
              origins: [endpointOrigin(s.endpoint)],
            }))
          )
            throw new Error("请授权 API 站点");
          await chrome.storage.local.set({ settings: s });
          return null;
        }
        default:
          throw new Error("不支持的消息");
      }
    })().then(
      (data) => reply({ ok: true, data }),
      (e) =>
        reply({
          ok: false,
          error: e instanceof Error ? e.message : "翻译失败",
        }),
    );
    return true;
  },
);
