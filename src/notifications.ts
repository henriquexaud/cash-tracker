import { monthLabel } from "./domain/finance";
import type { AppData, Month } from "./domain/types";

/** Device preference, like theme and privacy: never part of the backup or the financial sync. */
export interface NotificationPrefs {
  /** Day of the month (1–31) for the salary/budget reminder; null disables it. */
  reminderDay: number | null;
  splits: boolean;
}
/** Account side of the push subscription of this device (supabase/notifications.sql). */
export interface PushServer {
  save: (
    subscription: { endpoint: string; p256dh: string; auth: string },
    prefs: NotificationPrefs,
    timezone: string,
    doneMonth: Month | null,
  ) => Promise<void>;
  remove: (endpoint: string) => Promise<void>;
}
/**
 * on/off: this device is (un)subscribed. blocked: no browser permission.
 * unavailable: no service worker (development) or no key in this build.
 */
export type PushStatus = "on" | "off" | "blocked" | "unavailable" | "failed";

export const NOTIFICATIONS_KEY = "cash-tracker-notifications";
const REMINDED_KEY = `${NOTIFICATIONS_KEY}-reminded`;

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* The preference still works for this session. */
  }
}

export function readPrefs(): NotificationPrefs {
  let stored: Partial<NotificationPrefs> | null = null;
  try {
    stored = JSON.parse(readItem(NOTIFICATIONS_KEY) ?? "null");
  } catch {
    /* Unreadable preferences mean notifications are off. */
  }
  const day = stored?.reminderDay;
  return {
    reminderDay:
      typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
    splits: stored?.splits === true,
  };
}
export const savePrefs = (prefs: NotificationPrefs) =>
  writeItem(NOTIFICATIONS_KEY, JSON.stringify(prefs));

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

const monthOf = (now: Date): Month =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

/** The current month, once it has both a salary and a budget: nothing left to remind. */
export function completedMonth(data: AppData, now: Date): Month | null {
  const month = monthOf(now);
  return data.salaries.some((row) => row.month === month) &&
    data.budgets.some((row) => row.month === month)
    ? month
    : null;
}

/**
 * Reminder without an account, shown while the app is open: due from the chosen day
 * (or the last day of a shorter month), once per month, while salary or budget is missing.
 */
export function monthlyReminder(
  prefs: NotificationPrefs,
  reminded: string | null,
  data: AppData,
  now: Date,
): { month: Month; body: string; url: string } | null {
  if (!prefs.reminderDay) return null;
  const month = monthOf(now);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (reminded === month || now.getDate() < Math.min(prefs.reminderDay, lastDay)) return null;
  const salary = data.salaries.some((row) => row.month === month);
  const budget = data.budgets.some((row) => row.month === month);
  if (salary && budget) return null;
  const label = monthLabel(month);
  return {
    month,
    body: salary
      ? `Hora de montar o orçamento de ${label}.`
      : budget
        ? `Hora de lançar o salário de ${label}.`
        : `Hora de lançar o salário e montar o orçamento de ${label}.`,
    url: salary ? "#budget" : "#dashboard",
  };
}

/** Local mode only; with an account the server sends the reminder, even with the app closed. */
export async function checkLocalReminder(data: AppData) {
  if (notificationPermission() !== "granted") return;
  const reminder = monthlyReminder(readPrefs(), readItem(REMINDED_KEY), data, new Date());
  if (!reminder) return;
  writeItem(REMINDED_KEY, reminder.month);
  const options = {
    body: reminder.body,
    tag: `cash-tracker-reminder-${reminder.month}`,
    icon: "/icons/wallet-192.png",
    data: { url: reminder.url },
  };
  try {
    // Android only allows notifications through the service worker registration.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification("Cash Tracker", options);
      return;
    }
    const notification = new Notification("Cash Tracker", options);
    notification.onclick = () => {
      window.focus();
      location.hash = reminder.url;
      notification.close();
    };
  } catch {
    /* A notification is a convenience; the app keeps working without it. */
  }
}

const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";
const decodeKey = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

export const pushSupported = () =>
  typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

/**
 * Makes the push subscription of this device match its preferences: subscribes and
 * stores it in the account while something is enabled, removes it otherwise.
 */
export async function syncPush(
  server: PushServer,
  prefs: NotificationPrefs,
  doneMonth: Month | null,
  publicKey = VAPID_PUBLIC_KEY,
): Promise<PushStatus> {
  if (!pushSupported() || !publicKey) return "unavailable";
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return "unavailable";
    let subscription = await registration.pushManager.getSubscription();
    if (prefs.reminderDay === null && !prefs.splits) {
      if (subscription) {
        await server.remove(subscription.endpoint);
        await subscription.unsubscribe();
      }
      return "off";
    }
    if (notificationPermission() !== "granted") return "blocked";
    if (!subscription) {
      await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      });
    }
    const { endpoint, keys } = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) return "failed";
    await server.save(
      { endpoint, p256dh: keys.p256dh, auth: keys.auth },
      prefs,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      doneMonth,
    );
    return "on";
  } catch {
    return "failed";
  }
}

/** Before leaving the account: this device must not keep receiving its notifications. */
export async function removePush(server: PushServer) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await server.remove(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
  } catch {
    /* Signing out continues; the server also drops subscriptions the browser discarded. */
  }
}
