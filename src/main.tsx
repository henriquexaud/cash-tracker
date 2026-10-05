import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
const AuthGate = lazy(() =>
  import("./auth/AuthGate").then((module) => ({ default: module.AuthGate })),
);
import { PrivacyProvider } from "./privacy";
import { CLOUD_MODE } from "./config";
import "./styles.css";
import { registerPwa } from "./pwa";
import { initializeTheme } from "./theme";

initializeTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrivacyProvider>
      {CLOUD_MODE ? (
        <Suspense
          fallback={<div className="loading-screen">Abrindo sua conta…</div>}
        >
          <AuthGate />
        </Suspense>
      ) : (
        <App />
      )}
    </PrivacyProvider>
  </React.StrictMode>,
);
if (import.meta.env.PROD) {
  void registerPwa({
    onOfflineReady: () =>
      window.dispatchEvent(new Event("cash-tracker-offline-ready")),
    onUpdate: (registration) =>
      window.dispatchEvent(
        new CustomEvent("cash-tracker-update", { detail: registration }),
      ),
  }).catch(() => {
    /* Application data remains available independently of the offline cache. */
  });
}
