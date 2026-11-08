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
  import("virtual:pwa-register").then(({ registerSW }) =>
    registerSW({
      immediate: true,
      // iOS keeps the installed app alive for days: also look for a new version every
      // time it comes back to the foreground (and hourly), not only on a cold start
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => void reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
        setInterval(check, 60 * 60 * 1000);
      },
    }),
  );
}
// Ask the browser not to evict our data (important on iOS).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
