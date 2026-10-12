// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../App";
import { PrivacyContext, privacySettings } from "../privacy";
import type { DataRepository } from "../repository";
import type { AppData } from "../domain/types";
import { today } from "../domain/finance";
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

    // Two taps after typing: description and amount; payer, 50/50 and today are the defaults.
    fireEvent.click(screen.getByRole("button", { name: "Adicionar despesa" }));
    expect((screen.getByLabelText("Quem pagou") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Você");
    expect((screen.getByLabelText("Como dividir") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Meio a meio");
    expect(within(screen.getByLabelText("Como dividir")).queryByText("Escolher quem participa")).toBeNull();
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe(today());
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
    type("Data", "");
    submit("Salvar despesa");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Informe a data/);
    type("Data", "2026-03-07");
    fireEvent.change(screen.getByLabelText("Como dividir"), { target: { value: "single" } });
    expect(screen.getByRole("dialog").textContent).toMatch(/Bia assume R\$\s20,00/);
    submit("Salvar despesa");
    await waitFor(() => expect(debtsList().textContent).toMatch(/Bia deve R\$\s10,00 a você/));
    expect(screen.getByText(/07 de mar\.? de 2026 · Você pagou · por conta de Bia/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Março de 2026/ }).textContent).toMatch(/R\$\s20,00/);

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

  it("escolhe o ícone da despesa pela descrição, sem alterar o dos acertos", async () => {
    const entry = (id: string, description: string, kind: "expense" | "settlement" = "expense") => ({
      id, kind, description, amount: 9000, paidBy: "ana", participants: kind === "expense" ? ["ana", "bia", "caio"] : ["bia"],
      date: "2026-10-01", createdAt: `2026-10-01T10:00:0${id.slice(1)}Z`,
    });
    seed(trio([entry("e1", "Mercado"), entry("e2", "Diversos"), entry("e3", "", "settlement")]));
    window.history.replaceState(null, "", "/#splits/g1");
    setup();
    const icon = async (title: string | RegExp) =>
      (await screen.findByText(title)).closest(".movement-row")!.querySelector(".movement-icon svg")!;
    expect((await icon("Mercado")).classList.contains("lucide-shopping-basket")).toBe(true);
    expect((await icon("Diversos")).classList.contains("lucide-receipt")).toBe(true);
    const settlement = await icon(/pagou Bia/);
    expect(settlement.classList.contains("lucide-hand-coins")).toBe(true);
    expect(settlement.getAttribute("aria-hidden")).toBe("true");
  });

  it("resume o grupo, agrupa o histórico por mês e busca pela descrição", async () => {
    const expense = (id: number, description: string, amount: number, paidBy: string, participants: string[], date: string) => ({
      id: `e${id}`, kind: "expense" as const, description, amount, paidBy, participants, date, createdAt: `${date}T10:00:0${id}Z`,
    });
    const everyone = ["ana", "bia", "caio"];
    seed(
      trio([
        expense(1, "Mercado", 9000, "ana", everyone, "2026-10-03"),
        expense(2, "Pedágio", 3000, "bia", everyone, "2026-10-02"),
        expense(3, "Cinema", 4000, "bia", ["bia", "caio"], "2026-10-01"),
        expense(4, "Aluguel", 30000, "caio", everyone, "2026-09-10"),
        expense(5, "Farmácia", 1000, "ana", ["bia"], "2026-09-05"),
        { ...expense(6, "", 2000, "bia", ["ana"], "2026-09-04"), kind: "settlement" as const },
      ]),
      { ...trio(), id: "g2", name: "Casa" },
    );
    window.history.replaceState(null, "", "/#splits");
    setup();
    // Ana: paid 100,00 + received 20,00, owes 140,00 of shares.
    expect((await screen.findByText(/Somando os grupos/)).textContent).toMatch(/você deve R\$\s60,00/);

    fireEvent.click(screen.getByRole("link", { name: /Viagem/ }));
    const totals = (await screen.findByText("Gasto do grupo")).closest("dl")!;
    expect(totals.textContent).toMatch(/Gasto do grupoR\$\s470,00Sua parteR\$\s140,00Seu saldoVocê deve R\$\s60,00/);

    const months = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(months[0]).toMatch(/Outubro de 2026R\$\s160,00/);
    expect(months[1]).toMatch(/Setembro de 2026R\$\s310,00/);
    const value = (title: string) => screen.getByText(title).closest(".movement-row")!.querySelector(".split-entry-value")!.textContent;
    expect(value("Mercado")).toMatch(/R\$\s90,00você recebe R\$\s60,00/);
    expect(value("Pedágio")).toMatch(/R\$\s30,00você deve R\$\s10,00/);
    expect(value("Cinema")).toMatch(/R\$\s40,00não envolve você/);
    expect(value("Bia pagou você")).toMatch(/^R\$\s20,00$/);

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no histórico" }), { target: { value: " farmacia" } });
    expect(screen.getByText("Farmácia")).toBeTruthy();
    expect(screen.queryByText("Mercado")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(totals.textContent).toMatch(/R\$\s470,00/);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    expect(screen.getByRole("status").textContent).toMatch(/Nenhum lançamento com “xyz”/);
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

  it("reabre a aba com a última lista da sessão enquanto relê, sem a tela de carregamento", async () => {
    seed(trio());
    const local = createLocalSplitRepository(() => storage);
    let release = () => {};
    const load = vi.fn(local.load);
    setup({ splits: { ...local, load } });
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Divisões" }));
    await screen.findByRole("link", { name: /Viagem/ });

    fireEvent.click(screen.getByRole("link", { name: "Visão geral" }));
    await screen.findByRole("heading", { name: "Visão geral", level: 1 });
    load.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([{ ...trio(), name: "Viagem de julho" }]);
    }));
    fireEvent.click(screen.getByRole("link", { name: "Divisões" }));
    await screen.findByRole("heading", { name: "Divisões", level: 1 });
    expect(screen.getByRole("link", { name: /Viagem/ })).toBeTruthy();
    expect(screen.queryByText("Abrindo suas divisões…")).toBeNull();
    // The reading in progress still replaces what was shown.
    await act(async () => release());
    expect(await screen.findByRole("link", { name: /Viagem de julho/ })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
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
