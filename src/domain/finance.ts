import type {
  AppData,
  Budget,
  BudgetItem,
  Goal,
  Month,
  Movement,
  Salary,
} from "./types";

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error("Valor monetário fora do limite seguro.");
  const absolute = BigInt(Math.abs(cents));
  const whole = absolute / 100n;
  const signedWhole = cents < 0 ? (whole > 0n ? -whole : -0) : whole;
  const decimal = String(absolute % 100n).padStart(2, "0");
  return moneyFormatter
    .formatToParts(signedWhole)
    .map((part) => (part.type === "fraction" ? decimal : part.value))
    .join("");
}

/** Parses decimal text directly into cents, without floating point multiplication. */
export function parseMoney(text: string): number | null {
  let value = text.trim().replace(/^([+-]?)\s*R\$\s*/, "$1");
  const sign = value.startsWith("-") ? -1 : 1;
  value = value.replace(/^[+-]/, "");
  if (!value || /[^\d.,]/.test(value)) return null;

  let whole: string;
  let decimal = "";
  if (value.includes(",")) {
    const parts = value.split(",");
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return null;
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(parts[0])) return null;
    whole = parts[0].replaceAll(".", "");
    decimal = parts[1];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
    whole = value.replaceAll(".", "");
  } else {
    const parts = value.split(".");
    if (parts.length > 2 || !/^\d+$/.test(parts[0])) return null;
    if (parts.length === 2 && !/^\d{1,2}$/.test(parts[1])) return null;
    whole = parts[0];
    decimal = parts[1] ?? "";
  }

  const cents = sign * (Number(whole) * 100 + Number(decimal.padEnd(2, "0")));
  return Number.isSafeInteger(cents) ? cents : null;
}

function validMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function monthDate(month: Month): Date {
  if (!validMonth(month)) throw new Error("Mês inválido.");
  return new Date(`${month}-15T12:00:00Z`);
}

export function monthLabel(month: Month, short = false): string {
  return (short ? shortMonthFormatter : monthFormatter)
    .format(monthDate(month))
    .replace(".", "");
}

export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function currentMonth(): Month {
  return today().slice(0, 7);
}

export function shiftMonth(month: Month, delta: number): Month {
  if (!validMonth(month) || !Number.isSafeInteger(delta))
    throw new Error("Mês inválido.");
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + delta;
  const year = Math.floor(index / 12);
  if (year < 0 || year > 9999)
    throw new Error("Mês fora do intervalo permitido.");
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function safeSum(values: number[]): number {
  let result = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(result + value))
      throw new Error("Valor monetário fora do limite seguro.");
    result += value;
  }
  return result;
}

export function budgetTotal(items: BudgetItem[]): number {
  return safeSum(
    items.map((item) => {
      if (
        !Number.isSafeInteger(item.unitAmount) ||
        item.unitAmount < 0 ||
        !Number.isSafeInteger(item.factor) ||
        item.factor < 1
      ) {
        throw new Error(
          "Informe um valor e um fator válidos para o orçamento.",
        );
      }
      const total = item.unitAmount * item.factor;
      if (!Number.isSafeInteger(total))
        throw new Error("Valor monetário fora do limite seguro.");
      return total;
    }),
  );
}

export function copyBudget(source: Budget, targetMonth: Month): Budget {
  if (!validMonth(targetMonth)) throw new Error("Mês inválido.");
  return {
    month: targetMonth,
    reservePlan: source.reservePlan,
    items: source.items.map((item) => ({ ...item })),
  };
}

export function budgetStats(budgets: Budget[]) {
  const ordered = [...budgets].sort((a, b) => a.month.localeCompare(b.month));
  const fixed = safeSum(
    ordered.map((budget) =>
      budgetTotal(budget.items.filter((item) => item.kind === "fixed")),
    ),
  );
  const variable = safeSum(
    ordered.map((budget) =>
      budgetTotal(budget.items.filter((item) => item.kind === "variable")),
    ),
  );
  return {
    total: safeSum([fixed, variable]),
    fixed,
    variable,
    reserved: safeSum(ordered.map((budget) => budget.reservePlan)),
    count: ordered.length,
    firstMonth: ordered[0]?.month ?? null,
    lastMonth: ordered.at(-1)?.month ?? null,
  };
}

export function budgetSeries(budgets: Budget[]) {
  return [...budgets]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((budget) => ({
      month: budget.month,
      label: monthLabel(budget.month, true),
      value: budgetTotal(budget.items),
    }));
}

export function salaryStats(salaries: Salary[]) {
  const ordered = [...salaries].sort((a, b) => a.month.localeCompare(b.month));
  const first = ordered[0] ?? null;
  const latest = ordered.at(-1) ?? null;
  const highest = ordered.reduce<Salary | null>(
    (result, salary) =>
      !result || salary.amount > result.amount ? salary : result,
    null,
  );
  return {
    total: safeSum(ordered.map((salary) => salary.amount)),
    first,
    latest,
    highest,
    growth:
      first && latest && first.amount > 0
        ? ((latest.amount - first.amount) / first.amount) * 100
        : 0,
    count: ordered.length,
  };
}

function movementValue(movement: Movement): number {
  return movement.kind === "withdrawal" ? -movement.amount : movement.amount;
}

export function accountBalance(data: AppData, accountId: string): number {
  return safeSum(
    data.movements
      .filter((movement) => movement.accountId === accountId)
      .map(movementValue),
  );
}

export function wealthStats(data: AppData, month: Month) {
  const sumKind = (kind: Movement["kind"], onlyMonth = false) =>
    safeSum(
      data.movements
        .filter(
          (movement) =>
            movement.kind === kind &&
            (!onlyMonth || movement.date.slice(0, 7) === month),
        )
        .map((movement) => movement.amount),
    );
  const opening = sumKind("opening");
  const contributed = sumKind("contribution");
  const withdrawn = sumKind("withdrawal");
  const returns = sumKind("return");
  const monthContributed = sumKind("contribution", true);
  const monthWithdrawn = sumKind("withdrawal", true);
  return {
    total: safeSum([opening, contributed, returns, -withdrawn]),
    opening,
    contributed,
    withdrawn,
    returns,
    monthContributed,
    monthWithdrawn,
    monthReturns: sumKind("return", true),
    monthSaved: safeSum([monthContributed, -monthWithdrawn]),
  };
}

export function monthlySummary(data: AppData, month: Month) {
  const salary = data.salaries.find((entry) => entry.month === month) ?? null;
  const budget = data.budgets.find((entry) => entry.month === month) ?? null;
  const expenses = budget ? budgetTotal(budget.items) : 0;
  const reservePlan = budget?.reservePlan ?? 0;
  // Preview the base without creating a recorded budget for this month.
  const budgetItems = budget?.items ?? data.budgetTemplate;
  const estimatedExpenses = budget ? expenses : budgetTotal(budgetItems);
  return {
    salary,
    budget,
    budgetItems,
    estimatedExpenses,
    estimatedFree: salary
      ? safeSum([salary.amount, -estimatedExpenses, -reservePlan])
      : null,
    expenses,
    reservePlan,
    free: salary ? safeSum([salary.amount, -expenses, -reservePlan]) : null,
  };
}

export function salarySeries(salaries: Salary[]) {
  return [...salaries]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((salary) => ({
      month: salary.month,
      label: monthLabel(salary.month, true),
      value: salary.amount,
    }));
}

export function wealthSeries(data: AppData) {
  const movements = [...data.movements].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (!movements.length) return [];
  const monthly = new Map<Month, number[]>();
  for (const movement of movements) {
    const month = movement.date.slice(0, 7);
    monthly.set(month, [
      ...(monthly.get(month) ?? []),
      movementValue(movement),
    ]);
  }
  const series: { month: string; label: string; value: number }[] = [];
  let balance = 0;
  const finalMonth = movements.at(-1)!.date.slice(0, 7);
  for (
    let month = movements[0].date.slice(0, 7);
    ;
    month = shiftMonth(month, 1)
  ) {
    balance = safeSum([balance, ...(monthly.get(month) ?? [])]);
    series.push({ month, label: monthLabel(month, true), value: balance });
    if (month === finalMonth) break;
  }
  return series;
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

export function validateMovement(
  data: AppData,
  movement: Movement,
  excludeId?: string,
): string | null {
  if (!data.accounts.some((account) => account.id === movement.accountId))
    return "Selecione uma conta existente.";
  if (!validDate(movement.date)) return "Informe uma data válida.";
  if (movement.datePrecision !== undefined &&
      (movement.datePrecision !== "month" || !movement.date.endsWith("-01")))
    return "Um lançamento mensal deve usar uma referência válida do mês, sem atribuir um dia exato.";
  if (
    !["opening", "contribution", "withdrawal", "return"].includes(movement.kind)
  )
    return "Selecione um tipo de registro válido.";
  if (!Number.isSafeInteger(movement.amount))
    return "Informe um valor monetário válido.";
  if (movement.kind !== "return" && movement.amount < 0)
    return "Informe um valor positivo; use retirada para retirar dinheiro.";
  if (movement.kind !== "opening" && movement.amount === 0)
    return "Informe um valor diferente de zero.";
  if (
    data.movements.some(
      (entry) => entry.id === movement.id && entry.id !== excludeId,
    )
  )
    return "Esse registro já existe.";

  const candidates = [
    ...data.movements.filter((entry) => entry.id !== excludeId),
    movement,
  ];
  const previous = data.movements.find((entry) => entry.id === excludeId);
  const editingExistingOpening =
    previous?.kind === "opening" && previous.accountId === movement.accountId;
  if (
    movement.kind === "opening" &&
    !editingExistingOpening &&
    data.movements.some(
      (entry) =>
        entry.id !== excludeId && entry.accountId === movement.accountId,
    )
  ) {
    return "Registre o saldo inicial antes das outras movimentações dessa conta. Um saldo atual pode incluir dinheiro já registrado.";
  }
  const affectedAccounts = new Set([
    movement.accountId,
    ...(previous ? [previous.accountId] : []),
  ]);
  try {
    for (const accountId of affectedAccounts) {
      const accountMovements = candidates.filter(
        (entry) => entry.accountId === accountId,
      );
      const openings = accountMovements.filter(
        (entry) => entry.kind === "opening",
      );
      if (openings.length > 1)
        return "Cada conta pode ter apenas um saldo inicial. Edite o saldo inicial existente.";
      const invalidOpeningDate =
        openings[0] &&
        accountMovements.some(
          (entry) =>
            entry.id !== openings[0].id && entry.date < openings[0].date,
        );
      const byDate = new Map<string, number[]>();
      for (const entry of accountMovements) {
        byDate.set(entry.date, [
          ...(byDate.get(entry.date) ?? []),
          movementValue(entry),
        ]);
      }
      let balance = 0;
      for (const date of [...byDate.keys()].sort()) {
        balance = safeSum([balance, ...byDate.get(date)!]);
        if (balance < 0)
          return "Esse registro deixaria a conta com saldo negativo. Confira o valor e a data.";
      }
      if (invalidOpeningDate)
        return "A data do saldo inicial deve ser anterior ou igual à primeira movimentação dessa conta.";
      const allocated = safeSum(
        data.goals
          .filter((goal) => goal.accountId === accountId)
          .map((goal) => goal.allocated),
      );
      if (allocated > balance)
        return "Esse registro usaria dinheiro destinado a objetivos. Ajuste os objetivos primeiro.";
    }
  } catch {
    return "O valor ultrapassa o limite monetário permitido.";
  }
  return null;
}

export function validateGoal(
  data: AppData,
  goal: Goal,
  excludeId?: string,
): string | null {
  if (!goal.name.trim()) return "Dê um nome ao objetivo.";
  if (!data.accounts.some((account) => account.id === goal.accountId))
    return "Selecione uma conta existente.";
  if (!Number.isSafeInteger(goal.target) || goal.target <= 0)
    return "Informe um valor positivo para a meta.";
  if (!Number.isSafeInteger(goal.allocated) || goal.allocated < 0)
    return "Informe um valor destinado válido.";
  if (
    data.goals.some((entry) => entry.id === goal.id && entry.id !== excludeId)
  )
    return "Esse objetivo já existe.";
  try {
    const allocated = safeSum([
      ...data.goals
        .filter(
          (entry) =>
            entry.accountId === goal.accountId && entry.id !== excludeId,
        )
        .map((entry) => entry.allocated),
      goal.allocated,
    ]);
    if (allocated > accountBalance(data, goal.accountId))
      return "O valor destinado aos objetivos ultrapassa o saldo dessa conta.";
  } catch {
    return "O valor ultrapassa o limite monetário permitido.";
  }
  return null;
}
