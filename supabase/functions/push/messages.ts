// Texts of the notifications. No imports: shared by the Edge Function and the tests.
export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  /** Hash the app opens when the notification is clicked. */
  url: string;
}
/** A row of `split_entries`, as sent by the database trigger. */
export interface PushEntry {
  id: string;
  group_id: string;
  kind: "expense" | "settlement";
  description: string;
  amount: number;
  paid_by: string;
  participants: string[];
}
export type PushOperation = "insert" | "update" | "delete";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents: number) => currency.format(cents / 100);

/** Same rule as `entryShares` in src/splits/domain.ts: leftover cents go to the payer, then by ID. */
export function shareOf(entry: PushEntry, member: string): number {
  const people = [...new Set(entry.participants)].sort(
    (a, b) =>
      Number(b === entry.paid_by) - Number(a === entry.paid_by) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const index = people.indexOf(member);
  if (index < 0) return 0;
  return Math.floor(entry.amount / people.length) + (index < entry.amount % people.length ? 1 : 0);
}

export function splitMessage({ op, entry, groupName, members, actor, recipient }: {
  op: PushOperation;
  entry: PushEntry;
  groupName: string;
  members: { id: string; name: string }[];
  /** Member that made the change, when it still belongs to the group. */
  actor: string | null;
  recipient: string;
}): PushMessage {
  const name = (id: string | null) => members.find((member) => member.id === id)?.name ?? "Alguém";
  const who = (id: string) => (id === recipient ? "você" : name(id));
  const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  let body: string;
  if (entry.kind === "settlement") {
    const payment = `${capital(who(entry.paid_by))} pagou ${money(entry.amount)} a ${who(entry.participants[0])}.`;
    body = op === "insert"
      ? `Acerto: ${payment}`
      : `Acerto ${op === "update" ? "editado" : "excluído"} por ${name(actor)}: ${payment}`;
  } else {
    const verb = { insert: "adicionou", update: "editou", delete: "excluiu" }[op];
    const payer = entry.paid_by === actor ? "" : `, pago por ${who(entry.paid_by)}`;
    body = `${name(actor)} ${verb} “${entry.description}” (${money(entry.amount)}${payer}).`;
    if (op !== "delete") {
      const impact = (entry.paid_by === recipient ? entry.amount : 0) - shareOf(entry, recipient);
      body += impact > 0
        ? ` Você recebe ${money(impact)}.`
        : impact < 0
          ? ` Você deve ${money(-impact)}.`
          : " Você não deve nada.";
    }
  }
  return {
    title: groupName,
    body,
    tag: `cash-tracker-split-${entry.id}`,
    url: `#splits/${entry.group_id}`,
  };
}

export function reminderMessage(month: string): PushMessage {
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
  return {
    title: "Cash Tracker",
    body: `Hora de lançar o salário e montar o orçamento de ${label}.`,
    tag: `cash-tracker-reminder-${month}`,
    url: "#dashboard",
  };
}
