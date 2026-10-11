import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInviteCode } from "./domain";
import { validateGroups, type SplitRepository } from "./repository";
import type { SplitEntry, SplitGroup } from "./types";

// Only fixed operational messages are displayed; provider errors can contain private details.
const messages: Record<string, string> = {
  P0002: "Convite não encontrado. Confira o código e tente novamente.",
  "54000": "Esse grupo atingiu o limite permitido.",
  "42501": "Você não participa desse grupo ou sua sessão expirou. Entre novamente.",
  "22023": "Os dados informados não são válidos. Confira os campos e tente novamente.",
};
const unavailable =
  "Não foi possível falar com o servidor. Divisões precisam de internet: confira a conexão e tente novamente.";

interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  split_members: { id: string; name: string; user_id: string | null; joined_at: string }[];
  split_entries: {
    id: string;
    kind: SplitEntry["kind"];
    description: string;
    amount: number;
    paid_by: string;
    participants: string[];
    entry_date: string;
    created_at: string;
  }[];
}

/**
 * Shared groups live only on the server, which is the single source of truth for
 * every participant. Access is decided there by RLS and `auth.uid()`.
 */
export function createCloudSplitRepository(
  client: SupabaseClient,
  userId: string,
): SplitRepository {
  // Pin each call to the account that opened the app, as the financial sync does.
  const token = async () => {
    const session = (await client.auth.getSession()).data.session;
    if (session?.user.id !== userId)
      throw new Error("Entre novamente para acessar as divisões desta conta.");
    return `Bearer ${session.access_token}`;
  };
  const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    const authorization = await token();
    let result;
    try {
      result = await client.rpc(name, args).setHeader("Authorization", authorization);
    } catch {
      throw new Error(unavailable);
    }
    if (result.error) throw new Error(messages[result.error.code] ?? unavailable);
    return result.data as T;
  };
  return {
    mode: "cloud",
    load: async () => {
      const authorization = await token();
      let result;
      try {
        result = await client
          .from("split_groups")
          .select(
            "id,name,invite_code,created_at,split_members(id,name,user_id,joined_at),split_entries(id,kind,description,amount,paid_by,participants,entry_date,created_at)",
          )
          .order("created_at")
          .setHeader("Authorization", authorization);
      } catch {
        throw new Error(unavailable);
      }
      if (result.error || !Array.isArray(result.data)) throw new Error(unavailable);
      try {
        return validateGroups(
          (result.data as GroupRow[]).flatMap((row): SplitGroup[] => {
            const me = row.split_members.find((member) => member.user_id === userId);
            if (!me) return [];
            return [{
              id: row.id,
              name: row.name,
              inviteCode: row.invite_code,
              me: me.id,
              members: [...row.split_members]
                .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id))
                .map(({ id, name }) => ({ id, name })),
              entries: row.split_entries.map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                description: entry.description,
                amount: entry.amount,
                paidBy: entry.paid_by,
                participants: entry.participants,
                date: entry.entry_date,
                createdAt: entry.created_at,
              })),
            }];
          }),
        );
      } catch {
        throw new Error("O servidor retornou divisões em um formato inesperado. Atualize o aplicativo e tente novamente.");
      }
    },
    createGroup: (name, memberName) =>
      call<string>("split_create_group", { group_name: name, member_name: memberName }),
    joinGroup: (code, memberName) =>
      call<string>("split_join_group", { code: normalizeInviteCode(code), member_name: memberName }),
    saveEntry: async (groupId, entry) => {
      await call("split_save_entry", {
        entry_id: entry.id,
        target_group: groupId,
        entry_kind: entry.kind,
        entry_description: entry.description.trim(),
        entry_amount: entry.amount,
        payer: entry.paidBy,
        entry_participants: entry.participants,
        entry_day: entry.date,
      });
    },
    removeEntry: async (_groupId, entryId) => {
      await call("split_delete_entry", { entry_id: entryId });
    },
  };
}
