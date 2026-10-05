import { useEffect, useMemo, useState, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrendingUp } from "lucide-react";
import App from "../App";
import { createAuthClient, readCloudConfig } from "./client";
import { createCloudRepository } from "./cloud-repository";
import { AuthForm } from "./AuthForm";
import { identityStore, type AccountIdentity } from "./offline-identity";
import { authReturnNotice, cleanAuthReturn, readAuthReturn } from "./return";

function AccountApp({
  client,
  identity,
  onExit,
}: {
  client: SupabaseClient;
  identity: AccountIdentity;
  onExit: () => void;
}) {
  const project = readCloudConfig(import.meta.env).url;
  const repository = useMemo(
    () => createCloudRepository(client, identity.id, project),
    [client, identity.id, project],
  );
  const lifecycle = useRef(0);
  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycle.current === generation) repository.dispose?.();
      });
    };
  }, [repository]);
  return (
    <App
      repository={repository}
      account={{
        id: identity.id,
        email: identity.email ?? "Sua conta",
        signOut: async () => {
          await repository.sync?.();
          await repository.clear?.();
          const result = await client.auth.signOut({ scope: "local" });
          if (result.error) {
            // A network failure must not keep the local account accessible after exit.
            client.auth.stopAutoRefresh();
            try {
              window.localStorage.removeItem(
                `cash-tracker-auth:${new URL(project).hostname}`,
              );
            } catch {
              /* No usable persistent session. */
            }
          }
          identityStore(project, {
            getItem: (key) => window.localStorage.getItem(key),
            setItem: (key, value) => window.localStorage.setItem(key, value),
            removeItem: (key) => window.localStorage.removeItem(key),
          }).save(null);
          repository.dispose?.();
          onExit();
        },
      }}
    />
  );
}

export function AuthGate() {
  const [authReturn] = useState(() => readAuthReturn(window.location.href));
  const callbackPending = useRef(authReturn.hasCallback);
  const [callbackNotice, setCallbackNotice] = useState("");
  const [clientResult] = useState(() => {
    try {
      return { client: createAuthClient(), error: "" };
    } catch {
      return {
        client: null,
        error:
          "O acesso por conta ainda precisa ser configurado. Seus dados anteriores permanecem neste dispositivo.",
      };
    }
  });
  const client = clientResult.client;
  const identityStorage = useMemo(
    () =>
      identityStore(
        clientResult.client
          ? readCloudConfig(import.meta.env).url
          : "unconfigured",
        {
          getItem: (key) => window.localStorage.getItem(key),
          setItem: (key, value) => window.localStorage.setItem(key, value),
          removeItem: (key) => window.localStorage.removeItem(key),
        },
      ),
    [clientResult],
  );
  const [identity, setIdentity] = useState<AccountIdentity | null>(() =>
    identityStorage.read(),
  );
  const [loading, setLoading] = useState(!identity || authReturn.hasCallback);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let live = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      if (!live) return;
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (callbackPending.current) return;
      if (event === "SIGNED_IN") setCallbackNotice("");
      if (next) {
        const user = {
          id: next.user.id,
          email: next.user.email ?? "Sua conta",
        };
        identityStorage.save(user);
        setIdentity(user);
      } else if (event === "SIGNED_OUT") {
        identityStorage.save(null);
        setIdentity(null);
      }
      setLoading(false);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    void (async () => {
      const initialized = await client.auth.initialize();
      if (!live) return;
      const notice = authReturnNotice(
        authReturn,
        !!initialized.error,
        window.location.href,
      );
      callbackPending.current = false;
      if (authReturn.hasCallback)
        window.history.replaceState(
          window.history.state,
          "",
          cleanAuthReturn(window.location.href),
        );
      if (notice) {
        setCallbackNotice(notice);
        setLoading(false);
        return;
      }
      const { data, error } = await client.auth.getSession();
      if (!live) return;
      if (data.session) {
        const user = {
          id: data.session.user.id,
          email: data.session.user.email ?? "Sua conta",
        };
        identityStorage.save(user);
        setIdentity(user);
      } else if (!error && navigator.onLine) {
        identityStorage.save(null);
        setIdentity(null);
      }
      setLoading(false);
    })().catch(() => {
      if (!live) return;
      callbackPending.current = false;
      if (authReturn.hasCallback) {
        setCallbackNotice(
          authReturnNotice(authReturn, true, window.location.href),
        );
        window.history.replaceState(
          window.history.state,
          "",
          cleanAuthReturn(window.location.href),
        );
      }
      setLoading(false);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, [client, identityStorage, authReturn]);
  if (!client || loading)
    return (
      <main className="loading-screen">
        <span className="brand-mark">
          <TrendingUp size={23} />
        </span>
        <h1>Cash Tracker</h1>
        <p role={!client ? "alert" : "status"}>
          {clientResult.error || "Abrindo sua conta…"}
        </p>
      </main>
    );
  if (recovery)
    return (
      <AuthForm
        key="recovery"
        client={client}
        recovery
        onRecovered={() => setRecovery(false)}
      />
    );
  if (!identity || callbackNotice)
    return <AuthForm client={client} initialMessage={callbackNotice} />;
  return (
    <AccountApp
      key={identity.id}
      identity={identity}
      client={client}
      onExit={() => {
        identityStorage.save(null);
        setIdentity(null);
      }}
    />
  );
}
