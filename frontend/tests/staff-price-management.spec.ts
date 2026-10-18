import { expect, test, type Page } from "@playwright/test";

const user = { id: "staff-owner", aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };
const catalog = {
  syncedAt: "2026-10-17T10:00:00.000Z",
  entries: [{ categoryId: 3, productId: 8, variantId: 13, name: "Tắc kê đạn", category: "Tắc kê", spec: "6x50", displayName: "Đạn 6x50", productCode: "TK-650", aliases: ["tắc kê sắt"], sourcePages: [2], sourceFiles: [], verificationStatus: "verified" }],
  prices: [{ id: 21, priceId: 21, categoryId: 3, productId: 8, variantId: 13, packagingId: 34, name: "Tắc kê đạn", category: "Tắc kê", variantDisplayName: "Đạn 6x50", spec: "6x50 · Bịch", variantSpec: "6x50", packageName: "Bịch", packageQuantity: 10, packageNote: "", priceType: "retail", minimumQuantity: 1, price: 15000, unit: "cái", supplier: "Sổ giá", sourcePages: [2], sourceFiles: [], status: "verified", version: 7, validFrom: "2026-10-01T00:00:00.000Z", validTo: null }],
};

async function signIn(page: Page) {
  await page.route("**/auth/v1/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "staff-token", token_type: "bearer", expires_in: 3600, refresh_token: "staff-refresh", user }) });
    if (url.pathname.endsWith("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/staff/prices");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
}

async function mockCatalogApi(page: Page, options: { role?: string; response?: typeof catalog; catalogStatus?: number; priceUpdateStatus?: number } = {}) {
  let updateBody: unknown;
  const response = options.response ?? catalog;
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: user.id, role: options.role ?? "editor" }) });
    if (url.pathname.endsWith("/catalog") && route.request().method() === "GET") return route.fulfill({ status: options.catalogStatus ?? 200, contentType: "application/json", body: JSON.stringify(options.catalogStatus && options.catalogStatus >= 400 ? { error: { code: "UNAVAILABLE", message: "Unavailable" }, requestId: "test" } : response) });
    if (url.pathname.endsWith("/prices/21/update")) {
      updateBody = route.request().postDataJSON();
      if (options.priceUpdateStatus === 409) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "Version changed" }, requestId: "test" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ amount: 16000, version: 8, historyId: 91 }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" }, requestId: "test" }) });
  });
  return { getUpdateBody: () => updateBody };
}

test.describe("staff price management", () => {
  test("finds an item by alias and saves the selected price with its current version", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const api = await mockCatalogApi(page);
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Cập nhật & sửa giá" })).toBeVisible();
    await expect(page.locator("#staff-price-search")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator("#staff-price-search")).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(page.getByRole("button", { name: "Tải lại danh mục" })).toHaveCSS("background-color", "rgb(241, 243, 246)");
    await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toHaveCSS("color", "rgb(55, 65, 81)");
    await expect(page.getByRole("region", { name: "Chi tiết mặt hàng" }).locator('[data-testid="flowbite-card"]')).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.getByLabel("Tìm theo tên, alias, SKU hoặc quy cách").fill("tac ke sat");
    await page.getByRole("region", { name: "Kết quả danh mục" }).locator("li button").first().click();
    await expect(page.getByRole("region", { name: "Chi tiết mặt hàng" })).toContainText("Bịch");
    await expect(page.getByRole("region", { name: "Chi tiết mặt hàng" })).toContainText("Đã xác minh");
    await page.getByRole("button", { name: /Sửa giá lẻ/ }).click();
    await page.getByLabel("Giá mới VND").fill("16000");
    await page.getByRole("button", { name: "Lưu giá" }).click();
    await expect.poll(() => api.getUpdateBody()).toEqual({ amount: 16000, expectedVersion: 7, reason: "Cập nhật từ màn hình quản lý giá" });
    await expect(page.getByRole("region", { name: "Chi tiết mặt hàng" })).toContainText("16.000");
  });

  test("distinguishes a truly empty catalog from a failed request", async ({ page }) => {
    await mockCatalogApi(page, { response: { syncedAt: "2026-10-17T10:00:00.000Z", entries: [], prices: [] } });
    await signIn(page);
    await expect(page.getByText("Danh mục hiện chưa có mặt hàng")).toBeVisible();
    await expect(page.getByText("0 kết quả")).toBeVisible();
  });

  test("shows a failed request without cached data as an error and offers retry", async ({ page }) => {
    await mockCatalogApi(page, { catalogStatus: 503 });
    await signIn(page);
    await expect(page.getByText("Không tải được danh mục. Kiểm tra kết nối rồi thử lại.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  });

  test("shows cached data as stale and keeps writes disabled when refresh fails", async ({ page }) => {
    await page.addInitScript(async cached => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("gia-chuan-cache", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("snapshots", "readwrite");
          transaction.objectStore("snapshots").put({ data: cached.prices, syncedAt: "2026-10-17T09:00:00.000Z" }, "catalog");
          transaction.objectStore("snapshots").put({ data: cached.entries, syncedAt: "2026-10-17T09:00:00.000Z" }, "catalog-entries");
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, catalog);
    await mockCatalogApi(page, { catalogStatus: 503 });
    await signIn(page);
    await expect(page.getByText("Đang xem bản lưu; mọi thao tác sửa đã khóa.")).toBeVisible();
    await page.getByRole("region", { name: "Kết quả danh mục" }).locator("li button").first().click();
    await expect(page.getByText("Chỉ xem khi dữ liệu chưa đồng bộ hoặc đang ngoại tuyến.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sửa giá lẻ/ })).toHaveCount(0);
  });

  test("viewers may search and view details but cannot write", async ({ page }) => {
    await mockCatalogApi(page, { role: "viewer" });
    await signIn(page);
    await page.getByRole("region", { name: "Kết quả danh mục" }).locator("li button").first().click();
    await expect(page.getByRole("region", { name: "Chi tiết mặt hàng" })).toContainText("15.000");
    await expect(page.getByText("Tài khoản chỉ có quyền xem.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Sửa giá lẻ/ })).toHaveCount(0);
  });

  test("reloads current data and does not silently overwrite a conflicting price", async ({ page }) => {
    await mockCatalogApi(page, { priceUpdateStatus: 409 });
    await signIn(page);
    await page.getByRole("region", { name: "Kết quả danh mục" }).locator("li button").first().click();
    await page.getByRole("button", { name: /Sửa giá lẻ/ }).click();
    await page.getByLabel("Giá mới VND").fill("16000");
    await page.getByRole("button", { name: "Lưu giá" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Giá hoặc phiên bản đã đổi" })).toBeVisible();
  });
});
