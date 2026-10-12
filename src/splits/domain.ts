import type { SplitDebt, SplitEntry, SplitGroup } from "./types";

export const MAX_GROUP_NAME = 60;
export const MAX_MEMBER_NAME = 40;
export const MAX_DESCRIPTION = 80;
export const MAX_MEMBERS = 50;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Exact share of each participant, in cents. Leftover cents go first to the
 * payer (so the others never owe a rounded-up amount), then by member ID.
 */
export function entryShares(entry: SplitEntry): Map<string, number> {
  const people = [...new Set(entry.participants)].sort(
    (a, b) =>
      Number(b === entry.paidBy) - Number(a === entry.paidBy) || byId(a, b),
  );
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0 || !people.length)
    throw new Error("Lançamento inválido.");
  const base = Math.floor(entry.amount / people.length);
  const extra = entry.amount % people.length;
  return new Map(people.map((id, index) => [id, base + (index < extra ? 1 : 0)]));
}

/** Net position per member: positive receives, negative owes. Always sums to zero. */
export function balances(group: SplitGroup): Map<string, number> {
  const result = new Map(group.members.map((member) => [member.id, 0]));
  const add = (id: string, value: number) => {
    const next = (result.get(id) ?? 0) + value;
    if (!Number.isSafeInteger(next))
      throw new Error("Valor monetário fora do limite seguro.");
    result.set(id, next);
  };
  for (const entry of group.entries) {
    add(entry.paidBy, entry.amount);
    for (const [id, share] of entryShares(entry)) add(id, -share);
  }
  return result;
}

/** What one entry does to a member's position: positive is owed to them, negative they owe. */
export function entryImpact(entry: SplitEntry, member: string): number {
  return (entry.paidBy === member ? entry.amount : 0) - (entryShares(entry).get(member) ?? 0);
}

/** Expenses only, settlements move no cost: what was spent and how much of it is the member's share. */
export function spending(entries: SplitEntry[], member: string): { spent: number; share: number } {
  let spent = 0;
  let share = 0;
  for (const entry of entries) {
    if (entry.kind !== "expense") continue;
    spent += entry.amount;
    share += entryShares(entry).get(member) ?? 0;
    if (!Number.isSafeInteger(spent)) throw new Error("Valor monetário fora do limite seguro.");
  }
  return { spent, share };
}

/** Offsets debts inside the group, leaving at most one payment per debtor/creditor pair. */
export function debts(group: SplitGroup): SplitDebt[] {
  const open = [...balances(group)]
    .filter(([, value]) => value !== 0)
    .map(([id, value]) => ({ id, value }));
  const order = (a: { id: string; value: number }, b: typeof a) =>
    Math.abs(b.value) - Math.abs(a.value) || byId(a.id, b.id);
  const result: SplitDebt[] = [];
  for (;;) {
    const debtor = open.filter((row) => row.value < 0).sort(order)[0];
    const creditor = open.filter((row) => row.value > 0).sort(order)[0];
    if (!debtor || !creditor) return result;
    const amount = Math.min(-debtor.value, creditor.value);
    debtor.value += amount;
    creditor.value -= amount;
    result.push({ from: debtor.id, to: creditor.id, amount });
  }
}

export function validateEntry(group: SplitGroup, entry: SplitEntry): string | null {
  const members = new Set(group.members.map((member) => member.id));
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0)
    return "Informe um valor maior que zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date)))
    return "Data inválida.";
  if (!members.has(entry.paidBy)) return "Escolha quem pagou entre os integrantes do grupo.";
  if (
    !entry.participants.length ||
    new Set(entry.participants).size !== entry.participants.length ||
    entry.participants.some((id) => !members.has(id))
  )
    return "Escolha ao menos um integrante do grupo para a divisão.";
  if (entry.kind === "settlement") {
    if (entry.participants.length !== 1 || entry.participants[0] === entry.paidBy)
      return "Um acerto precisa de duas pessoas diferentes.";
    return null;
  }
  if (entry.kind !== "expense") return "Lançamento inválido.";
  const description = entry.description.trim();
  if (!description) return "Descreva a despesa.";
  if (description.length > MAX_DESCRIPTION)
    return `Use até ${MAX_DESCRIPTION} caracteres na descrição.`;
  if (entry.participants.length === 1 && entry.participants[0] === entry.paidBy)
    return "Quem pagou já assumiu a despesa inteira. Escolha outra pessoa ou outra divisão.";
  return null;
}

/** A settlement pays down an existing debt; it cannot exceed what is owed. */
export function validateSettlement(group: SplitGroup, entry: SplitEntry): string | null {
  const error = validateEntry(group, entry);
  if (error) return error;
  const owed =
    debts(group).find(
      (debt) => debt.from === entry.paidBy && debt.to === entry.participants[0],
    )?.amount ?? 0;
  if (!owed) return "Não há valor em aberto entre essas pessoas.";
  if (entry.amount > owed) return "O acerto não pode ser maior que o valor em aberto.";
  return null;
}

/** Newest first; entries of the same day keep the order in which they were recorded. */
export function timeline(group: SplitGroup): SplitEntry[] {
  return [...group.entries].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.createdAt.localeCompare(a.createdAt) ||
      byId(b.id, a.id),
  );
}

export function cleanName(value: string, limit: number): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= limit ? name : null;
}

export const normalizeInviteCode = (value: string) =>
  value.replace(/[^0-9a-z]/gi, "").toUpperCase();
