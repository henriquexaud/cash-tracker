import { describe, expect, it } from "vitest";
import { readCloudConfig } from "./client";
import { identityStore } from "./offline-identity";
describe("configuração de autenticação", () => {
  it("aceita somente chave publicável com URL HTTPS limpa", () => {
    expect(
      readCloudConfig({
        VITE_SUPABASE_URL: "https://project.supabase.co/",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      key: "sb_publishable_public",
    });
    for (const key of [undefined, "sb_secret_private", "eyJservice_role"])
      expect(() =>
        readCloudConfig({
          VITE_SUPABASE_URL: "https://project.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: key,
        }),
      ).toThrow();
    for (const url of [
      "http://project.supabase.co",
      "https://user:password@project.supabase.co",
      "https://project.supabase.co?key=secret",
      "https://project.supabase.co/auth/v1",
    ])
      expect(() =>
        readCloudConfig({
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
        }),
      ).toThrow();
  });
  it("guarda apenas a identidade offline, separa projetos e remove ao sair", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const first = identityStore("first", storage),
      second = identityStore("second", storage);
    first.save({
      id: "00000000-0000-4000-8000-000000000001",
      email: "user@example.com",
    });
    expect(first.read()?.email).toBe("user@example.com");
    expect(second.read()).toBeNull();
    expect([...values.values()].join()).not.toMatch(/password|token/);
    first.save(null);
    expect(first.read()).toBeNull();
  });
});
