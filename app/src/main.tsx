import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { applyTheme } from "./lib/settings";
import { startSyncLoop } from "./lib/sync";

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
startSyncLoop();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));
}
// Ask the browser not to evict our data (important on iOS).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
