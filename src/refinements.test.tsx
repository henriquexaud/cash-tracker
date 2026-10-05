// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { BudgetPage, HistoryPage, WealthPage } from "./Pages";
import { BudgetItemForm, SalaryForm } from "./components/EntryForms";
import { BudgetHistory } from "./components/BudgetHistory";
import { createEmptyData } from "./domain/empty";
import { currentMonth, shiftMonth } from "./domain/finance";
import { PrivacyContext, privacySettings } from "./privacy";
import { exportBackup, validateBackup } from "./storage";
import type { DataRepository } from "./repository";
import type { AppData } from "./domain/types";
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(initial = createEmptyData(), hidden = false, overrides: Partial<DataRepository> = {}) {
  let data = structuredClone(initial);
  const repository: DataRepository = {
    mode: "local",
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async next => { data = structuredClone(next); }),
    ...overrides,
  };
  render(<PrivacyContext.Provider value={privacySettings(hidden, vi.fn())}><App repository={repository} /></PrivacyContext.Provider>);
  return { repository, read: () => data, replace: (next: AppData) => { data = structuredClone(next); } };
}
function pageProps(data: AppData, month = "2026-10"): PageProps {
  return { data, month, setMonth: vi.fn(), actions: {} as Actions, offlineReady: true, persistent: false,
    canInstall: false, theme: { preference: "light", resolvedTheme: "light", setPreference: vi.fn() } };
}
async function openPage(name: string) {
  await screen.findByRole("heading", { name: "Visão geral", level: 1 });
  fireEvent.click(screen.getByRole("link", { name }));
  await screen.findByRole("heading", { name, level: 1 });
}

describe("histórico e apresentação", () => {
  it.each(["salary", "budget"])("mantém ano sem registros visível e acompanha o cabeçalho em %s", kind => {
    const data = createEmptyData();
    data.salaries = [{ id: "salary", month: "2026-10", amount: 10000 }];
    data.budgets = [{ month: "2026-10", items: [], reservePlan: 0 }];
    const props = pageProps(data, "2025-01");
    const component = (month: string) => kind === "salary" ? <HistoryPage {...props} month={month} /> : <BudgetHistory {...props} month={month} />;
    const view = render(component("2025-01"));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("2025");
    expect(select.selectedOptions[0].textContent).toBe("2025");
    view.rerender(component("2026-01"));
    expect(select.value).toBe("2026");
    fireEvent.change(select, { target: { value: "all" } });
    view.rerender(component("2024-01"));
    expect(select.value).toBe("all");
  });

  it("filtra 12/36 meses reais, inclui limites e não inventa registros nas lacunas", () => {
    const data = createEmptyData();
    data.salaries = ["2020-01", "2023-10", "2023-11", "2025-10", "2025-11", "2026-10", "2026-11"].map((month, index) => ({ id: `s${index}`, month, amount: 10000 }));
    const view = render(<HistoryPage {...pageProps(data)} />);
    fireEvent.click(screen.getByRole("button", { name: "1 ano" }));
    const chart = screen.getByRole("slider", { name: "Histórico dos recebimentos salariais" });
    expect(chart.getAttribute("aria-valuemax")).toBe("2");
    expect(chart.getAttribute("aria-valuetext")).toContain("out");
    fireEvent.click(screen.getByRole("button", { name: "3 anos" }));
    expect(chart.getAttribute("aria-valuemax")).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Tudo" }));
    expect(chart.getAttribute("aria-valuemax")).toBe("7");
    data.salaries = Array.from({ length: 50 }, (_, index) => ({ id: `s${index}`, month: shiftMonth("2026-10", -index), amount: 10000 }));
    view.rerender(<HistoryPage {...pageProps(data)} />);
    fireEvent.click(screen.getByRole("button", { name: "1 ano" }));
    expect(chart.getAttribute("aria-valuemax")).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "3 anos" }));
    expect(chart.getAttribute("aria-valuemax")).toBe("36");
  });

  it("limita a barra acessível e informa a destinação real acima da meta", () => {
    const data = createEmptyData();
    data.accounts = [{ id: "account", name: "Reserva" }];
    data.movements = [{ id: "opening", accountId: "account", date: "2026-10-01", kind: "opening", amount: 20000, note: "" }];
    data.goals = [{ id: "goal", name: "Viagem", accountId: "account", target: 10000, allocated: 15000 }];
    render(<WealthPage {...pageProps(data)} />);
    const bar = screen.getByRole("progressbar", { name: "Viagem" });
    expect(bar.getAttribute("aria-valuenow")).toBe("10000");
    expect(bar.getAttribute("aria-valuemax")).toBe("10000");
    expect(bar.getAttribute("aria-valuetext")).toMatch(/150,00.*100,00.*Meta superada/);
    expect(screen.getByText("1 cadastrado")).toBeTruthy();
  });

  it("mantém a cor de um gasto ao filtrar e ajustar seu valor", () => {
    const data = createEmptyData();
    data.budgets = [{ month: "2026-10", reservePlan: 0, items: [
      { id: "fixed", name: "Aluguel", kind: "fixed", frequency: "monthly", unitAmount: 50000, factor: 1 },
      { id: "variable", name: "Transporte", kind: "variable", frequency: "monthly", unitAmount: 10000, factor: 1 },
    ] }];
    const props = pageProps(data);
    const view = render(<BudgetPage {...props} />);
    const color = () => screen.getByText("Transporte").closest(".budget-row")!.querySelector(".category-icon")!.className;
    const before = color();
    fireEvent.click(screen.getByRole("button", { name: "Variáveis" }));
    expect(color()).toBe(before);
    data.budgets[0].items[1].unitAmount = 90000;
    view.rerender(<BudgetPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(color()).toBe(before);
  });
});

describe("formulários e gravação", () => {
  it("associa o erro e a dica ao campo, mantendo-o até editar o campo responsável", () => {
    render(<SalaryForm month="2026-10" onSave={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Valor recebido (R$)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    const error = screen.getByRole("alert");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(input.getAttribute("aria-describedby")).toContain(`${input.id}-hint`);
    fireEvent.change(input, { target: { value: "200" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-hint`);
  });

  it("não confirma edição de gasto excluído por outra aba e preserva o texto digitado", async () => {
    const data = createEmptyData();
    data.budgets = [{ month: currentMonth(), reservePlan: 0, items: [{ id: "expense", name: "Aluguel", kind: "fixed", frequency: "monthly", unitAmount: 50000, factor: 1 }] }];
    const app = setup(data, true);
    await openPage("Orçamento");
    fireEvent.click(screen.getByRole("button", { name: "Editar Aluguel" }));
    fireEvent.change(screen.getByLabelText("Nome do gasto"), { target: { value: "Aluguel ajustado" } });
    const current = structuredClone(data); current.budgets[0].items = []; app.replace(current);
    fireEvent.click(screen.getByRole("button", { name: "Salvar gasto" }));
    expect((await screen.findByRole("alert")).textContent).toContain("excluído ou substituído");
    expect((screen.getByLabelText("Nome do gasto") as HTMLInputElement).value).toBe("Aluguel ajustado");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(app.repository.save).not.toHaveBeenCalled();
    expect(app.read().budgets[0].items).toEqual([]);
  });

  it("não limpa o erro de um campo quando outro campo muda", () => {
    render(<BudgetItemForm onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar gasto" }));
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), { target: { value: "200" } });
    expect(screen.getByRole("alert").textContent).toContain("nome");
    expect(screen.getByLabelText("Nome do gasto").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("Nome do gasto"), { target: { value: "Transporte" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("confirma uma gravação cloud durável mesmo quando a atualização posterior falha", async () => {
    const data = createEmptyData();
    const load = vi.fn().mockResolvedValueOnce(data).mockResolvedValueOnce(data).mockRejectedValue(new Error("Atualização indisponível."));
    const save = vi.fn().mockResolvedValue(undefined);
    setup(data, false, { mode: "cloud", load, save });
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar salário" }));
    fireEvent.change(screen.getByLabelText("Valor recebido (R$)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    await screen.findByText("Salário registrado.");
    expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Editar salário" })).toBeTruthy();
  });

  it("bloqueia edição, fechamento e duplicidade durante save; falha mantém o formulário disponível", async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    setup(createEmptyData(), true, { save });
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar salário" }));
    const input = screen.getByLabelText("Valor recebido (R$)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar salário" }));
    const busy = await screen.findByRole("button", { name: "Salvando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(input.matches(":disabled")).toBe(true);
    expect((screen.getByRole("button", { name: "Fechar janela" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy); fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => reject(new Error("Não foi possível gravar neste dispositivo.")));
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível gravar");
    expect(input.value).toBe("300");
    expect(input.matches(":disabled")).toBe(false);
    expect((screen.getByRole("button", { name: "Salvar salário" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("evita descartar campos alterados por clique fora, mantendo cancelamento explícito", () => {
    const close = vi.fn();
    render(<SalaryForm month="2026-10" onSave={vi.fn()} onClose={close} />);
    fireEvent.change(screen.getByLabelText("Valor recebido (R$)"), { target: { value: "200" } });
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.pointerDown(backdrop); fireEvent.pointerUp(backdrop); fireEvent.click(backdrop);
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("recuperação, backup e feedback", () => {
  it("preserva dados que voltaram a abrir quando não consegue gerar a cópia anterior à recuperação", async () => {
    const data = createEmptyData();
    data.salaries = [{ id: "salary", month: currentMonth(), amount: 10000 }];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => { throw new Error("Não foi possível gerar a cópia anterior."); }) }));
    const save = vi.fn();
    setup(data, false, { load: vi.fn().mockRejectedValueOnce(new Error("Dados ilegíveis.")).mockResolvedValue(data), save });
    await screen.findByRole("alert");
    fireEvent.change(document.querySelector('.loading-screen input[type="file"]')!, {
      target: { files: [{ size: 1000, text: async () => exportBackup(createEmptyData()) }] },
    });
    await screen.findByRole("dialog", { name: "Recuperar seus dados?" });
    fireEvent.click(screen.getByRole("button", { name: "Restaurar e recuperar" }));
    await screen.findByText("Não foi possível gerar a cópia anterior.");
    expect(save).not.toHaveBeenCalled();
  });
  it("recupera um estado local ilegível com confirmação ocupada e sem inicialização automática", async () => {
    const data = createEmptyData();
    data.salaries = [{ id: "salary", month: currentMonth(), amount: 10000 }];
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    setup(createEmptyData(), false, { load: vi.fn().mockRejectedValue(new Error("Dados ilegíveis.")), save });
    await screen.findByRole("alert");
    expect(save).not.toHaveBeenCalled();
    const input = document.querySelector('.loading-screen input[type="file"]')!;
    fireEvent.change(input, { target: { files: [{ size: 1000, text: async () => exportBackup(data) }] } });
    await screen.findByRole("dialog", { name: "Recuperar seus dados?" });
    expect(screen.getByText(/1 salário e 0 movimentações/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar e recuperar" }));
    const busy = await screen.findByRole("button", { name: "Salvando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => finish());
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Editar salário" })).toBeTruthy();
    expect(save).toHaveBeenCalledWith(data);
  });
  it.each(["local", "cloud"] as const)("oferece recuperação compatível com o modo %s", async mode => {
    setup(createEmptyData(), false, { mode, load: vi.fn().mockRejectedValue(new Error("Falha ao abrir os dados.")) });
    await screen.findByRole("alert");
    expect(!!screen.queryByRole("button", { name: "Restaurar um backup" })).toBe(mode === "local");
    if (mode === "cloud") expect(screen.getByText(/Depois que a conta abrir/)).toBeTruthy();
  });

  it.each([true, false])("confirma o legado uma vez, com ou sem local existente (%s)", async hasAccount => {
    const data = createEmptyData();
    data.legacy = { ...data.legacy, status: "pending", source: "Planilha de teste", movements: [10000], displayedNet: 10000, displayedSaved: "R$ 100,00" };
    if (hasAccount) data.accounts = [{ id: "account", name: "Reserva" }];
    const app = setup(data);
    await openPage("Reserva");
    fireEvent.click(screen.getByRole("button", { name: "Conferir saldo da planilha" }));
    if (!hasAccount) {
      fireEvent.change(screen.getByLabelText("Nome do local"), { target: { value: "Reserva" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
      await screen.findByRole("dialog", { name: "Conferir reserva da planilha" });
    }
    fireEvent.change(screen.getByLabelText("Saldo exato conferido (R$)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saldo inicial" }));
    await waitFor(() => expect(app.read().legacy.status).toBe("resolved"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(app.read().movements).toHaveLength(1);
    expect(app.read().movements[0]).toMatchObject({ kind: "opening", amount: 10000 });
    expect(app.read().legacy.movements).toEqual([10000]);
    expect(screen.queryByRole("button", { name: "Conferir saldo da planilha" })).toBeNull();
  });

  it.each([true, false])("informa corretamente o download e a data quando save falha (%s)", async fails => {
    const createUrl = vi.fn(() => "blob:test");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const data = createEmptyData(); data.preferences.lastBackupAt = "2026-01-01T12:00:00.000Z";
    const app = setup(data, true, fails ? { save: vi.fn().mockRejectedValue(new Error("Armazenamento indisponível.")) } : {});
    await openPage("Configurações");
    fireEvent.click(screen.getByRole("button", { name: "Exportar backup" }));
    const feedback = await screen.findByText(fails ? /data da exportação não pôde ser atualizada/ : /Download do backup iniciado/);
    expect(click).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledOnce();
    if (fails) {
      expect(feedback.textContent).toContain("download do backup foi iniciado");
      expect(feedback.textContent).toContain("data da exportação não pôde ser atualizada");
      expect(feedback.textContent).toContain("Armazenamento indisponível");
      expect(app.read().preferences.lastBackupAt).toBe(data.preferences.lastBackupAt);
    } else {
      expect(feedback.textContent).toContain("Download do backup iniciado");
      expect(app.read().preferences.lastBackupAt).not.toBe(data.preferences.lastBackupAt);
    }
  });

  it.each([true, false])("distingue erro de sincronização com alterações pendentes (%s)", async pending => {
    setup(createEmptyData(), true, { mode: "cloud", getStatus: () => "error", hasPendingChanges: () => pending, getSyncError: () => "Entre novamente para sincronizar esta conta." });
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    const message = screen.getByText(/Entre novamente para sincronizar esta conta/);
    expect(message.textContent?.includes("Alterações salvas neste dispositivo")).toBe(pending);
  });

  it("mensagens de integridade financeira não revelam identificadores vindos do backup", () => {
    const data = createEmptyData();
    data.accounts = [{ id: "nome-sensivel@example.com", name: "Reserva" }];
    data.movements = [{ id: "m", accountId: data.accounts[0].id, date: "2026-10-01", kind: "withdrawal", amount: 10000, note: "" }];
    try { validateBackup(data); throw new Error("Deveria falhar"); }
    catch (error) {
      expect((error as Error).message).toContain("Backup inválido: movements");
      expect((error as Error).message).not.toContain("nome-sensivel");
    }
  });
});
