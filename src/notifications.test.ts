// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyData } from "./domain/empty";
import { entryImpact } from "./splits/domain";
import type { SplitEntry } from "./splits/types";
import {
  checkLocalReminder,
  completedMonth,
  monthlyReminder,
  readPrefs,
  removePush,
  savePrefs,
  syncPush,
  type PushServer,
} from "./notifications";
import { createPushServer } from "./auth/push";
import {
  reminderMessage,
  shareOf,
  splitMessage,
  type PushEntry,
} from "../supabase/functions/push/messages";
import {
  encryptPush,
  fromBase64Url,
  toBase64Url,
  vapidAuthorization,
} from "../supabase/functions/push/webpush";

const withSalary = () => ({
  ...createEmptyData(),
  salaries: [{ id: "s", month: "2026-10", amount: 300000 }],
}) as ReturnType<typeof createEmptyData>;
const withBudget = () => ({
  ...withSalary(),
  budgets: [{ month: "2026-10", items: [], reservePlan: 0 }],
});

describe("lembrete do mês", () => {
  const prefs = { reminderDay: 5, splits: false };
  it("espera o dia escolhido e avisa uma vez por mês", () => {
    const data = createEmptyData();
    expect(monthlyReminder(prefs, null, data, new Date(2026, 9, 4))).toBeNull();
    const due = monthlyReminder(prefs, null, data, new Date(2026, 9, 5));
    expect(due?.month).toBe("2026-10");
    expect(due?.body).toMatch(/salário e montar o orçamento de outubro/);
    expect(monthlyReminder(prefs, "2026-10", data, new Date(2026, 9, 20))).toBeNull();
    expect(monthlyReminder(prefs, "2026-10", data, new Date(2026, 10, 5))?.month).toBe("2026-11");
  });
  it("usa o último dia em meses curtos e fica desligado sem dia", () => {
    const data = createEmptyData();
    const last = { reminderDay: 31, splits: false };
    expect(monthlyReminder(last, null, data, new Date(2027, 1, 27))).toBeNull();
    expect(monthlyReminder(last, null, data, new Date(2027, 1, 28))).not.toBeNull();
    expect(monthlyReminder({ reminderDay: null, splits: false }, null, data, new Date(2026, 9, 31))).toBeNull();
  });
  it("lembra só do que falta e reconhece o mês completo", () => {
    const due = monthlyReminder(prefs, null, withSalary(), new Date(2026, 9, 6));
    expect(due?.body).toMatch(/^Hora de montar o orçamento/);
    expect(due?.url).toBe("#budget");
    expect(monthlyReminder(prefs, null, withBudget(), new Date(2026, 9, 6))).toBeNull();
    expect(completedMonth(withSalary(), new Date(2026, 9, 6))).toBeNull();
    expect(completedMonth(withBudget(), new Date(2026, 9, 6))).toBe("2026-10");
    expect(completedMonth(withBudget(), new Date(2026, 10, 1))).toBeNull();
  });
});

describe("neste dispositivo", () => {
  const shown: { title: string; body?: string }[] = [];
  let permission = "granted";
  beforeEach(() => {
    shown.length = 0;
    permission = "granted";
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    vi.stubGlobal("Notification", class {
      static get permission() { return permission; }
      constructor(title: string, options?: { body?: string }) {
        shown.push({ title, body: options?.body });
      }
    });
    vi.stubGlobal("PushManager", class {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("normaliza preferências ilegíveis", () => {
    expect(readPrefs()).toEqual({ reminderDay: null, splits: false });
    window.localStorage.setItem("cash-tracker-notifications", '{"reminderDay":40,"splits":"sim"}');
    expect(readPrefs()).toEqual({ reminderDay: null, splits: false });
    window.localStorage.setItem("cash-tracker-notifications", "{");
    expect(readPrefs()).toEqual({ reminderDay: null, splits: false });
  });

  it("sem conta, mostra o lembrete uma vez e respeita a permissão", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 11, 9) });
    savePrefs({ reminderDay: 10, splits: false });
    permission = "default";
    await checkLocalReminder(createEmptyData());
    expect(shown).toHaveLength(0);
    permission = "granted";
    await checkLocalReminder(createEmptyData());
    await checkLocalReminder(createEmptyData());
    expect(shown).toEqual([{ title: "Cash Tracker", body: "Hora de lançar o salário e montar o orçamento de outubro de 2026." }]);
  });

  const device = (existing = false) => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "chave", auth: "segredo" } }),
      unsubscribe: vi.fn(async () => true),
    };
    let current: typeof subscription | null = existing ? subscription : null;
    const pushManager = {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async (_options: PushSubscriptionOptionsInit) => (current = subscription)),
    };
    const registration = { pushManager };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
    });
    return { subscription, pushManager };
  };
  const server = () => ({ save: vi.fn(async () => {}), remove: vi.fn(async () => {}) }) satisfies PushServer;

  it("inscreve o dispositivo com a chave pública e grava preferências, fuso e mês completo", async () => {
    const { pushManager } = device();
    const account = server();
    const prefs = { reminderDay: 5, splits: true };
    expect(await syncPush(account, prefs, "2026-10", "AQID")).toBe("on");
    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    expect([...(options.applicationServerKey as Uint8Array)]).toEqual([1, 2, 3]);
    expect(account.save).toHaveBeenCalledWith(
      { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "chave", auth: "segredo" },
      prefs, Intl.DateTimeFormat().resolvedOptions().timeZone, "2026-10",
    );
    // An open app only refreshes the stored subscription.
    expect(await syncPush(account, prefs, null, "AQID")).toBe("on");
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("não inscreve sem permissão, sem chave ou sem service worker e informa falha do servidor", async () => {
    const account = server();
    const prefs = { reminderDay: 5, splits: false };
    expect(await syncPush(account, prefs, null, "AQID")).toBe("unavailable");
    const { pushManager } = device();
    expect(await syncPush(account, prefs, null, "")).toBe("unavailable");
    permission = "denied";
    expect(await syncPush(account, prefs, null, "AQID")).toBe("blocked");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(account.save).not.toHaveBeenCalled();
    permission = "granted";
    account.save.mockRejectedValueOnce(new Error("rede"));
    expect(await syncPush(account, prefs, null, "AQID")).toBe("failed");
  });

  it("remove a inscrição ao desligar tudo e ao sair da conta", async () => {
    const off = { reminderDay: null, splits: false };
    const first = device(true);
    const account = server();
    expect(await syncPush(account, off, null, "AQID")).toBe("off");
    expect(account.remove).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/abc");
    expect(first.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(account.save).not.toHaveBeenCalled();

    const second = device(true);
    account.remove.mockRejectedValueOnce(new Error("offline"));
    await removePush(account);
    expect(second.subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("grava na conta que abriu o app, sem enviar o dono, e recusa outra sessão", async () => {
    const setHeader = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ setHeader }));
    let user = "u1";
    const client = {
      rpc,
      auth: { getSession: async () => ({ data: { session: { user: { id: user }, access_token: "token" } } }) },
    } as unknown as Parameters<typeof createPushServer>[0];
    const account = createPushServer(client, "u1");
    await account.save({ endpoint: "e", p256dh: "p", auth: "a" }, { reminderDay: 7, splits: true }, "America/Sao_Paulo", null);
    expect(rpc).toHaveBeenCalledWith("push_subscribe", {
      sub_endpoint: "e", sub_p256dh: "p", sub_auth: "a", sub_reminder_day: 7,
      sub_splits: true, sub_timezone: "America/Sao_Paulo", done_month: null,
    });
    expect(setHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
    user = "u2";
    await expect(account.remove("e")).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("textos enviados pelo servidor", () => {
  const members = [{ id: "ana", name: "Ana" }, { id: "bia", name: "Bia" }, { id: "caio", name: "Caio" }];
  const expense: PushEntry = {
    id: "e1", group_id: "casa", kind: "expense", description: "Mercado",
    amount: 10000, paid_by: "ana", participants: ["ana", "bia", "caio"],
  };
  const message = (recipient: string, entry = expense, op: "insert" | "update" | "delete" = "insert", actor: string | null = "ana") =>
    splitMessage({ op, entry, groupName: "Casa", members, actor, recipient });
  const plain = (value: string) => value.replace(/ /g, " ");

  it("diz quem lançou, o total e quanto cada pessoa deve ou recebe", () => {
    const bia = message("bia");
    expect(bia.title).toBe("Casa");
    expect(plain(bia.body)).toBe("Ana adicionou “Mercado” (R$ 100,00). Você deve R$ 33,33.");
    expect(bia.url).toBe("#splits/casa");
    expect(bia.tag).toBe("cash-tracker-split-e1");
    expect(plain(message("ana", expense, "update", "bia").body))
      .toBe("Bia editou “Mercado” (R$ 100,00, pago por você). Você recebe R$ 66,66.");
    expect(plain(message("caio", { ...expense, participants: ["ana", "bia"] }).body))
      .toBe("Ana adicionou “Mercado” (R$ 100,00). Você não deve nada.");
    expect(plain(message("bia", expense, "delete", "caio").body))
      .toBe("Caio excluiu “Mercado” (R$ 100,00, pago por Ana).");
    expect(plain(message("bia", expense, "insert", null).body)).toMatch(/^Alguém adicionou/);
  });

  it("descreve acertos do ponto de vista de quem recebe o aviso", () => {
    const settlement: PushEntry = { ...expense, id: "s1", kind: "settlement", description: "", amount: 5000, paid_by: "bia", participants: ["ana"] };
    expect(plain(message("ana", settlement, "insert", "bia").body)).toBe("Acerto: Bia pagou R$ 50,00 a você.");
    expect(plain(message("bia", settlement, "insert", "ana").body)).toBe("Acerto: Você pagou R$ 50,00 a Ana.");
    expect(plain(message("caio", settlement, "delete", "ana").body)).toBe("Acerto excluído por Ana: Bia pagou R$ 50,00 a Ana.");
  });

  it("calcula a mesma cota da tela de Divisões", () => {
    for (const amount of [1, 100, 101, 9999, 10000])
      for (const participants of [["ana", "bia", "caio"], ["bia", "caio"], ["caio"]])
        for (const paidBy of ["ana", "caio"]) {
          const entry: SplitEntry = { id: "x", kind: "expense", description: "x", amount, paidBy, participants, date: "2026-10-10", createdAt: "" };
          const row: PushEntry = { ...expense, amount, paid_by: paidBy, participants };
          for (const { id } of members)
            expect((paidBy === id ? amount : 0) - shareOf(row, id)).toBe(entryImpact(entry, id));
        }
  });

  it("nomeia o mês do lembrete", () => {
    expect(reminderMessage("2026-10")).toEqual({
      title: "Cash Tracker", body: "Hora de lançar o salário e montar o orçamento de outubro.",
      tag: "cash-tracker-reminder-2026-10", url: "#dashboard",
    });
  });
});

describe("envio web push", () => {
  const text = new TextEncoder();
  const hkdf = async (salt: BufferSource, secret: BufferSource, info: BufferSource, length: number) =>
    new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]), length * 8));
  const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

  it("cifra de modo que só o dispositivo inscrito leia (RFC 8291)", async () => {
    const browser = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const receiver = new Uint8Array(await crypto.subtle.exportKey("raw", browser.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPush(
      { endpoint: "https://fcm.googleapis.com/x", p256dh: toBase64Url(receiver), auth: toBase64Url(auth) },
      "Olá, R$ 33,33",
    );
    // The browser side, from the header of the message alone.
    const salt = body.slice(0, 16);
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
    const sender = body.slice(21, 86);
    const shared = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "ECDH", public: await crypto.subtle.importKey("raw", sender, { name: "ECDH", namedCurve: "P-256" }, false, []) },
      browser.privateKey, 256));
    const material = await hkdf(auth, shared, join(text.encode("WebPush: info\0"), receiver, sender), 32);
    const key = await hkdf(salt, material, text.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, material, text.encode("Content-Encoding: nonce\0"), 12);
    const opened = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]), body.slice(86)));
    expect(opened.at(-1)).toBe(2);
    expect(new TextDecoder().decode(opened.slice(0, -1))).toBe("Olá, R$ 33,33");
  });

  it("assina a identificação do servidor com a chave VAPID", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { publicKey, privateKey, subject: "mailto:teste@example.com" }, 1_000_000,
    );
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(publicKey);
    const [head, claims, signature] = token.split(".");
    const decode = (value: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
    expect(decode(head)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(decode(claims)).toEqual({ aud: "https://fcm.googleapis.com", exp: 1000 + 43200, sub: "mailto:teste@example.com" });
    expect(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pair.publicKey, fromBase64Url(signature), text.encode(`${head}.${claims}`),
    )).toBe(true);
  });
});
