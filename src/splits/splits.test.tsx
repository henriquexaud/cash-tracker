// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { PrivacyContext, privacySettings } from "../privacy";
import type { DataRepository } from "../repository";
import type { AppData } from "../domain/types";
import { createTestData } from "../test/fixtures";
import { createLocalSplitRepository, type SplitRepository } from "./repository";
import type { SplitGroup } from "./types";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
};
const seed = (...groups: SplitGroup[]) =>
  values.set("cash-tracker-splits", JSON.stringify({ version: 1, groups }));
/** Synthetic group: Ana (current user), Bia and Caio. */
const trio = (entries: SplitGroup["entries"] = []): SplitGroup => ({
  id: "g1",
  name: "Viagem",
  inviteCode: "ABCDEF123456",
  me: "ana",
  members: [{ id: "ana", name: "Ana" }, { id: "bia", name: "Bia" }, { id: "caio", name: "Caio" }],
  entries,
});

function setup(options: { hidden?: boolean; splits?: SplitRepository } = {}) {
  let data = createTestData();
  const repository: DataRepository = {
    mode: "local",
    load: vi.fn(async () => structuredClone(data)),
    save: vi.fn(async (next: AppData) => {
      data = structuredClone(next);
    }),
  };
  const splits = options.splits ?? createLocalSplitRepository(() => storage);
  render(
    <PrivacyContext.Provider value={privacySettings(!!options.hidden, vi.fn())}>
      <App repository={repository} splits={splits} />
    </PrivacyContext.Provider>,
  );
  return { repository, splits, read: () => data };
}
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) =>
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
const debtsList = () => screen.getByRole("list", { name: "Quem deve a quem" });

beforeEach(() => {
  values.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.history.replaceState(null, "", "/#dashboard");
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Divisões", () => {
  it("cria grupo, registra despesa, mostra quem deve a quem e acerta sem tocar nas finanças pessoais", async () => {
    const app = setup();
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    const financial = structuredClone(app.read());

    fireEvent.click(screen.getByRole("link", { name: "Divisões" }));
    await screen.findByRole("heading", { name: "Divisões", level: 1 });
    expect(screen.queryByLabelText("Mês selecionado")).toBeNull();
    await screen.findByText("Divida despesas com outras pessoas");
    expect(screen.queryByRole("button", { name: "Entrar com código" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    submit("Criar grupo");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nome do grupo/);
    type("Nome do grupo", "Casa");
    type("Seu nome no grupo", "Ana");
    submit("Criar grupo");
    await screen.findByRole("heading", { name: "Casa", level: 2 });
    expect(location.hash).toMatch(/^#splits\/[0-9a-f-]{36}$/);
    expect((screen.getByRole("button", { name: "Adicionar despesa" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar participante" }));
    type("Nome", "Bia");
    submit("Adicionar");
    await screen.findByText("Bia e você");

    // Two taps after typing: description and amount; payer and 50/50 are the defaults.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar despesa" }));
    expect((screen.getByLabelText("Quem pagou") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Você");
    expect((screen.getByLabelText("Como dividir") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Meio a meio");
    expect(within(screen.getByLabelText("Como dividir")).queryByText("Escolher quem participa")).toBeNull();
    expect(screen.queryByLabelText(/Data/)).toBeNull();
    type("Descrição", "Mercado");
    type("Valor (R$)", "50,01");
    expect(screen.getByRole("dialog").textContent).toMatch(/Você R\$\s25,01 · Bia R\$\s25,00/);
    submit("Adicionar despesa");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve R\$\s25,00 a você/));
    expect(screen.getByText(/Você pagou · dividido entre todos/)).toBeTruthy();

    // Partial settlement, capped at what is owed.
    fireEvent.click(screen.getByRole("button", { name: /^Acertar: Bia deve/ }));
    expect((screen.getByLabelText("Valor pago (R$)") as HTMLInputElement).value).toBe("25,00");
    type("Valor pago (R$)", "30,00");
    submit("Registrar acerto");
    expect((await screen.findByRole("alert")).textContent).toMatch(/não pode ser maior/);
    type("Valor pago (R$)", "10,00");
    submit("Registrar acerto");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve R\$\s15,00 a você/));
    expect(screen.getByText("Bia pagou você")).toBeTruthy();

    // Editing the expense recalculates everything.
    fireEvent.click(screen.getByRole("button", { name: "Editar Mercado" }));
    type("Valor (R$)", "20,00");
    fireEvent.change(screen.getByLabelText("Como dividir"), { target: { value: "single" } });
    expect(screen.getByRole("dialog").textContent).toMatch(/Bia assume R\$\s20,00/);
    submit("Salvar despesa");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve R\$\s10,00 a você/));
    expect(screen.getByText(/Você pagou · por conta de Bia/)).toBeTruthy();

    // Full settlement, then removing it reopens the debt.
    fireEvent.click(screen.getByRole("button", { name: /^Acertar: Bia deve/ }));
    submit("Registrar acerto");
    await screen.findByText("Tudo acertado. Ninguém deve nada.");
    fireEvent.click(screen.getAllByRole("button", { name: "Excluir acerto: Bia pagou você" })[0]);
    submit("Excluir");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve R\$\s/));

    fireEvent.click(screen.getByRole("button", { name: "Excluir Mercado" }));
    submit("Excluir");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Você deve R\$\s10,00 a Bia/));

    fireEvent.click(screen.getByRole("link", { name: "Todos os grupos" }));
    const row = await screen.findByRole("link", { name: /Casa/ });
    expect(row.textContent).toMatch(/Você deve R\$\s10,00/);

    // Nothing above reached the personal financial data.
    expect(app.repository.save).not.toHaveBeenCalled();
    expect(app.read()).toEqual(financial);
    expect([...values.keys()].sort()).toEqual(["cash-tracker-split-name", "cash-tracker-splits"]);
    fireEvent.click(screen.getByRole("link", { name: "Reserva" }));
    await screen.findByRole("heading", { name: "Reserva", level: 1 });
    expect(screen.getByLabelText("Mês selecionado")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Mercado|Casa/);
  });

  it("divide só entre os integrantes escolhidos e permite outra pessoa como pagadora", async () => {
    seed(trio());
    window.history.replaceState(null, "", "/#splits/g1");
    setup();
    await screen.findByRole("heading", { name: "Viagem", level: 2 });
    expect(screen.getByText("Bia, Caio e você")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar despesa" }));
    expect((screen.getByLabelText("Como dividir") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Igualmente entre todos");
    type("Descrição", "Jantar");
    type("Valor (R$)", "100,00");
    expect(screen.getByRole("dialog").textContent).toMatch(/Você R\$\s33,34 · Bia R\$\s33,33 · Caio R\$\s33,33/);
    fireEvent.change(screen.getByLabelText("Quem pagou"), { target: { value: "bia" } });
    fireEvent.change(screen.getByLabelText("Como dividir"), { target: { value: "some" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Você" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bia" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Caio" }));
    submit("Adicionar despesa");
    expect((await screen.findByRole("alert")).textContent).toMatch(/ao menos um integrante/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Você" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Caio" }));
    submit("Adicionar despesa");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Você deve R\$\s50,00 a Bia/));
    expect(debtsList().textContent).toMatch(/Caio deve R\$\s50,00 a Bia/);
    expect(screen.getByText(/Bia pagou · dividido entre Caio e você/)).toBeTruthy();
  });

  it("oculta os valores com o olho fechado, mantendo nomes e ações", async () => {
    seed(trio([{ id: "e1", kind: "expense", description: "Mercado", amount: 9000, paidBy: "ana", participants: ["ana", "bia", "caio"], date: "2026-10-01", createdAt: "2026-10-01T10:00:00Z" }]));
    window.history.replaceState(null, "", "/#splits");
    setup({ hidden: true });
    expect((await screen.findByRole("link", { name: /Viagem/ })).textContent).toMatch(/Você recebe ••••/);
    fireEvent.click(screen.getByRole("link", { name: /Viagem/ }));
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve •••• a você/));
    expect(document.querySelector("main")!.textContent).not.toMatch(/30,00|90,00/);
    fireEvent.click(screen.getByRole("button", { name: "Acertar: Bia deve •••• a você" }));
    expect((screen.getByLabelText("Valor pago (R$)") as HTMLInputElement).value).toBe("30,00");
  });

  it("convida por código e link, e abre o convite recebido", async () => {
    seed(trio());
    const local = createLocalSplitRepository(() => storage);
    const joinGroup = vi.fn(async () => "g1");
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    window.history.replaceState(null, "", "/#splits/join/abcd-ef12-3456");
    setup({ splits: { ...local, mode: "cloud", addMember: undefined, joinGroup } });
    const dialog = await screen.findByRole("dialog", { name: "Entrar em um grupo" });
    expect(location.hash).toBe("#splits");
    expect((within(dialog).getByLabelText("Código do convite") as HTMLInputElement).value).toBe("ABCDEF123456");
    type("Seu nome no grupo", "Ana");
    submit("Entrar no grupo");
    await screen.findByRole("heading", { name: "Viagem", level: 2 });
    expect(joinGroup).toHaveBeenCalledWith("ABCDEF123456", "Ana");

    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));
    expect((screen.getByLabelText("Código do convite") as HTMLInputElement).value).toBe("ABCDEF123456");
    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await screen.findByText("Link do convite copiado.");
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/#splits/join/ABCDEF123456`);
  });

  it("não mostra um grupo do qual a conta não participa", async () => {
    seed(trio());
    window.history.replaceState(null, "", "/#splits/outro-grupo");
    setup();
    await screen.findByText("Grupo não encontrado");
    expect(screen.queryByText("Viagem")).toBeNull();
  });

  it("uma falha em Divisões não afeta as outras telas nem grava dados financeiros", async () => {
    const failing: SplitRepository = {
      mode: "cloud",
      load: vi.fn(async () => { throw new Error("Divisões precisam de internet."); }),
      createGroup: vi.fn(async () => { throw new Error("Divisões precisam de internet."); }),
      saveEntry: vi.fn(),
      removeEntry: vi.fn(),
    };
    window.history.replaceState(null, "", "/#splits");
    const app = setup({ splits: failing });
    expect((await screen.findByRole("alert")).textContent).toBe("Divisões precisam de internet.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(failing.load).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("link", { name: "Visão geral" }));
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(app.repository.save).not.toHaveBeenCalled();
  });

  it("as outras telas não consultam Divisões", async () => {
    const splits = createLocalSplitRepository(() => storage);
    const load = vi.spyOn(splits, "load");
    setup({ splits });
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    for (const name of ["Orçamento", "Histórico", "Reserva", "Configurações"]) {
      fireEvent.click(screen.getByRole("link", { name }));
      await screen.findByRole("heading", { name, level: 1 });
    }
    expect(load).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
});
