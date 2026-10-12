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
const database = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function deliver(jobs: { target: PushTarget; message: PushMessage }[]) {
  const expired: string[] = [];
  let failed = 0;
  await Promise.all(jobs.map(async ({ target, message }) => {
    try {
      const status = await sendPush(target, JSON.stringify(message), keys);
      if (status === 404 || status === 410) expired.push(target.endpoint);
      else if (status >= 400) failed++;
    } catch {
      failed++;
    }
  }));
  if (expired.length) await database.rpc("push_forget", { endpoints: expired });
  // Counts only: endpoints and texts never reach the logs.
  console.log(JSON.stringify({ sent: jobs.length - failed - expired.length, expired: expired.length, failed }));
}

Deno.serve(async (request) => {
  const secret = env("PUSH_SECRET");
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });
  let job: { type?: string; op?: PushOperation; actor?: string | null; entry?: PushEntry };
  try {
    job = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (job.type === "reminder") {
    const { data, error } = await database.rpc("push_claim_reminders");
    if (error) return new Response("Database error", { status: 500 });
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
    if (error || !data?.group) return new Response("Database error", { status: 500 });
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
