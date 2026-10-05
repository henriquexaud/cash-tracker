import { describe, expect, it } from "vitest";
import { authReturnNotice, cleanAuthReturn, readAuthReturn } from "./return";

describe("retorno de confirmação", () => {
  it("preserva navegação e parâmetros comuns", () => {
    const url = "https://example.com/?view=month#wealth";
    expect(readAuthReturn(url).hasCallback).toBe(false);
    expect(cleanAuthReturn(url)).toBe("/?view=month#wealth");
    expect(authReturnNotice(readAuthReturn(url), false, url)).toBe("");
  });
  it("retira códigos e erros sem refletir mensagens externas", () => {
    const url =
      "https://example.com/?code=secret&sb_flow_id=secret&view=month#error=access_denied&error_code=otp_expired&error_description=secret";
    expect(cleanAuthReturn(url)).toBe("/?view=month");
    expect(authReturnNotice(readAuthReturn(url), false, url)).not.toContain(
      "secret",
    );
    expect(authReturnNotice(readAuthReturn(url), false, url)).toContain(
      "reenvie",
    );
  });
  it("não anuncia confirmação só por existir um código na URL", () => {
    const url = "https://example.com/?code=code";
    expect(authReturnNotice(readAuthReturn(url), false, url)).toContain(
      "Se já confirmou",
    );
    expect(
      authReturnNotice(readAuthReturn(url), false, "https://example.com/"),
    ).toBe("");
    expect(authReturnNotice(readAuthReturn(url), true, url)).toContain(
      "Não foi possível",
    );
  });
});
