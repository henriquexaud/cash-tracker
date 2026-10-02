import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerPwa } from "./pwa";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
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
