export async function refreshServiceWorkerRegistration(
  registration: Pick<ServiceWorkerRegistration, "update">,
): Promise<void> {
  try {
    await registration.update();
  } catch {
    // A failed update check must not stop offline asset warming.
  }
}
type AppRegistration = { active?: { scriptURL: string } | null; unregister: () => Promise<boolean> };

export async function clearDevelopmentServiceWorkerState(
  workers: { getRegistrations: () => Promise<readonly AppRegistration[]> },
  cacheStorage: Pick<CacheStorage, "keys" | "delete">,
): Promise<void> {
  const registrations = await workers.getRegistrations();
  await Promise.all(registrations.filter(registration => registration.active && new URL(registration.active.scriptURL).pathname === "/sw.js")
    .map(registration => registration.unregister()));
  const names = await cacheStorage.keys();
  await Promise.all(names.filter(name => name.startsWith("gia-chuan-")).map(name => cacheStorage.delete(name)));
}

