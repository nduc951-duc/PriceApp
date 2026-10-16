import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "e2e-mocked-owner",
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00.000Z",
};
const catalog = {
  syncedAt: "2026-01-01T00:00:00.000Z",
  entries: [{ categoryId: 1, productId: 2, variantId: 3, name: "Test Bolt", category: "Test", spec: "8ly 3f", displayName: "Test Bolt 8ly 3f", sourcePages: [], sourceFiles: [] }],
  prices: [{
    id: 77, priceId: 77, categoryId: 1, productId: 2, variantId: 3, packagingId: 4,
    name: "Test Bolt", category: "Test", variantDisplayName: "Test Bolt 8ly 3f", spec: "8ly 3f",
    variantSpec: "8ly 3f", packageName: "Gói", packageQuantity: 1, packageNote: "",
    priceType: "retail", minimumQuantity: 1, price: 2500, unit: "cái", supplier: "Test supplier",
    sourcePages: [], sourceFiles: [], status: "verified", version: 1,
  }],
};

async function fulfillment(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApiAndAuth(
  page: Page,
  conflictWrite: () => void = () => undefined,
  catalogResponse: typeof catalog | ((catalogRead: number) => typeof catalog) = catalog,
  userForEmail: (email: string) => typeof user = () => user,
  logoutResponseStatus = 204,
) {
  let activeUser: typeof user | null = null;
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) {
      const email = (route.request().postDataJSON() as { email?: string } | null)?.email ?? user.email;
      activeUser = userForEmail(email);
      await fulfillment(route, 200, { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user: activeUser });
    } else if (url.pathname.endsWith("/user")) {
      await fulfillment(route, 200, activeUser ?? user);
    } else if (route.request().method() === "POST" && url.pathname.endsWith("/logout")) {
      activeUser = null;
      await route.fulfill({ status: logoutResponseStatus, body: logoutResponseStatus === 204 ? "" : JSON.stringify({ message: "temporary revocation failure" }) });
    } else {
      await fulfillment(route, 404, { message: "No mocked auth route" });
    }
  });
  let catalogReads = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/catalog") && request.method() === "GET") {
      const response = typeof catalogResponse === "function" ? catalogResponse(++catalogReads) : catalogResponse;
      return fulfillment(route, 200, response);
    }
    if (url.pathname.endsWith("/prices/77/update") && request.method() === "POST") {
      conflictWrite();
      return fulfillment(route, 409, { error: { code: "VERSION_CONFLICT", message: "Price has changed" }, requestId: "req-mocked-conflict" });
    }
    return fulfillment(route, 404, { error: { code: "NOT_FOUND", message: "Mocked route not configured" }, requestId: "req-mocked" });
  });
}

async function loginAndChooseBolt(page: Page, email = "owner@example.test") {
  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  await page.locator("#product-search").fill("test bolt");
  await page.locator(".pos-variant-chip").filter({ hasText: "8ly 3f" }).click();
}

test.describe("deterministic mocked sales workflow", () => {
  test("keeps the logout control from overlapping the quote control in the header", async ({ page }, testInfo) => {
    await mockApiAndAuth(page);
    await loginAndChooseBolt(page);

    const quoteBox = await page.locator(".pos-invoice-button").boundingBox();
    const logoutBox = await page.getByRole("button", { name: "Đăng xuất" }).boundingBox();
    expect(quoteBox).not.toBeNull();
    expect(logoutBox).not.toBeNull();
    const separated = quoteBox!.x + quoteBox!.width <= logoutBox!.x ||
      logoutBox!.x + logoutBox!.width <= quoteBox!.x ||
      quoteBox!.y + quoteBox!.height <= logoutBox!.y ||
      logoutBox!.y + logoutBox!.height <= quoteBox!.y;
    expect(separated).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("staff-workspace.png"), fullPage: true });
  });

  test("labels the draft consistently as a quote because the app does not process payments", async ({ page }) => {
    await mockApiAndAuth(page);
    await loginAndChooseBolt(page);

    await expect(page.getByRole("heading", { name: "Báo giá quầy" })).toBeVisible();
    await page.locator(".pos-open-invoice").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Báo giá tạm tính")).toBeVisible();
    await expect(dialog).not.toContainText("hóa đơn");
  });

  test("invoice dialog traps keyboard focus and closes on Escape", async ({ page }) => {
    await mockApiAndAuth(page);
    await loginAndChooseBolt(page);
    const opener = page.locator(".pos-open-invoice");
    await opener.focus();
    await opener.press("Enter");

    const dialog = page.getByRole("dialog", { name: /\d+ sản phẩm/ });
    const close = dialog.getByRole("button", { name: "Đóng báo giá" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Thêm sản phẩm khác" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("nested catalog editor hides its detail dialog and restores focus when closed", async ({ page }) => {
    await mockApiAndAuth(page);
    await loginAndChooseBolt(page);
    await page.locator(".pos-spec-banner button").click();
    const details = page.getByRole("dialog", { name: "Test Bolt" });
    const opener = details.getByRole("button", { name: "Sửa giá & thông tin" }).first();
    await opener.click();

    const editor = page.getByRole("dialog", { name: "Sửa giá & thông tin" });
    await expect(editor).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Test Bolt" })).toBeVisible();
    await expect(opener).toBeFocused();
  });

  test("cold offline reload restores the cached POS shell and read-only catalog", async ({ page }) => {
    await mockApiAndAuth(page);
    await loginAndChooseBolt(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find((name) => name === "gia-chuan-static-v7") ?? "missing");
      const keys = await cache.keys();
      return keys.some((key) => new URL(key.url).pathname === "/staff") &&
        keys.some((key) => new URL(key.url).pathname.startsWith("/_next/static/"));
    });

    await page.unroute("**/api/v1/**");
    await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, value: false }));
    await page.context().setOffline(true);
    await page.reload();

    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.locator("#product-search")).toBeVisible();
    await expect(page.locator(".pos-live-badge")).toContainText("BẢN LƯU");
    await page.locator("#product-search").fill("test bolt");
    await page.locator(".pos-variant-chip").filter({ hasText: "8ly 3f" }).click();
    await page.locator(".pos-spec-banner button").click();
    await expect(page.getByRole("dialog", { name: "Test Bolt" })).toBeVisible();
  });

  test("does not restore the previous account's invoice after successful logout", async ({ page }) => {
    await mockApiAndAuth(page, undefined, catalog, (email) => ({
      ...user,
      id: email === "first@example.test" ? "e2e-account-one" : "e2e-account-two",
      email,
    }));

    await loginAndChooseBolt(page, "first@example.test");
    await page.locator("#retail-package-count").fill("1");
    await page.getByRole("button", { name: /Thêm mức giá gợi ý vào báo giá/ }).click();
    await expect(page.locator(".pos-invoice-lines")).toContainText("Test Bolt");

    const logoutResponse = page.waitForResponse((response) => response.url().includes("/auth/v1/logout"));
    await page.getByRole("button", { name: "Đăng xuất" }).click();
    expect((await logoutResponse).status()).toBe(204);
    await expect(page.locator("#email")).toBeVisible();
    await loginAndChooseBolt(page, "second@example.test");

    await expect(page.locator(".pos-invoice-empty")).toBeVisible();
  });

  test("clears the previous account invoice when server logout revocation fails", async ({ page }) => {
    await mockApiAndAuth(page, undefined, catalog, (email) => ({
      ...user,
      id: email === "first@example.test" ? "e2e-account-one" : "e2e-account-two",
      email,
    }), 500);

    await loginAndChooseBolt(page, "first@example.test");
    await page.locator("#retail-package-count").fill("1");
    await page.getByRole("button", { name: /Thêm mức giá gợi ý vào báo giá/ }).click();
    await expect(page.locator(".pos-invoice-lines")).toContainText("Test Bolt");

    await page.getByRole("button", { name: "Đăng xuất" }).click();
    await expect(page.locator("#email")).toBeVisible();
    await loginAndChooseBolt(page, "second@example.test");

    await expect(page.locator(".pos-invoice-empty")).toBeVisible();
  });

  test("opens price detail, intercepts a conflict, and keeps the authoritative displayed price", async ({ page }) => {
    let writeRequests = 0;
    await mockApiAndAuth(page, () => { writeRequests += 1; });
    await loginAndChooseBolt(page);
    await page.locator(".pos-spec-banner button").click();
    const dialog = page.getByRole("dialog", { name: "Test Bolt" });
    await dialog.getByRole("button", { name: "Sửa giá Test Bolt" }).click();
    const input = dialog.getByRole("textbox", { name: "Giá mới của Test Bolt bằng VND" });
    await input.fill("9999");
    await input.press("Enter");
    await expect(page.locator(".pos-main > p[role=alert]")).toBeVisible();
    await expect(page.locator(".pos-price-amount")).toContainText("2.500");
    expect(writeRequests).toBe(1);
  });

  test("offline editing is rejected before any price write request is sent", async ({ page }) => {
    let writeRequests = 0;
    await mockApiAndAuth(page, () => { writeRequests += 1; });
    await loginAndChooseBolt(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    await page.locator(".pos-spec-banner button").click();
    const dialog = page.getByRole("dialog", { name: "Test Bolt" });
    await dialog.getByRole("button", { name: "Sửa giá Test Bolt" }).click();
    const input = dialog.getByRole("textbox", { name: "Giá mới của Test Bolt bằng VND" });
    await input.fill("9999");
    await input.press("Enter");
    await expect(page.locator(".pos-main > p[role=alert]")).toContainText("ngoại tuyến");
    expect(writeRequests).toBe(0);
  });

  test("unreviewed prices cannot be recommended or added to the invoice", async ({ page }) => {
    const unreviewedCatalog = {
      ...catalog,
      prices: catalog.prices.map((price) => ({ ...price, status: "needs_review" })),
    };
    await mockApiAndAuth(page, () => undefined, unreviewedCatalog);
    await loginAndChooseBolt(page);
    await page.locator("#retail-package-count").fill("1");

    await expect(page.getByRole("button", { name: "Thêm mức giá gợi ý vào báo giá" })).toBeDisabled();
    await expect(page.locator(".pos-price-card-footer button")).toBeDisabled();
    await expect(page.locator(".pos-invoice-total strong")).toHaveText(/^0/);
    await expect(page.locator(".pos-product-price")).toHaveText("Chưa có giá");
    await expect(page.locator(".pos-product-price")).not.toContainText("2.500");
  });

  test("an invoice line whose current price is unreviewed cannot remain active or be copied", async ({ page }) => {
    const unreviewedCatalog = {
      ...catalog,
      prices: catalog.prices.map((price) => ({ ...price, status: "needs_review" })),
    };
    const savedLine = {
      key: "77",
      item: catalog.prices[0],
      requestedQuantity: 1,
      packageCount: 1,
      unitPrice: 2500,
      total: 2500,
    };
    await page.addInitScript((line) => {
      localStorage.setItem("gia-chuan-invoice", JSON.stringify([line]));
    }, savedLine);
    await mockApiAndAuth(page, () => undefined, unreviewedCatalog);
    await loginAndChooseBolt(page);

    await expect(page.locator(".pos-invoice-total strong")).toHaveText(/^0/);
    await page.locator(".pos-open-invoice").click();
    await expect(page.getByRole("button", { name: "Sao chép báo giá", exact: true })).toBeDisabled();
  });

  test("copying rechecks verification status against the current catalog", async ({ page }) => {
    const unreviewedCatalog = {
      ...catalog,
      prices: catalog.prices.map((price) => ({ ...price, status: "needs_review" })),
    };
    const savedLine = {
      key: "77",
      item: catalog.prices[0],
      requestedQuantity: 1,
      packageCount: 1,
      unitPrice: 2500,
      total: 2500,
    };
    await page.addInitScript((line) => {
      localStorage.setItem("gia-chuan-invoice", JSON.stringify([line]));
    }, savedLine);
    await mockApiAndAuth(page, () => undefined, (catalogRead) => catalogRead === 1 ? catalog : unreviewedCatalog);
    await loginAndChooseBolt(page);
    await expect(page.locator(".pos-invoice-total strong")).toHaveText(/^2\.500/);
    await page.locator(".pos-open-invoice").click();
    await page.getByRole("button", { name: "Sao chép báo giá", exact: true }).click();

    await expect(page.getByRole("status")).toContainText("chưa được duyệt");
  });
});
