import {
  MAX_GROUP_NAME,
  MAX_MEMBER_NAME,
  MAX_MEMBERS,
  cleanName,
  validateEntry,
} from "./domain";
import type { SplitEntry, SplitGroup } from "./types";

export interface SplitRepository {
  mode: "local" | "cloud";
  load: () => Promise<SplitGroup[]>;
  /** Resolves with the ID of the new group. */
  createGroup: (name: string, memberName: string) => Promise<string>;
  /** Accounts join by invite code. Resolves with the group ID. */
  joinGroup?: (code: string, memberName: string) => Promise<string>;
  /** Without accounts there is nobody to invite: participants are added by name. */
  addMember?: (groupId: string, name: string) => Promise<void>;
  saveEntry: (groupId: string, entry: SplitEntry) => Promise<void>;
  removeEntry: (groupId: string, entryId: string) => Promise<void>;
}

/** Shared structural check for anything read back from storage or the network. */
export function validateGroups(groups: SplitGroup[]): SplitGroup[] {
  for (const group of groups) {
    const ids = new Set(group.members.map((member) => member.id));
    if (!ids.has(group.me) || ids.size !== group.members.length)
      throw new Error("Grupo inválido.");
    for (const entry of group.entries)
      if (validateEntry(group, entry)) throw new Error("Lançamento inválido.");
  }
  return groups;
}

const KEY = "cash-tracker-splits";
const unreadable =
  "Não foi possível abrir as divisões salvas neste dispositivo. Nenhum dado foi alterado.";

export function createLocalSplitRepository(
  storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage,
): SplitRepository {
  const read = (): SplitGroup[] => {
    let raw: string | null;
    try {
      raw = storage().getItem(KEY);
    } catch {
      throw new Error(unreadable);
    }
    // A missing key is a fresh installation; unreadable content is never treated as empty.
    if (raw === null) return [];
    try {
      const stored = JSON.parse(raw);
      if (stored?.version !== 1 || !Array.isArray(stored.groups)) throw new Error();
      return validateGroups(stored.groups);
    } catch {
      throw new Error(unreadable);
    }
  };
  const write = (groups: SplitGroup[]) => {
    try {
      storage().setItem(KEY, JSON.stringify({ version: 1, groups: validateGroups(groups) }));
    } catch {
      throw new Error("Não foi possível salvar neste dispositivo. Os dados anteriores foram preservados.");
    }
  };
  const update = (groupId: string, change: (group: SplitGroup) => void) => {
    const groups = read();
    const group = groups.find((row) => row.id === groupId);
    if (!group) throw new Error("Esse grupo não existe mais.");
    change(group);
    write(groups);
  };
  const named = (value: string, limit: number, message: string) => {
    const name = cleanName(value, limit);
    if (!name) throw new Error(message);
    return name;
  };
  return {
    mode: "local",
    load: async () => read(),
    createGroup: async (name, memberName) => {
      const me = crypto.randomUUID();
      const group: SplitGroup = {
        id: crypto.randomUUID(),
        name: named(name, MAX_GROUP_NAME, "Dê um nome ao grupo."),
        me,
        members: [{ id: me, name: named(memberName, MAX_MEMBER_NAME, "Informe seu nome.") }],
        entries: [],
      };
      write([...read(), group]);
      return group.id;
    },
    addMember: async (groupId, name) =>
      update(groupId, (group) => {
        if (group.members.length >= MAX_MEMBERS)
          throw new Error("Esse grupo atingiu o limite de participantes.");
        group.members.push({
          id: crypto.randomUUID(),
          name: named(name, MAX_MEMBER_NAME, "Informe o nome do participante."),
        });
      }),
    saveEntry: async (groupId, entry) =>
      update(groupId, (group) => {
        const error = validateEntry(group, entry);
        if (error) throw new Error(error);
        const previous = group.entries.find((row) => row.id === entry.id);
        if (previous && previous.kind !== entry.kind) throw new Error("Lançamento inválido.");
        group.entries = [
          ...group.entries.filter((row) => row.id !== entry.id),
          { ...entry, description: entry.description.trim(), createdAt: previous?.createdAt ?? entry.createdAt },
        ];
      }),
    removeEntry: async (groupId, entryId) =>
      update(groupId, (group) => {
        group.entries = group.entries.filter((row) => row.id !== entryId);
      }),
  };
}

export const localSplitRepository = createLocalSplitRepository();
