import { expect, test, type Page } from "@playwright/test";

const catalog = [{ category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", productCode: "VTK-420", aliases: [], packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "retail", minimumQuantity: 1, price: 15000 }];
type Submission = { customerName: string; phone: string; idempotencyKey: string; items: Array<{ priceId: number; version: number; quantity: number }> };

async function openStaffOrders(page: Page, failFirstSubmission = false, fromQuote = false) {
  const user = { id: "staff-orders-owner", aud: "authenticated", role: "authenticated", email: "orders@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };
  const submissions: Submission[] = [];
  let created = false;
  let status = "pending_confirmation";
  await page.route("**/auth/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/token")) return route.fulfill({ status: 200, json: { access_token: "staff-token", token_type: "bearer", expires_in: 3600, refresh_token: "staff-refresh", user } });
    if (path.endsWith("/user")) return route.fulfill({ status: 200, json: user });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/public/catalog") return route.fulfill({ json: { items: catalog, syncedAt: "2026-10-18T00:00:00Z" } });
    if (path === "/api/v1/catalog") return route.fulfill({ json: { entries: [{ categoryId: 1, productId: 1, variantId: 1, name: "Vít tự khoan", category: "Vít", spec: "4 x 20 mm", displayName: "Đầu dù 4x20", sourcePages: [], sourceFiles: [] }], prices: [{ id: 21, priceId: 21, categoryId: 1, productId: 1, variantId: 1, packagingId: 1, name: "Vít tự khoan", category: "Vít", variantDisplayName: "Đầu dù 4x20", spec: "4 x 20 mm", variantSpec: "4 x 20 mm", packageName: "Gói 100 cái", packageQuantity: 100, packageNote: "", priceType: "retail", minimumQuantity: 1, price: 15000, unit: "cái", supplier: "Sổ", sourcePages: [], sourceFiles: [], status: "verified", version: 3 }], syncedAt: "2026-10-18T00:00:00Z" } });
    if (path === "/api/v1/me") return route.fulfill({ json: { userId: user.id, role: "owner" } });
    if (path === "/api/v1/customer-order-requests" && route.request().method() === "POST") {
      submissions.push(route.request().postDataJSON() as Submission);
      if (failFirstSubmission && submissions.length === 1) return route.fulfill({ status: 503, json: { error: { code: "INTERNAL_ERROR", message: "temporary" }, requestId: "retry" } });
      created = true;
      return route.fulfill({ status: 201, json: { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "DH-STAFF-01", subtotal: 30000, itemCount: 1, status: "pending_confirmation" } });
    }
    if (path.endsWith("/status") && route.request().method() === "PATCH") {
      status = (route.request().postDataJSON() as { status: string }).status;
      return route.fulfill({ json: { updated: true } });
    }
    if (path === "/api/v1/customer-order-requests") return route.fulfill({ json: { requests: created ? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "DH-STAFF-01", status, customerName: "Khách tại quầy", phone: "0901234567", deliveryAddress: null, deliveryNotes: null, subtotal: 30000, createdAt: "2026-10-18T00:00:00Z", items: [{ productName: "Vít tự khoan", variantName: "Đầu dù 4x20", packaging: "Gói 100 cái", packageQuantity: 100, priceType: "retail", quantity: 2, unitPrice: 15000, lineTotal: 30000, unit: "cái" }] }] : [] } });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" }, requestId: "test" } });
  });
  await page.goto("/staff");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  if (fromQuote) {
    await page.locator(".pos-variant-chip").first().click();
    await page.getByLabel("Số lượng Gói 100 cái", { exact: true }).fill("2");
    await page.locator(".pos-detail-panel").getByRole("button", { name: "Thêm vào báo giá", exact: true }).click();
    await expect(page.locator(".pos-invoice-line")).toHaveCount(1);
    await page.keyboard.press("F4");
    await page.getByRole("button", { name: "Tạo đơn hàng", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Tạo đơn từ báo giá" });
    await expect(form).toContainText("Vít tự khoan");
    await expect(form.getByLabel("Mặt hàng", { exact: true })).toHaveCount(0);
    await expect(form.getByLabel("Số lượng Gói 100 cái Vít tự khoan trong giỏ, giá lẻ")).toHaveValue("2");
    await form.getByLabel("Tên khách hàng").fill("Khách tại quầy");
    await form.getByLabel("Số điện thoại").fill("0901234567");
    return { form, submissions };
  }
  await page.getByRole("button", { name: /Đơn khách/ }).first().click();
  await page.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Tạo đơn cho khách" });
  await form.getByLabel("Mặt hàng", { exact: true }).selectOption({ label: "Vít tự khoan" });
  await form.getByLabel("Quy cách", { exact: true }).selectOption({ label: "Đầu dù 4x20" });
  await form.getByLabel("Đóng gói và loại giá").selectOption("21");
  await form.getByRole("button", { name: "Thêm vào đơn" }).click();
  await form.getByLabel("Số lượng Gói 100 cái Vít tự khoan trong giỏ, giá lẻ").fill("2");
  await form.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await form.getByLabel("Tên khách hàng").fill("Khách tại quầy");
  await form.getByLabel("Số điện thoại").fill("0901234567");
  return { form, submissions };
}

test("staff creates an order from current catalog and confirms it in the inbox", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const { form, submissions } = await openStaffOrders(page);
  await expect(form.locator(":scope > div").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(form.getByLabel("Tên khách hàng")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(form.getByLabel("Tên khách hàng")).toHaveCSS("color", "rgb(17, 24, 39)");
  await form.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
  const inbox = page.getByRole("dialog", { name: "Yêu cầu đặt hàng" });
  await expect(inbox).toContainText("DH-STAFF-01");
  await expect(inbox).toContainText("Khách tại quầy");
  await expect(inbox.locator(":scope > div").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await inbox.getByRole("button", { name: "Xác nhận đơn", exact: true }).click();
  await expect(inbox.getByText("Đã xác nhận", { exact: true })).toBeVisible();
  expect(submissions).toEqual([{ customerName: "Khách tại quầy", phone: "0901234567", idempotencyKey: expect.any(String), items: [{ priceId: 21, version: 3, quantity: 2 }] }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("staff keeps the draft and idempotency key when retrying an uncertain submission", async ({ page }) => {
  const { form, submissions } = await openStaffOrders(page, true);
  await form.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
  await expect(form.getByText(/Chưa gửi được yêu cầu/)).toBeVisible();
  await expect(form.getByLabel("Tên khách hàng")).toHaveValue("Khách tại quầy");
  await form.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
  await expect(page.getByRole("dialog", { name: "Yêu cầu đặt hàng" })).toContainText("DH-STAFF-01");
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
});

test("staff places the selected quote directly without selecting products again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const { form, submissions } = await openStaffOrders(page, true, true);
  await expect(form.locator(":scope > div").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("F4");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await form.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
  await expect(form.getByText(/Chưa gửi được yêu cầu/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gia-chuan-invoice") ?? "[]").length)).toBe(1);
  await form.getByRole("button", { name: "Gửi yêu cầu đặt hàng" }).click();
  await expect(page.getByRole("dialog", { name: "Yêu cầu đặt hàng" })).toContainText("DH-STAFF-01");
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[1].items).toEqual([{ priceId: 21, version: 3, quantity: 2 }]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gia-chuan-invoice") ?? "[]").length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
