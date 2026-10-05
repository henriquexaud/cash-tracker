import { describe, expect, it } from "vitest";
import { createTestData } from "./test/fixtures";
import type { AppData } from "./domain/types";
import { exportBackup, parseBackup, validateBackup } from "./storage";

/** A schema-1 backup produced before the monthly history was identified. */
function legacyData(): AppData {
  const data = createTestData();
  data.movements = [];
  data.legacy.status = "pending";
  delete data.legacy.historyImported;
  delete data.legacy.resolution;
  return data;
}

function fundedData(): AppData {
  const data = legacyData();
  data.movements = [
    {
      id: "opening",
      accountId: data.accounts[0].id,
      date: "2026-10-01",
      kind: "opening",
      amount: 100_000,
      note: "Saldo confirmado",
    },
  ];
  return data;
}

describe("backup do Cash Tracker", () => {
  it("preserva os dados da planilha e a revisão pendente ao exportar e restaurar", () => {
    const original = legacyData();
    const restored = parseBackup(exportBackup(original));
    expect(restored).toEqual(original);
    expect(restored.salaries).toHaveLength(3);
    expect(
      restored.salaries.reduce((sum, salary) => sum + salary.amount, 0),
    ).toBe(460_000);
    expect(restored.legacy.status).toBe("pending");
    expect(restored.movements).toHaveLength(0);
    expect(restored.legacy).not.toHaveProperty("historyImported");
  });

  it("preserva meses identificados e a importação concluída no backup schema 1", () => {
    const data = legacyData();
    data.legacy.status = "resolved";
    data.legacy.historyImported = true;
    data.movements = [
      {
        id: "imported-contribution",
        accountId: data.accounts[0].id,
        date: "2025-05-01",
        datePrecision: "month",
        kind: "contribution",
        amount: 100_000,
        note: "Planilha: maio de 2025; dia não identificado.",
      },
      {
        id: "imported-return",
        accountId: data.accounts[0].id,
        date: "2026-07-01",
        datePrecision: "month",
        kind: "return",
        amount: 125,
        note: "Planilha: julho de 2026; dia não identificado.",
      },
    ];
    expect(parseBackup(exportBackup(data))).toEqual(data);
    expect(validateBackup(data).schemaVersion).toBe(1);
  });

  it("mantém o marcador de importação após excluir os lançamentos importados", () => {
    const data = legacyData();
    data.legacy.status = "resolved";
    data.legacy.historyImported = true;
    expect(parseBackup(exportBackup(data))).toEqual(data);
  });

  it("rejeita precisão mensal associada a um dia específico", () => {
    const data = fundedData();
    data.movements[0].date = "2026-10-12";
    data.movements[0].datePrecision = "month";
    expect(() => validateBackup(data)).toThrow(/primeiro dia/);
  });

  it("rejeita uma precisão de data desconhecida", () => {
    const data = fundedData();
    const malformed = structuredClone(data) as unknown as {
      movements: { datePrecision?: string }[];
    };
    malformed.movements[0].datePrecision = "year";
    expect(() => validateBackup(malformed)).toThrow(/datePrecision/);
  });

  it("não aceita o histórico importado como pendente nem junto do saldo inicial legado", () => {
    const data = fundedData();
    data.legacy.historyImported = true;
    expect(() => validateBackup(data)).toThrow(/historyImported/);
    data.legacy.status = "resolved";
    data.legacy.resolution = {
      accountId: data.accounts[0].id,
      movementId: "opening",
      amount: 100_000,
      date: "2026-10-01",
    };
    expect(() => validateBackup(data)).toThrow(/historyImported/);
  });

  it("rejeita um marcador de importação falso em vez de tratar o legado como resolvido", () => {
    const data = fundedData();
    data.legacy.status = "resolved";
    const malformed = {
      ...data,
      legacy: { ...data.legacy, historyImported: false },
    };
    expect(() => validateBackup(malformed)).toThrow(/historyImported/);
  });

  it("aceita prejuízo registrado como rendimento e entradas no mesmo dia", () => {
    const data = fundedData();
    data.movements.unshift({
      id: "withdrawal",
      accountId: data.accounts[0].id,
      date: "2026-10-01",
      kind: "withdrawal",
      amount: 20_000,
      note: "",
    });
    data.movements.push({
      id: "loss",
      accountId: data.accounts[0].id,
      date: "2026-10-02",
      kind: "return",
      amount: -2_000,
      note: "Ajuste negativo",
    });
    expect(validateBackup(data)).toEqual(data);
  });

  it("rejeita perda de saldo em uma data anterior, mesmo com saldo final positivo", () => {
    const data = fundedData();
    data.movements.push({
      id: "early-withdrawal",
      accountId: data.accounts[0].id,
      date: "2026-09-30",
      kind: "withdrawal",
      amount: 1_000,
      note: "",
    });
    expect(() => validateBackup(data)).toThrow(/saldo negativo/);
  });

  it("rejeita objetivos que somam mais que o dinheiro da conta", () => {
    const data = fundedData();
    data.goals = [
      {
        id: "one",
        accountId: data.accounts[0].id,
        name: "Reserva",
        target: 200_000,
        allocated: 70_000,
      },
      {
        id: "two",
        accountId: data.accounts[0].id,
        name: "Viagem",
        target: 100_000,
        allocated: 40_000,
      },
    ];
    expect(() => validateBackup(data)).toThrow(/objetivos|saldo/);
  });

  it.each([
    [
      "centavos fracionários",
      (data: AppData) => {
        data.salaries[0].amount = 0.1;
      },
    ],
    [
      "centavos fora do limite",
      (data: AppData) => {
        data.salaries[0].amount = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "mês inexistente",
      (data: AppData) => {
        data.salaries[0].month = "2026-13";
      },
    ],
    [
      "salário duplicado",
      (data: AppData) => {
        data.salaries.push({ ...data.salaries[0], id: "other" });
      },
    ],
    [
      "ID repetido",
      (data: AppData) => {
        data.accounts.push({ ...data.accounts[0] });
      },
    ],
    [
      "referência quebrada",
      (data: AppData) => {
        data.movements[0].accountId = "unknown-account";
      },
    ],
    [
      "data inexistente",
      (data: AppData) => {
        data.movements[0].date = "2026-02-31";
      },
    ],
    [
      "total de salário inseguro",
      (data: AppData) => {
        data.salaries[0].amount = Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      "multiplicação insegura",
      (data: AppData) => {
        data.budgetTemplate[0].unitAmount = Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      "reserva e despesas inseguras",
      (data: AppData) => {
        data.budgets = [
          {
            month: "2026-10",
            items: [data.budgetTemplate[0]],
            reservePlan: Number.MAX_SAFE_INTEGER,
          },
        ];
      },
    ],
    [
      "legado resolvido sem confirmação",
      (data: AppData) => {
        data.legacy.status = "resolved";
      },
    ],
    [
      "data e hora inválidas",
      (data: AppData) => {
        data.preferences.lastBackupAt = "2026-02-31T12:00:00.000Z";
      },
    ],
  ])("rejeita %s antes de restaurar", (_description, corrupt) => {
    const data = fundedData();
    corrupt(data);
    expect(() => validateBackup(data)).toThrow(/Backup inválido/);
  });

  it("vincula a resolução do legado ao saldo inicial confirmado", () => {
    const data = fundedData();
    data.legacy.status = "resolved";
    data.legacy.resolution = {
      accountId: data.accounts[0].id,
      movementId: "opening",
      amount: 100_000,
      date: "2026-10-01",
    };
    expect(validateBackup(data)).toEqual(data);
    data.legacy.resolution.amount = 1;
    expect(() => validateBackup(data)).toThrow(/saldo inicial/);
  });

  it("rejeita JSON quebrado, envelopes desconhecidos e versões incompatíveis", () => {
    expect(() => parseBackup("{")).toThrow(/JSON válido/);
    expect(() => parseBackup(JSON.stringify({ format: "unknown" }))).toThrow(
      /Cash Tracker/,
    );
    expect(() =>
      parseBackup(JSON.stringify({ format: "cash-tracker", version: 2 })),
    ).toThrow(/compatível/);
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "cash-tracker",
          version: 1,
          exportedAt: "ontem",
          data: createTestData(),
        }),
      ),
    ).toThrow(/data e hora/);
  });

  it("descarta campos desconhecidos e não modifica o objeto recebido", () => {
    const original = { ...createTestData(), unexpected: { value: true } };
    const validated = validateBackup(original);
    expect(validated).not.toHaveProperty("unexpected");
    validated.salaries[0].amount = 1;
    expect(original.salaries[0].amount).toBe(120_000);
  });
});
