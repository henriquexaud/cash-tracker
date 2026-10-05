import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData } from "../domain/types";
import type { DataRepository, SyncStatus } from "../repository";
import { validateBackup } from "../storage";
import { createAccountCache, type AccountCache } from "../sync/cache";
import {
  applyEdit,
  emptyDocument,
  materialize,
  mergeDocuments,
  needsReview,
  nextStamp,
  validateDocument,
  validateSynchronizedEdit,
  type SyncDocument,
} from "../sync/document";

interface Options {
  cache?: AccountCache;
  now?: () => number;
  online?: () => boolean;
  device?: string;
}
// Only our fixed operational messages may be displayed; provider errors can contain private details.
class SyncFailure extends Error {}
export function createCloudRepository(
  client: SupabaseClient,
  ownerId: string,
  project: string,
  options: Options = {},
): DataRepository {
  const cache = options.cache ?? createAccountCache(project, ownerId);
  const now = options.now ?? Date.now;
  const online = options.online ?? (() => navigator.onLine);
  const device = options.device ?? crypto.randomUUID();
  const listeners = new Set<() => void>();
  let status: SyncStatus = "pending",
    active = true;
  let baseline: AppData | null = null;
  let syncError: string | null = null;
  let pendingChanges = false;
  let inFlight: Promise<void> | null = null;
  const emit = (next: SyncStatus, changed = false) => {
    if (next === status && !changed) return;
    status = next;
    if (active) listeners.forEach((listener) => listener());
  };
  const assertActive = () => {
    if (!active)
      throw new Error(
        "Esta conta foi fechada. Entre novamente para continuar.",
      );
  };
  const requestSync = async (document: SyncDocument) => {
    assertActive();
    const session = await client.auth.getSession();
    if (session.data.session?.user.id !== ownerId)
      throw new SyncFailure(
        "Entre novamente para sincronizar esta conta.",
      );
    const { data, error } = await client
      .rpc("sync_financial_data", { incoming: document })
      .setHeader(
        "Authorization",
        `Bearer ${session.data.session!.access_token}`,
      );
    assertActive();
    if (error || !data)
      throw new SyncFailure(
        "Não foi possível atualizar sua conta. Tente sincronizar novamente.",
      );
    const serverNow = Date.parse(data.server_time);
    if (!Number.isFinite(serverNow))
      throw new SyncFailure("O servidor retornou uma data inválida. Tente sincronizar novamente.");
    return {
      document: validateDocument(data.document),
      offset: serverNow - now(),
    };
  };
  const sync = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (!active) return Promise.resolve();
    if (!online()) {
      emit("offline");
      return Promise.resolve();
    }
    inFlight = (async () => {
      syncError = null;
      emit("syncing");
      try {
        const before = await cache.read();
        pendingChanges = before?.pending ?? false;
        const remote = await requestSync(
          before?.pending ? before.document : emptyDocument(),
        );
        const merged = await cache.update((current) => {
          assertActive();
          const document = mergeDocuments(
            current?.document ?? emptyDocument(),
            remote.document,
          );
          materialize(document); // Reject malformed responses before committing.
          const pending = Object.entries(document.records).some(
            ([id, row]) =>
              !remote.document.records[id] ||
              row.stamp > remote.document.records[id].stamp,
          );
          return { document, pending, clockOffset: remote.offset };
        });
        pendingChanges = merged.pending;
        emit(
          needsReview(materialize(merged.document))
            ? "review"
            : merged.pending
              ? "pending"
              : "synced",
          true,
        );
      } catch (error) {
        syncError = error instanceof SyncFailure ? error.message : "Não foi possível atualizar sua conta. Tente novamente.";
        if (active) emit(online() ? "error" : "offline", true);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return {
    mode: "cloud",
    sync,
    getStatus: () => status,
    getSyncError: () => syncError,
    hasPendingChanges: () => pendingChanges,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: async () => {
      assertActive();
      let stored = await cache.read();
      if (!stored) {
        await sync();
        stored = await cache.read();
      }
      if (!stored)
        throw new Error(
          "Abra esta conta com internet uma vez para preparar os dados offline. Confira também a configuração do Supabase.",
        );
      validateDocument(stored.document);
      const pendingChanged = pendingChanges !== stored.pending;
      pendingChanges = stored.pending;
      baseline = materialize(stored.document);
      if (needsReview(baseline)) emit("review", pendingChanged);
      else if (!online()) emit("offline", pendingChanged);
      else if (status !== "syncing" && status !== "error")
        emit(stored.pending ? "pending" : "synced", pendingChanged);
      else if (pendingChanged) emit(status, true);
      return structuredClone(baseline);
    },
    save: async (input) => {
      assertActive();
      const snapshot = baseline
        ? validateSynchronizedEdit(baseline, input)
        : validateBackup(input);
      if (!baseline) throw new Error("Abra os dados da conta antes de salvar.");
      const before = structuredClone(baseline);
      const saved = await cache.update((current) => {
        assertActive();
        if (!current)
          throw new Error(
            "Os dados offline não foram encontrados. Reabra a conta.",
          );
        const document = applyEdit(
          current.document,
          before,
          snapshot,
          nextStamp(current.document, now() + current.clockOffset, device),
        );
        materialize(document);
        return { ...current, document, pending: true };
      });
      baseline = materialize(saved.document);
      pendingChanges = saved.pending;
      emit(online() ? "pending" : "offline");
      // The UI's commit completes after durable local storage, never after a network wait.
      void sync();
    },
    clear: async () => {
      assertActive();
      const stored = await cache.read();
      if (stored?.pending)
        throw new Error(
          "Há edições aguardando envio. Conecte-se e sincronize antes de sair para preservar seus dados.",
        );
      await inFlight;
      active = false;
      try {
        await cache.clear();
      } catch (error) {
        active = true;
        throw error;
      }
      listeners.clear();
    },
    dispose: () => {
      active = false;
      listeners.clear();
    },
  };
}
