import { describe, expect, it, vi } from "vitest";
import { clearDevelopmentServiceWorkerState, refreshServiceWorkerRegistration } from "./service-worker-registration";

describe("service worker registration refresh", () => {
  it("removes this app's development worker and stale asset cache without touching unrelated caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const unrelated = vi.fn().mockResolvedValue(true);
    const workers = { getRegistrations: vi.fn().mockResolvedValue([
      { active: { scriptURL: "http://localhost:3000/sw.js?v=6" }, unregister },
      { active: { scriptURL: "http://localhost:3000/another-app/sw.js" }, unregister: unrelated },
    ]) };
    const cacheStorage = { keys: vi.fn().mockResolvedValue(["gia-chuan-static-v6", "other-app-cache"]), delete: vi.fn().mockResolvedValue(true) };
    await clearDevelopmentServiceWorkerState(workers, cacheStorage);
    expect(unregister).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
    expect(cacheStorage.delete).toHaveBeenCalledExactlyOnceWith("gia-chuan-static-v6");
  });
  it("allows static asset warming to continue when update checks fail", async () => {
    const update = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(refreshServiceWorkerRegistration({ update })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();
  });
});
