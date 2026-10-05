import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCloudRepository } from "../auth/cloud-repository";
import { createAccountCache } from "./cache";
import {
  applyEdit,
  emptyDocument,
  flatten,
  materialize,
  mergeDocuments,
  needsReview,
  validateSynchronizedEdit,
  nextStamp,
  type SyncDocument,
} from "./document";
import { createEmptyData } from "../domain/empty";
import { exportBackup, validateBackup } from "../storage";
import type { AppData } from "../domain/types";

const owner = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const d1 = "10000000-0000-4000-8000-000000000001";
const d2 = "10000000-0000-4000-8000-000000000002";
let time: number;
const salary = (month: string, amount: number) => ({
  id: `salary-${month}`,
  month,
  amount,
});
function initial() {
  const data = createEmptyData();
  data.accounts = [{ id: "reserve", name: "Minha reserva" }];
  data.salaries = [salary("2026-10", 500000)];
  data.movements = [
    {
      id: "opening",
      accountId: "reserve",
      date: "2026-10-01",
      kind: "opening",
      amount: 100000,
      note: "",
    },
  ];
  data.budgets = [
    {
      month: "2026-10",
      reservePlan: 100,
      items: [
        {
          id: "rent",
          name: "Moradia",
          kind: "fixed",
          frequency: "monthly",
          unitAmount: 10000,
          factor: 1,
        },
        {
          id: "food",
          name: "Alimentação",
          kind: "variable",
          frequency: "monthly",
          unitAmount: 20000,
          factor: 1,
        },
      ],
    },
  ];
  return data;
}
function server() {
  const documents = new Map<string, SyncDocument>();
  let identity = owner,
    unavailable = false;
  let gate: Promise<void> | undefined;
  const rpc = vi.fn((_name: string, input: { incoming: SyncDocument }) => ({
    setHeader: vi.fn(async (_name: string, bearer: string) => {
      const user = bearer.replace("Bearer ", "");
      if (gate) await gate;
      if (unavailable) return { error: { code: "NETWORK" }, data: null };
      const document = mergeDocuments(
        documents.get(user) ?? emptyDocument(),
        input.incoming,
      );
      documents.set(user, document);
      return {
        error: null,
        data: {
          document: structuredClone(document),
          server_time: new Date(time).toISOString(),
        },
      };
    }),
  }));
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: identity }, access_token: identity } },
        error: null,
      })),
    },
    rpc,
  } as unknown as SupabaseClient;
  const device = (name: string, id = owner) => {
    let online = true;
    const cache = createAccountCache(`test-project-${name}`, id);
    const repo = createCloudRepository(client, id, "test-project", {
      cache,
      now: () => time,
      online: () => online,
      device: name === "a" ? d1 : d2,
    });
    return {
      repo,
      cache,
      offline: () => {
        online = false;
      },
      online: () => {
        online = true;
      },
    };
  };
  return {
    documents,
    client,
    device,
    rpc,
    identity: (id: string) => {
      identity = id;
    },
    unavailable: (value: boolean) => {
      unavailable = value;
    },
    gate: (value?: Promise<void>) => {
      gate = value;
    },
  };
}
async function edit(
  repo: ReturnType<typeof createCloudRepository>,
  transform: (data: AppData) => void,
) {
  const data = (await repo.load())!;
  transform(data);
  await repo.save(data);
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  time = Date.UTC(2026, 9, 4);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sincronização offline por conta", () => {
  it("não cria dados de planilha em uma conta nova e exige primeiro acesso online", async () => {
    const s = server(),
      a = s.device("a");
    a.offline();
    await expect(a.repo.load()).rejects.toThrow(/internet uma vez/);
    expect(await a.cache.read()).toBeNull();
    expect(s.rpc).not.toHaveBeenCalled();
    a.online();
    const data = (await a.repo.load())!;
    expect(data.salaries).toEqual([]);
    expect(data.accounts).toEqual([]);
    expect(data.legacy.status).toBe("none");
    expect(validateBackup(data)).toEqual(data);
  });
  it("preserva edições offline ao reabrir e sincroniza ao reconectar", async () => {
    const s = server(),
      a = s.device("a");
    await a.repo.load();
    a.offline();
    await a.repo.save(initial());
    expect((await a.cache.read())?.pending).toBe(true);
    const reopened = s.device("a");
    reopened.offline();
    expect(await reopened.repo.load()).toEqual(initial());
    expect(reopened.repo.getStatus?.()).toBe("offline");
    reopened.online();
    await reopened.repo.sync?.();
    expect(reopened.repo.getStatus?.()).toBe("synced");
    const b = s.device("b");
    expect(await b.repo.load()).toEqual(initial());
  });
  it("combina salários e itens de orçamento editados em dois dispositivos offline", async () => {
    const s = server(),
      a = s.device("a"),
      b = s.device("b");
    await a.repo.load();
    await a.repo.save(initial());
    await a.repo.sync?.();
    await b.repo.load();
    a.offline();
    b.offline();
    time += 100;
    await edit(a.repo, (data) => {
      data.salaries.push(salary("2026-11", 600000));
      data.budgets[0].items[0].unitAmount = 11000;
    });
    time += 100;
    await edit(b.repo, (data) => {
      data.salaries[0].amount = 550000;
      data.budgets[0].items[1].unitAmount = 22000;
    });
    b.online();
    await b.repo.sync?.();
    a.online();
    await a.repo.sync?.();
    await b.repo.sync?.();
    const merged = (await a.repo.load())!;
    expect(merged.salaries.map((row) => row.amount)).toEqual([550000, 600000]);
    expect(merged.budgets[0].items.map((row) => row.unitAmount)).toEqual([
      11000, 22000,
    ]);
    expect(await b.repo.load()).toEqual(merged);
  });
  it("prioriza o momento da edição, mesmo quando a edição antiga chega depois", async () => {
    const s = server(),
      a = s.device("a"),
      b = s.device("b");
    await a.repo.load();
    await a.repo.save(initial());
    await a.repo.sync?.();
    await b.repo.load();
    a.offline();
    b.offline();
    time += 100;
    await edit(a.repo, (data) => {
      data.salaries[0].amount = 400000;
    });
    time += 100;
    await edit(b.repo, (data) => {
      data.salaries[0].amount = 700000;
    });
    b.online();
    await b.repo.sync?.();
    a.online();
    await a.repo.sync?.();
    expect((await a.repo.load())!.salaries[0].amount).toBe(700000);
  });
  it("não ressuscita exclusões ao receber um dispositivo antigo", async () => {
    const s = server(),
      a = s.device("a"),
      b = s.device("b");
    await a.repo.load();
    await a.repo.save(initial());
    await a.repo.sync?.();
    await b.repo.load();
    b.offline();
    a.offline();
    time += 100;
    await edit(a.repo, (data) => {
      data.salaries = [];
    });
    a.online();
    await a.repo.sync?.();
    b.online();
    await b.repo.sync?.();
    expect((await b.repo.load())!.salaries).toEqual([]);
  });
  it("mantém pendente uma edição feita enquanto a rede enviava a versão anterior", async () => {
    const s = server(),
      a = s.device("a");
    await a.repo.load();
    a.offline();
    await a.repo.save(initial());
    let release!: () => void;
    s.gate(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    a.online();
    const syncing = a.repo.sync!();
    await vi.waitFor(() => expect(s.rpc).toHaveBeenCalledTimes(2));
    time += 100;
    await edit(a.repo, (data) => {
      data.salaries[0].amount = 900000;
    });
    release();
    await syncing;
    s.gate();
    expect((await a.cache.read())?.pending).toBe(true);
    expect(a.repo.getStatus?.()).toBe("pending");
    await a.repo.sync?.();
    expect((await a.cache.read())?.pending).toBe(false);
    expect((await s.device("b").repo.load())!.salaries[0].amount).toBe(900000);
  });
  it("salva sem rede e não confirma envio quando a sessão pertence a outra conta", async () => {
    const s = server(),
      a = s.device("a");
    await a.repo.load();
    s.identity(second);
    await a.repo.save(initial());
    await a.repo.sync?.();
    expect(a.repo.getStatus?.()).toBe("error");
    expect((await a.cache.read())?.pending).toBe(true);
    expect(s.documents.get(second)).toBeUndefined();
    await expect(a.repo.clear?.()).rejects.toThrow(/aguardando/);
    expect(await a.repo.load()).toEqual(initial());
    expect(a.repo.getStatus?.()).toBe("error");
    expect(a.repo.hasPendingChanges?.()).toBe(true);
    expect(a.repo.getSyncError?.()).toContain("Entre novamente");
  });
  it("diferencia atualização indisponível de envio pendente e limpa o erro após reconectar", async () => {
    const s = server(), a = s.device("a");
    await a.repo.load();
    s.unavailable(true);
    await a.repo.sync?.();
    expect(a.repo.getStatus?.()).toBe("error");
    expect(a.repo.hasPendingChanges?.()).toBe(false);
    expect(a.repo.getSyncError?.()).toBe("Não foi possível atualizar sua conta. Tente sincronizar novamente.");
    await a.repo.save(initial());
    await a.repo.sync?.();
    expect(a.repo.hasPendingChanges?.()).toBe(true);
    expect(a.repo.getStatus?.()).toBe("error");
    await a.repo.load();
    expect(a.repo.getStatus?.()).toBe("error");
    s.unavailable(false);
    await a.repo.sync?.();
    expect(a.repo.getSyncError?.()).toBeNull();
    expect(a.repo.hasPendingChanges?.()).toBe(false);
    expect(a.repo.getStatus?.()).toBe("synced");
  });
  it("não apresenta conteúdo arbitrário de uma exceção do provedor", async () => {
    const s = server(), a = s.device("a");
    await a.repo.load();
    vi.mocked(s.client.auth.getSession).mockRejectedValueOnce(new Error("token=segredo@example.com"));
    await a.repo.sync?.();
    expect(a.repo.getSyncError?.()).toBe("Não foi possível atualizar sua conta. Tente novamente.");
    expect(a.repo.hasPendingChanges?.()).toBe(false);
  });
  it("notifica uma pendência criada em outra aba sem apagar o erro nem repetir notificações", async () => {
    const s = server(), a = s.device("a"), b = s.device("a");
    await a.repo.load();
    await b.repo.load();
    s.unavailable(true);
    await a.repo.sync?.();
    b.offline();
    await b.repo.save(initial());
    const listener = vi.fn();
    a.repo.subscribe?.(listener);
    await a.repo.load();
    expect(a.repo.getStatus?.()).toBe("error");
    expect(a.repo.hasPendingChanges?.()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    await a.repo.load();
    expect(listener).toHaveBeenCalledOnce();
  });
  it("isola contas e projetos no armazenamento do mesmo navegador", async () => {
    const s = server(),
      a = s.device("a");
    await a.repo.load();
    await a.repo.save(initial());
    await a.repo.sync?.();
    s.identity(second);
    const b = s.device("a", second);
    expect((await b.repo.load())!.salaries).toEqual([]);
    expect(
      await createAccountCache("different-project", owner).read(),
    ).toBeNull();
    expect(await a.repo.load()).toEqual(initial());
  });
  it("permite sair após sincronizar, remove a cópia offline e rejeita gravações antigas", async () => {
    const s = server(),
      a = s.device("a");
    await a.repo.load();
    await a.repo.save(initial());
    await a.repo.sync?.();
    await a.repo.clear?.();
    expect(await a.cache.read()).toBeNull();
    await expect(a.repo.save(initial())).rejects.toThrow(/fechada/);
    expect(materialize(s.documents.get(owner)!)).toEqual(initial());
  });
});

describe("mesclagem de registros e consistência financeira", () => {
  it("converge em qualquer ordem, com empate determinístico e sem repetir lançamentos", () => {
    const base = emptyDocument(),
      data = initial();
    const a = applyEdit(
      base,
      createEmptyData(),
      data,
      nextStamp(base, time, d1),
    );
    const newer = structuredClone(data);
    newer.salaries[0].amount = 100000;
    const b = applyEdit(
      base,
      createEmptyData(),
      newer,
      nextStamp(base, time, d2),
    );
    expect(mergeDocuments(a, b)).toEqual(mergeDocuments(b, a));
    expect(mergeDocuments(a, a)).toEqual(a);
    expect(materialize(mergeDocuments(a, b)).salaries[0].amount).toBe(100000);
    expect(Object.keys(flatten(materialize(a)))).length.greaterThan(0);
  });
  it("preserva retiradas concorrentes e sinaliza revisão em vez de apagar um lançamento", () => {
    const data = initial(),
      base = applyEdit(
        emptyDocument(),
        createEmptyData(),
        data,
        nextStamp(emptyDocument(), time, d1),
      );
    const a = structuredClone(data),
      b = structuredClone(data);
    a.movements.push({
      id: "w-a",
      accountId: "reserve",
      date: "2026-10-02",
      kind: "withdrawal",
      amount: 80000,
      note: "",
    });
    b.movements.push({
      id: "w-b",
      accountId: "reserve",
      date: "2026-10-02",
      kind: "withdrawal",
      amount: 80000,
      note: "",
    });
    validateBackup(a);
    validateBackup(b);
    const merged = materialize(
      mergeDocuments(
        applyEdit(base, data, a, nextStamp(base, time + 1, d1)),
        applyEdit(base, data, b, nextStamp(base, time + 2, d2)),
      ),
    );
    expect(merged.movements).toHaveLength(3);
    expect(needsReview(merged)).toBe(true);
    merged.movements = merged.movements.filter((row) => row.id !== "w-a");
    expect(needsReview(merged)).toBe(false);
  });
});

describe("correção gradual de concorrências financeiras", () => {
  it("permite corrigir contas separadamente, preserva backup e impede um novo saldo inconsistente", () => {
    const data = createEmptyData();
    data.accounts = [
      { id: "a", name: "Primeira" },
      { id: "b", name: "Segunda" },
      { id: "c", name: "Terceira" },
    ];
    for (const accountId of ["a", "b", "c"])
      data.movements.push({
        id: `open-${accountId}`,
        accountId,
        date: "2026-10-01",
        kind: "opening",
        amount: 100000,
        note: "",
      });
    for (const accountId of ["a", "b"])
      for (const index of [1, 2])
        data.movements.push({
          id: `w-${accountId}-${index}`,
          accountId,
          date: "2026-10-02",
          kind: "withdrawal",
          amount: 80000,
          note: "",
        });
    expect(needsReview(data)).toBe(true);
    const first = structuredClone(data);
    first.movements = first.movements.filter((row) => row.id !== "w-a-1");
    expect(validateSynchronizedEdit(data, first)).toEqual(first);
    expect(needsReview(first)).toBe(true);
    const backup = JSON.parse(exportBackup(first));
    expect(backup.requiresReview).toBe(true);
    expect(backup.data.movements).toHaveLength(first.movements.length);
    const invalid = structuredClone(first);
    invalid.movements.push({
      id: "w-c",
      accountId: "c",
      date: "2026-10-02",
      kind: "withdrawal",
      amount: 200000,
      note: "",
    });
    expect(() => validateSynchronizedEdit(first, invalid)).toThrow();
    const fixed = structuredClone(first);
    fixed.movements = fixed.movements.filter((row) => row.id !== "w-b-1");
    expect(needsReview(validateSynchronizedEdit(first, fixed))).toBe(false);
  });
});
