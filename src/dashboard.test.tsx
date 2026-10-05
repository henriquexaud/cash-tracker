// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardPage } from "./Pages";
import { createEmptyData } from "./domain/empty";
import { PrivacyContext, privacySettings } from "./privacy";
import type { Actions, PageProps } from "./ui-types";

function setup(hidden = false) {
  const data = createEmptyData();
  data.salaries = [
    { id: "previous", month: "2026-09", amount: 90_000 },
    { id: "current", month: "2026-10", amount: 100_000 },
  ];
  data.budgets = [
    { month: "2026-09", reservePlan: 0, items: [{ id: "old", name: "Rotina", kind: "fixed", frequency: "monthly", unitAmount: 40_000, factor: 1 }] },
    { month: "2026-10", reservePlan: 20_000, items: [
      { id: "fixed", name: "Moradia", kind: "fixed", frequency: "monthly", unitAmount: 45_000, factor: 1 },
      { id: "variable", name: "Rotina", kind: "variable", frequency: "daily", unitAmount: 500, factor: 30 },
    ] },
  ];
  data.accounts = [{ id: "account", name: "Conta privada de teste" }];
  data.movements = [
    { id: "opening", accountId: "account", date: "2026-10-01", kind: "opening", amount: 500_000, note: "Nota privada de teste" },
    { id: "contribution", accountId: "account", date: "2026-10-02", kind: "contribution", amount: 30_000, note: "" },
    { id: "return", accountId: "account", date: "2026-10-03", kind: "return", amount: 500, note: "" },
    { id: "withdrawal", accountId: "account", date: "2026-10-04", kind: "withdrawal", amount: 18_000, note: "" },
  ];
  const handlers = new Map<string, ReturnType<typeof vi.fn>>();
  const actions = new Proxy({}, { get: (_, key: string) => {
    if (!handlers.has(key)) handlers.set(key, vi.fn());
    return handlers.get(key);
  } }) as Actions;
  const props: PageProps = {
    data, actions, month: "2026-10", setMonth: vi.fn(), offlineReady: true,
    persistent: false, canInstall: false,
    theme: { preference: "light", resolvedTheme: "light", setPreference: vi.fn() },
  };
  const mount = () => render(<PrivacyContext.Provider value={privacySettings(hidden, vi.fn())}><DashboardPage {...props} /></PrivacyContext.Provider>);
  return { data, actions, mount };
}

afterEach(cleanup);

describe("visão geral", () => {
  it("preserva os totais e compara planejamento com aportes líquidos, sem incluir saldo inicial ou rendimentos", () => {
    const app = setup();
    const original = structuredClone(app.data);
    app.mount();
    const metrics = screen.getByRole("region", { name: "Resumo do mês" });
    expect(within(metrics).getByText(/1\.000,00/)).toBeTruthy();
    expect(within(metrics).getByText(/600,00/)).toBeTruthy();
    expect(within(metrics).getByText(/120,00/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("60% do planejado")).toBeTruthy();
    expect(screen.getByText(/1\.900,00/)).toBeTruthy();
    expect(screen.getByText(/5\.125,00/)).toBeTruthy();
    expect(screen.getByText(/200,00 a mais/)).toBeTruthy();
    expect(app.data).toEqual(original);
  });

  it.each([
    [50_000, "Planejado alcançado", "100"],
    [10_000, "As retiradas superam os aportes", "0"],
  ])("trata aporte de %i sem ultrapassar a barra nem esconder retiradas líquidas", (amount, message, progress) => {
    const app = setup();
    app.data.movements[1].amount = amount;
    app.mount();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(progress);
  });

  it("mostra a base como estimativa e não compara com um mês confirmado", () => {
    const app = setup();
    app.data.budgetTemplate = app.data.budgets[1].items;
    app.data.budgets.pop();
    app.data.salaries = [];
    app.mount();
    expect(screen.getByText("Estimativa da base · ainda não confirmada no mês")).toBeTruthy();
    expect(screen.queryByText(/Em relação a/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Planejar reserva" }));
    expect(app.actions.editReservePlan).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("seleciona os últimos três registros só do mês e abre o registro correto", () => {
    const app = setup();
    app.data.movements.push({ id: "other-month", accountId: "account", date: "2026-11-01", kind: "contribution", amount: 99_999, note: "" });
    app.data.movements[0].date = "2026-09-01";
    app.data.movements[2].datePrecision = "month";
    app.data.movements[2].date = "2026-10-01";
    app.mount();
    const activity = screen.getByRole("region", { name: "Movimentações do mês" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(3);
    expect(within(activity).queryByText(/nov/)).toBeNull();
    const buttons = within(activity).getAllByRole("button", { name: /^Editar/ });
    expect(buttons[0].textContent).toContain("Retirada");
    expect(buttons[2].getAttribute("aria-label")).toBe("Editar Rendimento de out de 26");
    fireEvent.click(buttons[0]);
    expect(app.actions.editMovement).toHaveBeenCalledWith(app.data.movements[3]);
    fireEvent.click(within(activity).getByRole("button", { name: /Ver movimentações/ }));
    expect(app.actions.navigate).toHaveBeenCalledWith("wealth");
  });

  it("oculta percentuais, barras e conta junto dos valores monetários", () => {
    const app = setup(true);
    app.mount();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector(".dashboard-expense-bar")?.children).toHaveLength(0);
    expect(document.body.innerHTML).not.toMatch(/60%|75%|width:|Conta privada de teste|Nota privada de teste|5\.125,00|120,00|200,00 a mais/);
    expect(screen.getByText("Movimentações do mês")).toBeTruthy();
    expect(screen.getByText("Fixos")).toBeTruthy();
  });

  it("mantém o início vazio simples e calcula sem dividir por salário zero", () => {
    const app = setup();
    Object.assign(app.data, createEmptyData());
    const view = app.mount();
    expect(screen.queryByText("Como os gastos se dividem")).toBeNull();
    expect(screen.queryByText("Recebido no histórico")).toBeNull();
    app.data.salaries.push({ id: "zero", month: "2026-10", amount: 0 });
    app.data.budgets.push({ month: "2026-10", items: [], reservePlan: 0 });
    view.unmount();
    app.mount();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText("Nenhum gasto previsto neste orçamento.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
