import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { createThemeStore, THEME_STORAGE_KEY } from "./theme";

function browserTheme({
  saved,
  dark = false,
  blockedStorage = false,
}: {
  saved?: string;
  dark?: boolean;
  blockedStorage?: boolean;
} = {}) {
  const values = new Map<string, string>();
  if (saved) values.set(THEME_STORAGE_KEY, saved);
  const listeners = new Map<string, (event: StorageEvent) => void>();
  let systemChange: (() => void) | undefined;
  const media = {
    matches: dark,
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      systemChange = listener;
    }),
    removeEventListener: vi.fn(() => {
      systemChange = undefined;
    }),
  };
  const meta = { content: "#244b3b", setAttribute: vi.fn() };
  meta.setAttribute.mockImplementation((_name: string, content: string) => {
    meta.content = content;
  });
  const document = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
    },
    querySelector: () => meta,
  };
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const host = {
    document,
    get localStorage() {
      if (blockedStorage) throw new Error("Storage unavailable");
      return storage;
    },
    matchMedia: () => media,
    addEventListener: (name: string, listener: (event: StorageEvent) => void) => {
      listeners.set(name, listener);
    },
    removeEventListener: (name: string) => {
      listeners.delete(name);
    },
  };
  return {
    host: host as unknown as Parameters<typeof createThemeStore>[0],
    document,
    meta,
    storage,
    setSystemDark: (next: boolean) => {
      media.matches = next;
      systemChange?.();
    },
    changeFromAnotherTab: (key: string | null, value: string | null) => {
      if (key === null) values.clear();
      else if (value === null) values.delete(key);
      else values.set(key, value);
      listeners.get("storage")?.({ key, newValue: value } as StorageEvent);
    },
  };
}

describe("device appearance", () => {
  it("starts with the system and follows appearance changes without financial storage writes", () => {
    const browser = browserTheme({ dark: true });
    const store = createThemeStore(browser.host);
    const changed = vi.fn();
    store.subscribe(changed);
    expect(store.getSnapshot()).toEqual({
      preference: "system",
      resolvedTheme: "dark",
    });
    expect(browser.document.documentElement.dataset.theme).toBe("dark");
    expect(browser.document.documentElement.style.colorScheme).toBe("dark");
    expect(browser.meta.content).toBe("#101a17");

    browser.setSystemDark(false);
    expect(store.getSnapshot().resolvedTheme).toBe("light");
    expect(browser.meta.content).toBe("#244b3b");
    expect(changed).toHaveBeenCalledOnce();
    expect(browser.storage.setItem).not.toHaveBeenCalled();
    store.dispose();
  });

  it("keeps a manual choice across reloads and resumes automatic changes when System is chosen", () => {
    const browser = browserTheme();
    const firstLoad = createThemeStore(browser.host);
    firstLoad.setPreference("dark");
    browser.setSystemDark(false);
    expect(firstLoad.getSnapshot()).toEqual({
      preference: "dark",
      resolvedTheme: "dark",
    });
    firstLoad.dispose();

    const nextLoad = createThemeStore(browser.host);
    expect(nextLoad.getSnapshot().resolvedTheme).toBe("dark");
    nextLoad.setPreference("system");
    expect(nextLoad.getSnapshot().resolvedTheme).toBe("light");
    browser.setSystemDark(true);
    expect(nextLoad.getSnapshot().resolvedTheme).toBe("dark");
    expect(browser.storage.setItem.mock.calls).toEqual([
      [THEME_STORAGE_KEY, "dark"],
      [THEME_STORAGE_KEY, "system"],
    ]);
    nextLoad.dispose();
  });

  it("syncs appearance changes between tabs and ignores unrelated storage", () => {
    const browser = browserTheme();
    const store = createThemeStore(browser.host);
    const initial = store.getSnapshot();
    browser.changeFromAnotherTab("unrelated-data", "dark");
    expect(store.getSnapshot()).toBe(initial);
    browser.changeFromAnotherTab(THEME_STORAGE_KEY, "dark");
    expect(store.getSnapshot().resolvedTheme).toBe("dark");
    browser.changeFromAnotherTab(THEME_STORAGE_KEY, "invalid");
    expect(store.getSnapshot()).toEqual({
      preference: "system",
      resolvedTheme: "light",
    });
    browser.changeFromAnotherTab(THEME_STORAGE_KEY, "dark");
    browser.changeFromAnotherTab(null, null);
    expect(store.getSnapshot().preference).toBe("system");
    expect(browser.storage.setItem).not.toHaveBeenCalled();
    store.dispose();
  });

  it("allows a session choice when the browser blocks localStorage", () => {
    const browser = browserTheme({ blockedStorage: true, dark: true });
    const store = createThemeStore(browser.host);
    expect(store.getSnapshot().resolvedTheme).toBe("dark");
    expect(() => store.setPreference("light")).not.toThrow();
    expect(store.getSnapshot()).toEqual({
      preference: "light",
      resolvedTheme: "light",
    });
    browser.setSystemDark(true);
    expect(browser.document.documentElement.dataset.theme).toBe("light");
    store.dispose();
  });

  it("removes listeners when disposed", () => {
    const browser = browserTheme();
    const store = createThemeStore(browser.host);
    const changed = vi.fn();
    store.subscribe(changed);
    store.dispose();
    browser.setSystemDark(true);
    browser.changeFromAnotherTab(THEME_STORAGE_KEY, "dark");
    expect(changed).not.toHaveBeenCalled();
    expect(store.getSnapshot().resolvedTheme).toBe("light");
  });
});

describe("theme before the app loads", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  it.each([
    { dark: false, expected: "light" },
    { dark: true, expected: "dark" },
    { saved: "dark", dark: false, expected: "dark" },
    { saved: "light", dark: true, expected: "light" },
    { saved: "invalid", dark: true, expected: "dark" },
    { blockedStorage: true, dark: true, expected: "dark" },
  ])("uses the saved or system appearance without a light flash: %o", (scenario) => {
    const browser = browserTheme(scenario);
    const context = {
      document: browser.document,
      matchMedia: browser.host.matchMedia,
      get localStorage() {
        return browser.host.localStorage;
      },
    };
    expect(bootstrap).toBeTruthy();
    runInNewContext(bootstrap!, context);
    expect(browser.document.documentElement.dataset.theme).toBe(
      scenario.expected,
    );
    expect(browser.document.documentElement.style.colorScheme).toBe(
      scenario.expected,
    );
    const beforeRender = browser.meta.content;
    const store = createThemeStore(browser.host);
    expect(store.getSnapshot().resolvedTheme).toBe(scenario.expected);
    expect(browser.meta.content).toBe(beforeRender);
    store.dispose();
  });
});
