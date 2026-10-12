/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORAGE_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

/** System close requests (Android back button or gesture). Not in TypeScript's DOM library yet. */
declare class CloseWatcher extends EventTarget {
  onclose: (() => void) | null;
  destroy(): void;
}
