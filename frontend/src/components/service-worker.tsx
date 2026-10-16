"use client";

import { useEffect } from "react";
import { clearDevelopmentServiceWorkerState, refreshServiceWorkerRegistration } from "./service-worker-registration";

const CACHE = "gia-chuan-static-v7";

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") {
      // Dev chunk URLs are reused by HMR; caching them can serve stale CSS after edits.
      void clearDevelopmentServiceWorkerState(navigator.serviceWorker, caches).catch(() => undefined);
      return;
    }
    void navigator.serviceWorker.register("/sw.js?v=7", { updateViaCache: "none" })
      .then(async (registration) => {
        await refreshServiceWorkerRegistration(registration);
        await navigator.serviceWorker.ready;
        const cache = await caches.open(CACHE);
        const staticAssets = performance.getEntriesByType("resource")
          .map((entry) => new URL(entry.name, window.location.href))
          .filter((url) => url.origin === window.location.origin && url.pathname.startsWith("/_next/static/"));
        await Promise.allSettled(staticAssets.map(async (url) => {
          const response = await fetch(url);
          if (response.ok && response.type === "basic") await cache.put(url, response);
        }));
      });
    void caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("gia-chuan-") && key !== CACHE)
      .map((key) => caches.delete(key))));
  }, []);
  return null;
}
