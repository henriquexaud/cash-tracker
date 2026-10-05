import { createClient } from "@supabase/supabase-js";

export function readCloudConfig(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key || !key.startsWith("sb_publishable_"))
    throw new Error(
      "Configure a URL e a chave publicável do Supabase. Chaves secretas não são aceitas no navegador.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  )
    throw new Error("Use apenas a URL HTTPS do projeto Supabase.");
  return { url: parsed.origin, key };
}

let authClient: ReturnType<typeof createClient> | undefined;
export function createAuthClient() {
  const { url, key } = readCloudConfig(import.meta.env);
  return (authClient ??= createClient(url, key, {
    auth: {
      storageKey: `cash-tracker-auth:${new URL(url).hostname}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  }));
}
