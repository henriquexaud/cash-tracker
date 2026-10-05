import type { AppData, Budget, BudgetItem } from "../domain/types";
import { createEmptyData } from "../domain/empty";
import { validateBackup } from "../storage";
import { validateMovement, validateGoal } from "../domain/finance";

export interface SyncRecord {
  stamp: string;
  value: unknown | null;
  deletedValue?: unknown;
}
export interface SyncDocument {
  version: 1;
  records: Record<string, SyncRecord>;
}
export const emptyDocument = (): SyncDocument => ({ version: 1, records: {} });
const key = (...parts: string[]) => JSON.stringify(parts);
export function flatten(data: AppData): Record<string, unknown> {
  const records: Record<string, unknown> = {};
  for (const row of data.salaries) records[key("salary", row.month)] = row;
  for (const row of data.accounts) records[key("account", row.id)] = row;
  for (const row of data.movements) records[key("movement", row.id)] = row;
  for (const row of data.goals) records[key("goal", row.id)] = row;
  for (const row of data.budgetTemplate) records[key("template", row.id)] = row;
  for (const row of data.budgets) {
    records[key("budget", row.month)] = {
      month: row.month,
      reservePlan: row.reservePlan,
    };
    for (const item of row.items)
      records[key("item", row.month, item.id)] = item;
  }
  records[key("legacy")] = data.legacy;
  records[key("preferences")] = data.preferences;
  return records;
}

/** Fixed-width logical time sorts identically in JavaScript and SQL COLLATE C. */
export function nextStamp(
  document: SyncDocument,
  now: number,
  device: string,
): string {
  const latest = Object.values(document.records).reduce(
    (max, row) => (row.stamp > max ? row.stamp : max),
    "",
  );
  const observed = Number(latest.slice(0, 16)) || 0;
  const wall = Math.max(Math.round(now), observed);
  const counter =
    wall === observed ? (Number(latest.slice(17, 23)) || 0) + 1 : 0;
  if (
    counter > 999999 ||
    !Number.isSafeInteger(wall) ||
    wall < 0 ||
    wall >= 1e16
  )
    throw new Error("Não foi possível gerar a revisão desta edição.");
  return `${String(wall).padStart(16, "0")}:${String(counter).padStart(6, "0")}:${device}`;
}

/** Only edited records receive a new timestamp. Unchanged records keep their origin. */
export function applyEdit(
  document: SyncDocument,
  before: AppData,
  after: AppData,
  stamp: string,
): SyncDocument {
  const previous = flatten(before),
    next = flatten(after);
  const result = structuredClone(document);
  for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[id]) !== JSON.stringify(next[id]))
      result.records[id] = {
        stamp,
        value: next[id] ?? null,
        ...(next[id] === undefined ? { deletedValue: previous[id] } : {}),
      };
  }
  return result;
}

export function mergeDocuments(
  left: SyncDocument,
  right: SyncDocument,
): SyncDocument {
  const result = structuredClone(left);
  for (const [id, row] of Object.entries(right.records)) {
    if (!result.records[id] || row.stamp > result.records[id].stamp)
      result.records[id] = structuredClone(row);
  }
  return result;
}

export function validateDocument(input: unknown): SyncDocument {
  const raw = input as SyncDocument;
  if (
    !raw ||
    raw.version !== 1 ||
    !raw.records ||
    typeof raw.records !== "object" ||
    Array.isArray(raw.records)
  )
    throw new Error("O formato dos dados sincronizados é inválido.");
  if (Object.keys(raw.records).length > 100000)
    throw new Error("O histórico excede o limite de registros.");
  for (const [id, row] of Object.entries(raw.records)) {
    let parts: unknown;
    try {
      parts = JSON.parse(id);
    } catch {
      throw new Error("Identificador de sincronização inválido.");
    }
    if (
      !Array.isArray(parts) ||
      parts.some((part) => typeof part !== "string") ||
      ![
        "salary",
        "account",
        "movement",
        "goal",
        "template",
        "budget",
        "item",
        "legacy",
        "preferences",
      ].includes(parts[0]) ||
      parts.length !==
        (["legacy", "preferences"].includes(parts[0])
          ? 1
          : parts[0] === "item"
            ? 3
            : 2) ||
      !row ||
      !/^[0-9]{16}:[0-9]{6}:[0-9a-f-]{36}$/.test(row.stamp) ||
      !("value" in row)
    )
      throw new Error("Registro de sincronização inválido.");
  }
  return structuredClone(raw);
}

/** Tombstones suppress stale children; a later child edit can retain its account. */
export function materialize(document: SyncDocument): AppData {
  const data = createEmptyData();
  const budgets = new Map<string, Budget>();
  const accounts = new Map<string, AppData["accounts"][number]>();
  const active = Object.entries(document.records).filter(
    ([, row]) => row.value !== null,
  );
  for (const [id, row] of active) {
    const [type, name] = JSON.parse(id) as string[];
    if (type === "account")
      accounts.set(name, row.value as AppData["accounts"][number]);
    if (type === "budget")
      budgets.set(name, { ...(row.value as Omit<Budget, "items">), items: [] });
  }
  for (const [id, row] of active) {
    const [type, name] = JSON.parse(id) as string[];
    switch (type) {
      case "salary":
        data.salaries.push(row.value as AppData["salaries"][number]);
        break;
      case "movement":
      case "goal": {
        const child = row.value as AppData["movements"][number] &
          AppData["goals"][number];
        const account = document.records[key("account", child.accountId)];
        // Deleting an account only occurs when empty locally. A concurrent newer
        // child preserves the old account name from its deletion record's parent.
        if (accounts.has(child.accountId)) {
          if (type === "movement") data.movements.push(child);
          else data.goals.push(child);
        } else if (account && row.stamp > account.stamp) {
          accounts.set(child.accountId, {
            id: child.accountId,
            name:
              (account.deletedValue as { name?: string } | undefined)?.name ??
              "Local recuperado",
          });
          if (type === "movement") data.movements.push(child);
          else data.goals.push(child);
        }
        break;
      }
      case "template":
        data.budgetTemplate.push(row.value as BudgetItem);
        break;
      case "item": {
        const parent = document.records[key("budget", name)];
        if (
          parent?.value === null &&
          row.stamp > parent.stamp &&
          !budgets.has(name)
        )
          budgets.set(name, {
            month: name,
            reservePlan:
              (parent.deletedValue as { reservePlan?: number } | undefined)
                ?.reservePlan ?? 0,
            items: [],
          });
        if (
          budgets.has(name) &&
          (parent?.value !== null || row.stamp > parent.stamp)
        )
          budgets.get(name)!.items.push(row.value as BudgetItem);
        break;
      }
      case "legacy":
        data.legacy = row.value as AppData["legacy"];
        break;
      case "preferences":
        data.preferences = row.value as AppData["preferences"];
        break;
    }
  }
  data.accounts = [...accounts.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  data.budgets = [...budgets.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  data.salaries.sort((a, b) => a.month.localeCompare(b.month));
  data.movements.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  // Legacy resolution describes a movement and follows its winning edit.
  if (data.legacy.resolution) {
    const row = data.movements.find(
      (m) =>
        m.id === data.legacy.resolution!.movementId && m.kind === "opening",
    );
    if (row)
      data.legacy.resolution = {
        movementId: row.id,
        accountId: row.accountId,
        amount: row.amount,
        date: row.date,
      };
    else {
      data.legacy.status = "pending";
      delete data.legacy.resolution;
    }
  }
  return validateBackup(data, { allowFinancialConflicts: true });
}
export function needsReview(data: AppData): boolean {
  try {
    validateBackup(data);
    return false;
  } catch {
    return true;
  }
}

/** Existing merge conflicts may be corrected one account at a time. */
export function validateSynchronizedEdit(
  current: AppData,
  input: AppData,
): AppData {
  try {
    return validateBackup(input);
  } catch (error) {
    if (!needsReview(current)) throw error;
    const candidate = validateBackup(input, { allowFinancialConflicts: true });
    const issues = (data: AppData) => {
      const result = new Set<string>();
      for (const account of data.accounts) {
        const movement = data.movements.find(
          (row) => row.accountId === account.id,
        );
        if (movement && validateMovement(data, movement, movement.id))
          result.add(`account:${account.id}`);
      }
      for (const goal of data.goals)
        if (validateGoal(data, goal, goal.id)) result.add(`goal:${goal.id}`);
      return result;
    };
    const previous = issues(current);
    if ([...issues(candidate)].some((issue) => !previous.has(issue)))
      throw error;
    return candidate;
  }
}
