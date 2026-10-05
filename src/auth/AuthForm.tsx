import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Moon, Sun } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useTheme } from "../theme";
import { PasswordField } from "./PasswordField";

type Mode = "login" | "register" | "confirm" | "reset" | "recovery";
export function AuthForm({
  client,
  recovery = false,
  onRecovered,
  initialEmail = "",
  initialMessage = "",
}: {
  client: SupabaseClient;
  recovery?: boolean;
  onRecovered?: () => void;
  initialEmail?: string;
  initialMessage?: string;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>(recovery ? "recovery" : "login");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const needsConfirmation = mode === "register" || mode === "recovery";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [offerConfirmation, setOfferConfirmation] = useState(!!initialMessage);
  const changeMode = (next: Mode) => {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setMismatch(false);
    setError("");
    setMessage("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (needsConfirmation && password !== confirmation) {
      setError("As senhas não coincidem. Confira a confirmação da senha.");
      setMismatch(true);
      confirmationRef.current?.focus();
      return;
    }
    if (!navigator.onLine) {
      setError(
        "Conecte-se à internet para entrar ou criar uma conta. Após o primeiro acesso, os dados ficam disponíveis offline.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const redirectTo = window.location.origin + window.location.pathname;
    try {
      const result =
        mode === "login"
          ? await client.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : mode === "register"
            ? await client.auth.signUp({
                email: email.trim(),
                password,
                options: { emailRedirectTo: redirectTo },
              })
            : mode === "confirm"
              ? await client.auth.resend({
                  type: "signup",
                  email: email.trim(),
                  options: { emailRedirectTo: redirectTo },
                })
              : mode === "reset"
                ? await client.auth.resetPasswordForEmail(email.trim(), {
                    redirectTo,
                  })
                : await client.auth.updateUser({ password });
      if (result.error) {
        if (mode === "login" && result.error.code === "email_not_confirmed")
          setOfferConfirmation(true);
        setError(
          mode === "login"
            ? "Não foi possível entrar. Confira e-mail e senha; se acabou de se cadastrar, confirme seu e-mail."
            : mode === "register"
              ? "Não foi possível criar a conta. Confira os campos e tente novamente."
              : mode === "confirm"
                ? "Não foi possível reenviar agora. Aguarde um pouco e tente novamente."
                : "Não foi possível concluir. Tente novamente com conexão.",
        );
        return;
      }
      setPassword("");
      setConfirmation("");
      if (mode === "reset")
        setMessage(
          "Se esse e-mail tiver uma conta, você receberá um link para redefinir a senha.",
        );
      if (mode === "register") {
        setMode("confirm");
        setMessage("Confira seu e-mail para confirmar a conta e entrar.");
      }
      if (mode === "confirm")
        setMessage(
          "Se a confirmação estiver pendente, você receberá um novo link. Confira também a caixa de spam.",
        );
      if (mode === "recovery") {
        onRecovered?.();
        changeMode("login");
        setMessage("Senha atualizada. Você já pode continuar.");
      }
    } catch {
      setError("Não foi possível conectar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-screen">
      <div className="auth-toolbar">
        <button
          className="icon-button"
          aria-label="Mudar tema"
          onClick={() =>
            theme.setPreference(
              theme.resolvedTheme === "dark" ? "light" : "dark",
            )
          }
        >
          {theme.resolvedTheme === "dark" ? (
            <Sun size={18} />
          ) : (
            <Moon size={18} />
          )}
        </button>
      </div>
      <section className="auth-card panel">
        <BrandMark />
        <h1>
          {mode === "login"
            ? "Entrar no Cash Tracker"
            : mode === "register"
              ? "Criar sua conta"
              : mode === "confirm"
                ? "Confirmar seu e-mail"
                : mode === "reset"
                  ? "Recuperar acesso"
                  : "Definir nova senha"}
        </h1>
        <p className="auth-description">
          {mode === "login"
            ? "Seu dinheiro, com clareza."
            : mode === "register"
              ? "Seus registros ficam separados e sincronizados na sua conta."
              : mode === "confirm"
                ? "Abra o link enviado por e-mail. Depois, entre com sua senha."
                : "Use seu e-mail para continuar com segurança."}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          {mode !== "recovery" && (
            <label className="field">
              <span>E-mail</span>
              <input
                className="input"
                type="email"
                name="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint={mode === "reset" || mode === "confirm" ? "done" : "next"}
                autoComplete="username"
                required
                disabled={busy}
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
          )}
          {mode !== "reset" && mode !== "confirm" && (
            <PasswordField
              key={mode}
              label={mode === "recovery" ? "Nova senha" : "Senha"}
              name="password"
              enterKeyHint={needsConfirmation ? "next" : "done"}
              visibilityLabel={mode === "recovery" ? "nova senha" : "senha"}
              autoFocus={mode === "recovery"}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              disabled={busy}
              minLength={mode === "login" ? undefined : 8}
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setMismatch(false);
                setError("");
              }}
            />
          )}
          {needsConfirmation && (
            <>
              <PasswordField
                key={`${mode}-confirmation`}
                label="Confirmar senha"
                name="password-confirmation"
                enterKeyHint="done"
                visibilityLabel="confirmação da senha"
                inputRef={confirmationRef}
                autoComplete="new-password"
                required
                disabled={busy}
                minLength={8}
                maxLength={128}
                value={confirmation}
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? "auth-error" : undefined}
                onChange={(e) => {
                  setConfirmation(e.target.value);
                  setMismatch(false);
                  setError("");
                }}
              />
              <p className="form-hint">Use pelo menos 8 caracteres.</p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert" id="auth-error">
              {error}
            </p>
          )}
          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}
          <button
            className="button primary auth-submit"
            disabled={busy}
            type="submit"
          >
            {busy
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar"
                : mode === "register"
                  ? "Criar conta"
                  : mode === "reset"
                    ? "Enviar link"
                    : mode === "confirm"
                      ? "Reenviar confirmação"
                      : "Salvar senha"}
          </button>
        </form>
        {mode === "login" && offerConfirmation && (
          <button
            className="text-button auth-back"
            disabled={busy}
            onClick={() => changeMode("confirm")}
          >
            Reenviar confirmação
          </button>
        )}
        {mode === "login" ? (
          <div className="auth-links">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => changeMode("reset")}
            >
              Esqueci minha senha
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => changeMode("register")}
            >
              Criar conta
            </button>
          </div>
        ) : (
          mode !== "recovery" && (
            <button
              className="text-button auth-back"
              disabled={busy}
              onClick={() => changeMode("login")}
            >
              Voltar para entrar
            </button>
          )
        )}
        <p className="form-hint auth-offline">
          Depois do primeiro acesso neste dispositivo, você pode usar o app
          offline.
        </p>
      </section>
    </main>
  );
}
