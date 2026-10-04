import type {
  Account,
  AppData,
  BudgetItem,
  Goal,
  Month,
  Movement,
  MovementKind,
  Salary,
} from "./domain/types";
import type { ThemeSettings } from "./theme";

export type Page = "dashboard" | "budget" | "history" | "wealth" | "settings";
export interface Actions {
  navigate: (page: Page) => void;
  editSalary: (salary?: Salary, month?: Month) => void;
  removeSalary: (salary: Salary) => void;
  editBudgetItem: (item?: BudgetItem) => void;
  removeBudgetItem: (item: BudgetItem) => void;
  editReservePlan: () => void;
  startBudget: (source: "template" | "previous" | "empty") => void;
  editMovement: (movement?: Movement, kind?: MovementKind) => void;
  removeMovement: (movement: Movement) => void;
  editGoal: (goal?: Goal) => void;
  removeGoal: (goal: Goal) => void;
  addAccount: () => void;
  removeAccount: (account: Account) => void;
  reviewLegacy: () => void;
  importSavingsHistory: () => void;
  backup: () => void;
  restore: () => void;
  requestPersistence: () => void;
  install: () => void;
}
export interface PageProps {
  data: AppData;
  month: Month;
  setMonth: (month: Month) => void;
  actions: Actions;
  offlineReady: boolean;
  persistent: boolean;
  canInstall: boolean;
  theme: ThemeSettings;
}
