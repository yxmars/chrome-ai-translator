import { beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  });
});
