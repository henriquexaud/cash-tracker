// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { BudgetPage } from "./Pages";
import { MovementForm } from "./components/EntryForms";
import { createEmptyData } from "./domain/empty";
import { currentMonth, shiftMonth } from "./domain/finance";
import { PrivacyContext, privacySettings } from "./privacy";
import type { DataRepository } from "./repository";
import type { AppData } from "./domain/types";
import type { Actions, PageProps } from "./ui-types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.history.replaceState(null, "", "/#dashboard");
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(initial: AppData, hidden = false) {
  let data = structuredClone(initial);
  const repository: DataRepository = {
    mode: "local",
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (next) => { data = structuredClone(next); }),
  };
  render(
    <PrivacyContext.Provider value={privacySettings(hidden, vi.fn())}>
      <App repository={repository} />
    </PrivacyContext.Provider>,
  );
  return { repository, read: () => data };
}

function movementData() {
  const data = createEmptyData();
  data.accounts = [{ id: "account", name: "Reserva de teste" }];
  data.budgets = [
    { month: "2026-09", reservePlan: 80000, items: [] },
    { month: "2026-10", reservePlan: 120000, items: [] },
  ];
  return data;
}

describe("sugestões de valores", () => {
  it("usa o salário do mês mais recente, preserva os anteriores e permite ajustar", async () => {
    const data = createEmptyData();
    data.salaries = [
      { id: "latest", month: shiftMonth(currentMonth(), -1), amount: 250000 },
      { id: "older", month: shiftMonth(currentMonth(), -2), amount: 180000 },
    ];
    const app = setup(data);
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar salário" }));
    const field = screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement;
    expect(field.value).toBe("2.500,00");
    fireEvent.change(field, { target: { value: "2700,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    await waitFor(() => expect(app.read().salaries).toHaveLength(3));
    expect(app.read().salaries.find(s => s.month === currentMonth())).toMatchObject({ amount: 270000 });
    expect(app.read().salaries.find(s => s.id === "latest")).toEqual(data.salaries[0]);
    expect(app.read().salaries.find(s => s.id === "older")).toEqual(data.salaries[1]);
  });

  it("prefere o valor existente ao editar e deixa vazio quando não há salário", async () => {
    const data = createEmptyData();
    data.salaries = [
      { id: "current", month: currentMonth(), amount: 0 },
      { id: "future", month: shiftMonth(currentMonth(), 1), amount: 500000 },
    ];
    setup(data);
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Editar salário" }));
    expect((screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement).value).toBe("0,00");
    cleanup();
    setup(createEmptyData());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar salário" }));
    expect((screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement).value).toBe("");
  });

  it("sugere a reserva planejada para a data e mantém um ajuste manual ao mudar o mês", () => {
    const onSave = vi.fn();
    render(<MovementForm data={movementData()} initialDate="2026-10-05" onSave={onSave} onClose={vi.fn()} />);
    const field = screen.getByLabelText("Valor (R$)") as HTMLInputElement;
    expect(field.value).toBe("1.200,00");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-05" } });
    expect(field.value).toBe("800,00");
    fireEvent.change(field, { target: { value: "900,00" } });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    expect(field.value).toBe("900,00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar aporte" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 90000, date: "2026-10-06", kind: "contribution" }));
  });

  it("não sugere aportes para outros tipos nem para meses sem planejamento", () => {
    render(<MovementForm data={movementData()} initialKind="opening" initialDate="2026-10-05" onSave={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText("Valor (R$)") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(screen.getByLabelText("Tipo de movimentação"), { target: { value: "contribution" } });
    expect(field.value).toBe("1.200,00");
    fireEvent.change(screen.getByLabelText("Tipo de movimentação"), { target: { value: "withdrawal" } });
    expect(field.value).toBe("");
    fireEvent.change(screen.getByLabelText("Tipo de movimentação"), { target: { value: "contribution" } });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-01" } });
    expect(field.value).toBe("");
  });

  it("mantém o valor de uma movimentação existente mesmo ao trocar sua data", () => {
    render(<MovementForm data={movementData()} movement={{ id: "existing", kind: "contribution", date: "2026-10-01", accountId: "account", amount: 35000, note: "" }} onSave={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText("Valor (R$)") as HTMLInputElement;
    expect(field.value).toBe("350,00");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-01" } });
    expect(field.value).toBe("350,00");
  });
});

describe("ordenação dos gastos", () => {
  it.each([false, true])("ordena o orçamento e sua base pelo total mensal sem alterar os dados (base=%s)", (template) => {
    const data = createEmptyData();
    const items = [
      { id: "small", name: "Internet", kind: "fixed" as const, frequency: "monthly" as const, unitAmount: 10000, factor: 1 },
      { id: "daily", name: "Alimentação", kind: "variable" as const, frequency: "daily" as const, unitAmount: 2000, factor: 30 },
      { id: "large", name: "Aluguel", kind: "fixed" as const, frequency: "monthly" as const, unitAmount: 150000, factor: 1 },
    ];
    if (template) data.budgetTemplate = items;
    else data.budgets = [{ month: currentMonth(), reservePlan: 0, items }];
    const original = structuredClone(data);
    const props: PageProps = {
      data, month: currentMonth(), actions: new Proxy({}, { get: () => vi.fn() }) as Actions,
      setMonth: vi.fn(), offlineReady: false, persistent: false, canInstall: false,
      theme: { preference: "light", resolvedTheme: "light", setPreference: vi.fn() },
    };
    render(<BudgetPage {...props} />);
    const names = () => Array.from(document.querySelectorAll(".budget-row-main strong"), element => element.textContent);
    expect(names()).toEqual(["Aluguel", "Alimentação", "Internet"]);
    fireEvent.click(screen.getByRole("button", { name: "Fixos" }));
    expect(names()).toEqual(["Aluguel", "Internet"]);
    expect(data).toEqual(original);
  });
});
