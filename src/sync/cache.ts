import type { SyncDocument } from "./document";
export interface CachedAccount {
  document: SyncDocument;
  pending: boolean;
  clockOffset: number;
}
export interface AccountCache {
  read: () => Promise<CachedAccount | null>;
  update: (
    transform: (current: CachedAccount | null) => CachedAccount,
  ) => Promise<CachedAccount>;
  clear: () => Promise<void>;
}
/** Project + auth UUID form the partition; the old unowned store is untouched. */
export function createAccountCache(
  project: string,
  owner: string,
): AccountCache {
  const partition = JSON.stringify([project, owner]);
  let database: Promise<IDBDatabase> | undefined;
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(
          new Error(
            "Ative o armazenamento do navegador para usar o app offline.",
          ),
        );
        return;
      }
      let blocked = false;
      const request = indexedDB.open("cash-tracker-accounts", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("accounts");
      request.onerror = () => {
        database = undefined;
        reject(new Error("Não foi possível abrir os dados offline."));
      };
      request.onblocked = () => {
        blocked = true;
        database = undefined;
        reject(
          new Error(
            "Feche outras abas para atualizar o armazenamento offline.",
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    }));
  const transaction = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore, result: CachedAccount | undefined) => T,
  ): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", mode);
      const store = tx.objectStore("accounts"),
        request = store.get(partition);
      let result: T, failure: unknown;
      request.onsuccess = () => {
        try {
          result = action(store, request.result as CachedAccount | undefined);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(
          failure ??
            new Error(
              "Não foi possível salvar os dados offline. A versão anterior foi preservada.",
            ),
        );
    });
  };
  return {
    read: () => transaction("readonly", (_, result) => result ?? null),
    update: (transform) =>
      transaction("readwrite", (store, result) => {
        const next = transform(result ?? null);
        store.put(next, partition);
        return next;
      }),
    clear: () =>
      transaction("readwrite", (store, current) => {
        if (current?.pending)
          throw new Error(
            "Há edições aguardando envio. Sincronize antes de sair.",
          );
        store.delete(partition);
      }),
  };
}
