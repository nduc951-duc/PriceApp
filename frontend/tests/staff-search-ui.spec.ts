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

test("staff can search and filter products, choose a specification, and add its price to a quote", async ({ page }) => {
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
  await expect(page.locator("#invoice-panel")).toBeVisible();
  await expect(page.locator("#invoice-panel")).toContainText("Chưa có sản phẩm trong báo giá.");
  for (const selector of [".pos-catalog-column", ".pos-invoice-panel"]) {
    await expect(page.locator(selector)).toHaveCSS("border-top-width", "1px");
  }
  await expect(page.locator(".pos-catalog-column")).toHaveCSS("gap", "0px");
  await expect(page.locator(".pos-results-panel")).toHaveCSS("border-top-width", "0px");
  for (const selector of [".pos-search-panel", ".pos-results-panel", ".pos-invoice-panel"]) {
    const padding = await page.locator(selector).evaluate(element => Number.parseFloat(getComputedStyle(element).paddingLeft));
    expect(padding).toBeGreaterThanOrEqual(16);
  }
  await expect(page.locator(".pos-detail-column")).toHaveCount(0);
  if (page.viewportSize()!.width >= 768) {
    const catalogBounds = await page.locator(".pos-catalog-column").boundingBox();
    const quoteBounds = await page.locator("#invoice-panel").boundingBox();
    expect(Math.abs(catalogBounds!.y - quoteBounds!.y)).toBeLessThanOrEqual(2);
    expect(quoteBounds!.x).toBeGreaterThan(catalogBounds!.x);
  }
  await expect(page.getByRole("link", { name: /^(Hỏi đáp AI|Hỏi giá)$/ }).first()).toBeVisible();

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
  await page.getByLabel("Lọc theo nhóm hàng").selectOption("all");

  const bulong = page.locator(".pos-product-card").filter({ hasText: "Bulong" });
  const specification = bulong.getByRole("button", { name: /8 ly x 3F/ });
  await specification.click();
  await expect(specification).toHaveAttribute("aria-pressed", "true");
  const details = page.locator(".pos-detail-panel");
  await expect(page.locator("#invoice-panel")).toHaveCount(0);
  await expect(details).toContainText("Bulong");
  await expect(details).toContainText("Nguồn sổ: trang 1");
  await expect(details).toContainText("30.000");
  await details.getByRole("button", { name: "Quay lại báo giá tổng" }).click();
  await expect(page.locator("#invoice-panel")).toBeVisible();
  await expect(page.locator(".pos-detail-column")).toHaveCount(0);
  await specification.click();
  await expect(details).toBeVisible();
  await details.scrollIntoViewIfNeeded();
  const headerBottom = await page.locator(".pos-header").evaluate((header) => header.getBoundingClientRect().bottom);
  const detailsTop = await details.evaluate((panel) => panel.getBoundingClientRect().top);
  expect(detailsTop).toBeGreaterThanOrEqual(headerBottom);
  for (const mode of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), mode === "dark");
    for (const field of [page.locator("#retail-package-count"), page.getByLabel("Số lượng Bịch 100 cái", { exact: true })]) {
      const contrast = await field.evaluate(input => {
        const style = getComputedStyle(input);
        const luminance = (color: string) => {
          const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      expect(contrast, `${mode}: quantity text must be readable against its input background`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.getByLabel("Số lượng Bịch 100 cái").fill("1");
  await details.getByRole("button", { name: "Thêm vào báo giá", exact: true }).click();
  await expect(page.locator(".pos-invoice-line")).toHaveCount(1);
  await expect(page.locator(".pos-invoice-line")).toContainText("Bulong");
  await expect(page.locator(".pos-detail-column")).toHaveCount(0);

  await expect(page.locator(".pos-invoice-total")).toContainText("Tổng báo giá");
  await expect(page.locator(".pos-invoice-total")).toContainText("1 mặt hàng");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(241, 243, 246)");
  await expect(page.locator(".pos-invoice-total")).toHaveCSS("background-color", "rgb(234, 241, 255)");
  await expect(page.locator(".pos-invoice-total")).toHaveCSS("border-top-color", "rgb(217, 222, 231)");
  await page.evaluate(() => window.scrollTo(0, 0));
  const quoteDock = page.getByRole("region", { name: "Tóm tắt báo giá" });
  await expect(quoteDock).toBeVisible();
  await expect(quoteDock).toContainText("30.000");
  const dockBounds = await quoteDock.boundingBox();
  const navigationBounds = await page.locator(".mobile-nav").isVisible() ? await page.locator(".mobile-nav").boundingBox() : null;
  expect(dockBounds!.y + dockBounds!.height).toBeLessThanOrEqual(navigationBounds?.y ?? page.viewportSize()!.height);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 700, height: 600 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(quoteDock).toBeVisible();
  const tabletDock = await quoteDock.boundingBox();
  const tabletNavigation = await page.locator(".mobile-nav").boundingBox();
  expect(tabletDock!.y + tabletDock!.height).toBeLessThanOrEqual(tabletNavigation!.y);
  await page.setViewportSize(originalViewport);
  await quoteDock.getByRole("button", { name: /Xem.*báo giá/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(quoteDock).toHaveCount(0);
  await page.getByRole("button", { name: "Đóng báo giá" }).click();
  await page.locator(".pos-invoice-summary").evaluate(summary => summary.scrollIntoView({ block: "center" }));
  await expect(quoteDock).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
