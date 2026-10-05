export interface AccountIdentity {
  id: string;
  email?: string;
}
export function identityStore(
  project: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const key = `cash-tracker-offline-identity:${project}`;
  return {
    read: (): AccountIdentity | null => {
      try {
        const raw = JSON.parse(storage.getItem(key) ?? "null");
        return raw &&
          typeof raw.id === "string" &&
          /^[0-9a-f-]{36}$/.test(raw.id) &&
          typeof raw.email === "string"
          ? { id: raw.id, email: raw.email }
          : null;
      } catch {
        return null;
      }
    },
    save: (identity: AccountIdentity | null) => {
      try {
        if (identity) storage.setItem(key, JSON.stringify(identity));
        else storage.removeItem(key);
      } catch {
        /* The active account still works; persistence unavailable is surfaced by IndexedDB. */
      }
    },
  };
}
