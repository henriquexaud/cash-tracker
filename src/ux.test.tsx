// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { BudgetPage, SettingsPage } from "./Pages";
import { InstallGuide } from "./components/InstallGuide";
import { BudgetItemForm, GoalForm, LegacyForm, MovementForm, ReservePlanForm, SalaryForm } from "./components/EntryForms";
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

describe("cabeçalho e configurações", () => {
  it("mostra apenas os controles de valores e tema, nessa ordem", async () => {
    setup(createEmptyData());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    const header = document.querySelector(".topbar") as HTMLElement;
    const buttons = within(header).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/valores sensíveis/);
    expect(buttons[1].getAttribute("aria-label")).toMatch(/Ativar tema/);
    expect(within(header).queryByText(/Salvo|Sincroniz|Offline|Salvando/)).toBeNull();
  });

  it("mantém o nome sem ícone no menu e cabeçalho ao alternar o tema sem gravar dados financeiros", async () => {
    const { repository } = setup(createEmptyData());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    const names = () => Array.from(document.querySelectorAll(".brand, .topbar-brand"));
    const initialTheme = document.documentElement.dataset.theme;
    expect(names()).toHaveLength(2);
    expect(names().every(name => !name.querySelector("img"))).toBe(true);
    const initialNames = names().map(name => name.textContent);
    fireEvent.click(screen.getByRole("button", { name: /Ativar tema/ }));
    const changedTheme = document.documentElement.dataset.theme;
    expect(changedTheme).not.toBe(initialTheme);
    expect(names().map(name => name.textContent)).toEqual(initialNames);
    expect(names().every(name => !name.querySelector("img"))).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Ativar tema/ }));
    expect(document.documentElement.dataset.theme).toBe(initialTheme);
  });

  it("preserva o aviso e a ação para alterações pendentes", async () => {
    const sync = vi.fn(async () => {});
    const repository: DataRepository = {
      mode: "cloud", load: vi.fn(async () => createEmptyData()), save: vi.fn(async () => {}),
      sync, getStatus: () => "pending",
    };
    render(<App repository={repository} />);
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.getByText(/Alterações salvas neste dispositivo/)).toBeTruthy();
    sync.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar" }));
    expect(sync).toHaveBeenCalledOnce();
  });

  it.each(["local", "cloud"] as const)("explica a gravação %s e preserva as ações de backup e instalação", (storageMode) => {
    const backup = vi.fn(), restore = vi.fn(), install = vi.fn(), instructions = vi.fn(), protection = vi.fn();
    const actions = {
      backup, restore, install, showInstallGuide: instructions, requestPersistence: protection,
      signOut: vi.fn(),
    } as unknown as Actions;
    render(<SettingsPage data={createEmptyData()} month={currentMonth()} actions={actions}
      setMonth={vi.fn()} offlineReady persistent={false} canInstall storageMode={storageMode}
      account={storageMode === "cloud" ? { id: "test", email: "test@example.com", signOut: vi.fn() } : undefined}
      theme={{ preference: "light", resolvedTheme: "light", setPreference: vi.fn() }} />);
    const accountSection = screen.getByRole("heading", { name: "Conta e backup" }).closest("section") as HTMLElement;
    const deviceSection = screen.getByRole("heading", { name: "App no seu dispositivo" }).closest("section") as HTMLElement;
    expect(within(accountSection).getByText(storageMode === "cloud"
      ? "Seus registros ficam salvos na sua conta, mesmo depois de fechar o app."
      : "Seus registros ficam salvos neste navegador, mesmo depois de fechar o app.")).toBeTruthy();
    expect(within(accountSection).getByText("Sobre seus dados")).toBeTruthy();
    expect(within(deviceSection).queryByText("Sobre seus dados")).toBeNull();
    expect(within(deviceSection).queryByText(/sem internet|offline|versão publicada/)).toBeNull();
    if (storageMode === "cloud") {
      expect(within(accountSection).getByText(/backup é uma cópia extra e opcional/)).toBeTruthy();
      expect(within(deviceSection).queryByText(/exporte um backup/)).toBeNull();
    }
    const installButtons = within(deviceSection).getAllByRole("button");
    expect(installButtons.map(button => button.textContent)).toEqual(["Ver instruções", "Instalar app"]);
    fireEvent.click(installButtons[0]);
    fireEvent.click(installButtons[1]);
    fireEvent.click(within(accountSection).getByRole("button", { name: "Exportar backup" }));
    fireEvent.click(within(accountSection).getByRole("button", { name: "Restaurar backup" }));
    fireEvent.click(within(accountSection).getByText("Sobre seus dados"));
    fireEvent.click(within(accountSection).getByRole("button", { name: "Proteger dados neste dispositivo" }));
    for (const action of [backup, restore, install, instructions, protection]) expect(action).toHaveBeenCalledOnce();
  });

  it("não pede login nas instruções do modo local", () => {
    render(<InstallGuide storageMode="local" onClose={vi.fn()} />);
    expect(screen.getByText(/exporte um backup para levar seus registros/)).toBeTruthy();
    expect(screen.queryByText(/entre com a mesma conta/)).toBeNull();
    expect(screen.queryByText(/Disponível sem internet|sem conexão/)).toBeNull();
  });
});

describe("entrada de valores", () => {
  it.each([
    ["1234,5", "1.234,50", 123450],
    ["1234.56", "1.234,56", 123456],
    ["R$\u00a01.234,56", "1.234,56", 123456],
    [",50", "0,50", 50],
    [".50", "0,50", 50],
    ["123,", "123,00", 12300],
    ["0", "0,00", 0],
  ])("formata %s ao sair do campo e salva os centavos exatos", (typed, formatted, cents) => {
    const onSave = vi.fn();
    render(<SalaryForm month={currentMonth()} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: typed } });
    expect(input.value).toBe(typed);
    fireEvent.blur(input);
    expect(input.value).toBe(formatted);
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: cents }));
  });

  it.each(["", "12,345", "1e3", "90.071.992.547.409,92", "-20"])("não descarta nem salva um salário inválido (%s)", (typed) => {
    const onSave = vi.fn();
    render(<SalaryForm month={currentMonth()} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);
    expect(input.value).toBe(typed === "-20" ? "-20,00" : typed);
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("seleciona o valor sugerido para substituição e não marca um aporte intacto como editado", () => {
    render(<MovementForm data={movementData()} initialDate="2026-10-05" onSave={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Valor (R$)") as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    fireEvent.blur(input);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-05" } });
    expect(input.value).toBe("800,00");
  });

  it("mantém a formatação compartilhada em gastos, planejamento, objetivos e saldo legado", () => {
    const cases = [
      { form: <BudgetItemForm onSave={vi.fn()} onClose={vi.fn()} />, label: "Valor mensal (R$)" },
      { form: <ReservePlanForm value={0} onSave={vi.fn()} onClose={vi.fn()} />, label: "Valor planejado (R$)" },
      { form: <GoalForm data={movementData()} onSave={vi.fn()} onClose={vi.fn()} />, label: "Meta (R$)" },
      { form: <GoalForm data={movementData()} onSave={vi.fn()} onClose={vi.fn()} />, label: "Valor já reservado (R$)" },
      { form: <LegacyForm data={movementData()} onSave={vi.fn()} onClose={vi.fn()} />, label: "Saldo exato conferido (R$)" },
    ];
    for (const { form, label } of cases) {
      render(form);
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.type).toBe("text");
      expect(input.inputMode).toBe("decimal");
      expect(input.required).toBe(true);
      fireEvent.change(input, { target: { value: "23,4" } });
      fireEvent.blur(input);
      expect(input.value).toBe("23,40");
      cleanup();
    }
  });

  it("permite digitar o sinal de perdas e preserva os centavos do rendimento negativo", () => {
    const data = movementData();
    data.movements = [{ id: "opening", kind: "opening", accountId: "account", date: "2026-10-01", amount: 100000, note: "" }];
    const onSave = vi.fn();
    render(<MovementForm data={data} initialKind="return" initialDate="2026-10-05" onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Valor (R$)") as HTMLInputElement;
    expect(input.inputMode).toBe("text");
    fireEvent.change(input, { target: { value: "-12.5" } });
    fireEvent.blur(input);
    expect(input.value).toBe("-12,50");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rendimento" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: -1250, kind: "return" }));
    fireEvent.change(screen.getByLabelText("Tipo de movimentação"), { target: { value: "contribution" } });
    expect(input.inputMode).toBe("decimal");
  });

  it.each(["1e2", "0x10", "2,0", "1.5", "0"])("rejeita repetições que não são inteiros positivos (%s)", (factor) => {
    const onSave = vi.fn();
    render(<BudgetItemForm onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Nome do gasto"), { target: { value: "Transporte" } });
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: factor } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar gasto" }));
    expect(screen.getByRole("alert").textContent).toContain("quantidade inteira");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("salva a quantidade inteira e o total esperado", () => {
    const onSave = vi.fn();
    render(<BudgetItemForm onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Nome do gasto"), { target: { value: "Transporte" } });
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), { target: { value: "2,50" } });
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "30" } });
    expect(screen.getByText(/75,00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar gasto" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ unitAmount: 250, factor: 30 }));
  });
});
