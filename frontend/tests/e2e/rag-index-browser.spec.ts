import { expect, test } from "@playwright/test";

test("owner sees simple index progress and can page through published chunks", async ({ page }) => {
  const user = { id: "index-owner", aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00.000Z" };
  await page.route("**/auth/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/token")) return route.fulfill({ json: { access_token: "mock-access-token", refresh_token: "mock-refresh-token", token_type: "bearer", expires_in: 3600, user } });
    return route.fulfill({ json: user });
  });
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { userId: user.id, role: "owner" } });
    if (path.endsWith("/catalog")) return route.fulfill({ json: { entries: [], prices: [], syncedAt: new Date().toISOString() } });
    if (path.endsWith("/rag/index")) return route.fulfill({ json: { run: { runId: 7, status: "completed", checkpoint: 41, chunks: 41, indexed: 41, reused: 0, removed: 0, embeddingModel: "bge-m3", contentHash: "hash" } } });
    if (path.endsWith("/rag/index-job")) return route.fulfill({ json: { job: { status: "completed", requestedRevision: 7, completedRevision: 7, attempts: 0, maxAttempts: 5, availableAt: "", updatedAt: "", lastErrorCode: null, lastErrorMessage: null } } });
    if (path.includes("/rag/chunks/")) {
      const current = Number(path.split("/").at(-1));
      return route.fulfill({ json: { generation: 7, total: 41, page: current, pageSize: 20, items: [{ id: current, productName: current === 1 ? "Bulong" : "Tắc kê sắt", variantName: "8x30", content: current === 1 ? "Nội dung chunk bulong đã lập" : "Nội dung chunk tắc kê đã lập" }] } });
    }
    if (path.endsWith("/rag/feedback")) return route.fulfill({ json: { total: 0, helpful: 0, notHelpful: 0, reasons: [], truncated: false } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  await page.goto("/rag-admin");
  await expect(page.getByRole("heading", { name: "Tiến độ lập chỉ mục" })).toBeVisible();
  await expect(page.getByText("41 / 41 chunk", { exact: true })).toBeVisible();
  await expect(page.getByText(/revision yêu cầu|thử 0\/5|model bge-m3/)).toHaveCount(0);
  await expect(page.getByText("Nội dung chunk bulong đã lập", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trang sau" }).click();
  await expect(page.getByText("Nội dung chunk tắc kê đã lập", { exact: true })).toBeVisible();
  await expect(page.getByText("Trang 2 / 3", { exact: true })).toBeVisible();
});
