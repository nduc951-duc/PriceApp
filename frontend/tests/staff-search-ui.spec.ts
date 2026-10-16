import { expect, test } from "@playwright/test";

const user = {
  id: "staff-search-test-user", aud: "authenticated", role: "authenticated", email: "staff-search@example.test",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00.000Z",
};
const catalog = {
  syncedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    { categoryId: 1, productId: 1, variantId: 1, name: "Bulong", category: "Bu lông", spec: "8 ly x 3F", displayName: "Bulong 8 ly x 3F", productCode: "BL-83", aliases: ["lục giác"], sourcePages: [1], sourceFiles: [] },
    { categoryId: 2, productId: 2, variantId: 2, name: "Tắc kê", category: "Tắc kê", spec: "6 x 50", displayName: "Tắc kê 6 x 50", sourcePages: [2], sourceFiles: [] },
  ],
  prices: [
    { id: 11, priceId: 11, categoryId: 1, productId: 1, variantId: 1, packagingId: 1, name: "Bulong", category: "Bu lông", variantDisplayName: "Bulong 8 ly x 3F", spec: "8 ly x 3F", variantSpec: "8 ly x 3F", packageName: "Bịch 100 cái", packageQuantity: 100, packageNote: "", priceType: "retail", minimumQuantity: 1, price: 30000, unit: "cái", supplier: "Sổ", sourcePages: [1], sourceFiles: [], status: "verified", version: 1 },
    { id: 12, priceId: 12, categoryId: 1, productId: 1, variantId: 1, packagingId: 2, name: "Bulong", category: "Bu lông", variantDisplayName: "Bulong 8 ly x 3F", spec: "8 ly x 3F", variantSpec: "8 ly x 3F", packageName: "Thùng 1000 cái", packageQuantity: 1000, packageNote: "", priceType: "wholesale", minimumQuantity: 2, price: 250000, unit: "cái", supplier: "Sổ", sourcePages: [1], sourceFiles: [], status: "verified", version: 1 },
    { id: 13, priceId: 13, categoryId: 2, productId: 2, variantId: 2, packagingId: 3, name: "Tắc kê", category: "Tắc kê", variantDisplayName: "Tắc kê 6 x 50", spec: "6 x 50", variantSpec: "6 x 50", packageName: "Bịch 10 cái", packageQuantity: 10, packageNote: "", priceType: "retail", minimumQuantity: 1, price: 40000, unit: "cái", supplier: "Sổ", sourcePages: [2], sourceFiles: [], status: "verified", version: 1 },
  ],
};

test("staff price search follows the customer catalog filters while retaining RAG navigation", async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user }) });
    if (pathname.endsWith("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/catalog")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) });
    if (pathname.endsWith("/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: user.id, role: "owner" }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" }, requestId: "staff-search-test" }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  await expect(page.locator(".pos-product-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Hỏi đáp AI", exact: true }).first()).toBeVisible();

  const search = page.locator("#product-search");
  await search.fill("bl-83");
  await expect(page.locator(".pos-product-card")).toHaveCount(1);
  await expect(page.locator(".pos-product-card")).toContainText("Bulong");
  await search.fill("luc giac");
  await expect(page.locator(".pos-product-card")).toHaveCount(1);
  await expect(page.locator(".pos-product-card")).toContainText("Bulong");
  await search.fill("khong co san pham nay");
  await expect(page.getByText("Không tìm thấy mặt hàng phù hợp.")).toBeVisible();
  await search.fill("");
  await expect(page.locator(".pos-product-card")).toHaveCount(2);

  await page.getByLabel("Lọc theo nhóm hàng").selectOption({ label: "Bu lông" });
  await expect(page.locator(".pos-product-card")).toHaveCount(1);
  await expect(page.locator(".pos-product-card")).toContainText("Bulong");
  await page.getByLabel("Loại giá").selectOption("wholesale");
  await expect(page.locator(".pos-variant-chip")).toContainText("1 giá");
  await page.getByLabel("Lọc theo nhóm hàng").selectOption({ label: "Tắc kê" });
  await expect(page.getByText("Không tìm thấy mặt hàng phù hợp.")).toBeVisible();
  await page.getByLabel("Loại giá").selectOption("all");
  await expect(page.locator(".pos-product-card")).toContainText("Tắc kê");
});
