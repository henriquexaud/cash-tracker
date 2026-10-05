// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import App from "./App";
import { createEmptyData } from "./domain/empty";
import { currentMonth } from "./domain/finance";
import { PrivacyContext, privacySettings } from "./privacy";
import type { DataRepository } from "./repository";
import type { AppData } from "./domain/types";

function setup(initial = createEmptyData(), id = "new-user") {
  let data = structuredClone(initial);
  const repository: DataRepository = {
    mode: "cloud",
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (next: AppData) => {
      data = structuredClone(next);
    }),
  };
  const mount = () =>
    render(
      <PrivacyContext.Provider value={privacySettings(false, vi.fn())}>
        <App
          repository={repository}
          account={{ id, email: "test@example.com", signOut: vi.fn() }}
        />
      </PrivacyContext.Provider>,
    );
  return { repository, mount, read: () => data };
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.history.replaceState(null, "", "/#dashboard");
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    },
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("primeiro uso", () => {
  it.each(["local", "cloud"] as const)("inicializa %s vazio, sem dados de outra pessoa", async (mode) => {
    vi.stubEnv("VITE_STORAGE_MODE", mode);
    let saved: AppData | null = null;
    const repository: DataRepository = {
      mode,
      load: vi.fn(async () => saved),
      save: vi.fn(async (next) => { saved = structuredClone(next); }),
    };
    render(
      <PrivacyContext.Provider value={privacySettings(false, vi.fn())}>
        <App repository={repository} />
      </PrivacyContext.Provider>,
    );
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saved).toMatchObject({
      salaries: [], budgets: [], budgetTemplate: [], accounts: [], movements: [], goals: [],
      legacy: { status: "none", movements: [], possibleReturns: [] },
    });
  });

  it("preserva registros existentes ao abrir as configurações", async () => {
    const initial = createEmptyData();
    initial.salaries.push({
      id: "salary",
      month: currentMonth(),
      amount: 100000,
    });
    const app = setup(initial);
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Configurações" }));
    await screen.findByRole("heading", { name: "Configurações", level: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(app.read()).toEqual(initial);
    expect(app.repository.save).not.toHaveBeenCalled();
  });

  it("oferece instruções por dispositivo quando não há instalação direta", async () => {
    const app = setup();
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Configurações" }));
    fireEvent.click(await screen.findByRole("button", { name: "Como instalar" }));
    const guide = screen.getByRole("dialog", { name: "Instalar o Cash Tracker" });
    expect(within(guide).queryByRole("button", { name: /valores sensíveis/ })).toBeNull();
    fireEvent.click(within(guide).getByRole("button", { name: "iPhone / iPad" }));
    expect(within(guide).getByText("Adicione à Tela de Início")).toBeTruthy();
    fireEvent.click(within(guide).getByRole("button", { name: "Android" }));
    expect(within(guide).getByText("Abra o menu de três pontos")).toBeTruthy();
    fireEvent.click(within(guide).getByRole("button", { name: "Computador" }));
    expect(within(guide).getByText("Pelo Chrome ou Edge")).toBeTruthy();
    fireEvent.click(within(guide).getByRole("button", { name: "Entendi" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(app.repository.save).not.toHaveBeenCalled();
  });

  it("usa a instalação direta e mantém ajuda disponível se o navegador falhar", async () => {
    const app = setup();
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Configurações" }));
    await screen.findByRole("heading", { name: "Configurações", level: 1 });
    const prompt = vi.fn().mockRejectedValue(new Error("Prompt indisponível"));
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Instalar app" }));
    await screen.findByRole("dialog", { name: "Instalar o Cash Tracker" });
    expect(prompt).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    fireEvent(window, new Event("appinstalled"));
    expect(screen.getByText("Instalado neste dispositivo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Como instalar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver instruções" }));
    expect(screen.getByRole("dialog", { name: "Instalar o Cash Tracker" })).toBeTruthy();
    expect(app.repository.save).not.toHaveBeenCalled();
  });

  it("não mostra referências a planilha ou estatísticas vazias para uma conta nova", async () => {
    const app = setup();
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.queryByText(/planilha|A confirmar/)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Recebido no histórico" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Orçamento" }));
    await screen.findByText("Quais são os gastos deste mês?");
    expect(screen.queryByText(/planilha/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Usar base neste mês" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Histórico" }));
    await screen.findByText("Seu histórico começa com o primeiro salário");
    expect(screen.queryByText("Evolução salarial")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Orçamentos" }));
    expect(screen.getByText("Nenhum orçamento registrado")).toBeTruthy();
    expect(screen.queryByText(/planilha/)).toBeNull();
  });

  it("conduz do primeiro local ao saldo inicial e só inclui o valor ao salvar", async () => {
    const app = setup();
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Reserva" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Informar saldo inicial" }),
    );
    await screen.findByRole("dialog", { name: "Adicionar local de reserva" });
    fireEvent.change(screen.getByLabelText("Nome do local"), {
      target: { value: "Minha reserva" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    const movement = await screen.findByRole("dialog", {
      name: "Registrar saldo inicial",
    });
    expect(app.read().accounts).toHaveLength(1);
    expect(app.read().movements).toHaveLength(0);
    fireEvent.change(within(movement).getByLabelText("Valor (R$)"), {
      target: { value: "250,00" },
    });
    fireEvent.click(
      within(movement).getByRole("button", { name: "Salvar saldo inicial" }),
    );
    await waitFor(() => expect(app.read().movements).toHaveLength(1));
    expect(app.read().movements[0]).toMatchObject({
      kind: "opening",
      amount: 25000,
      accountId: app.read().accounts[0].id,
    });
    expect(app.read().salaries).toHaveLength(0);
    expect(app.read().budgets).toHaveLength(0);
  });

  it("mantém o formulário do local em caso de falha e não avança para um aporte sem local salvo", async () => {
    const app = setup();
    vi.mocked(app.repository.save).mockRejectedValue(
      new Error("Falha ao salvar local"),
    );
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar aporte" }));
    fireEvent.change(screen.getByLabelText("Nome do local"), {
      target: { value: "Reserva" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar local" }));
    await screen.findByText("Falha ao salvar local");
    expect(
      screen.getByRole("dialog", { name: "Adicionar local de reserva" }),
    ).toBeTruthy();
    expect(app.read().accounts).toHaveLength(0);
    expect(app.read().movements).toHaveLength(0);
  });

  it("permite cancelar o primeiro aporte sem cadastrar nada", async () => {
    const app = setup();
    app.mount();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Registrar aporte" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(app.repository.save).not.toHaveBeenCalled();
  });

});
