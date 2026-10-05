// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DashboardPage,
  BudgetPage,
  HistoryPage,
  WealthPage,
  SettingsPage,
} from "./Pages";
import {
  PrivacyContext,
  privacySettings,
  createPrivacyStore,
  PRIVATE_VALUE,
  PRIVACY_KEY,
} from "./privacy";
import { SalaryForm, MovementForm, GoalForm } from "./components/EntryForms";
import { Modal } from "./components/Modal";
import { createEmptyData } from "./domain/empty";
import type { Actions, PageProps } from "./ui-types";

const data = createEmptyData();
data.salaries = [
  { id: "salary-a", month: "2026-09", amount: 412345 },
  { id: "salary-b", month: "2026-10", amount: 912345 },
];
data.accounts = [{ id: "account", name: "Banco pessoal confidencial" }];
data.movements = [
  {
    id: "movement",
    accountId: "account",
    date: "2026-10-01",
    kind: "contribution",
    amount: 812345,
    note: "Nota pessoal confidencial",
  },
];
data.budgets = [
  {
    month: "2026-10",
    reservePlan: 50000,
    items: [
      {
        id: "rent",
        name: "Aluguel",
        kind: "fixed",
        frequency: "monthly",
        factor: 1,
        unitAmount: 112345,
      },
    ],
  },
];
data.goals = [
  {
    id: "goal",
    name: "Objetivo pessoal confidencial",
    accountId: "account",
    target: 1000000,
    allocated: 200000,
  },
];
const actions = new Proxy({}, { get: () => vi.fn() }) as Actions;
const props: PageProps = {
  data,
  month: "2026-10",
  setMonth: vi.fn(),
  actions,
  offlineReady: true,
  persistent: true,
  canInstall: false,
  theme: {
    preference: "system",
    resolvedTheme: "light",
    setPreference: vi.fn(),
  },
  account: { id: "user", email: "privado@example.com", signOut: vi.fn() },
  storageMode: "cloud",
};
afterEach(() => cleanup());
const hidden = privacySettings(true, vi.fn());
describe("privacidade das telas", () => {
  it("não mostra olho nem aviso em uma janela sem informações sensíveis", () => {
    render(
      <PrivacyContext.Provider value={hidden}>
        <Modal title="Instalar o Cash Tracker" onClose={vi.fn()}>
          <p>Adicione o app à tela de início.</p>
        </Modal>
      </PrivacyContext.Provider>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Mostrar valores sensíveis" }),
    ).toBeNull();
    expect(screen.queryByText(/Informações ocultas/)).toBeNull();
    expect(screen.getByText("Adicione o app à tela de início.")).toBeTruthy();
  });
  it("permite revelar conteúdo sensível dentro de uma janela financeira", () => {
    const setHidden = vi.fn();
    render(
      <PrivacyContext.Provider value={privacySettings(true, setHidden)}>
        <SalaryForm
          salary={data.salaries[1]}
          month="2026-10"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </PrivacyContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar valores sensíveis" }),
    );
    expect(setHidden).toHaveBeenCalledWith(false);
    expect(screen.getByText(/Informações ocultas/)).toBeTruthy();
  });
  for (const Page of [
    DashboardPage,
    BudgetPage,
    HistoryPage,
    WealthPage,
    SettingsPage,
  ]) {
    it(`oculta valores e detalhes no HTML de ${Page.name}, incluindo gráficos e acessibilidade`, () => {
      const markup = renderToStaticMarkup(
        <PrivacyContext.Provider value={hidden}>
          <Page {...props} />
        </PrivacyContext.Provider>,
      );
      expect(markup).toContain(PRIVATE_VALUE);
      for (const secret of [
        "9.123,45",
        "8.123,45",
        "1.123,45",
        "Banco pessoal confidencial",
        "Nota pessoal confidencial",
        "Objetivo pessoal confidencial",
        "privado@example.com",
        "aria-valuenow",
      ])
        expect(markup).not.toContain(secret);
      expect(markup).not.toMatch(/<svg[^>]*role="img"/);
    });
  }
  it("mantém datas, categorias e tipos legíveis", () => {
    const markup = renderToStaticMarkup(
      <PrivacyContext.Provider value={hidden}>
        <BudgetPage {...props} />
      </PrivacyContext.Provider>,
    );
    expect(markup).toContain("Aluguel");
    expect(markup).toContain("Fixo");
  });
  it("oculta valores nos campos e permite revelar sem perder o valor que estava sendo editado", () => {
    const view = render(
      <PrivacyContext.Provider value={hidden}>
        <SalaryForm
          salary={data.salaries[1]}
          month="2026-10"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </PrivacyContext.Provider>,
    );
    const amount = screen.getByLabelText(
      "Valor recebido (R$)",
    ) as HTMLInputElement;
    expect(amount.value).toBe(PRIVATE_VALUE);
    expect(amount.readOnly).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar salário",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    view.rerender(
      <PrivacyContext.Provider value={privacySettings(false, vi.fn())}>
        <SalaryForm
          salary={data.salaries[1]}
          month="2026-10"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </PrivacyContext.Provider>,
    );
    expect(amount.value).toMatch(/9\.123,45/);
    expect(amount.readOnly).toBe(false);
  });
  it("não expõe conta e nota pessoal em movimentação nem o nome do objetivo no formulário", () => {
    const view = render(
      <PrivacyContext.Provider value={hidden}>
        <MovementForm
          data={data}
          movement={data.movements[0]}
          initialKind="contribution"
          initialDate="2026-10-01"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </PrivacyContext.Provider>,
    );
    expect(document.body.innerHTML).not.toContain("Banco pessoal confidencial");
    expect(document.body.innerHTML).not.toContain("Nota pessoal confidencial");
    view.unmount();
    render(
      <PrivacyContext.Provider value={hidden}>
        <GoalForm
          data={data}
          goal={data.goals[0]}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </PrivacyContext.Provider>,
    );
    expect(document.body.innerHTML).not.toContain(
      "Objetivo pessoal confidencial",
    );
  });
  it("carrega a preferência imediatamente e sincroniza entre abas", () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        clear: () => values.clear(),
      },
    });
    window.localStorage.setItem(PRIVACY_KEY, "true");
    const store = createPrivacyStore(window),
      listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBe(true);
    window.localStorage.setItem(PRIVACY_KEY, "false");
    window.dispatchEvent(new StorageEvent("storage", { key: PRIVACY_KEY }));
    expect(store.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    store.setHidden(true);
    expect(window.localStorage.getItem(PRIVACY_KEY)).toBe("true");
    store.dispose();
    window.localStorage.clear();
  });
});
