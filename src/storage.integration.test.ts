import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { createTestData } from "./test/fixtures";
import type { AppData } from "./domain/types";

type StorageApi = typeof import("./storage");

async function newTab(): Promise<StorageApi> {
  // Separate module state models separate tabs; the IndexedDB factory stays shared.
  vi.resetModules();
  return import("./storage");
}

async function seed(tab: StorageApi): Promise<AppData> {
  expect(await tab.loadData()).toBeNull();
  const data = createTestData();
  await tab.saveData(data);
  return data;
}

function backupState(): AppData {
  const data = createTestData();
  data.salaries.push({
    id: "salary-2026-10",
    month: "2026-10",
    amount: 812_345,
  });
  data.budgets = [
    {
      month: "2026-10",
      items: structuredClone(data.budgetTemplate),
      reservePlan: 100_000,
    },
  ];
  data.movements = [
    {
      id: "opening",
      accountId: data.accounts[0].id,
      date: "2026-10-01",
      kind: "opening",
      amount: 1_500_051,
      note: "Saldo conferido com centavos",
    },
  ];
  data.goals = [
    {
      id: "goal-reserve",
      accountId: data.accounts[0].id,
      name: "Reserva",
      target: 3_000_000,
      allocated: 1_000_023,
    },
  ];
  data.preferences.lastBackupAt = "2026-10-02T03:00:00.000Z";
  return data;
}

/** Corrupt an existing persistent record to model damaged/migrated local contents. */
async function corruptSavedSalary(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cash-tracker", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("state", "readwrite");
      const store = transaction.objectStore("state");
      const request = store.get("current");
      request.onsuccess = () => {
        const record = request.result as { revision: number; data: AppData };
        record.data.salaries[0].amount = 0.5;
        store.put(record, "current");
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

describe("persistência IndexedDB", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserva histórico mensal antigo ao reabrir, usando dados fictícios", async () => {
    const tab = await newTab();
    expect(await tab.loadData()).toBeNull();
    const original = backupState();
    original.legacy.status = "resolved";
    original.legacy.historyImported = true;
    original.movements = [
      { id: "monthly-contribution", accountId: "account-test", date: "2026-08-01", datePrecision: "month", kind: "contribution", amount: 2_000_000, note: "Histórico fictício" },
      { id: "monthly-return", accountId: "account-test", date: "2026-09-01", datePrecision: "month", kind: "return", amount: 250, note: "Rendimento fictício" },
    ];
    await tab.saveData(original);
    expect(await (await newTab()).loadData()).toEqual(original);
  });

  it("distingue armazenamento vazio sem inserir dados automaticamente", async () => {
    const firstTab = await newTab();
    expect(await firstTab.loadData()).toBeNull();
    const reopened = await newTab();
    expect(await reopened.loadData()).toBeNull();
  });

  it("mantém valores e coleções ao gravar e reabrir o aplicativo", async () => {
    const tab = await newTab();
    await seed(tab);
    const expected = backupState();
    await tab.saveData(expected);
    const reopened = await newTab();
    expect(await reopened.loadData()).toEqual(expected);
  });

  it("uma falha de leitura rejeita em vez de retornar banco vazio ou substituir dados", async () => {
    const tab = await newTab();
    const original = await seed(tab);
    const originalGet = FakeObjectStore.prototype.get;
    const readFailure = vi
      .spyOn(FakeObjectStore.prototype, "get")
      .mockImplementation(function (
        this: IDBObjectStore,
        query: IDBValidKey | IDBKeyRange,
      ) {
        const request = originalGet.call(this, query);
        this.transaction.abort();
        return request;
      });
    await expect(tab.loadData()).rejects.toThrow(
      /leitura.*interrompida|ler os dados/,
    );
    readFailure.mockRestore();
    expect(await (await newTab()).loadData()).toEqual(original);
  });

  it("recusa gravação de uma aba desatualizada sem apagar o trabalho da outra", async () => {
    const firstTab = await newTab();
    const original = await seed(firstTab);
    const secondTab = await newTab();
    const stale = (await secondTab.loadData())!;
    const firstEdit = structuredClone(original);
    firstEdit.accounts[0].name = "Minha reserva atualizada";
    await firstTab.saveData(firstEdit);
    stale.budgetTemplate[0].unitAmount = 6_123;
    await expect(secondTab.saveData(stale)).rejects.toBeInstanceOf(
      secondTab.StorageConflictError,
    );
    expect(await secondTab.loadData()).toEqual(firstEdit);

    // After rereading, this tab can preserve the newer data and apply its edit.
    const merged = structuredClone(firstEdit);
    merged.budgetTemplate[0].unitAmount = 6_123;
    await secondTab.saveData(merged);
    expect(await firstTab.loadData()).toEqual(merged);
  });

  it("restaura todas as coleções de um backup válido numa única gravação", async () => {
    const tab = await newTab();
    await seed(tab);
    const expected = backupState();
    const parsed = tab.parseBackup(tab.exportBackup(expected));
    await tab.saveData(parsed);
    expect(await (await newTab()).loadData()).toEqual(expected);
  });

  it("uma transação abortada após escrever preserva integralmente a versão anterior", async () => {
    const tab = await newTab();
    const original = await seed(tab);
    const replacement = backupState();
    const originalPut = FakeObjectStore.prototype.put;
    const interruptedWrite = vi
      .spyOn(FakeObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        const request = originalPut.call(this, value, key);
        request.addEventListener("success", () => this.transaction.abort());
        return request;
      });
    await expect(tab.saveData(replacement)).rejects.toThrow(
      /interrompida|Não foi possível salvar/,
    );
    interruptedWrite.mockRestore();
    expect(await (await newTab()).loadData()).toEqual(original);

    // The aborted write must not advance the local revision or poison the queue.
    await tab.saveData(replacement);
    expect(await (await newTab()).loadData()).toEqual(replacement);
  });

  it("preserva o snapshot solicitado mesmo que o chamador modifique o objeto durante a gravação", async () => {
    const tab = await newTab();
    await seed(tab);
    const candidate = backupState();
    const expected = structuredClone(candidate);
    const write = tab.saveData(candidate);
    candidate.salaries[0].amount = 1;
    candidate.movements[0].amount = 9_999_999;
    candidate.budgets[0].items.splice(0);
    await write;
    expect(await (await newTab()).loadData()).toEqual(expected);
  });

  it("permite restaurar explicitamente um backup após detectar conteúdo local inválido", async () => {
    const tab = await newTab();
    await seed(tab);
    await corruptSavedSalary();
    const reopened = await newTab();
    await expect(reopened.loadData()).rejects.toThrow(/Backup inválido/);
    // Reading the damaged data repeatedly must not silently insert the seed.
    await expect(reopened.loadData()).rejects.toThrow(/Backup inválido/);
    const expected = backupState();
    await reopened.saveData(
      reopened.parseBackup(reopened.exportBackup(expected)),
    );
    expect(await (await newTab()).loadData()).toEqual(expected);
  });
});
