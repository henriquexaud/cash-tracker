import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { formatMoney } from "./domain/finance";

export const PRIVACY_KEY = "cash-tracker-hide-values";
export const PRIVATE_VALUE = "••••";

export function createPrivacyStore(
  host: Pick<
    Window,
    "localStorage" | "addEventListener" | "removeEventListener"
  >,
) {
  const read = () => {
    try {
      return host.localStorage.getItem(PRIVACY_KEY) === "true";
    } catch {
      return false;
    }
  };
  let hidden = read();
  const listeners = new Set<() => void>();
  const update = (next: boolean) => {
    if (next === hidden) return;
    hidden = next;
    listeners.forEach((listener) => listener());
  };
  const storage = (event: StorageEvent) => {
    if (event.key === PRIVACY_KEY || event.key === null) update(read());
  };
  host.addEventListener("storage", storage);
  return {
    getSnapshot: () => hidden,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHidden: (next: boolean) => {
      try {
        host.localStorage.setItem(PRIVACY_KEY, String(next));
      } catch {
        /* Session preference still works. */
      }
      update(next);
    },
    dispose: () => {
      host.removeEventListener("storage", storage);
      listeners.clear();
    },
  };
}

export function privacySettings(
  hidden: boolean,
  setHidden: (next: boolean) => void,
) {
  return {
    hidden,
    setHidden,
    money: (value: number) => (hidden ? PRIVATE_VALUE : formatMoney(value)),
    protect: (value: string) => (hidden ? PRIVATE_VALUE : value),
  };
}

export const PrivacyContext = createContext(privacySettings(false, () => {}));
let store: ReturnType<typeof createPrivacyStore> | undefined;

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const active = (store ??= createPrivacyStore(window));
  const hidden = useSyncExternalStore(active.subscribe, active.getSnapshot);
  const value = useMemo(
    () => privacySettings(hidden, active.setHidden),
    [hidden, active],
  );
  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export const usePrivacy = () => useContext(PrivacyContext);

export function SensitiveText({ children }: { children: string }) {
  return <>{usePrivacy().protect(children)}</>;
}

export function PrivacyToggle() {
  const { hidden, setHidden } = usePrivacy();
  const label = hidden
    ? "Mostrar valores sensíveis"
    : "Ocultar valores sensíveis";
  return (
    <button
      type="button"
      className="icon-button privacy-toggle"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      onClick={() => setHidden(!hidden)}
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}
