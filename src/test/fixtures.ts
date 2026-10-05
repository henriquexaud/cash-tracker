import { createEmptyData } from "../domain/empty";
import type { AppData } from "../domain/types";

/** Synthetic fixtures only. Never copy real account records into tests. */
export function createTestData(): AppData {
  const data = createEmptyData();
  data.salaries = [
    { id: "salary-a", month: "2026-07", amount: 120_000 },
    { id: "salary-b", month: "2026-08", amount: 180_000 },
    { id: "salary-c", month: "2026-09", amount: 160_000 },
  ];
  data.budgetTemplate = [
    { id: "daily", name: "Gasto diário", kind: "variable", frequency: "daily", unitAmount: 1_000, factor: 30 },
    { id: "fixed", name: "Gasto mensal", kind: "fixed", frequency: "monthly", unitAmount: 20_000, factor: 1 },
  ];
  data.accounts = [{ id: "account-test", name: "Local de teste" }];
  data.legacy = {
    status: "pending", source: "Arquivo de teste", capturedAt: "2026-01-01",
    movements: [10_000, 20_000, -5_000], possibleReturns: [100, 200],
    displayedNet: 25_000, displayedSaved: "250,00", notes: ["Dados fictícios para compatibilidade de backup."],
  };
  return data;
}
