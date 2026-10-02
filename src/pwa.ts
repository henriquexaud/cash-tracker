/// <reference types="vite/client" />

export interface PwaOptions {
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onOfflineReady?: () => void;
}

let watchingController = false;

/** Register only the built application: Vite's development modules are never cached. */
export async function registerPwa(
  options: PwaOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return null;
  if (!watchingController) {
    watchingController = true;
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controlled) location.reload();
      else controlled = true;
    });
  }
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) =>
      window.addEventListener("load", () => resolve(), { once: true }),
    );
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (registration.waiting) options.onUpdate?.(registration);
    const observed = new WeakSet<ServiceWorker>();
    const observeInstallation = () => {
      const worker = registration.installing;
      if (!worker || observed.has(worker)) return;
      observed.add(worker);
      const reportState = () => {
        if (worker.state !== "installed") return;
        if (navigator.serviceWorker.controller)
          options.onUpdate?.(registration);
        else options.onOfflineReady?.();
      };
      worker.addEventListener("statechange", reportState);
      reportState();
    };
    registration.addEventListener("updatefound", observeInstallation);
    // updatefound can fire before register() resolves on a fast cached update.
    observeInstallation();
    return registration;
  } catch {
    // Local data and the application remain usable when registration is unavailable.
    return null;
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
