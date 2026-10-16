import { expect, test, type Page } from "@playwright/test";

const prices = [
  { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "retail", minimumQuantity: 1, price: 15000 },
  { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 22, version: 3, priceType: "wholesale", minimumQuantity: 5, price: 12000 },
];

async function mockGuestApi(page: Page) {
  let submitted: unknown;
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: prices, syncedAt: "2026-10-16T00:00:00Z" }) }));
  await page.route("**/api/v1/public/order-requests", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "DH-1234ABCD", subtotal: 30000, itemCount: 1, status: "pending_confirmation" }) });
  });
  return () => submitted;
}

test.describe("public customer ordering", () => {
  test("freezes a submitted basket and clears its draft only after server confirmation", async ({ page }, testInfo) => {
    let finishSubmission: (() => void) | undefined;
    await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: prices, syncedAt: new Date().toISOString() }) }));
    await page.route("**/api/v1/public/order-requests", async route => {
      await new Promise<void>(resolve => { finishSubmission = resolve; });
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "DH-1234ABCD", subtotal: 15000, itemCount: 1, status: "pending_confirmation" }) });
    });
    await page.goto("/shop");
    await page.getByRole("button", { name: "Thêm giá lẻ" }).click();
    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: /Xem giỏ/ }).click();
    await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await page.getByLabel("Tên khách hàng").fill("Lan Nguyễn");
    await page.getByLabel("Số điện thoại").fill("0901234567");
    await page.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
    await expect.poll(() => Boolean(finishSubmission)).toBe(true);
    if (testInfo.project.name === "chromium") await expect(page.getByRole("button", { name: "Thêm giá lẻ" })).toBeDisabled();
    finishSubmission?.();
    await expect(page.getByRole("heading", { name: "Đã gửi yêu cầu" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Giỏ hàng (0)", exact: true })).toBeVisible();
  });

  test("lets a guest browse both published tiers, estimate a basket and submit a call-back request", async ({ page }, testInfo) => {
    const getSubmitted = await mockGuestApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Khách hàng" }).click();
    await expect(page.getByRole("heading", { name: "Tra giá và đặt hàng" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel("Tìm sản phẩm").fill("vít tự khoan");
    await page.getByRole("button", { name: "Thêm giá lẻ" }).click();
    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: /Xem giỏ/ }).click();
    await page.getByLabel("Số lượng gói Vít tự khoan trong giỏ, giá lẻ").fill("2");
    await expect(page.getByText(/Chưa gồm phí giao hàng/)).toBeVisible();
    await expect(page.getByText("15.000 ₫").first()).toBeVisible();
    await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await page.getByLabel("Tên khách hàng").fill("Lan Nguyễn");
    await page.getByLabel("Số điện thoại").fill("0901234567");
    await page.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
    await expect(page.getByRole("heading", { name: "Đã gửi yêu cầu" })).toBeVisible();
    await expect(page.getByText("DH-1234ABCD")).toBeVisible();
    await expect(page.getByText(/Chưa thu tiền và chưa chốt phí giao hàng/)).toBeVisible();
    expect(getSubmitted()).toMatchObject({ customerName: "Lan Nguyễn", phone: "0901234567", items: [{ priceId: 21, version: 3, quantity: 2 }] });
  });

  test("keeps employee mode behind the existing login screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Nhân viên" }).click();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#product-search")).toHaveCount(0);
  });

  test("lets an authenticated employee see a customer request and mark it contacted", async ({ page }) => {
    const user = { id: "shop-owner", aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };
    let activeUser: typeof user | null = null;
    let updatedStatus = "";
    await page.route("**/auth/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/token")) {
        activeUser = user;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "staff-token", token_type: "bearer", expires_in: 3600, refresh_token: "staff-refresh", user }) });
      } else if (url.pathname.endsWith("/user")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(activeUser ?? user) });
      else await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/catalog")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [], prices: [], syncedAt: "now" }) });
      if (url.pathname.endsWith("/customer-order-requests") && route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "DH-1234ABCD", status: "pending_confirmation", customerName: "Lan Nguyễn", phone: "0901234567", deliveryAddress: null, deliveryNotes: null, subtotal: 30000, createdAt: "2026-10-16T00:00:00Z", items: [{ productName: "Vít tự khoan", variantName: "Đầu dù 4x20", packaging: "Gói 100 cái", priceType: "retail", quantity: 2, unitPrice: 15000, lineTotal: 30000, unit: "cái" }] }] }) });
      if (url.pathname.endsWith("/status") && route.request().method() === "PATCH") {
        updatedStatus = (route.request().postDataJSON() as { status: string }).status;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: true }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" }, requestId: "test" }) });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Nhân viên" }).click();
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill("mock-password");
    await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
    await expect(page.locator("#product-search")).toBeVisible();
    await page.getByRole("button", { name: /Đơn khách/ }).first().click();
    await expect(page.getByRole("dialog", { name: "Yêu cầu đặt hàng" })).toContainText("0901234567");
    await page.getByRole("button", { name: "Đã gọi khách" }).click();
    await expect(page.getByText("Đã liên hệ")).toBeVisible();
    expect(updatedStatus).toBe("contacted");
  });
});
