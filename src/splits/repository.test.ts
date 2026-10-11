import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCloudSplitRepository } from "./cloud-repository";
import { debts } from "./domain";
import { createLocalSplitRepository } from "./repository";
import type { SplitEntry } from "./types";

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};
const entry = (extra: Partial<SplitEntry>): SplitEntry => ({
  id: crypto.randomUUID(),
  kind: "expense",
  description: "Mercado",
  amount: 1000,
  paidBy: "",
  participants: [],
  date: "2026-10-01",
  createdAt: "2026-10-01T10:00:00Z",
  ...extra,
});

describe("repositório local de divisões", () => {
  it("começa vazio e usa uma chave própria, separada dos dados financeiros", async () => {
    const storage = memory();
    const repository = createLocalSplitRepository(() => storage);
    expect(await repository.load()).toEqual([]);
    expect(storage.values.size).toBe(0);
    await repository.createGroup(" Casa ", "Ana");
    expect([...storage.values.keys()]).toEqual(["cash-tracker-splits"]);
  });

  it("cria grupo, adiciona participante, salva, edita e exclui lançamentos", async () => {
    const storage = memory();
    const repository = createLocalSplitRepository(() => storage);
    const id = await repository.createGroup("Casa", "Ana");
    await repository.addMember!(id, "Bia");
    let [group] = await repository.load();
    expect(group.members.map((member) => member.name)).toEqual(["Ana", "Bia"]);
    const [ana, bia] = group.members.map((member) => member.id);
    expect(group.me).toBe(ana);

    const expense = entry({ paidBy: ana, participants: [ana, bia] });
    await repository.saveEntry(id, expense);
    await repository.saveEntry(id, { ...expense, amount: 3000, createdAt: "2030-01-01T00:00:00Z" });
    [group] = await repository.load();
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0].createdAt).toBe(expense.createdAt);
    expect(debts(group)).toEqual([{ from: bia, to: ana, amount: 1500 }]);

    await repository.removeEntry(id, expense.id);
    expect((await repository.load())[0].entries).toEqual([]);
  });

  it("recusa lançamentos inválidos sem alterar o que estava salvo", async () => {
    const storage = memory();
    const repository = createLocalSplitRepository(() => storage);
    const id = await repository.createGroup("Casa", "Ana");
    const before = storage.values.get("cash-tracker-splits");
    const [group] = await repository.load();
    await expect(repository.saveEntry(id, entry({ paidBy: group.me, participants: [group.me] }))).rejects.toThrow(/já assumiu/);
    await expect(repository.saveEntry(id, entry({ paidBy: group.me, participants: ["fora"] }))).rejects.toThrow();
    await expect(repository.saveEntry("outro", entry({}))).rejects.toThrow(/não existe/);
    await expect(repository.createGroup("  ", "Ana")).rejects.toThrow(/nome ao grupo/);
    expect(storage.values.get("cash-tracker-splits")).toBe(before);
  });

  it("não trata conteúdo ilegível como vazio nem o sobrescreve", async () => {
    for (const raw of ["{", '{"version":2,"groups":[]}', '{"version":1,"groups":[{"id":"g","name":"x","me":"fora","members":[],"entries":[]}]}']) {
      const storage = memory({ "cash-tracker-splits": raw });
      const repository = createLocalSplitRepository(() => storage);
      await expect(repository.load()).rejects.toThrow(/Não foi possível abrir/);
      await expect(repository.createGroup("Casa", "Ana")).rejects.toThrow(/Não foi possível abrir/);
      expect(storage.values.get("cash-tracker-splits")).toBe(raw);
    }
  });
});

const USER = "00000000-0000-4000-8000-000000000001";
function fakeClient(options: { user?: string; rows?: unknown; error?: { code: string; message: string } } = {}) {
  const calls: { name: string; args?: unknown; authorization?: string }[] = [];
  const response = (name: string, args?: unknown) => {
    const call: (typeof calls)[number] = { name, args };
    calls.push(call);
    const result = { data: options.error ? null : (options.rows ?? "group-id"), error: options.error ?? null };
    const chain = {
      select: () => chain,
      order: () => chain,
      setHeader: (_key: string, value: string) => {
        call.authorization = value;
        return Promise.resolve(result);
      },
    };
    return chain;
  };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: options.user ?? USER }, access_token: "token-da-conta" } },
      })),
    },
    rpc: (name: string, args: unknown) => response(name, args),
    from: (table: string) => response(table),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("repositório cloud de divisões", () => {
  const rows = [{
    id: "g1",
    name: "Casa",
    invite_code: "ABCDEF123456",
    created_at: "2026-10-01T00:00:00Z",
    split_members: [
      { id: "m2", name: "Bia", user_id: "00000000-0000-4000-8000-000000000002", joined_at: "2026-10-02T00:00:00Z" },
      { id: "m1", name: "Ana", user_id: USER, joined_at: "2026-10-01T00:00:00Z" },
    ],
    split_entries: [
      { id: "e1", kind: "expense", description: "Mercado", amount: 1001, paid_by: "m1", participants: ["m1", "m2"], entry_date: "2026-10-03", created_at: "2026-10-03T00:00:00Z" },
    ],
  }];

  it("lê os grupos do participante e identifica o integrante da conta atual", async () => {
    const { client, calls } = fakeClient({ rows });
    const [group] = await createCloudSplitRepository(client, USER).load();
    expect(group).toMatchObject({ id: "g1", me: "m1", inviteCode: "ABCDEF123456" });
    expect(group.members).toEqual([{ id: "m1", name: "Ana" }, { id: "m2", name: "Bia" }]);
    expect(debts(group)).toEqual([{ from: "m2", to: "m1", amount: 500 }]);
    expect(calls[0]).toMatchObject({ name: "split_groups", authorization: "Bearer token-da-conta" });
  });

  it("não envia o dono: o servidor decide por auth.uid()", async () => {
    const { client, calls } = fakeClient();
    const repository = createCloudSplitRepository(client, USER);
    await repository.createGroup("Casa", "Ana");
    await repository.joinGroup!(" abcd-ef12 3456 ", "Ana");
    await repository.saveEntry("g1", entry({ id: "e9", paidBy: "m1", participants: ["m2"], description: " Mercado " }));
    await repository.removeEntry("g1", "e9");
    expect(calls.map((call) => call.name)).toEqual(["split_create_group", "split_join_group", "split_save_entry", "split_delete_entry"]);
    expect(calls[1].args).toEqual({ code: "ABCDEF123456", member_name: "Ana" });
    expect(calls[2].args).toEqual({
      entry_id: "e9", target_group: "g1", entry_kind: "expense", entry_description: "Mercado",
      entry_amount: 1000, payer: "m1", entry_participants: ["m2"], entry_day: "2026-10-01",
    });
    expect(JSON.stringify(calls)).not.toContain(USER);
  });

  it("não opera com a sessão de outra conta", async () => {
    const { client, calls } = fakeClient({ user: "00000000-0000-4000-8000-000000000009", rows });
    const repository = createCloudSplitRepository(client, USER);
    await expect(repository.load()).rejects.toThrow(/Entre novamente/);
    await expect(repository.createGroup("Casa", "Ana")).rejects.toThrow(/Entre novamente/);
    expect(calls).toEqual([]);
  });

  it("mostra apenas mensagens fixas, sem detalhes do provedor", async () => {
    const secret = "relation split_groups row 42 secret";
    for (const [code, expected] of [["P0002", /Convite não encontrado/], ["42501", /não participa/], ["XX000", /precisam de internet/]] as const) {
      const { client } = fakeClient({ error: { code, message: secret } });
      const failure = await createCloudSplitRepository(client, USER).joinGroup!("ABC", "Ana").catch((error: Error) => error);
      expect((failure as Error).message).toMatch(expected);
      expect((failure as Error).message).not.toContain("secret");
    }
    const { client } = fakeClient({ error: { code: "XX000", message: secret } });
    await expect(createCloudSplitRepository(client, USER).load()).rejects.toThrow(/precisam de internet/);
  });

  it("recusa uma resposta malformada em vez de calcular saldos errados", async () => {
    const broken = structuredClone(rows);
    broken[0].split_entries[0].amount = 10.5;
    const { client } = fakeClient({ rows: broken });
    await expect(createCloudSplitRepository(client, USER).load()).rejects.toThrow(/formato inesperado/);
  });
});
