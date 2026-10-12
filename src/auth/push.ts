import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushServer } from "../notifications";

/** Stores the push subscription of this device in the signed-in account. */
export function createPushServer(client: SupabaseClient, userId: string): PushServer {
  const call = async (name: string, args: Record<string, unknown>) => {
    // Pin each call to the account that opened the app, as the financial sync does.
    const session = (await client.auth.getSession()).data.session;
    if (session?.user.id !== userId) throw new Error("Sessão de outra conta.");
    const { error } = await client
      .rpc(name, args)
      .setHeader("Authorization", `Bearer ${session.access_token}`);
    if (error) throw new Error("Não foi possível atualizar as notificações.");
  };
  return {
    save: (subscription, prefs, timezone, doneMonth) =>
      call("push_subscribe", {
        sub_endpoint: subscription.endpoint,
        sub_p256dh: subscription.p256dh,
        sub_auth: subscription.auth,
        sub_reminder_day: prefs.reminderDay,
        sub_splits: prefs.splits,
        sub_timezone: timezone,
        done_month: doneMonth,
      }),
    remove: (endpoint) => call("push_unsubscribe", { sub_endpoint: endpoint }),
  };
}
