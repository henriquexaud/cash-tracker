export type Month = string;
export type MovementKind = "opening" | "contribution" | "withdrawal" | "return";
export type BudgetKind = "fixed" | "variable";
export type Frequency = "monthly" | "weekly" | "daily";

export interface Salary {
  id: string;
  month: Month;
  amount: number;
}
export interface BudgetItem {
  id: string;
  name: string;
  kind: BudgetKind;
  frequency: Frequency;
  unitAmount: number;
  factor: number;
}
export interface Budget {
  month: Month;
  items: BudgetItem[];
  reservePlan: number;
}
export interface Account {
  id: string;
  name: string;
}
export interface Movement {
  id: string;
  accountId: string;
  date: string;
  kind: MovementKind;
  amount: number;
  note: string;
}
export interface Goal {
  id: string;
  name: string;
  accountId: string;
  target: number;
  allocated: number;
}
export interface LegacyImport {
  status: "pending" | "resolved";
  source: string;
  capturedAt: string;
  movements: number[];
  possibleReturns: number[];
  displayedNet: number;
  displayedSaved: string;
  notes: string[];
  resolution?: {
    amount: number;
    date: string;
    accountId: string;
    movementId: string;
  };
}
export interface AppData {
  schemaVersion: 1;
  salaries: Salary[];
  budgets: Budget[];
  budgetTemplate: BudgetItem[];
  accounts: Account[];
  movements: Movement[];
  goals: Goal[];
  legacy: LegacyImport;
  preferences: { lastBackupAt: string | null };
}
