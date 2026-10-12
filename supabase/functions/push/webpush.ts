// Web Push (RFC 8291 encryption, RFC 8292 VAPID) on standard Web Crypto only,
// so the same file runs in the Edge Function and in the project's tests.
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface VapidKeys {
  /** Uncompressed P-256 point, base64url (as printed by `web-push generate-vapid-keys`). */
  publicKey: string;
  privateKey: string;
  /** Contact of the sender, `mailto:` or `https:`. */
  subject: string;
}

const text = new TextEncoder();
export const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
export const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const hkdf = async (salt: BufferSource, secret: BufferSource, info: BufferSource, length: number) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]),
      length * 8,
    ),
  );

/** Body for `Content-Encoding: aes128gcm`, readable only by the subscribed browser. */
export async function encryptPush(target: PushTarget, message: string) {
  const receiver = fromBase64Url(target.p256dh);
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  )) as CryptoKeyPair;
  const sender = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: await crypto.subtle.importKey(
          "raw", receiver, { name: "ECDH", namedCurve: "P-256" }, false, [],
        ),
      },
      pair.privateKey,
      256,
    ),
  );
  const material = await hkdf(
    fromBase64Url(target.auth), shared,
    join(text.encode("WebPush: info\0"), receiver, sender), 32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await hkdf(salt, material, text.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, material, text.encode("Content-Encoding: nonce\0"), 12);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]),
      // 0x02 closes the single record.
      join(text.encode(message), Uint8Array.of(2)),
    ),
  );
  // Header: salt, record size (4096), sender key length and key.
  return join(salt, Uint8Array.of(0, 0, 16, 0, sender.length), sender, encrypted);
}

/** `Authorization` value that identifies this server to the push service. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const point = fromBase64Url(keys.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256", d: keys.privateKey,
      x: toBase64Url(point.slice(1, 33)), y: toBase64Url(point.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const encode = (value: unknown) => toBase64Url(text.encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/** Resolves with the HTTP status of the push service; 404 and 410 mean an expired subscription. */
export async function sendPush(target: PushTarget, message: string, keys: VapidKeys): Promise<number> {
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // The push service keeps the message for up to a day while the device is offline.
      TTL: "86400",
      Urgency: "normal",
    },
    body: await encryptPush(target, message),
  });
  await response.body?.cancel();
  return response.status;
}
