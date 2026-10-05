import { today } from "./finance";
import type { AppData } from "./types";

export function createEmptyData(): AppData {
  return {
    schemaVersion: 1,
    salaries: [],
    budgets: [],
    budgetTemplate: [],
    accounts: [],
    movements: [],
    goals: [],
    legacy: {
      status: "none",
      source: "Conta nova",
      capturedAt: today(),
      movements: [],
      possibleReturns: [],
      displayedNet: 0,
      displayedSaved: "—",
      notes: [],
    },
    preferences: { lastBackupAt: null },
  };
}
