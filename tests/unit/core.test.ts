import { describe, it, expect, vi, beforeEach } from "vitest";
import { Semaphore, TranslationService } from "../../src/translation/service";
import { defaults } from "../../src/shared/types";
import {
  endpointOrigin,
  parseResult,
  OpenAIProvider,
  AnthropicProvider,
  prompt,
} from "../../src/translation/providers";
import { paragraphs } from "../../src/content/dom";
let store: Record<string, any>;
beforeEach(() => {
  store = { settings: { ...defaults, mode: "direct", apiKey: "test" } };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]),
          ),
        ),
        set: vi.fn(async (v: object) => Object.assign(store, v)),
        remove: vi.fn(async (keys: string[]) =>
          keys.forEach((k) => delete store[k]),
        ),
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: "你好",
                    detectedLanguage: "en",
                  }),
                },
              },
            ],
          }),
        ),
    ),
  );
});
describe("providers and safety", () => {
  it("validates secure endpoints", () => {
    expect(endpointOrigin("https://example.org/v1")).toBe(
      "https://example.org/*",
    );
    expect(() => endpointOrigin("http://example.org")).toThrow();
    expect(() => endpointOrigin("https://user:pass@example.org")).toThrow();
    expect(endpointOrigin("http://127.0.0.1:4211/translate")).toBe(
      "http://127.0.0.1/*",
    );
  });
  it("parses structured responses and rejects invalid output", () => {
    expect(
      parseResult('```json\n{"text":"你好","detectedLanguage":"en"}\n```').text,
    ).toBe("你好");
    expect(() => parseResult('{"text":12}')).toThrow();
  });
  it("sends correct OpenAI payload", async () => {
    await new OpenAIProvider().translate("Hello", store.settings);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string).messages[1].content).toBe("Hello");
    expect(init!.headers).toMatchObject({ Authorization: "Bearer test" });
  });
  it("uses Anthropic headers and response blocks", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: '{"text":"译文","detectedLanguage":"en"}' },
          ],
        }),
      ),
    );
    expect(
      (await new AnthropicProvider().translate("hello", store.settings)).text,
    ).toBe("译文");
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
    });
  });
  it("handles HTTP errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 429 }));
    await expect(
      new OpenAIProvider().translate("x", store.settings),
    ).rejects.toThrow("429");
  });
  it("includes domain glossary", () => {
    expect(prompt({ ...defaults, domain: "robotics" })).toContain("SLAM");
  });
});
describe("service", () => {
  it("deduplicates requests and persists cache", async () => {
    const service = new TranslationService();
    await Promise.all([service.translate("hello"), service.translate("hello")]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await service.translate("hello");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.history).toHaveLength(1);
  });
  it("separates cache by target language", async () => {
    const s = new TranslationService();
    await s.translate("hello");
    store.settings.target = "ja";
    await s.translate("hello");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("clears persistent history and cache", async () => {
    const s = new TranslationService();
    await s.translate("hello");
    await s.clear();
    expect((await s.state()).history).toHaveLength(0);
    expect(store.cache).toBeUndefined();
  });
  it("rejects oversized text", async () => {
    await expect(
      new TranslationService().translate("x".repeat(12001)),
    ).rejects.toThrow();
  });
  it("limits concurrent jobs", async () => {
    const queue = new Semaphore(3);
    let active = 0,
      max = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        queue.run(async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(max).toBe(3);
  });
});
it("excludes editable areas, code, nested paragraphs and existing translations", () => {
  document.body.innerHTML =
    '<main><p id="yes">This is an ordinary article paragraph.</p><pre><p>This code paragraph should not translate.</p></pre><div contenteditable=""><p>Editable text should never be translated.</p></div><p>This contains <code>inline code</code> and is excluded.</p><div data-cait="translation"><p>Translated contents should be excluded.</p></div></main>';
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  expect(paragraphs().map((e) => e.id)).toEqual(["yes"]);
});
