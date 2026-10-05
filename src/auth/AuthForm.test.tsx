// @vitest-environment jsdom
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthForm } from "./AuthForm";
function client() {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      resend: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("acesso simples por e-mail e senha", () => {
  it("mostra e oculta a senha sem enviar o formulário ou perder o texto", () => {
    const c = client();
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    const password = screen.getByLabelText("Senha") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "example-password" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar senha" }),
    );
    expect(password.type).toBe("text");
    expect(password.value).toBe("example-password");
    expect(c.auth.signInWithPassword).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Ocultar senha" }),
    );
    expect(password.type).toBe("password");
    expect(screen.queryByLabelText("Confirmar senha")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar senha" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Criar conta" }),
    );
    expect((screen.getByLabelText("Senha") as HTMLInputElement).type).toBe(
      "password",
    );
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");
  });
  it("impede cadastrar senhas divergentes e leva o foco à confirmação", async () => {
    const c = client();
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Criar conta" }),
    );
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "correct-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "different-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Criar conta" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "não coincidem",
    );
    expect(c.auth.signUp).not.toHaveBeenCalled();
    const confirmation = screen.getByLabelText(
      "Confirmar senha",
    ) as HTMLInputElement;
    expect(document.activeElement).toBe(confirmation);
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar confirmação da senha" }),
    );
    expect(confirmation.type).toBe("text");
    expect((screen.getByLabelText("Senha") as HTMLInputElement).type).toBe(
      "password",
    );
    fireEvent.change(confirmation, { target: { value: "correct-password" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Criar conta" }),
    );
    await screen.findByRole("heading", { name: "Confirmar seu e-mail" });
    expect(c.auth.signUp).toHaveBeenCalledTimes(1);
  });
  it("confere a senha nova antes de atualizar o acesso recuperado", async () => {
    const c = client();
    const recovered = vi.fn();
    render(
      <AuthForm
        client={c as unknown as SupabaseClient}
        recovery
        onRecovered={recovered}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nova senha"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
    expect(c.auth.updateUser).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar senha" }));
    await waitFor(() =>
      expect(c.auth.updateUser).toHaveBeenCalledWith({
        password: "new-password",
      }),
    );
    expect(recovered).toHaveBeenCalledTimes(1);
  });
  it("cadastra com retorno ao app e permite reenviar sem cadastrar outra vez", async () => {
    const c = client();
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "test-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await screen.findByRole("heading", { name: "Confirmar seu e-mail" });
    expect(c.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "test-password",
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    expect(screen.queryByLabelText("Senha")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Reenviar confirmação" }),
    );
    await waitFor(() =>
      expect(c.auth.resend).toHaveBeenCalledWith({
        type: "signup",
        email: "new@example.com",
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      }),
    );
    expect(c.auth.signUp).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Se a confirmação estiver pendente",
    );
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      "new@example.com",
    );
  });
  it("oferece reenvio após retorno sem sessão, sem exibir a opção em todos os logins", () => {
    const c = client();
    render(
      <AuthForm
        client={c as unknown as SupabaseClient}
        initialMessage="Entre para continuar neste navegador."
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Entre para continuar neste navegador.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reenviar confirmação" }),
    );
    expect(screen.queryByLabelText("Senha")).toBeNull();
  });
  it("envia login apenas ao provedor e mantém a senha como campo password", async () => {
    const c = client();
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    const input = screen.getByLabelText("Senha") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("current-password");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("spellcheck")).toBe("false");
    const email = screen.getByLabelText("E-mail") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.inputMode).toBe("email");
    expect(email.autocomplete).toBe("username");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(input, { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(c.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "test-password",
      }),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });
  it("recuperação não revela se existe uma conta com aquele e-mail", async () => {
    const c = client();
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Esqueci minha senha" }),
    );
    expect(screen.queryByLabelText("Senha")).toBeNull();
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Se esse e-mail tiver uma conta, você receberá um link para redefinir a senha.",
    );
  });
  it("mostra erro útil sem retornar os detalhes internos do provedor", async () => {
    const c = client();
    c.auth.signInWithPassword.mockResolvedValue({
      error: { message: "secret internal details" },
    } as never);
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Confira e-mail e senha",
    );
    expect(document.body.textContent).not.toContain("secret internal details");
  });
  it("bloqueia autenticação offline sem tentar cadastrar ou entrar", async () => {
    const c = client();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<AuthForm client={c as unknown as SupabaseClient} />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("primeiro acesso"),
    );
    expect(c.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
