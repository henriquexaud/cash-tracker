export interface SplitMember {
  id: string;
  name: string;
}
export type SplitEntryKind = "expense" | "settlement";
/**
 * Expense: `paidBy` paid `amount`, shared equally by `participants`.
 * Settlement: `paidBy` handed `amount` to the single participant.
 */
export interface SplitEntry {
  id: string;
  kind: SplitEntryKind;
  description: string;
  amount: number;
  paidBy: string;
  participants: string[];
  date: string;
  createdAt: string;
}
export interface SplitGroup {
  id: string;
  name: string;
  inviteCode?: string;
  /** Member that represents the current user in this group. */
  me: string;
  members: SplitMember[];
  entries: SplitEntry[];
}
export interface SplitDebt {
  from: string;
  to: string;
  amount: number;
}
