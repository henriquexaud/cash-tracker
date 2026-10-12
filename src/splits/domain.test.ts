import { describe, expect, it } from "vitest";
import {
  balances,
  debts,
  entryImpact,
  entryShares,
  normalizeInviteCode,
  spending,
  timeline,
  validateEntry,
  validateSettlement,
} from "./domain";
import type { SplitEntry, SplitGroup } from "./types";

/** Synthetic people and amounts only. */
const group = (entries: SplitEntry[] = [], members = ["ana", "bia", "caio"]): SplitGroup => ({
  id: "g",
  name: "Grupo de teste",
  me: members[0],
  members: members.map((id) => ({ id, name: id })),
  entries,
});
let sequence = 0;
const expense = (amount: number, paidBy: string, participants: string[], extra: Partial<SplitEntry> = {}): SplitEntry => ({
  id: `e${++sequence}`,
  kind: "expense",
  description: "Despesa",
  amount,
  paidBy,
  participants,
  date: "2026-10-01",
  createdAt: `2026-10-01T10:00:${String(sequence).padStart(2, "0")}Z`,
  ...extra,
});
const settlement = (amount: number, from: string, to: string): SplitEntry =>
  expense(amount, from, [to], { kind: "settlement", description: "" });
const total = (values: Iterable<number>) => [...values].reduce((sum, value) => sum + value, 0);

describe("divisão em centavos", () => {
  it("divide igualmente quando o valor é exato", () => {
    expect([...entryShares(expense(9000, "ana", ["ana", "bia", "caio"]))]).toEqual([
      ["ana", 3000], ["bia", 3000], ["caio", 3000],
    ]);
  });

  it("deixa o centavo que sobra com quem pagou, sem perder nem criar dinheiro", () => {
    const shares = entryShares(expense(1000, "bia", ["ana", "bia", "caio"]));
    expect(Object.fromEntries(shares)).toEqual({ ana: 333, bia: 334, caio: 333 });
    expect(total(shares.values())).toBe(1000);
  });

  it("distribui as sobras de forma estável quando quem pagou não participa", () => {
    const first = entryShares(expense(1001, "ana", ["caio", "bia"]));
    const second = entryShares(expense(1001, "ana", ["bia", "caio"]));
    expect(Object.fromEntries(first)).toEqual({ bia: 501, caio: 500 });
    expect([...second]).toEqual([...first]);
  });

  it.each([1, 2, 7, 99, 100, 101, 999_999, 123_456_789])("soma exatamente %i centavos entre 1 a 7 pessoas", (amount) => {
    const people = ["a", "b", "c", "d", "e", "f", "g"];
    for (let count = 1; count <= people.length; count++) {
      const values = [...entryShares(expense(amount, "a", people.slice(0, count))).values()];
      expect(total(values)).toBe(amount);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });

  it("uma pessoa assume 100% da despesa", () => {
    const one = group([expense(5000, "ana", ["bia"])]);
    expect(debts(one)).toEqual([{ from: "bia", to: "ana", amount: 5000 }]);
  });

  it("divide apenas entre os integrantes selecionados", () => {
    const some = group([expense(6000, "ana", ["bia", "caio"])]);
    expect(Object.fromEntries(balances(some))).toEqual({ ana: 6000, bia: -3000, caio: -3000 });
  });

  it("usa 50/50 em um grupo de duas pessoas", () => {
    const pair = group([expense(5001, "ana", ["ana", "bia"])], ["ana", "bia"]);
    expect(debts(pair)).toEqual([{ from: "bia", to: "ana", amount: 2500 }]);
  });

  it("recusa valores que não são centavos inteiros positivos", () => {
    for (const amount of [0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1, NaN])
      expect(() => entryShares(expense(amount, "ana", ["ana", "bia"]))).toThrow();
  });
});

describe("saldos e compensação", () => {
  it("mantém a soma dos saldos em zero", () => {
    const mixed = group([
      expense(1000, "ana", ["ana", "bia", "caio"]),
      expense(777, "bia", ["ana", "caio"]),
      expense(1, "caio", ["ana", "bia", "caio"]),
      settlement(250, "caio", "ana"),
    ]);
    expect(total(balances(mixed).values())).toBe(0);
    const open = debts(mixed);
    expect(total(open.map((debt) => debt.amount))).toBe(
      total([...balances(mixed).values()].filter((value) => value > 0)),
    );
  });

  it("compensa dívidas cruzadas entre duas pessoas", () => {
    const crossed = group(
      [expense(10000, "ana", ["ana", "bia"]), expense(4000, "bia", ["ana", "bia"])],
      ["ana", "bia"],
    );
    expect(debts(crossed)).toEqual([{ from: "bia", to: "ana", amount: 3000 }]);
  });

  it("elimina o intermediário de uma cadeia de dívidas", () => {
    // Ana owes Bia and Bia owes Caio the same amount: Ana pays Caio directly.
    const chain = group([expense(3000, "bia", ["ana"]), expense(3000, "caio", ["bia"])]);
    expect(debts(chain)).toEqual([{ from: "ana", to: "caio", amount: 3000 }]);
  });

  it("não deixa dívidas quando tudo se compensa", () => {
    const even = group([
      expense(3000, "ana", ["bia"]),
      expense(3000, "bia", ["caio"]),
      expense(3000, "caio", ["ana"]),
    ]);
    expect(debts(even)).toEqual([]);
  });

  it("usa no máximo um pagamento a menos que o número de pessoas com saldo", () => {
    const many = group(
      [expense(10003, "a", ["a", "b", "c", "d", "e"]), expense(4999, "b", ["c", "d"]), expense(301, "e", ["a", "b", "c"])],
      ["a", "b", "c", "d", "e"],
    );
    const open = debts(many);
    expect(open.length).toBeLessThanOrEqual(4);
    const after = new Map(balances(many));
    for (const debt of open) {
      after.set(debt.from, after.get(debt.from)! + debt.amount);
      after.set(debt.to, after.get(debt.to)! - debt.amount);
    }
    expect([...after.values()].every((value) => value === 0)).toBe(true);
  });

  it("inclui integrantes sem lançamentos com saldo zero", () => {
    expect(Object.fromEntries(balances(group()))).toEqual({ ana: 0, bia: 0, caio: 0 });
  });
});

describe("resumo por pessoa", () => {
  it("mostra o efeito de cada lançamento na posição de uma pessoa", () => {
    const shared = expense(9000, "ana", ["ana", "bia", "caio"]);
    expect(entryImpact(shared, "ana")).toBe(6000);
    expect(entryImpact(shared, "bia")).toBe(-3000);
    expect(entryImpact(expense(4000, "bia", ["bia", "caio"]), "ana")).toBe(0);
    expect(entryImpact(expense(1000, "ana", ["bia"]), "ana")).toBe(1000);
    expect(entryImpact(settlement(2000, "bia", "ana"), "ana")).toBe(-2000);
  });

  it("os efeitos dos lançamentos somam o saldo da pessoa", () => {
    const current = group([
      expense(1001, "ana", ["ana", "bia", "caio"]),
      expense(700, "bia", ["ana", "caio"]),
      settlement(300, "caio", "ana"),
    ]);
    for (const member of current.members)
      expect(total(current.entries.map((entry) => entryImpact(entry, member.id)))).toBe(balances(current).get(member.id));
  });

  it("soma o gasto e a cota da pessoa sem contar acertos", () => {
    const entries = [
      expense(1001, "ana", ["ana", "bia", "caio"]),
      expense(700, "bia", ["bia", "caio"]),
      settlement(300, "bia", "ana"),
    ];
    expect(spending(entries, "ana")).toEqual({ spent: 1701, share: 334 });
    expect(spending(entries, "caio")).toEqual({ spent: 1701, share: 683 });
    expect(spending([], "ana")).toEqual({ spent: 0, share: 0 });
  });
});

describe("acertos", () => {
  const base = () => group([expense(10000, "ana", ["ana", "bia"])], ["ana", "bia"]);

  it("um acerto parcial reduz a dívida e um total a encerra", () => {
    const current = base();
    expect(debts(current)).toEqual([{ from: "bia", to: "ana", amount: 5000 }]);
    current.entries.push(settlement(2000, "bia", "ana"));
    expect(debts(current)).toEqual([{ from: "bia", to: "ana", amount: 3000 }]);
    current.entries.push(settlement(3000, "bia", "ana"));
    expect(debts(current)).toEqual([]);
  });

  it("recalcula os saldos quando uma despesa ou um acerto é alterado ou removido", () => {
    const current = base();
    current.entries.push(settlement(5000, "bia", "ana"));
    current.entries[0] = { ...current.entries[0], amount: 6000 };
    expect(debts(current)).toEqual([{ from: "ana", to: "bia", amount: 2000 }]);
    current.entries.pop();
    expect(debts(current)).toEqual([{ from: "bia", to: "ana", amount: 3000 }]);
  });

  it("recusa acerto acima do valor em aberto, sem dívida ou no sentido contrário", () => {
    const current = base();
    expect(validateSettlement(current, settlement(5000, "bia", "ana"))).toBeNull();
    expect(validateSettlement(current, settlement(1, "bia", "ana"))).toBeNull();
    expect(validateSettlement(current, settlement(5001, "bia", "ana"))).toMatch(/maior que o valor em aberto/);
    expect(validateSettlement(current, settlement(100, "ana", "bia"))).toMatch(/Não há valor em aberto/);
    expect(validateSettlement(current, settlement(0, "bia", "ana"))).toMatch(/maior que zero/);
    expect(validateSettlement(current, settlement(100, "bia", "bia"))).toMatch(/duas pessoas diferentes/);
  });
});

describe("validações e linha do tempo", () => {
  it("valida despesa", () => {
    const current = group();
    expect(validateEntry(current, expense(100, "ana", ["ana", "bia"]))).toBeNull();
    expect(validateEntry(current, expense(100, "ana", ["ana", "bia"], { description: "  " }))).toMatch(/Descreva/);
    expect(validateEntry(current, expense(100, "ana", ["ana", "bia"], { description: "x".repeat(81) }))).toMatch(/80/);
    expect(validateEntry(current, expense(0, "ana", ["bia"]))).toMatch(/maior que zero/);
    expect(validateEntry(current, expense(10.5, "ana", ["bia"]))).toMatch(/maior que zero/);
    expect(validateEntry(current, expense(100, "fora", ["bia"]))).toMatch(/quem pagou/);
    expect(validateEntry(current, expense(100, "ana", []))).toMatch(/ao menos um/);
    expect(validateEntry(current, expense(100, "ana", ["bia", "bia"]))).toMatch(/ao menos um/);
    expect(validateEntry(current, expense(100, "ana", ["fora"]))).toMatch(/ao menos um/);
    expect(validateEntry(current, expense(100, "ana", ["ana"]))).toMatch(/já assumiu/);
    expect(validateEntry(current, expense(100, "ana", ["bia"], { date: "01/10/2026" }))).toMatch(/Data/);
  });

  it("ordena dos mais recentes aos mais antigos, inclusive no mesmo dia", () => {
    const current = group([
      expense(100, "ana", ["bia"], { id: "antiga", date: "2026-09-30", createdAt: "2026-10-05T00:00:00Z" }),
      expense(100, "ana", ["bia"], { id: "manha", date: "2026-10-02", createdAt: "2026-10-02T08:00:00Z" }),
      expense(100, "bia", ["ana"], { id: "tarde", kind: "settlement", date: "2026-10-02", createdAt: "2026-10-02T15:00:00Z" }),
    ]);
    expect(timeline(current).map((entry) => entry.id)).toEqual(["tarde", "manha", "antiga"]);
  });

  it("normaliza o código de convite digitado ou colado", () => {
    expect(normalizeInviteCode(" ab12-cd34 ef56 ")).toBe("AB12CD34EF56");
  });
});
