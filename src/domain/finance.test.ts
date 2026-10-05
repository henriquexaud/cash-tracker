import { describe, expect, it } from "vitest";
import {
  accountBalance,
  budgetSeries,
  budgetStats,
  budgetTotal,
  copyBudget,
  formatMoney,
  monthlySummary,
  parseMoney,
  salarySeries,
  salaryStats,
  shiftMonth,
  validateGoal,
  validateMovement,
  wealthSeries,
  wealthStats,
} from "./finance";
import { createTestData } from "../test/fixtures";
import type { AppData, Budget, Movement } from "./types";

const entry = (overrides: Partial<Movement> = {}): Movement => ({
  id: "entry",
  accountId: "account-test",
  date: "2026-10-01",
  kind: "contribution",
  amount: 100_000,
  note: "",
  ...overrides,
});

function withWealth(): AppData {
  const data = createTestData();
  data.movements = [
    entry({
      id: "opening",
      date: "2026-09-01",
      kind: "opening",
      amount: 500_000,
    }),
    entry({ id: "contribution", amount: 100_000 }),
    entry({ id: "return", kind: "return", amount: 5_031 }),
    entry({ id: "loss", kind: "return", amount: -31 }),
    entry({
      id: "withdrawal",
      date: "2026-10-20",
      kind: "withdrawal",
      amount: 20_000,
    }),
  ];
  return data;
}

describe("synthetic financial data", () => {
  it("calculates salary totals, chronology and growth", () => {
    const stats = salaryStats(createTestData().salaries);
    expect(stats.count).toBe(3);
    expect(stats.total).toBe(460_000);
    expect(stats.first).toMatchObject({ month: "2026-07", amount: 120_000 });
    expect(stats.latest).toMatchObject({ month: "2026-09", amount: 160_000 });
    expect(stats.highest).toMatchObject({ month: "2026-08", amount: 180_000 });
    expect(stats.growth).toBeCloseTo(100 / 3);
  });

  it("keeps an undated template separate from monthly budgets", () => {
    const data = createTestData();
    expect(data.budgets).toEqual([]);
    expect(budgetTotal(data.budgetTemplate)).toBe(50_000);
  });

  it("does not count unconfirmed legacy values as savings", () => {
    const data = createTestData();
    expect(data.legacy.status).toBe("pending");
    expect(data.movements).toEqual([]);
    expect(wealthStats(data, "2026-10").total).toBe(0);
    expect(wealthSeries(data)).toEqual([]);
  });
});

describe("money in cents", () => {
  it.each([
    ["R$ 1.234,56", 123_456],
    ["1234,56", 123_456],
    ["1234.56", 123_456],
    ["1.234", 123_400],
    ["0,10", 10],
    ["19,9", 1_990],
    ["-32,01", -3_201],
    [" 66,99 ", 6_699],
    ["0", 0],
    ["90.071.992.547.409,91", Number.MAX_SAFE_INTEGER],
  ])("parses %s exactly", (text, amount) =>
    expect(parseMoney(text)).toBe(amount),
  );

  it.each([
    "",
    "abc",
    "1e3",
    "NaN",
    "12,345",
    "12.345,678",
    "1,234.56",
    "1.2.3",
    "1 234,56",
    "90.071.992.547.409,92",
  ])("rejects invalid or unsafe input %s", (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it("formats BRL and refuses multiplication beyond the safe integer range", () => {
    expect(formatMoney(50_000).replaceAll("\u00a0", " ")).toBe("R$ 500,00");
    expect(formatMoney(-1).replaceAll("\u00a0", " ")).toBe("-R$ 0,01");
    expect(formatMoney(Number.MAX_SAFE_INTEGER).replaceAll("\u00a0", " ")).toBe(
      "R$ 90.071.992.547.409,91",
    );
    expect(() =>
      budgetTotal([
        {
          id: "too-big",
          name: "Too big",
          kind: "fixed",
          frequency: "monthly",
          unitAmount: Number.MAX_SAFE_INTEGER,
          factor: 2,
        },
      ]),
    ).toThrow();
  });
});

describe("monthly planning", () => {
  it("previews the base without recording a budget or counting actual contributions twice", () => {
    const data = withWealth();
    data.salaries.push({ id: "salary-oct", month: "2026-10", amount: 800_000 });
    const summary = monthlySummary(data, "2026-10");
    expect(summary).toMatchObject({
      budget: null,
      expenses: 0,
      estimatedExpenses: 50_000,
      estimatedFree: 750_000,
    });
    expect(summary.budgetItems).toEqual(data.budgetTemplate);
    expect(data.budgets).toEqual([]);
    const savedBefore = wealthStats(data, "2026-10").monthSaved;
    data.movements.push({
      id: "manual-contribution",
      accountId: "account-test",
      date: "2026-10-03",
      kind: "contribution",
      amount: 100_000,
      note: "",
    });
    expect(monthlySummary(data, "2026-10").estimatedFree).toBe(750_000);
    expect(wealthStats(data, "2026-10").monthSaved).toBe(savedBefore + 100_000);
  });

  it("keeps an empty monthly budget instead of falling back to the base", () => {
    const data = createTestData();
    data.budgets.push({ month: "2026-09", items: [], reservePlan: 100_000 });
    expect(monthlySummary(data, "2026-09")).toMatchObject({
      budgetItems: [],
      estimatedExpenses: 0,
      estimatedFree: 60_000,
    });
  });

  it("does not infer a salary for an estimate and preserves a recorded zero", () => {
    const data = createTestData();
    expect(monthlySummary(data, "2026-10").estimatedFree).toBeNull();
    data.salaries.push({ id: "salary-zero", month: "2026-10", amount: 0 });
    expect(monthlySummary(data, "2026-10").estimatedFree).toBe(-50_000);
  });

  it("summarizes only recorded budget months and excludes reserves from expenses", () => {
    const budgets: Budget[] = [
      {
        month: "2026-10",
        reservePlan: 50_000,
        items: [
          {
            id: "rent",
            name: "Aluguel",
            kind: "fixed",
            frequency: "monthly",
            unitAmount: 100_000,
            factor: 1,
          },
          {
            id: "groceries",
            name: "Mercado",
            kind: "variable",
            frequency: "weekly",
            unitAmount: 10_000,
            factor: 4,
          },
        ],
      },
      {
        month: "2025-12",
        reservePlan: 30_000,
        items: [
          {
            id: "rent",
            name: "Aluguel",
            kind: "fixed",
            frequency: "monthly",
            unitAmount: 90_000,
            factor: 1,
          },
          {
            id: "food",
            name: "Alimentação",
            kind: "variable",
            frequency: "daily",
            unitAmount: 3_000,
            factor: 30,
          },
        ],
      },
    ];
    const stats = budgetStats(budgets);
    expect(stats).toEqual({
      total: 320_000,
      fixed: 190_000,
      variable: 130_000,
      reserved: 80_000,
      count: 2,
      firstMonth: "2025-12",
      lastMonth: "2026-10",
    });
    expect(stats.fixed + stats.variable).toBe(stats.total);
    expect(
      budgetSeries(budgets).map(({ month, value }) => ({ month, value })),
    ).toEqual([
      { month: "2025-12", value: 180_000 },
      { month: "2026-10", value: 140_000 },
    ]);
    expect(budgets[0].month).toBe("2026-10");
  });

  it("distinguishes absent budgets from an explicitly recorded empty budget", () => {
    expect(budgetStats([])).toEqual({
      total: 0,
      fixed: 0,
      variable: 0,
      reserved: 0,
      count: 0,
      firstMonth: null,
      lastMonth: null,
    });
    expect(budgetSeries([])).toEqual([]);
    const budgets: Budget[] = [
      { month: "2026-10", items: [], reservePlan: 50_000 },
    ];
    expect(budgetStats(budgets)).toEqual({
      total: 0,
      fixed: 0,
      variable: 0,
      reserved: 50_000,
      count: 1,
      firstMonth: "2026-10",
      lastMonth: "2026-10",
    });
    expect(budgetSeries(budgets)).toHaveLength(1);
    expect(budgetSeries(budgets)[0]).toMatchObject({
      month: "2026-10",
      value: 0,
    });
    expect(budgetStats(createTestData().budgets).count).toBe(0);
  });

  it("copies a budget without changing a previous month and preserves explicit factors", () => {
    const source: Budget = {
      month: "2026-09",
      items: createTestData().budgetTemplate,
      reservePlan: 100_000,
    };
    const copied = copyBudget(source, "2026-10");
    copied.items[0].unitAmount = 6_000;
    copied.items.push({
      id: "extra",
      name: "Extra",
      kind: "variable",
      frequency: "monthly",
      unitAmount: 1_000,
      factor: 1,
    });
    copied.reservePlan = 200_000;
    expect(source.items[0].unitAmount).toBe(1_000);
    expect(source.items).toHaveLength(2);
    expect(source.reservePlan).toBe(100_000);
    expect(copied.items[0].factor).toBe(30);
    expect(source.month).toBe("2026-09");
  });

  it("subtracts the planned reserve once, regardless of actual contributions and goals", () => {
    const data = withWealth();
    data.salaries.push({ id: "salary-oct", month: "2026-10", amount: 800_000 });
    data.budgets.push({
      month: "2026-10",
      items: data.budgetTemplate,
      reservePlan: 100_000,
    });
    data.goals.push({
      id: "trip",
      name: "Viagem",
      accountId: "account-test",
      target: 200_000,
      allocated: 50_000,
    });
    expect(monthlySummary(data, "2026-10")).toMatchObject({
      expenses: 50_000,
      reservePlan: 100_000,
      free: 650_000,
    });
    expect(wealthStats(data, "2026-10").total).toBe(585_000);
  });

  it("preserves unknown salary versus a recorded zero and exposes a negative forecast", () => {
    const data = createTestData();
    expect(monthlySummary(data, "2026-10").free).toBeNull();
    data.salaries.push({ id: "zero", month: "2026-10", amount: 0 });
    data.budgets.push({
      month: "2026-10",
      items: data.budgetTemplate,
      reservePlan: 0,
    });
    expect(monthlySummary(data, "2026-10").free).toBe(-50_000);
  });
});

describe("wealth and chronology", () => {
  it("keeps opening balance, gross contributions, losses and withdrawals distinct", () => {
    const data = withWealth();
    expect(wealthStats(data, "2026-10")).toEqual({
      total: 585_000,
      opening: 500_000,
      contributed: 100_000,
      withdrawn: 20_000,
      returns: 5_000,
      monthContributed: 100_000,
      monthWithdrawn: 20_000,
      monthReturns: 5_000,
      monthSaved: 80_000,
    });
    expect(accountBalance(data, "account-test")).toBe(585_000);
    expect(wealthStats(data, "2026-09").monthSaved).toBe(0);
  });

  it("fills the history between dated records without inventing pre-opening wealth", () => {
    const data = createTestData();
    data.movements = [
      entry({ kind: "opening", date: "2026-07-01", amount: 100_000 }),
      entry({ id: "later", date: "2026-09-30", amount: 50_000 }),
    ];
    expect(
      wealthSeries(data).map(({ month, value }) => ({ month, value })),
    ).toEqual([
      { month: "2026-07", value: 100_000 },
      { month: "2026-08", value: 100_000 },
      { month: "2026-09", value: 150_000 },
    ]);
  });

  it("rejects historical overdrafts even if a later deposit would leave a positive current balance", () => {
    const data = createTestData();
    data.movements = [entry({ date: "2026-10-10", amount: 200_000 })];
    expect(
      validateMovement(
        data,
        entry({
          id: "earlier",
          date: "2026-10-01",
          kind: "withdrawal",
          amount: 50_000,
        }),
      ),
    ).toContain("saldo negativo");
    expect(
      validateMovement(
        data,
        entry({
          id: "later",
          date: "2026-10-20",
          kind: "withdrawal",
          amount: 50_000,
        }),
      ),
    ).toBeNull();
  });

  it("validates dates, signed amounts, safe cents and replacement records", () => {
    const data = withWealth();
    expect(
      validateMovement(data, entry({ id: "bad-date", date: "2026-02-30" })),
    ).toContain("data válida");
    expect(
      validateMovement(
        data,
        entry({ id: "bad-account", accountId: "missing" }),
      ),
    ).toContain("conta existente");
    expect(
      validateMovement(data, entry({ id: "decimal", amount: 100.01 })),
    ).toContain("valor monetário");
    expect(
      validateMovement(data, entry({ id: "negative", amount: -100 })),
    ).toContain("valor positivo");
    expect(
      validateMovement(
        data,
        entry({ id: "loss2", kind: "return", amount: -100 }),
      ),
    ).toBeNull();
    expect(
      validateMovement(
        data,
        entry({ id: "contribution", amount: 200_000 }),
        "contribution",
      ),
    ).toBeNull();
    expect(validateMovement(data, entry({ id: "contribution" }))).toContain(
      "já existe",
    );
  });

  it("allocates objectives only within the account balance and protects them on withdrawal", () => {
    const data = withWealth();
    const goal = {
      id: "trip",
      name: "Viagem",
      accountId: "account-test",
      target: 800_000,
      allocated: 500_000,
    };
    expect(validateGoal(data, goal)).toBeNull();
    data.goals.push(goal);
    expect(wealthStats(data, "2026-10").total).toBe(585_000);
    expect(
      validateGoal(data, {
        ...goal,
        id: "other",
        name: "Emergência",
        allocated: 100_000,
      }),
    ).toContain("ultrapassa o saldo");
    expect(
      validateGoal(data, { ...goal, allocated: 585_000 }, "trip"),
    ).toBeNull();
    expect(
      validateMovement(
        data,
        entry({
          id: "use-goal",
          kind: "withdrawal",
          date: "2026-10-25",
          amount: 100_000,
        }),
      ),
    ).toContain("objetivos");
  });

  it("checks the original account when an edit moves an entry to another account", () => {
    const data = withWealth();
    data.accounts.push({ id: "other", name: "Outra conta" });
    const negativeData = {
      ...data,
      movements: [
        entry({
          id: "opening",
          kind: "opening",
          date: "2026-09-01",
          amount: 500_000,
        }),
        entry({
          id: "withdrawal",
          kind: "withdrawal",
          date: "2026-09-20",
          amount: 400_000,
        }),
      ],
    };
    const opening = negativeData.movements[0];
    expect(
      validateMovement(
        negativeData,
        { ...opening, accountId: "other" },
        "opening",
      ),
    ).toContain("saldo negativo");
    data.goals.push({
      id: "trip",
      name: "Viagem",
      accountId: "account-test",
      target: 600_000,
      allocated: 550_000,
    });
    const contribution = data.movements.find(
      (movement) => movement.id === "contribution",
    )!;
    expect(
      validateMovement(
        data,
        { ...contribution, accountId: "other" },
        "contribution",
      ),
    ).toContain("objetivos");
  });

  it("prevents confirming a current balance after a recorded contribution", () => {
    const data = createTestData();
    data.movements = [entry({ amount: 100_000 })];
    const confirmation = entry({
      id: "confirmation",
      kind: "opening",
      amount: 200_000,
      date: "2026-10-02",
    });
    expect(validateMovement(data, confirmation)).toContain(
      "saldo inicial antes das outras movimentações",
    );
    // An earlier date cannot turn the same already-recorded money into a new baseline.
    expect(
      validateMovement(data, { ...confirmation, date: "2026-09-01" }),
    ).toContain("saldo inicial antes das outras movimentações");
    expect(wealthStats(data, "2026-10").total).toBe(100_000);
  });

  it("allows one opening before later contributions, but rejects a second opening", () => {
    const data = createTestData();
    const opening = entry({
      id: "opening",
      kind: "opening",
      amount: 200_000,
    });
    expect(validateMovement(data, opening)).toBeNull();
    data.movements.push(opening);
    expect(
      validateMovement(data, entry({ id: "contribution", date: "2026-10-02" })),
    ).toBeNull();
    expect(
      validateMovement(
        data,
        entry({ id: "second-opening", kind: "opening", amount: 200_000 }),
      ),
    ).toContain("saldo inicial antes");
    data.movements.push(entry({ id: "contribution", date: "2026-10-02" }));
    expect(wealthStats(data, "2026-10").total).toBe(300_000);
  });

  it("permits correcting the opening while keeping it before the rest of the account history", () => {
    const data = withWealth();
    const opening = data.movements.find(
      (movement) => movement.id === "opening",
    )!;
    expect(
      validateMovement(
        data,
        { ...opening, amount: 600_001, date: "2026-09-02" },
        opening.id,
      ),
    ).toBeNull();
    expect(
      validateMovement(data, { ...opening, date: "2026-10-01" }, opening.id),
    ).toBeNull();
    expect(
      validateMovement(data, { ...opening, date: "2026-10-02" }, opening.id),
    ).toContain("anterior ou igual à primeira movimentação");
    const contribution = data.movements.find(
      (movement) => movement.id === "contribution",
    )!;
    expect(
      validateMovement(
        data,
        { ...contribution, date: "2026-08-01" },
        contribution.id,
      ),
    ).toContain("anterior ou igual à primeira movimentação");
  });

  it("rejects invalid opening structures when validating an already populated ledger", () => {
    const data = withWealth();
    const representative = data.movements[0];
    const duplicate = {
      ...data,
      movements: [
        ...data.movements,
        entry({ id: "duplicate", kind: "opening", amount: 100 }),
      ],
    };
    expect(
      validateMovement(duplicate, representative, representative.id),
    ).toContain("apenas um saldo inicial");
    const lateOpening = {
      ...data,
      movements: data.movements.map((movement) =>
        movement.id === representative.id
          ? { ...movement, date: "2026-10-02" }
          : movement,
      ),
    };
    const lateRepresentative = lateOpening.movements[0];
    expect(
      validateMovement(lateOpening, lateRepresentative, lateRepresentative.id),
    ).toContain("anterior ou igual à primeira movimentação");
  });

  it("blocks changing an existing contribution into a second opening or moving an opening into a populated account", () => {
    const data = withWealth();
    data.accounts.push({ id: "other", name: "Outra conta" });
    data.movements.push(
      entry({ id: "other-contribution", accountId: "other", amount: 100_000 }),
    );
    const contribution = data.movements.find(
      (movement) => movement.id === "contribution",
    )!;
    expect(
      validateMovement(
        data,
        { ...contribution, kind: "opening" },
        contribution.id,
      ),
    ).toContain("saldo inicial antes");
    const opening = data.movements.find(
      (movement) => movement.id === "opening",
    )!;
    expect(
      validateMovement(data, { ...opening, accountId: "other" }, opening.id),
    ).toContain("saldo inicial antes");
  });
});

describe("monthly history helpers", () => {
  it("orders salaries without mutating their source and handles empty history", () => {
    const salaries = [
      { id: "new", month: "2026-01", amount: 200 },
      { id: "old", month: "2025-12", amount: 100 },
    ];
    expect(salarySeries(salaries).map((point) => point.month)).toEqual([
      "2025-12",
      "2026-01",
    ]);
    expect(salaries[0].id).toBe("new");
    expect(salaryStats([])).toEqual({
      total: 0,
      first: null,
      latest: null,
      highest: null,
      growth: 0,
      count: 0,
    });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 2)).toBe("2026-02");
  });
});
