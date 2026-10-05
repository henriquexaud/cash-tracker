import type {
  Account,
  AppData,
  Budget,
  BudgetItem,
  Goal,
  LegacyImport,
  Movement,
  Salary,
} from "./domain/types";
import { validateGoal, validateMovement } from "./domain/finance";

const DATABASE_NAME = "cash-tracker";
const DATABASE_VERSION = 1;
const STATE_STORE = "state";
const STATE_KEY = "current";

type StoredState = { revision: number; data: AppData };
let knownRevision: number | null = null;
let pendingSave: Promise<void> = Promise.resolve();
let databasePromise: Promise<IDBDatabase> | null = null;

export class StorageConflictError extends Error {
  constructor() {
    super(
      "Seus dados mudaram em outra aba. Recarregue esta aba antes de salvar para preservar as duas versões.",
    );
    this.name = "StorageConflictError";
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error("O navegador não disponibilizou o armazenamento local."),
    );
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE))
        request.result.createObjectStore(STATE_STORE);
    };
    request.onsuccess = () => {
      const database = request.result;
      // A blocked request may later succeed after its rejected promise was
      // retried. Close that abandoned connection instead of leaking a DB lock.
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(
        new Error(
          "Não foi possível abrir os dados locais. Tente novamente antes de fazer alterações.",
        ),
      );
    };
    request.onblocked = () => {
      blocked = true;
      databasePromise = null;
      reject(
        new Error(
          "Feche outras abas do Cash Tracker para atualizar o armazenamento local.",
        ),
      );
    };
  });
  return databasePromise;
}

/** A read error is deliberately distinct from an empty database. */
export async function loadData(): Promise<AppData | null> {
  const database = await openDatabase();
  const stored = await new Promise<StoredState | undefined>(
    (resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, "readonly");
      const request = transaction.objectStore(STATE_STORE).get(STATE_KEY);
      transaction.oncomplete = () =>
        resolve(request.result as StoredState | undefined);
      transaction.onerror = () =>
        reject(
          new Error(
            "Não foi possível ler os dados locais. Nenhum dado foi substituído.",
          ),
        );
      transaction.onabort = () =>
        reject(
          new Error(
            "A leitura dos dados locais foi interrompida. Nenhum dado foi substituído.",
          ),
        );
    },
  );
  if (stored === undefined) {
    knownRevision = 0;
    return null;
  }
  if (
    !stored ||
    !Number.isSafeInteger(stored.revision) ||
    stored.revision < 1
  ) {
    throw new Error(
      "Os dados locais têm um formato inválido. Restaure um backup válido para recuperá-los.",
    );
  }
  knownRevision = stored.revision;
  // Remember a readable revision even if the contents require an explicit
  // backup restore. The caller still receives the validation error, not seed data.
  return validateBackup(stored.data);
}

/** All application data is committed atomically in one transaction. */
export function saveData(data: AppData): Promise<void> {
  // Snapshot before queueing so later caller mutations cannot change the write.
  const snapshot = validateBackup(data);
  const operation = pendingSave
    .catch(() => undefined)
    .then(async () => {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE, "readwrite");
        const store = transaction.objectStore(STATE_STORE);
        const request = store.get(STATE_KEY);
        let failure: Error | null = null;
        let nextRevision = 0;
        request.onsuccess = () => {
          const existing = request.result as StoredState | undefined;
          const revision = existing?.revision ?? 0;
          if (
            !Number.isSafeInteger(revision) ||
            revision < 0 ||
            revision === Number.MAX_SAFE_INTEGER
          ) {
            failure = new Error(
              "Os dados locais têm uma revisão inválida. Nenhum dado foi substituído.",
            );
            transaction.abort();
            return;
          }
          if (knownRevision === null || revision !== knownRevision) {
            failure = new StorageConflictError();
            transaction.abort();
            return;
          }
          nextRevision = revision + 1;
          store.put(
            { revision: nextRevision, data: snapshot } satisfies StoredState,
            STATE_KEY,
          );
        };
        transaction.oncomplete = () => {
          knownRevision = nextRevision;
          resolve();
        };
        transaction.onerror = () =>
          reject(
            failure ??
              new Error(
                "Não foi possível salvar. Verifique o espaço disponível no navegador e tente novamente.",
              ),
          );
        transaction.onabort = () =>
          reject(
            failure ??
              new Error(
                "A gravação foi interrompida. Os dados anteriores foram preservados.",
              ),
          );
      });
    });
  pendingSave = operation;
  return operation;
}

function invalid(path: string, message: string): never {
  throw new Error(`Backup inválido: ${path} ${message}.`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "deve ser um objeto");
  return value as Record<string, unknown>;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "deve ser uma lista");
  return value;
}
function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()))
    invalid(path, "deve ser um texto válido");
  return value;
}
function integer(value: unknown, path: string, signed = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!signed && value < 0)
  ) {
    invalid(path, "deve conter centavos inteiros dentro do limite seguro");
  }
  return value;
}
function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T))
    invalid(path, "contém uma opção desconhecida");
  return value as T;
}
function month(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text) || text.startsWith("0000"))
    invalid(path, "deve ser um mês válido (AAAA-MM)");
  return text;
}
function date(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000"))
    invalid(path, "deve ser uma data válida (AAAA-MM-DD)");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  )
    invalid(path, "contém uma data inexistente");
  return text;
}
function timestamp(value: unknown, path: string, allowDate = false): string {
  const text = string(value, path);
  if (allowDate && /^\d{4}-\d{2}-\d{2}$/.test(text)) return date(text, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      text,
    )
  )
    invalid(path, "deve ser uma data e hora ISO válida");
  date(text.slice(0, 10), path);
  const time = text.slice(11, 19).split(":").map(Number);
  if (
    time[0] > 23 ||
    time[1] > 59 ||
    time[2] > 59 ||
    !Number.isFinite(Date.parse(text))
  )
    invalid(path, "contém uma data ou hora inexistente");
  return text;
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length)
    invalid(path, "contém identificadores repetidos");
}
function safeTotal(values: number[], path: string): number {
  let total = 0;
  for (const amount of values) {
    total += amount;
    if (!Number.isSafeInteger(total))
      invalid(path, "ultrapassa o limite monetário seguro");
  }
  return total;
}
function budgetItems(value: unknown, path: string): BudgetItem[] {
  const items = list(value, path).map((entry, index) => {
    const location = `${path}[${index}]`;
    const item = object(entry, location);
    const unitAmount = integer(item.unitAmount, `${location}.unitAmount`);
    const factor = integer(item.factor, `${location}.factor`);
    if (factor < 1)
      invalid(`${location}.factor`, "deve ser um multiplicador positivo");
    if (!Number.isSafeInteger(unitAmount * factor))
      invalid(location, "produz um total monetário acima do limite seguro");
    return {
      id: string(item.id, `${location}.id`),
      name: string(item.name, `${location}.name`),
      kind: choice(item.kind, ["fixed", "variable"], `${location}.kind`),
      frequency: choice(
        item.frequency,
        ["monthly", "weekly", "daily"],
        `${location}.frequency`,
      ),
      unitAmount,
      factor,
    };
  });
  unique(
    items.map((item) => item.id),
    path,
  );
  safeTotal(
    items.map((item) => item.unitAmount * item.factor),
    path,
  );
  return items;
}

/** Validate and reconstruct only known fields before any persistent write. */
export function validateBackup(
  input: unknown,
  options: { allowFinancialConflicts?: boolean } = {},
): AppData {
  const root = object(input, "dados");
  if (root.schemaVersion !== 1)
    invalid("schemaVersion", "não é uma versão compatível");
  const salaries: Salary[] = list(root.salaries, "salaries").map(
    (entry, index) => {
      const item = object(entry, `salaries[${index}]`);
      return {
        id: string(item.id, `salaries[${index}].id`),
        month: month(item.month, `salaries[${index}].month`),
        amount: integer(item.amount, `salaries[${index}].amount`),
      };
    },
  );
  unique(
    salaries.map((item) => item.id),
    "salaries",
  );
  unique(
    salaries.map((item) => item.month),
    "salaries.month",
  );
  safeTotal(
    salaries.map((item) => item.amount),
    "total dos salários",
  );
  const budgets: Budget[] = list(root.budgets, "budgets").map(
    (entry, index) => {
      const item = object(entry, `budgets[${index}]`);
      const items = budgetItems(item.items, `budgets[${index}].items`);
      const reservePlan = integer(
        item.reservePlan,
        `budgets[${index}].reservePlan`,
      );
      safeTotal(
        [
          ...items.map(
            (budgetItem) => budgetItem.unitAmount * budgetItem.factor,
          ),
          reservePlan,
        ],
        `budgets[${index}].total`,
      );
      return {
        month: month(item.month, `budgets[${index}].month`),
        items,
        reservePlan,
      };
    },
  );
  unique(
    budgets.map((item) => item.month),
    "budgets.month",
  );
  const budgetTemplate = budgetItems(root.budgetTemplate, "budgetTemplate");
  const accounts: Account[] = list(root.accounts, "accounts").map(
    (entry, index) => {
      const item = object(entry, `accounts[${index}]`);
      return {
        id: string(item.id, `accounts[${index}].id`),
        name: string(item.name, `accounts[${index}].name`),
      };
    },
  );
  unique(
    accounts.map((item) => item.id),
    "accounts",
  );
  const accountIds = new Set(accounts.map((item) => item.id));
  const movements: Movement[] = list(root.movements, "movements").map(
    (entry, index) => {
      const item = object(entry, `movements[${index}]`);
      const kind = choice(
        item.kind,
        ["opening", "contribution", "withdrawal", "return"],
        `movements[${index}].kind`,
      );
      const accountId = string(item.accountId, `movements[${index}].accountId`);
      if (!accountIds.has(accountId))
        invalid(
          `movements[${index}].accountId`,
          "referencia uma conta inexistente",
        );
      const amount = integer(
        item.amount,
        `movements[${index}].amount`,
        kind === "return",
      );
      if (kind !== "opening" && amount === 0)
        invalid(`movements[${index}].amount`, "deve ser diferente de zero");
      const movement: Movement = {
        id: string(item.id, `movements[${index}].id`),
        accountId,
        date: date(item.date, `movements[${index}].date`),
        kind,
        amount,
        note: string(item.note, `movements[${index}].note`, true),
      };
      if (item.datePrecision !== undefined) {
        movement.datePrecision = choice<"month">(
          item.datePrecision,
          ["month"],
          `movements[${index}].datePrecision`,
        );
        if (!movement.date.endsWith("-01"))
          invalid(
            `movements[${index}].date`,
            "deve usar o primeiro dia como referência do mês, sem afirmar um dia exato",
          );
      }
      return movement;
    },
  );
  unique(
    movements.map((item) => item.id),
    "movements",
  );
  const goals: Goal[] = list(root.goals, "goals").map((entry, index) => {
    const item = object(entry, `goals[${index}]`);
    const accountId = string(item.accountId, `goals[${index}].accountId`);
    if (!accountIds.has(accountId))
      invalid(`goals[${index}].accountId`, "referencia uma conta inexistente");
    return {
      id: string(item.id, `goals[${index}].id`),
      name: string(item.name, `goals[${index}].name`),
      accountId,
      target: integer(item.target, `goals[${index}].target`),
      allocated: integer(item.allocated, `goals[${index}].allocated`),
    };
  });
  unique(
    goals.map((item) => item.id),
    "goals",
  );
  safeTotal(
    goals.map((item) => item.target),
    "total dos objetivos",
  );
  safeTotal(
    goals.map((item) => item.allocated),
    "total alocado aos objetivos",
  );
  const rawLegacy = object(root.legacy, "legacy");
  const legacy: LegacyImport = {
    status: choice(
      rawLegacy.status,
      ["none", "pending", "resolved"],
      "legacy.status",
    ),
    source: string(rawLegacy.source, "legacy.source"),
    capturedAt: timestamp(rawLegacy.capturedAt, "legacy.capturedAt", true),
    movements: list(rawLegacy.movements, "legacy.movements").map(
      (value, index) => integer(value, `legacy.movements[${index}]`, true),
    ),
    possibleReturns: list(
      rawLegacy.possibleReturns,
      "legacy.possibleReturns",
    ).map((value, index) =>
      integer(value, `legacy.possibleReturns[${index}]`, true),
    ),
    displayedNet: integer(rawLegacy.displayedNet, "legacy.displayedNet", true),
    displayedSaved: string(rawLegacy.displayedSaved, "legacy.displayedSaved"),
    notes: list(rawLegacy.notes, "legacy.notes").map((value, index) =>
      string(value, `legacy.notes[${index}]`, true),
    ),
  };
  safeTotal(legacy.movements, "total das movimentações legadas");
  safeTotal(legacy.possibleReturns, "total dos possíveis rendimentos legados");
  if (rawLegacy.historyImported !== undefined) {
    if (rawLegacy.historyImported !== true)
      invalid("legacy.historyImported", "deve ser verdadeiro quando presente");
    if (legacy.status !== "resolved" || rawLegacy.resolution !== undefined)
      invalid(
        "legacy.historyImported",
        "exige o histórico resolvido sem uma confirmação de saldo inicial",
      );
    legacy.historyImported = true;
  }
  if (rawLegacy.resolution !== undefined) {
    const resolution = object(rawLegacy.resolution, "legacy.resolution");
    const accountId = string(
      resolution.accountId,
      "legacy.resolution.accountId",
    );
    const movementId = string(
      resolution.movementId,
      "legacy.resolution.movementId",
    );
    const amount = integer(resolution.amount, "legacy.resolution.amount");
    const resolvedDate = date(resolution.date, "legacy.resolution.date");
    if (!accountIds.has(accountId))
      invalid(
        "legacy.resolution.accountId",
        "referencia uma conta inexistente",
      );
    const movement = movements.find((item) => item.id === movementId);
    if (
      !movement ||
      movement.accountId !== accountId ||
      movement.amount !== amount ||
      movement.date !== resolvedDate ||
      movement.kind !== "opening"
    ) {
      invalid(
        "legacy.resolution",
        "não corresponde ao saldo inicial confirmado",
      );
    }
    legacy.resolution = { amount, date: resolvedDate, accountId, movementId };
  }
  if (
    legacy.status === "none" &&
    (legacy.historyImported ||
      legacy.resolution ||
      legacy.movements.length ||
      legacy.possibleReturns.length ||
      legacy.displayedNet !== 0)
  )
    invalid(
      "legacy.status",
      "uma conta sem planilha não pode conter histórico legado",
    );
  if (
    !legacy.historyImported &&
    (legacy.status === "resolved") !== Boolean(legacy.resolution)
  )
    invalid("legacy.status", "não corresponde à resolução registrada");
  const preferences = object(root.preferences, "preferences");
  const lastBackupAt =
    preferences.lastBackupAt === null
      ? null
      : timestamp(preferences.lastBackupAt, "preferences.lastBackupAt");
  const data: AppData = {
    schemaVersion: 1,
    salaries,
    budgets,
    budgetTemplate,
    accounts,
    movements,
    goals,
    legacy,
    preferences: { lastBackupAt },
  };
  validateFinancialIntegrity(data, options.allowFinancialConflicts);
  return data;
}

function validateFinancialIntegrity(
  data: AppData,
  allowConflicts = false,
): void {
  const totals = new Map<string, number>();
  for (const kind of [
    "opening",
    "contribution",
    "withdrawal",
    "return",
  ] as const) {
    totals.set(
      kind,
      safeTotal(
        data.movements
          .filter((movement) => movement.kind === kind)
          .map((movement) => movement.amount),
        `total de ${kind}`,
      ),
    );
  }
  safeTotal(
    [
      totals.get("opening")!,
      totals.get("contribution")!,
      totals.get("return")!,
      -totals.get("withdrawal")!,
    ],
    "reserva total",
  );
  if (allowConflicts) return;
  for (const account of data.accounts) {
    // Domain validation checks the account's entire date-grouped ledger. Once
    // per account is sufficient because every entry's structure was checked.
    const representative = data.movements.find(
      (movement) => movement.accountId === account.id,
    );
    if (representative) {
      const error = validateMovement(data, representative, representative.id);
      if (error) invalid(`movements.${account.id}`, error.replace(/\.$/, ""));
    }
  }
  for (const goal of data.goals) {
    const error = validateGoal(data, goal, goal.id);
    if (error) invalid(`goals.${goal.id}`, error.replace(/\.$/, ""));
  }
}

export function exportBackup(data: AppData): string {
  let requiresReview = false;
  try {
    validateBackup(data);
  } catch {
    requiresReview = true;
  }
  const snapshot = validateBackup(data, {
    allowFinancialConflicts: requiresReview,
  });
  return JSON.stringify(
    {
      format: "cash-tracker",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: snapshot,
      ...(requiresReview ? { requiresReview: true } : {}),
    },
    null,
    2,
  );
}

export function parseBackup(text: string): AppData {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error(
      "O arquivo não é um JSON válido. Escolha um backup exportado pelo Cash Tracker.",
    );
  }
  const envelope = object(input, "arquivo");
  if (envelope.format !== "cash-tracker")
    invalid("format", "não identifica um backup do Cash Tracker");
  if (envelope.version !== 1)
    invalid("version", "não é compatível com esta versão do aplicativo");
  timestamp(envelope.exportedAt, "exportedAt");
  return validateBackup(envelope.data);
}
