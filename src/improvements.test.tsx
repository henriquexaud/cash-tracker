// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { HistoryPage, WealthPage } from "./Pages";
import { createEmptyData } from "./domain/empty";
import {
  balanceUpdate,
  compareMovementsNewestFirst,
  currentMonth,
  goalPlan,
  monthsBetween,
  validateMovementRemoval,
  yearSummary,
} from "./domain/finance";
import { exportCsv, csvMoney } from "./csv";
import { applyEdit, emptyDocument, materialize } from "./sync/document";
import { PrivacyContext, privacySettings } from "./privacy";
import { exportBackup, parseBackup } from "./storage";
import type { DataRepository } from "./repository";
import type { AppData, Movement } from "./domain/types";
import type { Actions, PageProps } from "./ui-types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.history.replaceState(null, "", "/#dashboard");
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const move = (id: string, date: string, kind: Movement["kind"], amount: number, accountId = "a"): Movement =>
  ({ id, accountId, date, kind, amount, note: "" });

function reserve(): AppData {
  const data = createEmptyData();
  data.accounts = [{ id: "a", name: "Nubank" }];
  data.movements = [
    move("m1", "2026-10-01", "contribution", 10000),
    move("m2", "2026-10-05", "withdrawal", 8000),
  ];
  return data;
}

function setup(initial: AppData) {
  let data = structuredClone(initial);
  const repository: DataRepository = {
    mode: "local",
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async next => { data = structuredClone(next); }),
  };
  render(<PrivacyContext.Provider value={privacySettings(false, vi.fn())}><App repository={repository} /></PrivacyContext.Provider>);
  return { read: () => data };
}
function pageProps(data: AppData, month = "2026-10", actions = {} as Actions): PageProps {
  return { data, month, setMonth: vi.fn(), actions, offlineReady: true, persistent: false,
    canInstall: false, theme: { preference: "light", resolvedTheme: "light", setPreference: vi.fn() } };
}

describe("regras novas do domínio", () => {
  it("explica a exclusão que deixaria o local negativo ou abaixo dos objetivos", () => {
    const data = reserve();
    expect(validateMovementRemoval(data, "m1")).toMatch(/^Excluir este registro deixaria o local com saldo negativo/);
    expect(validateMovementRemoval(data, "m2")).toBeNull();
    data.goals = [{ id: "g", name: "Viagem", accountId: "a", target: 5000, allocated: 2000 }];
    data.movements = [move("m1", "2026-10-01", "contribution", 10000), move("m3", "2026-10-02", "contribution", 100)];
    expect(validateMovementRemoval(data, "m1")).toMatch(/destinado a objetivos/);
    // A conflict that already exists is left to the review flow.
    data.goals[0].allocated = 20000;
    expect(validateMovementRemoval(data, "m1")).toBeNull();
  });

  it("ordena lançamentos do mesmo dia sempre da mesma forma", () => {
    const rows = [
      move("z", "2026-10-05", "withdrawal", 1),
      move("a", "2026-10-05", "opening", 1),
      move("m", "2026-10-05", "contribution", 1),
      move("b", "2026-10-06", "return", 1),
    ];
    expect([...rows].sort(compareMovementsNewestFirst).map(row => row.id)).toEqual(["b", "z", "m", "a"]);
  });

  it("transforma o saldo informado em rendimento, perda ou saldo inicial", () => {
    const data = reserve();
    data.movements.push(move("future", "2026-12-01", "contribution", 5000));
    expect(balanceUpdate(data, "a", "2026-10-31", 2500)).toEqual({ kind: "return", amount: 500 });
    expect(balanceUpdate(data, "a", "2026-10-31", 1500)).toEqual({ kind: "return", amount: -500 });
    expect(balanceUpdate(data, "a", "2026-10-31", 2000)).toBeNull();
    data.accounts.push({ id: "b", name: "Caixinha" });
    expect(balanceUpdate(data, "b", "2026-10-31", 3000)).toEqual({ kind: "opening", amount: 3000 });
  });

  it("calcula quanto falta e quanto guardar por mês até o prazo", () => {
    expect(monthsBetween("2026-11", "2027-04")).toBe(6);
    expect(monthsBetween("2026-11", "2026-10")).toBe(0);
    const goal = { id: "g", name: "Viagem", accountId: "a", target: 100000, allocated: 40000, deadline: "2027-04" };
    expect(goalPlan(goal, "2026-11")).toEqual({ remaining: 60000, months: 6, monthly: 10000, overdue: false });
    expect(goalPlan(goal, "2027-05").overdue).toBe(true);
    expect(goalPlan({ ...goal, deadline: undefined }, "2026-11").monthly).toBeNull();
    expect(goalPlan({ ...goal, allocated: 100000 }, "2026-11").remaining).toBe(0);
  });

  it("resume o ano com recebido, previsto, guardado e taxa", () => {
    const data = reserve();
    data.salaries = [{ id: "s", month: "2026-10", amount: 100000 }];
    data.budgets = [{ month: "2026-09", reservePlan: 0, items: [{ id: "i", name: "Aluguel", kind: "fixed", frequency: "monthly", unitAmount: 50000, factor: 1 }] }];
    data.movements.push(move("r", "2026-10-20", "return", 300));
    const summary = yearSummary(data, "2026");
    expect(summary.months.map(row => row.month)).toEqual(["2026-09", "2026-10"]);
    expect(summary.months[1]).toMatchObject({ salary: 100000, saved: 2000, returns: 300, rate: 2 });
    expect(summary).toMatchObject({ received: 100000, expenses: 50000, saved: 2000, returns: 300, rate: 2 });
  });

  it("mantém o prazo do objetivo no backup e no sync", () => {
    const data = reserve();
    data.goals = [{ id: "g", name: "Viagem", accountId: "a", target: 5000, allocated: 1000, deadline: "2027-03" }];
    expect(parseBackup(exportBackup(data)).goals[0].deadline).toBe("2027-03");
    const document = applyEdit(emptyDocument(), createEmptyData(), data, `${"1".padStart(16, "0")}:000000:${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`);
    expect(materialize(document).goals[0].deadline).toBe("2027-03");
    expect(() => parseBackup(exportBackup({ ...data, goals: [{ ...data.goals[0], deadline: "2027-13" }] }))).toThrow();
  });

  it("ordena os locais sincronizados pelo nome", () => {
    const data = createEmptyData();
    data.accounts = [{ id: "0", name: "Poupança" }, { id: "1", name: "Corrente" }, { id: "2", name: "caixinha" }];
    const document = applyEdit(emptyDocument(), createEmptyData(), data, `${"1".padStart(16, "0")}:000000:${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`);
    expect(materialize(document).accounts.map(row => row.name)).toEqual(["caixinha", "Corrente", "Poupança"]);
  });

  it("exporta CSV em português, com sinais e sem fórmulas", () => {
    const data = reserve();
    data.salaries = [{ id: "s", month: "2026-10", amount: 123456 }];
    data.movements[0].note = "=SOMA(A1); \"teste\"";
    const csv = exportCsv(data);
    expect(csv.startsWith("﻿Mês;Data;Tipo;Descrição;Local;Valor (R$)\r\n")).toBe(true);
    expect(csv).toContain("2026-10;;Salário;;;1234,56");
    expect(csv).toContain(`2026-10;2026-10-01;Aporte;"'=SOMA(A1); ""teste""";Nubank;100,00`);
    expect(csv).toContain("2026-10;2026-10-05;Retirada;;Nubank;-80,00");
    expect(csvMoney(-5)).toBe("-0,05");
  });
});

describe("telas", () => {
  it("excluir um aporte necessário mostra uma explicação e não fala em backup", async () => {
    const { read } = setup(reserve());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Reserva" }));
    await screen.findByRole("heading", { name: "Reserva", level: 1 });
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar movimentações" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: /^Excluir Aporte/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir" }));
    const alert = await screen.findByText(/^Excluir este registro deixaria o local com saldo negativo/);
    expect(alert.textContent).not.toMatch(/backup|movements/i);
    expect(read().movements).toHaveLength(2);
  });

  it("renomeia um local e atualiza o saldo com um rendimento", async () => {
    const { read } = setup(reserve());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Reserva" }));
    await screen.findByRole("heading", { name: "Reserva", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Renomear local Nubank" }));
    const name = screen.getByLabelText("Nome do local") as HTMLInputElement;
    expect(name.value).toBe("Nubank");
    fireEvent.change(name, { target: { value: "Inter" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    await waitFor(() => expect(read().accounts).toEqual([{ id: "a", name: "Inter" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Atualizar saldo de Inter" }));
    fireEvent.change(screen.getByLabelText("Data do saldo"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("Saldo que o local mostra (R$)"), { target: { value: "25,00" } });
    expect(screen.getByText(/Será registrado um rendimento de R\$\s5,00/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Atualizar saldo" }));
    await waitFor(() => expect(read().movements).toHaveLength(3));
    expect(read().movements[2]).toMatchObject({ kind: "return", amount: 500, date: "2026-10-31", note: "Atualização de saldo" });
  });

  it("acompanha a virada do mês com o app aberto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 31, 23, 59, 30) });
    setup(createEmptyData());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.getByText("outubro de 2026")).toBeTruthy();
    await act(async () => { vi.setSystemTime(new Date(2026, 10, 1, 0, 0, 30)); vi.advanceTimersByTime(60000); });
    expect(currentMonth()).toBe("2026-11");
    expect(await screen.findByText("novembro de 2026")).toBeTruthy();
  });

  it("agrupa o histórico de movimentações por mês e mostra quanto falta no objetivo", () => {
    const data = reserve();
    data.movements.push(move("m3", "2026-11-02", "contribution", 3000));
    data.goals = [{ id: "g", name: "Viagem", accountId: "a", target: 6000, allocated: 1000, deadline: "2027-04" }];
    render(<WealthPage {...pageProps(data, "2026-11")} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar movimentações" }), { target: { value: "all" } });
    const headers = document.querySelectorAll(".movement-month");
    expect([...headers].map(header => header.textContent?.replace(/\s/g, " "))).toEqual([
      "novembro de 2026+ R$ 30,00",
      "outubro de 2026+ R$ 20,00",
    ]);
    expect(document.querySelector(".goal-status")?.textContent).toMatch(/^Faltam R\$\s50,00 · R\$\s8,34 por mês até abril de 2027$/);
  });

  it("compara o salário com o último registro mesmo com meses faltando e resume o ano", () => {
    const data = createEmptyData();
    data.salaries = [{ id: "a", month: "2026-07", amount: 100000 }, { id: "b", month: "2026-10", amount: 110000 }];
    render(<HistoryPage {...pageProps(data)} />);
    const row = screen.getByText("desde julho de 2026").closest(".history-row") as HTMLElement;
    expect(within(row).getByText("+10%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ano" }));
    expect(screen.getByText("Recebido em 2026")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
