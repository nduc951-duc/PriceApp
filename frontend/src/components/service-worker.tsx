"use client";

import { useEffect } from "react";

const CACHE = "gia-chuan-static-v5";

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js?v=5", { updateViaCache: "none" })
      .then((registration) => registration.update());
    void caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("gia-chuan-") && key !== CACHE)
      .map((key) => caches.delete(key))));
  }, []);
  return null;
}
