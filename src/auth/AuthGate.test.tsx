// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { identityStore } from "./offline-identity";

const harness = vi.hoisted(() => {
  const listeners = new Set<(event: string, session: unknown) => void>();
  const repository = {
    sync: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const client = {
    auth: {
      initialize: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(
        (listener: (event: string, session: unknown) => void) => {
          listeners.add(listener);
          return {
            data: {
              subscription: { unsubscribe: () => listeners.delete(listener) },
            },
          };
        },
      ),
      signOut: vi.fn(async () => ({ error: null })),
      stopAutoRefresh: vi.fn(),
    },
  };
  return { client, repository, listeners };
});
vi.mock("./client", () => ({
  createAuthClient: () => harness.client,
  readCloudConfig: () => ({
    url: "https://test.supabase.co",
    key: "sb_publishable_test",
  }),
}));
vi.mock("./cloud-repository", () => ({
  createCloudRepository: () => harness.repository,
}));
vi.mock("../App", () => ({
  default: function MockApp({
    account,
  }: {
    account: { id: string; email: string; signOut: () => Promise<void> };
  }) {
    const [error, setError] = React.useState("");
    return (
      <div>
        <p>Conta aberta: {account.id}</p>
        <p>{account.email}</p>
        <button
          onClick={() =>
            void account.signOut().catch((error) => setError(error.message))
          }
        >
          Sair da conta
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  },
}));
vi.mock("./AuthForm", () => ({
  AuthForm: ({
    initialMessage = "",
    recovery = false,
  }: {
    initialMessage?: string;
    recovery?: boolean;
  }) => (
    <div>
      <p>{recovery ? "Nova senha" : "Tela de login"}</p>
      <p>{initialMessage}</p>
    </div>
  ),
}));
import { AuthGate } from "./AuthGate";
const id = "00000000-0000-4000-8000-000000000001",
  second = "00000000-0000-4000-8000-000000000002";
let values: Map<string, string>;
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  values = new Map();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
  harness.listeners.clear();
  vi.clearAllMocks();
  harness.client.auth.initialize.mockResolvedValue({ error: null });
  harness.client.auth.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("conta offline e ciclo de sessão", () => {
  it("conclui a confirmação no mesmo navegador e abre a conta confirmada", async () => {
    window.history.replaceState(null, "", "/?code=one-use-code");
    harness.client.auth.initialize.mockImplementationOnce(async () => {
      window.history.replaceState(null, "", "/");
      return { error: null };
    });
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: second, email: "new@example.com" } } },
      error: null,
    });
    render(<AuthGate />);
    await screen.findByText("new@example.com");
    expect(screen.queryByText("Tela de login")).toBeNull();
    expect(window.location.search).toBe("");
    expect(
      identityStore("https://test.supabase.co", window.localStorage).read()?.id,
    ).toBe(second);
  });
  it("orienta login em outro navegador sem abrir uma conta anterior nem preservar o código na URL", async () => {
    identityStore("https://test.supabase.co", window.localStorage).save({
      id,
      email: "previous@example.com",
    });
    window.history.replaceState(null, "", "/?code=one-use-code#dashboard");
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id, email: "previous@example.com" } } },
      error: null,
    });
    render(
      <React.StrictMode>
        <AuthGate />
      </React.StrictMode>,
    );
    await screen.findByText("Tela de login");
    expect(
      screen.getByText(
        /entre com e-mail e senha para continuar neste navegador/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("previous@example.com")).toBeNull();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#dashboard");
    act(() =>
      harness.listeners.forEach((listener) =>
        listener("SIGNED_IN", {
          user: { id: second, email: "new@example.com" },
        }),
      ),
    );
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(
      screen.queryByText(/entre com e-mail e senha para continuar/),
    ).toBeNull();
  });
  it("trata link expirado sem mostrar descrições externas", async () => {
    window.history.replaceState(
      null,
      "",
      "/#error=access_denied&error_description=untrusted-secret&error_code=otp_expired",
    );
    render(<AuthGate />);
    await screen.findByText(/Não foi possível concluir por este link/);
    expect(document.body.textContent).not.toContain("untrusted-secret");
    expect(window.location.hash).toBe("");
  });
  it("libera nova tentativa de login após falha ao processar o retorno", async () => {
    window.history.replaceState(null, "", "/?code=one-use-code");
    harness.client.auth.initialize.mockRejectedValueOnce(
      new Error("network details"),
    );
    render(<AuthGate />);
    await screen.findByText(/Não foi possível concluir por este link/);
    expect(window.location.search).toBe("");
    act(() =>
      harness.listeners.forEach((listener) =>
        listener("SIGNED_IN", {
          user: { id: second, email: "new@example.com" },
        }),
      ),
    );
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(document.body.textContent).not.toContain("network details");
  });
  it("permite definir a senha quando a confirmação retorna recuperação", async () => {
    window.history.replaceState(null, "", "/?code=recovery-code");
    harness.client.auth.initialize.mockImplementationOnce(async () => {
      window.history.replaceState(null, "", "/");
      harness.listeners.forEach((listener) =>
        listener("PASSWORD_RECOVERY", {
          user: { id, email: "first@example.com" },
        }),
      );
      return { error: null };
    });
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id, email: "first@example.com" } } },
      error: null,
    });
    render(<AuthGate />);
    await screen.findByText("Nova senha");
  });
  it("abre a última conta autenticada offline mesmo sem token vigente", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    identityStore("https://test.supabase.co", window.localStorage).save({
      id,
      email: "first@example.com",
    });
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthRetryableFetchError" },
    });
    render(<AuthGate />);
    expect(screen.getByText(`Conta aberta: ${id}`)).toBeTruthy();
    await waitFor(() =>
      expect(harness.client.auth.getSession).toHaveBeenCalled(),
    );
    expect(screen.queryByText("Tela de login")).toBeNull();
  });
  it("troca a árvore da aplicação quando muda de usuário e limpa a identidade ao sair", async () => {
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id, email: "first@example.com" } } },
      error: null,
    });
    render(<AuthGate />);
    await screen.findByText("first@example.com");
    act(() => {
      harness.listeners.forEach((listener) =>
        listener("SIGNED_IN", {
          user: { id: second, email: "second@example.com" },
        }),
      );
    });
    expect(screen.getByText("second@example.com")).toBeTruthy();
    expect(screen.queryByText("first@example.com")).toBeNull();
    act(() => {
      harness.listeners.forEach((listener) => listener("SIGNED_OUT", null));
    });
    expect(screen.getByText("Tela de login")).toBeTruthy();
    expect(
      identityStore("https://test.supabase.co", window.localStorage).read(),
    ).toBeNull();
  });
  it("não remove a sessão nem a cópia offline quando existe gravação pendente", async () => {
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id, email: "first@example.com" } } },
      error: null,
    });
    harness.repository.clear.mockRejectedValueOnce(
      new Error("Há edições pendentes"),
    );
    render(<AuthGate />);
    await screen.findByText("first@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Há edições pendentes",
    );
    expect(harness.client.auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("first@example.com")).toBeTruthy();
    harness.repository.clear.mockReset().mockResolvedValue(undefined);
  });
  it("remove a cópia local antes de notificar o encerramento da sessão", async () => {
    const order: string[] = [];
    harness.repository.sync.mockImplementationOnce(async () => {
      order.push("sync");
    });
    harness.repository.clear.mockImplementationOnce(async () => {
      order.push("clear");
    });
    harness.client.auth.signOut.mockImplementationOnce(async () => {
      order.push("signout");
      return { error: null };
    });
    harness.client.auth.getSession.mockResolvedValue({
      data: { session: { user: { id, email: "first@example.com" } } },
      error: null,
    });
    render(<AuthGate />);
    await screen.findByText("first@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));
    await screen.findByText("Tela de login");
    expect(order).toEqual(["sync", "clear", "signout"]);
  });
});
