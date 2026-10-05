const callbackKeys = [
  "code",
  "sb_flow_id",
  "error",
  "error_code",
  "error_description",
];

export function readAuthReturn(address: string) {
  const url = new URL(address);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasError = ["error", "error_code", "error_description"].some(
    (key) => url.searchParams.has(key) || fragment.has(key),
  );
  return { hasCallback: url.searchParams.has("code") || hasError, hasError };
}

export function cleanAuthReturn(address: string) {
  const url = new URL(address);
  callbackKeys.forEach((key) => url.searchParams.delete(key));
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (callbackKeys.some((key) => fragment.has(key))) {
    callbackKeys.forEach((key) => fragment.delete(key));
    url.hash = fragment.toString();
  }
  return url.pathname + url.search + url.hash;
}

export function authReturnNotice(
  initial: ReturnType<typeof readAuthReturn>,
  initializationFailed: boolean,
  currentAddress: string,
) {
  if (!initial.hasCallback) return "";
  if (initial.hasError || initializationFailed)
    return "Não foi possível concluir por este link. Entre com e-mail e senha ou reenvie a confirmação se ainda não confirmou sua conta. Para recuperar a senha, solicite um novo link.";
  if (new URL(currentAddress).searchParams.has("code"))
    return "Se já confirmou seu e-mail, entre com e-mail e senha para continuar neste navegador. Caso precise, reenvie a confirmação.";
  return "";
}
