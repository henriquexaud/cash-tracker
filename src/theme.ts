import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export interface ThemeSnapshot {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}
export interface ThemeSettings extends ThemeSnapshot {
  setPreference: (preference: ThemePreference) => void;
}

export const THEME_STORAGE_KEY = "cash-tracker-theme";
const systemQuery = "(prefers-color-scheme: dark)";
const themeColors: Record<ResolvedTheme, string> = {
  light: "#244b3b",
  dark: "#101a17",
};

type ThemeHost = Pick<
  Window,
  | "localStorage"
  | "matchMedia"
  | "addEventListener"
  | "removeEventListener"
  | "document"
>;

function normalizePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function createThemeStore(host: ThemeHost) {
  const listeners = new Set<() => void>();
  const readPreference = () => {
    try {
      return normalizePreference(host.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      return "system";
    }
  };
  let media: MediaQueryList | undefined;
  try {
    media = host.matchMedia(systemQuery);
  } catch {
    // A manual preference remains available if the browser cannot read its theme.
  }
  let preference = readPreference();
  const resolve = (): ResolvedTheme =>
    preference === "system" ? (media?.matches ? "dark" : "light") : preference;
  let snapshot: ThemeSnapshot = { preference, resolvedTheme: resolve() };
  const apply = () => {
    const root = host.document.documentElement;
    root.dataset.theme = snapshot.resolvedTheme;
    root.style.colorScheme = snapshot.resolvedTheme;
    host.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeColors[snapshot.resolvedTheme]);
    host.document
      .querySelector('link#app-favicon')
      ?.setAttribute("href", `/icons/wallet-favicon-${snapshot.resolvedTheme}.png`);
  };
  const update = () => {
    const resolvedTheme = resolve();
    if (
      snapshot.preference === preference &&
      snapshot.resolvedTheme === resolvedTheme
    )
      return;
    snapshot = { preference, resolvedTheme };
    apply();
    listeners.forEach((listener) => listener());
  };
  const onSystemChange = () => update();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    preference =
      event.key === null
        ? readPreference()
        : normalizePreference(event.newValue);
    update();
  };

  apply();
  if (media?.addEventListener)
    media.addEventListener("change", onSystemChange);
  else media?.addListener(onSystemChange);
  host.addEventListener("storage", onStorage);

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreference: (next: ThemePreference) => {
      preference = next;
      try {
        host.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Keep the chosen appearance for this session when storage is unavailable.
      }
      update();
    },
    dispose: () => {
      if (media?.removeEventListener)
        media.removeEventListener("change", onSystemChange);
      else media?.removeListener(onSystemChange);
      host.removeEventListener("storage", onStorage);
      listeners.clear();
    },
  };
}

let activeStore: ReturnType<typeof createThemeStore> | undefined;
export const initializeTheme = () =>
  (activeStore ??= createThemeStore(window));

export function useTheme(): ThemeSettings {
  const store = initializeTheme();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, setPreference: store.setPreference };
}
