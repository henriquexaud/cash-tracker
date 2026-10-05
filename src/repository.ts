import type { AppData } from "./domain/types";
import { loadData, saveData } from "./storage";
export type SyncStatus =
  | "local"
  | "offline"
  | "pending"
  | "syncing"
  | "synced"
  | "error"
  | "review";
export interface DataRepository {
  mode: "local" | "cloud";
  load: () => Promise<AppData | null>;
  save: (data: AppData) => Promise<void>;
  sync?: () => Promise<void>;
  getStatus?: () => SyncStatus;
  subscribe?: (listener: () => void) => () => void;
  clear?: () => Promise<void>;
  dispose?: () => void;
}
export const localRepository: DataRepository = {
  mode: "local",
  load: loadData,
  save: saveData,
};
