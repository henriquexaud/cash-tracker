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
import type { PushServer } from "./notifications";

export type Page = "dashboard" | "budget" | "history" | "wealth" | "splits" | "settings";
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
  backup: () => void;
  restore: () => void;
  signOut: () => void;
  requestPersistence: () => void;
  install: () => void;
  showInstallGuide: () => void;
}
export interface AuthAccount {
  id: string;
  email: string;
  signOut: () => Promise<void>;
}
export interface PageProps {
  account?: AuthAccount;
  storageMode?: "local" | "cloud";
  data: AppData;
  month: Month;
  setMonth: (month: Month) => void;
  actions: Actions;
  offlineReady: boolean;
  persistent: boolean;
  canInstall: boolean;
  theme: ThemeSettings;
  /** Present with an account: notifications reach this device with the app closed. */
  push?: PushServer;
}
