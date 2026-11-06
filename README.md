# Chrome AI Translator

当前版本：0.1.11。默认申请全部 HTTP/HTTPS 网页访问权限，不再要求填写网站地址或逐站授权。

Manifest V3 + TypeScript + React + Tailwind CSS + Vite 的最小可用翻译扩展。

## 架构与目录

```text
src/
  content/       划词按钮、Shadow DOM 弹窗、正文提取、双语插入与恢复
  background/    Service Worker 消息路由、可信配置访问
  sidepanel/     React 配置、手动翻译、网页控制、历史记录
  shared/        类型、消息协议、默认设置
  translation/   模型适配、领域词典、缓存、并发队列
scripts/build.mjs Vite 分别构建 UI、ES module 后台、IIFE 内容脚本
public/manifest.json
 tests/unit/     Vitest 核心测试
 tests/e2e/      Playwright 真实 MV3 扩展测试
```

数据流：Content Script / Side Panel → 类型化 Chrome 消息 → Background → TranslationService → Provider → 配置的 API。模型文本通过 textContent / React 文本节点显示，不解析为 HTML。无 eval、无远程 JavaScript。

## 安装与开发

建议 Node.js 24 LTS（本项目实际环境 24.13.1），npm。具体依赖已锁定在 package-lock.json，使用 npm ci 保持可复现。

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run dev` 持续重新构建三种入口。修改后在 chrome://extensions 手动重新加载扩展，并刷新目标网页；没有运行时远程代码或热重载服务。

## Chrome 开发者模式加载

1. 运行 `npm run build`。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择本项目 **dist** 文件夹。
5. 在工具栏扩展菜单固定 Chrome AI Translator。
6. 打开普通 HTTP/HTTPS 网页，点击扩展图标打开侧边栏。
7. 配置服务并保存。安装或升级时按 Chrome 提示确认所有网页访问权限。
8. 点击「启用划词翻译」，回到网页拖动选择文字，点击浮动「翻译」按钮。
9. 点击「切换网页双语翻译」开始整页翻译，再点击「恢复原文」移除所有插入译文。点击弹窗外或按 Escape 关闭划词弹窗。

Chrome 内部页面、Chrome Web Store 等禁止注入的页面不可用。划词启用只作用于当前文档，刷新或跳转后需重新启用。这使扩展无需持续读取所有网站。

## API 配置

先选择模式与服务，再填写完整请求 Endpoint、Model、源语言与目标语言。

- OpenAI：`https://api.openai.com/v1/chat/completions`，使用 Chat Completions 请求协议。
- Anthropic：`https://api.anthropic.com/v1/messages`，使用 Messages 协议及版本头。
- OpenAI Compatible：填写兼容 Chat Completions 的完整请求地址。
- 源语言 `auto` 为模型自动识别；目标语言可填 `zh-CN`、`en`、`ja` 等。
- 配置中的模型名是可编辑示例，请使用自己账号实际可用的模型。
- 仅允许 HTTPS；本地开发允许 localhost 和 127.0.0.1 的 HTTP。请求拒绝重定向，25 秒超时。

### DeepSeek V4.1 Flash

点击「使用 DeepSeek V4.1 Flash」会选择 OpenAI Compatible 直连模式，并设置完整 Endpoint `https://api.deepseek.com/chat/completions`、Model `deepseek-flash`。随后在个人 API Key 字段填写你自己的 Key，点击保存配置。已有配置不自动覆盖。Key 不预置于源码、构建包或此文档。

官方模型名称是 `deepseek-flash`，对应 DeepSeek V4.1 Flash，不能把产品显示名直接当作 API 模型 ID。参考 [DeepSeek 官方调用文档](https://api-docs.deepseek.com/quick_start/agent_integrations/)。

### 本地开发个人 Key

必须显式选择「本地开发：个人 Key 直连」。Key 明文存储于本机 chrome.storage.local，不是加密保险箱；请使用限额专用 Key，勿共享浏览器配置或真实密钥。后台将 local storage 限制为 TRUSTED_CONTEXTS，内容脚本不能直接读取配置。Key 不进入代码或构建文件，历史与缓存不存 Key。网页访问范围可在 Chrome 扩展详情中调整。

### 生产网关

默认选择后端网关模式，扩展不发送个人 API Key。将 Endpoint 指向你部署的 HTTPS 网关。此 MVP 提供可接入的接口和 GatewayProvider，**不包含已部署网关、账号认证或计费系统**。

请求 `POST /translate`（路径自定义）：

```json
{
  "text": "Hello",
  "provider": "openai",
  "model": "your-model",
  "source": "auto",
  "target": "zh-CN",
  "domain": "general",
  "explainTerms": true
}
```

响应：

```json
{ "text": "你好", "detectedLanguage": "en" }
```

网关负责身份认证、速率限制、配额、请求大小校验、服务端提示词和密钥管理。生产认证应由网关实施短期会话；不要在扩展包中写开发者 Key，也不要将静态共享凭据当作生产认证。

## 专业翻译与网页行为

领域：通用、计算机、人工智能、机器人。内置领域词典，提示模型保留英文术语；可设置首次术语出现追加目标语言解释。MVP 的「首次」范围为单段或单次输入，术语遵循情况由模型决定，不保证文档级统一术语计数。

正文候选为 p、li、blockquote、h1–h3，长度 20–12000 字符且可见。跳过代码、表单、脚本、样式、可编辑区域、导航、页眉页脚、translate=no、notranslate 和扩展自己的节点；行内 code / kbd / samp 内容原样保护，周围正文正常翻译；独立代码块仍跳过。插入相邻译文节点，不替换原文、不重建 DOM，保留原有节点和监听器。每批 3 段，后台全局并发上限 3，相同请求合并。恢复时递增任务代号，已在途的结果不会重新插回页面。相同配置缓存避免重复模型请求。

缓存最多 100,000 条、内容预算 512 MiB，位于本机 IndexedDB，满额按 LRU 淘汰；历史最多 30 条，位于 Chrome Storage。用户输入及译文可能包含敏感信息，保存在本机并发送给所配置服务；可在侧边栏清除缓存和记录，清除不删除服务配置及 Key。要删除 Key，请清空 Key 后保存或移除扩展。

MVP 不自动跟踪 SPA 路由和动态新增段落，不处理跨域 iframe、PDF、Shadow DOM 内的网页正文、复杂表格或超长段落；更改语言后先恢复再翻译。正文检测是保守启发式，需要页面具体布局验证。

## 测试范围

- Vitest：提供商请求/响应、错误、Endpoint 安全、领域提示词、缓存隔离、重复请求合并、历史清除、并发控制、正文排除规则。
- Playwright：启动持久化 Chromium 并加载未经权限修改的正式 dist 构建；本地 HTTP 测试服务提供固定翻译响应；鼠标选段、弹窗、文本防注入、外部关闭、双语插入、恢复、原监听器保留、缓存复用、侧边栏历史清除。
- 所有测试直接加载正式权限配置，不再预授权测试副本。UI 以扩展页面打开，仍使用真实 Chrome 消息与后台；测试验证网站默认可访问且没有逐站授权控件。
- 不需要真实付费 API Key。测试不代表已验证第三方模型的翻译质量、真实服务账户权限或已部署的生产网关。
- Playwright 官方要求使用其自带 Chromium 进行扩展自动化。实际桌面 Chrome 加载方式见上。

## 发布

1. 配置并验证生产网关，保留密钥在服务端；在自己的 Chrome 稳定版进行手动验收。
2. 运行类型检查、单元测试、构建、E2E。
3. 更新 `public/manifest.json` 和 `package.json` 版本号后重新构建。
4. 仅将 dist 内部文件压成 ZIP（manifest.json 位于 ZIP 根目录），不要包含 node_modules、个人配置或 Key。
5. Chrome Web Store 开发者后台上传 ZIP，补充图标、截图、隐私政策、数据传输说明、权限用途和审核所需网关测试账号；提交审核。

权限为 storage、sidePanel、scripting，host_permissions 为 http://*/* 和 https://*/*。安装或升级时一次确认网页访问权限，API 保存时不再弹出逐站授权。内容脚本仅在用户启用功能时注入，不自动向模型发送页面。

## 官方方案参考

- [Vite 指南与 Node 要求](https://vite.dev/guide/)
- [Tailwind Vite 插件](https://tailwindcss.com/docs/installation/using-vite)
- [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)

实际运行结果见 TEST_RESULTS.md。

## 点击网页翻译无反馈时

更新后在 chrome://extensions 重新加载插件并确认新增权限。若扩展被停用，按 Chrome 提示重新启用。扩展详情中的网站访问权限应设为「在所有网站上」。刷新目标网页，打开侧边栏，确认服务配置后点击网页双语翻译。Chrome 内部页面和应用商店仍不可注入。

0.1.2 已移除网站地址输入框与授权网站按钮；不需要遵循旧版逐站授权步骤。


## 0.1.3 失败重试与每日 Token / 费用

- 服务配置可设置自动重试次数 0–3，默认 2（最多 3 次实际请求）。网络错误、25 秒超时、HTTP 408/429/500/502/503/504/529、模型或服务 JSON 格式异常可重试；鉴权/配置错误不自动重试。指数退避加随机抖动，尊重 Retry-After；等待超过 10 秒时停止自动重试，稍后手动再试。重试仍受全局并发上限 3 约束。
- 重试耗尽后，划词弹窗显示「重试翻译」、网页失败段落显示「重试此段」，侧边栏文本按钮变为「重试翻译」。恢复原文后，在途结果不会重新插回网页。
- 用量按北京时间（Asia/Shanghai）请求完成日期累计，支持日期范围筛选；展示输入、输出、缓存读写、总 Token、请求及失败次数。统计存储于独立的 usageStats，清除翻译缓存/历史不会删除统计；升级前未记录的用量不能追溯。
- 每一次实际 HTTP 尝试都计数。返回 usage 的格式错误响应也记入 Token；本机缓存命中与合并请求不重复统计。缺少 usage 的响应、网络错误和超时标记「无用量返回」，不按字符数假装精确 Token。
- 「启用费用估算（当前模型）」后，填写币种及每百万 Token 的输入、缓存命中输入、缓存写入、输出单价，然后保存。价格按接口、模型、提供商及连接模式分别保存。未配置显示「未计价」；不内置未经确认的官方单价。新启用的单价字段为 0，须按实际账单填写。
- 费用按每次请求的单价快照保存，仅影响后续请求。CNY 与 USD 分开累计，不做汇率换算。费用不含税费、折扣、阶梯价和未知用量，最终以服务商账单为准。超时请求可能已在服务端产生费用；重试可能增加实际账单。

OpenAI / DeepSeek 从 prompt_tokens、completion_tokens、缓存字段统计；Anthropic 输入合计包含 input_tokens、cache_read_input_tokens 和 cache_creation_input_tokens。输出 Token 包括服务返回的推理用量（通常已包含在 completion_tokens 内，不再重复加算）。

网关可在原响应中附带 usage：

```json
{"text":"你好","detectedLanguage":"en","usage":{"inputTokens":100,"outputTokens":20,"cachedInputTokens":40,"cacheWriteTokens":0}}
```

也支持网关直接传递 OpenAI 风格的 usage。网关未返回 usage 时仍可翻译，但只能统计请求次数。记录包含日期、模型、接口、用量与单价，不额外保存待翻译文本或密钥。

协议字段参考：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 0.1.4 默认保留参考文献与引用

网页双语翻译默认跳过 References、Bibliography、Works Cited、参考文献等标题下的参考文献，直到下一个同级或更高层级章节；后续附录仍正常翻译。也识别 arXiv 的 ltx_bibliography / ltx_biblist / ltx_bibitem 和 doc-bibliography 语义标记。blockquote 引用块不翻译。

正文中的 cite、q、doc-biblioref、arXiv ltx_cite、引用链接及 [1] / [2–4] 等数字引用会先保护为占位符，模型只翻译周围正文，再安全恢复原引用文字和 HTTP/HTTPS 链接。模型遗漏或重复引用占位符会判为失败并按重试策略处理。原节点及其事件监听器不改动，译文链接不复制原节点的脚本或事件属性。占位符稳定生成，重复翻译仍可复用缓存；历史中用 [引用] 代替内部占位符。

这些规则用于自动网页翻译；手动选中或输入文本仍属于用户明确请求。未使用语义标记的特殊自定义参考文献布局可能无法识别。生产网关需让模型完整保留 CAIT_CITE 占位符。


## 0.1.5 网页翻译状态

开始双语翻译后，网页右下角显示小型状态条和进度条：翻译中、已处理段落 / 总段落、失败与跳过数量、翻译完成或翻译结束。等待队列和自动重试期间保持「翻译中」；单段手动重试会同步更新进度和失败数。

状态条位于独立 Shadow DOM，固定定位，不占用正文布局；背景不截获点击或滚动，只有「收起 / 展开」和「隐藏」按钮可交互。展开宽度 260px，小屏幕限制在视口内；可收起成更小的文字提示，也可隐藏本次任务状态，均不会停止翻译。恢复原文时状态条隐藏，旧请求不会把状态重新显示；下次开启翻译时重新展示。它仍可能覆盖角落中的少量内容，需要时可收起或隐藏。


## 0.1.6 划词恢复失败段落

网页双语翻译在多次自动重试后仍失败时，选中该失败原文段落中的任意词句，浮动按钮会显示「重译失败段落」。点击后重新翻译完整原文段落，原位更新段落下方已有的双语译文节点，不弹出独立划词窗口、不重复插入节点。引用保护、自动重试、Token / 费用统计继续适用，成功后进度条失败数同步减少。

选区跨越多个失败原文段落时，只重译选区涉及的失败段落；已成功段落不重复处理。重译期间该段从失败集合移除，防止同一个失败状态重复触发。开启双语模式后，普通或漏译段落的划词也采用原位整段翻译；未开启双语模式时仍使用划词弹窗。恢复原文后，旧选区和旧请求不会重新插入译文；刷新网页后需要重新开启双语翻译。


## 0.1.7 Macrodata 漏译修复与大容量缓存

针对 https://macrodata.co/blog/annotating-robot-video-subtasks 实际 DOM 检查：截图两段分别含行内 code 数值（5.77s / 0.070 / 0.081），旧规则误将含代码的整段排除，导致它们没有纳入已完成统计。现在仅保护行内代码本身，周围正文正常参与双语翻译，独立 pre / code 块仍跳过。该页 article-notes 参考文献区域不翻译。标题位于 flex / grid 分组时，译文插入标题分组下方，避免与标题挤在同一行。

开启网页双语模式后，在任意符合正文规则的漏译、失败或已翻译段落中选择词句，点击「翻译选中段落」（失败段落为「重译失败段落」），会翻译完整段落并原位补充 / 更新，不弹窗、不重复插入节点。包括未被初始任务追踪的段落。未开启双语模式时维持划词弹窗。

缓存从 100 条提高为最多 10,000 条 / 64 MiB 内容预算，使用 IndexedDB；不新增 unlimitedStorage 权限。缓存不自动过期，达到条数或内容字节预算时淘汰最久未使用条目。数据库自身索引开销不计入内容预算，实际可用量也受浏览器磁盘配额约束。

- 持久化缓存可跨网页刷新、Service Worker 重启和浏览器重启复用，不随扩展版本号失效。
- 自动迁移旧 chrome.storage.local 缓存，成功迁移后才移除旧数据。源文本与配置规范化后使用 SHA-256 键；语言、模型、接口、领域、解释设置仍分别隔离。
- 规范化多余水平空白与语言代码大小写；保留换行边界。引用及行内代码占位符在无意义空白变化下稳定。
- 划词补译默认优先读取缓存，不再无条件强制请求模型。同一内容并发请求合并，缓存命中不新增 Token 统计。
- 侧边栏显示缓存条数、内容体积、命中次数与命中率。命中率按缓存查询次数计算，不等同于服务商提示词缓存命中率。
- 「清除缓存与记录」同时清除 IndexedDB 翻译缓存与本地翻译历史，保留 Token 统计及服务配置。

回归样本来自上述网页两段实际 DOM。可选完整页面快照复测：CAIT_MACRODATA_SNAPSHOT=/path/to/macrodata-dom.html npm run test:e2e -- macrodata.test.ts。测试使用固定译文验证内容覆盖、数值与引用保留、原位排版和重复访问零新增模型请求，不代表真实模型翻译质量。


## 0.1.8 缓存优先显示与速度诊断

对 0.1.7 实测，150 段同页二次翻译 API 请求为 0，但仍花费约 904ms：前台仍每批 3 段等待消息往返，每条缓存命中独立完成一个 IndexedDB 写事务；部分未命中请求还能阻塞其后的缓存段落。缓存生效不等于界面足够快。

现在先按每批 32 段查询持久化缓存，批量完成 LRU / 命中计数更新并直接渲染缓存结果，再处理未命中的段落。实际模型请求仍由后台限制为最多 3 个并发，前台未命中任务独立调度，不再使用整批完成屏障。模型请求不会阻止本轮已缓存段落先显示。

网页状态依次显示「读取缓存」「翻译中 / 翻译完成」，展开状态附带「缓存 N」计数；命中缓存的单段补译也更新该计数。它统计本次任务实际使用本地缓存的段落数，不是服务商提示词缓存。

同一台机器、150 段固定本机测试页的优化后测量为约 36ms，0 新增 API 请求；实际网站会受到 DOM 规模、缓存命中率与剩余网络请求影响。更换模型、目标语言、领域、接口或解释选项会使用不同缓存，首次访问或清空缓存后仍需联网翻译。无需清空旧缓存即可升级本版本。

### 0.1.9 修复

修复 arXiv 正文因含行内 MathML 公式而整段漏译的问题。正文参与翻译，公式使用占位符保护，并通过安全的 MathML 元素白名单恢复；纯公式、参考文献继续跳过。更新扩展后刷新论文网页并重新开启双语翻译，已有缓存继续保留。

### 0.1.10 图注与表注翻译

网页双语翻译支持 HTML figcaption、table caption 和 arXiv/LaTeXML 的 ltx_caption。译文在原注释文字下方显示，嵌套段落不会重复翻译；保留公式与引用保护、缓存、进度和恢复原文。图片像素内的文字不在本次范围。

### 0.1.11 缓存扩容

默认缓存上限提高至 100,000 条 / 512 MiB 内容预算。无需清除旧缓存，已有条目与命中统计保留；满额仍按 LRU 淘汰。容量按需增长，不预占 512 MiB；实际可用量受浏览器磁盘配额和剩余空间限制。
