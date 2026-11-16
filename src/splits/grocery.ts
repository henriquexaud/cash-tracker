import { shiftMonth } from "../domain/finance";
import type { Month } from "../domain/types";
import type { SplitEntry } from "./types";

/**
 * Grocery spending read from the descriptions of the group's expenses. Nothing is recorded:
 * an expense counts when its description looks like a grocery trip ("Mercado Tauste",
 * "Supermercado - Assaí"), and the rest of the description names the store.
 */

// Words that say "this is a grocery trip" without naming the store. Compared without accents or case.
const GENERIC = new Set([
  "mercado",
  "mercados",
  "supermercado",
  "supermercados",
  "hipermercado",
  "minimercado",
  "mercadinho",
  "mercearia",
  "atacadista",
  "atacarejo",
  "hortifruti",
  "sacolao",
]);
// "super mercado", "hiper mercado", "mini mercado" written apart.
const PREFIXES = new Set(["super", "hiper", "mini"]);
// Chains that are a grocery trip even without the word "mercado"; each is also the store's name.
const CHAINS = ["assai", "atacadao", "carrefour", "tauste", "pao de acucar", "makro", "sams club"];
// Not groceries, even though they contain the word.
const EXCLUDED = ["mercado livre", "mercado pago"];
// Leftover connectors at the start of the store's name: "Mercado do Zé" is "Zé".
const CONNECTORS = new Set(["de", "do", "da", "dos", "das"]);

const plainWord = (word: string) =>
  word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^0-9a-z]/g, "");

export interface GroceryMatch {
  /** Groups the same store however it was typed. Empty when only "mercado" was written. */
  key: string;
  /** The store as it was typed, without the generic words. Empty when unnamed. */
  name: string;
}

/** Whether the description is a grocery trip and, if so, which store. */
export function groceryStore(description: string): GroceryMatch | null {
  const words = description.split(/[\s\-–—/|:,.;()]+/).filter(Boolean);
  const plain = words.map(plainWord);
  const text = ` ${plain.filter(Boolean).join(" ")} `;
  if (EXCLUDED.some((term) => text.includes(` ${term} `))) return null;
  const chain = CHAINS.find((term) => text.includes(` ${term} `));
  const generic = plain.some(
    (word, index) => GENERIC.has(word) || (PREFIXES.has(word) && GENERIC.has(plain[index + 1] ?? "")),
  );
  if (!chain && !generic) return null;

  const kept = words.filter(
    (_, index) =>
      plain[index] &&
      !GENERIC.has(plain[index]) &&
      !(PREFIXES.has(plain[index]) && GENERIC.has(plain[index + 1] ?? "")),
  );
  while (kept.length && CONNECTORS.has(plainWord(kept[0]))) kept.shift();
  const keptPlain = kept.map(plainWord);
  // A known chain names the store even with extra words: "Assaí compra do mês" is "Assaí".
  const chainWords = chain?.split(" ") ?? [];
  const at = chain
    ? keptPlain.findIndex((_, index) => chainWords.every((word, offset) => keptPlain[index + offset] === word))
    : -1;
  const name = (at >= 0 ? kept.slice(at, at + chainWords.length) : kept).join(" ");
  return {
    key: chain ?? keptPlain.join(" "),
    name: name ? name[0].toLocaleUpperCase("pt-BR") + name.slice(1) : "",
  };
}

export interface GroceryStoreTotal {
  key: string;
  name: string;
  total: number;
  count: number;
}

export interface GrocerySummary {
  month: Month;
  thisMonth: number;
  lastMonth: number;
  /** Average of the complete months in the window, counting months without groceries as zero. */
  average: number | null;
  /** Complete months the average covers. */
  averageMonths: number;
  /** First month of the window used by the average and the store totals. */
  since: Month;
  /** Highest total first. */
  stores: GroceryStoreTotal[];
}

const safe = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new Error("Valor monetário fora do limite seguro.");
  return value;
};

/**
 * Totals of the grocery expenses: this month, last month, the monthly average of up to
 * `window` complete months before this one (starting at the first grocery trip), and how
 * much went to each store in that period. Settlements and future months are ignored.
 * Returns null when no expense up to this month looks like groceries.
 */
export function grocerySummary(entries: SplitEntry[], month: Month, window = 6): GrocerySummary | null {
  const trips = entries
    .filter((entry) => entry.kind === "expense" && entry.date.slice(0, 7) <= month)
    .map((entry) => ({ entry, store: groceryStore(entry.description) }))
    .filter((trip): trip is { entry: SplitEntry; store: GroceryMatch } => !!trip.store);
  if (!trips.length) return null;

  const first = trips.reduce((min, trip) => (trip.entry.date < min ? trip.entry.date : min), month).slice(0, 7);
  const earliest = shiftMonth(month, -window);
  const since = first > earliest ? first : earliest;
  const averageMonths = Math.max(
    0,
    (Number(month.slice(0, 4)) - Number(since.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(since.slice(5)),
  );
  const previous = shiftMonth(month, -1);

  let thisMonth = 0;
  let lastMonth = 0;
  let completed = 0;
  const stores = new Map<string, GroceryStoreTotal>();
  // Newest first, so each store shows the name as it was typed most recently.
  const recent = [...trips].sort(
    (a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
  for (const { entry, store } of recent) {
    const entryMonth = entry.date.slice(0, 7);
    if (entryMonth < since) continue;
    if (entryMonth === month) thisMonth = safe(thisMonth + entry.amount);
    else completed = safe(completed + entry.amount);
    if (entryMonth === previous) lastMonth = safe(lastMonth + entry.amount);
    const row = stores.get(store.key) ?? { key: store.key, name: store.name, total: 0, count: 0 };
    row.total = safe(row.total + entry.amount);
    row.count += 1;
    stores.set(store.key, row);
  }
  return {
    month,
    thisMonth,
    lastMonth,
    average: averageMonths ? Math.round(completed / averageMonths) : null,
    averageMonths,
    since,
    stores: [...stores.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR")),
  };
}
