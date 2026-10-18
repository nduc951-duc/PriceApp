import { expect, test, type Page } from "@playwright/test";

const longName = "Víttolekhônggỉquy cáchđặc biệt dành chomái nhàcông trìnhkích thướclớn".repeat(2);
const longSpec = "quycachkhongco khoangtrang-".repeat(5);
const staffUser = { id: "layout-staff", aud: "authenticated", role: "authenticated", email: "staff@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };
const catalogPrice = {
  id: 71, priceId: 71, categoryId: 2, productId: 8, variantId: 13, packagingId: 34,
  name: longName, category: "Vật tư", variantDisplayName: longSpec, spec: longSpec, variantSpec: longSpec,
  packageName: "Bịch-" + "quy cách không khoảng trắng".replaceAll(" ", "").repeat(5), packageQuantity: 10,
  packageNote: "", priceType: "retail", minimumQuantity: 1, price: 15000, unit: "cái", supplier: "Sổ giá",
  sourcePages: [2], sourceFiles: [], status: "verified", version: 7, validFrom: "2026-10-01T00:00:00.000Z", validTo: null,
};
const catalog = {
  syncedAt: "2026-10-17T10:00:00.000Z",
  entries: [{ categoryId: 2, productId: 8, variantId: 13, name: longName, category: "Vật tư", spec: longSpec, displayName: longSpec, productCode: "VT-13", aliases: [], sourcePages: [2], sourceFiles: [], verificationStatus: "verified" }],
  prices: [catalogPrice],
};
const publicCatalogItem = {
  category: "Vật tư", name: longName, variant: longSpec, specification: longSpec, productCode: "VT-13", aliases: [],
  packaging: catalogPrice.packageName, packageQuantity: 10, unit: "cái", priceId: 71, version: 7,
  priceType: "retail", minimumQuantity: 1, price: 15000,
};

async function mockStaff(page: Page) {
  await page.route("**/auth/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh", user: staffUser }) });
    if (pathname.endsWith("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staffUser) });
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/public/catalog")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [publicCatalogItem], syncedAt: catalog.syncedAt }) });
    if (pathname.endsWith("/catalog")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) });
    if (pathname.endsWith("/me")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: staffUser.id, role: "editor" }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" }, requestId: "layout-test" }) });
  });
}

async function expectInsideViewport(locator: ReturnType<Page["locator"]>, width: number) {
  const box = await locator.boundingBox();
  expect(box, "the target should have a rendered box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
}

test("storefront and staff search fit narrow, tablet, desktop, and 200% equivalent widths", async ({ page }, testInfo) => {
  await mockStaff(page);
  await page.goto("/staff");
  await page.locator("#email").fill(staffUser.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  for (const width of [320, 390, 768, 1440, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const staffSearch = page.locator("#product-search");
    await expect(staffSearch).toBeVisible();
    await expectInsideViewport(staffSearch, width);
    const staffProduct = page.locator(".pos-product-card").first();
    await expect(staffProduct).toContainText(longName);
    await expectInsideViewport(staffProduct, width);
    const staffLongText = staffProduct.locator("h3");
    expect(await staffLongText.evaluate(element => getComputedStyle(element).overflowWrap)).toMatch(/anywhere|break-word/);
    expect(await staffLongText.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await staffLongText.evaluate(element => element.clientWidth));
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`staff-${width}.png`), fullPage: true });
  }

  await page.goto("/shop");
  for (const width of [320, 390, 768, 1440, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const customerSearch = page.getByLabel("Tìm sản phẩm");
    await expect(customerSearch).toBeVisible();
    await expectInsideViewport(customerSearch, width);
    const customerName = page.getByRole("heading", { name: longName });
    await expect(customerName).toBeVisible();
    expect(await customerName.evaluate(element => getComputedStyle(element).overflowWrap)).toMatch(/anywhere|break-word/);
    await expectInsideViewport(customerName, width);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`shop-${width}.png`), fullPage: true });
  }
});

test("dark theme keeps the customer chat input and send action readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.goto("/shop");
  const input = page.locator("#price-question");
  await expect(input).toBeVisible();
  const colors = await input.evaluate(element => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    placeholder: getComputedStyle(element, "::placeholder").color,
  }));
  expect(colors.foreground).not.toBe(colors.background);
  expect(colors.placeholder).not.toBe(colors.background);
  await expect(page.getByRole("button", { name: "Gửi câu hỏi" })).toBeDisabled();
  await input.fill("Giá vít tole bao nhiêu?");
  await expect(page.getByRole("button", { name: "Gửi câu hỏi" })).toBeEnabled();
});

test("an unauthenticated visitor choosing staff is sent through the login gate", async ({ page }) => {
  await page.route("**/auth/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null, session: null }) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("heading", { name: "Đăng nhập nhân viên" })).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
});

test("staff catalog labels stay readable at normal desktop zoom", async ({ page }) => {
  await mockStaff(page);
  await page.goto("/staff");
  await page.locator("#email").fill(staffUser.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".pos-product-card").first()).toBeVisible();
  for (const selector of [".pos-eyebrow", ".pos-category-label", ".pos-product-price", ".pos-step-note"]) {
    const label = page.locator(selector).first();
    await expect(label).toBeVisible();
    expect(await label.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), selector).toBeGreaterThanOrEqual(14);
  }
  expect(await page.locator(".pos-product-heading h3").first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
});
