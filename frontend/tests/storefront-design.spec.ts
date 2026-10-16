import { expect, test } from "@playwright/test";

test("catalog failure is distinct from an empty public catalog and retry recovers", async ({ page }, testInfo) => {
  let failing = true;
  await page.route("**/api/v1/public/catalog", route => route.fulfill({
    status: failing ? 503 : 200, contentType: "application/json",
    body: failing ? JSON.stringify({ error: { message: "Unavailable" } }) : JSON.stringify({ items: [], syncedAt: new Date().toISOString() }),
  }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Chưa đăng nhập", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("role-entry.png") });
  await page.getByRole("button", { name: /Khách hàng/ }).click();
  await expect(page.getByText("Chưa tải được bảng giá", { exact: true })).toBeVisible();
  await expect(page.getByText(/Chưa có mặt hàng công khai|0 mức giá|Giá đang áp dụng/)).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByText("Cửa hàng chưa công bố bảng giá", { exact: true })).toBeVisible();
});

test("shop layout keeps real units readable and the cart usable on narrow screens", async ({ page }, testInfo) => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    category: index < 6 ? "Vít & bu lông" : "Phụ kiện", name: index % 2 ? "Bu lông lục giác mạ kẽm" : "Vít tự khoan đầu dù",
    variant: `Quy cách ${index + 1} · 4 × 20 mm`, specification: "Thép mạ kẽm", packaging: "Gói 100 cái", packageQuantity: 100,
    unit: "cái", priceId: index + 1, version: 1, priceType: "retail", minimumQuantity: 1, price: 15000 + index * 1000,
  }));
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, syncedAt: new Date().toISOString() }) }));
  await page.goto("/");
  await page.getByRole("button", { name: /Khách hàng/ }).click();
  await expect(page.getByRole("heading", { name: "Tra giá và đặt hàng" })).toBeVisible();
  await expect(page.getByText("/ gói 100 cái").first()).toBeVisible();
  if (testInfo.project.name === "chromium") {
    for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`shop-${width}.png`) });
    }
  }
  await page.getByRole("button", { name: "Thêm giá lẻ" }).first().click();
  await page.reload();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("button", { name: "Giỏ hàng (1)", exact: true })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: /Xem giỏ/ }).click();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Xem giỏ/ })).toBeFocused();
    await page.getByRole("button", { name: /Xem giỏ/ }).click();
  }
  await expect(page.getByRole("button", { name: "Tiếp tục", exact: true })).toBeVisible();
  await expect(page.getByLabel("Tên khách hàng")).toHaveCount(0);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByLabel("Tên khách hàng")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const font = await page.locator("body").evaluate(el => getComputedStyle(el).fontFamily);
  expect(font).toContain("Segoe UI");
  await page.screenshot({ path: testInfo.outputPath("shop-checkout.png"), fullPage: testInfo.project.name !== "mobile" });
});
