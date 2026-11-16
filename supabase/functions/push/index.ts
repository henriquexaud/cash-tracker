// Supabase Edge Function. Called only by the database (trigger and cron in
// supabase/notifications.sql) with the shared secret. Deploy without JWT verification.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { reminderMessage, splitMessage, type PushEntry, type PushMessage, type PushOperation } from "./messages.ts";
import { sendPush, type PushTarget } from "./webpush.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const keys = {
  publicKey: env("VAPID_PUBLIC_KEY"),
  privateKey: env("VAPID_PRIVATE_KEY"),
  subject: env("VAPID_SUBJECT"),
};
// Projects on the new API keys get SUPABASE_SECRET_KEYS (a JSON dictionary); the legacy
// service_role key is deprecated and stops working once legacy keys are disabled.
function serviceKey() {
  try {
    const secret = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}")?.default;
    if (typeof secret === "string" && secret) return secret;
  } catch {
    /* Falls back to the legacy key. */
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
const database = createClient(env("SUPABASE_URL"), serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const missing = [
  ...Object.entries({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: keys.subject })
    .filter(([, value]) => !value).map(([name]) => name),
  ...(serviceKey() ? [] : ["SUPABASE_SECRET_KEYS"]),
];

async function deliver(jobs: { target: PushTarget; message: PushMessage }[]) {
  const expired: string[] = [];
  const statuses: Record<string, number> = {};
  let failed = 0;
  await Promise.all(jobs.map(async ({ target, message }) => {
    try {
      const status = await sendPush(target, JSON.stringify(message), keys);
      if (status === 404 || status === 410) expired.push(target.endpoint);
      else if (status >= 400) {
        failed++;
        // 401/403 usually mean VAPID keys that differ from the ones the device subscribed with.
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    } catch {
      failed++;
      statuses.error = (statuses.error ?? 0) + 1;
    }
  }));
  if (expired.length) await database.rpc("push_forget", { endpoints: expired });
  // Counts only: endpoints and texts never reach the logs.
  console.log(JSON.stringify({
    sent: jobs.length - failed - expired.length, expired: expired.length, failed,
    ...(failed ? { statuses } : {}),
  }));
}

Deno.serve(async (request) => {
  // Trimmed on both sides: a secret pasted with a trailing space or line break is a common mistake.
  const secret = env("PUSH_SECRET").trim();
  const sent = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || sent !== secret) {
    // Never logs the secrets themselves, only what helps tell the two cases apart.
    console.error(JSON.stringify({
      error: "unauthorized",
      reason: !secret ? "PUSH_SECRET not set in the function" : "Vault push_secret differs from PUSH_SECRET",
      lengths: { function: secret.length, request: sent.length },
    }));
    return new Response("Unauthorized", { status: 401 });
  }
  if (missing.length) {
    console.error(JSON.stringify({ error: "missing secrets", missing }));
    return new Response("Function not configured", { status: 500 });
  }
  let job: { type?: string; op?: PushOperation; actor?: string | null; entry?: PushEntry };
  try {
    job = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (job.type === "reminder") {
    const { data, error } = await database.rpc("push_claim_reminders");
    if (error) {
      console.error(JSON.stringify({ error: "push_claim_reminders", code: error.code, message: error.message }));
      return new Response("Database error", { status: 500 });
    }
    await deliver((data as (PushTarget & { month: string })[]).map((row) => ({
      target: row,
      message: reminderMessage(row.month),
    })));
  } else if (job.type === "split" && job.entry && job.op) {
    const { entry, op } = job;
    const { data, error } = await database.rpc("push_split_targets", {
      target_group: entry.group_id,
      actor: job.actor ?? null,
    });
    if (error || !data?.group) {
      console.error(JSON.stringify({ error: "push_split_targets", code: error?.code, message: error?.message ?? "group not found" }));
      return new Response("Database error", { status: 500 });
    }
    await deliver((data.targets as (PushTarget & { member: string })[]).map((target) => ({
      target,
      message: splitMessage({
        op, entry, groupName: data.group.name, members: data.members,
        actor: data.actor, recipient: target.member,
      }),
    })));
  } else return new Response("Bad request", { status: 400 });
  return new Response("ok");
});
