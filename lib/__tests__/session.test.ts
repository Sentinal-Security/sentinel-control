import test from "node:test";
import assert from "node:assert/strict";
import { loadRootSession, saveRootSession } from "../api.ts";

function installMockSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  };
  return store;
}

test("loadRootSession returns active session and evicts expired session", () => {
  const store = installMockSessionStorage();

  saveRootSession({
    token: "tok-valid",
    email: "root@sentinel.local",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    apiBaseUrl: "http://localhost:8080",
  });
  const active = loadRootSession();
  assert.ok(active);
  assert.equal(active.token, "tok-valid");

  saveRootSession({
    token: "tok-expired",
    email: "root@sentinel.local",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    apiBaseUrl: "http://localhost:8080",
  });
  const expired = loadRootSession();
  assert.equal(expired, null);
  assert.equal(store.size, 0);
});
