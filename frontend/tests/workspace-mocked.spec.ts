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

async function mockApiAndAuth(page: Page, conflictWrite: () => void = () => undefined) {
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) {
      await fulfillment(route, 200, { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user });
    } else if (url.pathname.endsWith("/user")) {
      await fulfillment(route, 200, user);
    } else if (route.request().method() === "POST" && url.pathname.endsWith("/logout")) {
      await route.fulfill({ status: 204, body: "" });
    } else {
      await fulfillment(route, 404, { message: "No mocked auth route" });
    }
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/catalog") && request.method() === "GET") return fulfillment(route, 200, catalog);
    if (url.pathname.endsWith("/prices/77/update") && request.method() === "POST") {
      conflictWrite();
      return fulfillment(route, 409, { error: { code: "VERSION_CONFLICT", message: "Price has changed" }, requestId: "req-mocked-conflict" });
    }
    return fulfillment(route, 404, { error: { code: "NOT_FOUND", message: "Mocked route not configured" }, requestId: "req-mocked" });
  });
}

async function loginAndChooseBolt(page: Page) {
  await page.goto("/");
  await page.locator("#email").fill("owner@example.test");
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  await page.locator("#product-search").fill("test bolt");
  await page.locator(".pos-variant-chip").filter({ hasText: "8ly 3f" }).click();
}

test.describe("deterministic mocked sales workflow", () => {
  test("opens price detail, intercepts a conflict, and keeps the authoritative displayed price", async ({ page }) => {
    let writeRequests = 0;
    await mockApiAndAuth(page, () => { writeRequests += 1; });
    await loginAndChooseBolt(page);
    await page.locator(".pos-spec-banner button").click();
    const dialog = page.getByRole("dialog", { name: "Test Bolt" });
    await dialog.getByRole("button", { name: "Sửa giá Test Bolt" }).click();
    const input = dialog.locator("input.mt-3");
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
    const input = dialog.locator("input.mt-3");
    await input.fill("9999");
    await input.press("Enter");
    await expect(page.locator(".pos-main > p[role=alert]")).toContainText("ngoại tuyến");
    expect(writeRequests).toBe(0);
  });
});
