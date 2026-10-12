import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { LoaderCircle } from "lucide-react";
import App from "./App";
import { BrandMark } from "./components/BrandMark";
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
          fallback={
            // Same layout as the account and data steps that follow: nothing shifts while opening.
            <div className="loading-screen">
              <BrandMark />
              <h1>Cash Tracker</h1>
              <LoaderCircle className="spin" />
              <p>Abrindo sua conta…</p>
            </div>
          }
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
