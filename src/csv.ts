import { budgetTotal } from "./domain/finance";
import type { AppData } from "./domain/types";

/**
 * Spreadsheet export: one row per salary, planned expense, planned reserve and movement.
 * Semicolons and decimal commas open directly in a spreadsheet set to Portuguese; a BOM
 * keeps the accents. Export only: the JSON backup remains the way to restore.
 */
const movementKinds = {
  opening: "Saldo inicial",
  contribution: "Aporte",
  withdrawal: "Retirada",
  return: "Rendimento",
} as const;

/** Cents as a plain decimal ("-1234,56"), with no currency symbol or thousands separator. */
export function csvMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Valor monetário fora do limite seguro.");
  const absolute = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

function cell(value: string, index: number): string {
  // Typed text starting with = + - @ would be read as a formula; the value column is a number.
  const safe = index !== 5 && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function exportCsv(data: AppData): string {
  const accounts = new Map(data.accounts.map((account) => [account.id, account.name]));
  const rows: string[][] = [];
  for (const salary of data.salaries)
    rows.push([salary.month, "", "Salário", "", "", csvMoney(salary.amount)]);
  for (const budget of data.budgets) {
    for (const item of budget.items)
      rows.push([
        budget.month,
        "",
        item.kind === "fixed" ? "Gasto previsto fixo" : "Gasto previsto variável",
        item.name,
        "",
        csvMoney(budgetTotal([item])),
      ]);
    if (budget.reservePlan)
      rows.push([budget.month, "", "Reserva planejada", "", "", csvMoney(budget.reservePlan)]);
  }
  for (const movement of data.movements)
    rows.push([
      movement.date.slice(0, 7),
      movement.datePrecision === "month" ? "" : movement.date,
      movementKinds[movement.kind],
      movement.note,
      accounts.get(movement.accountId) ?? "",
      csvMoney(movement.kind === "withdrawal" ? -movement.amount : movement.amount),
    ]);
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const header = ["Mês", "Data", "Tipo", "Descrição", "Local", "Valor (R$)"];
  return `﻿${[header, ...rows].map((row) => row.map((value, index) => cell(value, index)).join(";")).join("\r\n")}\r\n`;
}
