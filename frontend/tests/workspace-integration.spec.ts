import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.PRICEAPP_E2E_ENABLED === "true";
const ownerEmail = process.env.PRICEAPP_E2E_OWNER_EMAIL ?? "";
const ownerPassword = process.env.PRICEAPP_E2E_OWNER_PASSWORD ?? "";
const employeeEmail = process.env.PRICEAPP_E2E_EMPLOYEE_EMAIL ?? "";
const employeePassword = process.env.PRICEAPP_E2E_EMPLOYEE_PASSWORD ?? "";

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

async function loginOwner(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(ownerEmail);
  await page.locator("#password").fill(ownerPassword);
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
}

async function stubCatalog(page: Page) {
  await page.route(/\/api\/v1\/catalog$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(catalog),
  }));
}

async function chooseTestBolt(page: Page) {
  await page.locator("#product-search").fill("test bolt");
  await page.locator(".pos-variant-chip").filter({ hasText: "8ly 3f" }).click();
}

test.describe("isolated PriceApp integration", () => {
  test.skip(!enabled, "Set PRICEAPP_E2E_ENABLED and isolated test-project secrets to run authenticated E2E.");

  test("owner login restores the session and reaches owner-only RAG pages", async ({ page }) => {
    await loginOwner(page);
    await page.reload();
    await expect(page.locator("#product-search")).toBeVisible();

    const pagesResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/admin/rag/pages"));
    await page.goto("/rag-admin");
    expect((await pagesResponse).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("selected package count times the unchanged amount is quoted and copied", async ({ page }) => {
    await stubCatalog(page);
    await loginOwner(page);
    await chooseTestBolt(page);
    await page.locator("#retail-package-count").fill("2");
    await expect(page.locator("#retail-package-help")).toContainText("5.000");
    await page.locator(".pos-suggestion button").click();
    await expect(page.locator(".pos-invoice-total strong")).toContainText("5.000");
    await page.locator(".pos-open-invoice").click();
    await page.getByRole("button", { name: /Sao chép báo giá/i }).click();
    await expect(page.getByRole("status")).toBeVisible();
  });

  test("price version conflict is surfaced without changing the displayed price", async ({ page }) => {
    await stubCatalog(page);
    await page.route("**/api/v1/prices/77/update", (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "Price has changed" }, requestId: "req-e2e-conflict" }),
    }));
    await loginOwner(page);
    await chooseTestBolt(page);
    await page.locator(".pos-spec-banner button").click();
    const dialog = page.getByRole("dialog", { name: "Test Bolt" });
    const priceButton = dialog.getByRole("button", { name: "Sửa giá Test Bolt" });
    await priceButton.click();
    const input = dialog.getByRole("textbox", { name: "Giá mới của Test Bolt bằng VND" });
    await input.fill("9999");
    await input.press("Enter");
    await expect(page.locator(".pos-main > p[role=alert]")).toBeVisible();
    await expect(page.locator(".pos-price-amount")).toContainText("2.500");
  });

  test("offline price edits do not send a write request", async ({ page }) => {
    await stubCatalog(page);
    let writeRequests = 0;
    await page.route("**/api/v1/prices/**", async (route) => {
      if (route.request().method() !== "GET") writeRequests += 1;
      await route.continue();
    });
    await loginOwner(page);
    await chooseTestBolt(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    await page.locator(".pos-spec-banner button").click();
    const dialog = page.getByRole("dialog", { name: "Test Bolt" });
    const priceButton = dialog.getByRole("button", { name: "Sửa giá Test Bolt" });
    await priceButton.click();
    const input = dialog.getByRole("textbox", { name: "Giá mới của Test Bolt bằng VND" });
    await input.fill("9999");
    await input.press("Enter");
    await expect(page.locator(".pos-main > p[role=alert]")).toBeVisible();
    expect(writeRequests).toBe(0);
  });

  test("RAG question flow renders the API response", async ({ page }) => {
    await page.route("**/api/v1/rag/query", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer: "Câu trả lời kiểm thử có nguồn.", items: [], sources: [],
        retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "e2e-fixture" },
      }),
    }));
    await loginOwner(page);
    await page.goto("/questions");
    await page.locator("#price-question").fill("Test question");
    await page.getByRole("button", { name: "Hỏi giá" }).click();
    await expect(page.getByText("Câu trả lời kiểm thử có nguồn.")).toBeVisible();
  });

  test("employee can read catalog but is denied owner-only RAG administration", async ({ page }) => {
    test.skip(!employeeEmail || !employeePassword, "Configure the isolated employee test-account secrets for role-gate coverage.");
    await page.goto("/");
    await page.locator("#email").fill(employeeEmail);
    await page.locator("#password").fill(employeePassword);
    const catalogResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/catalog"));
    await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
    await expect(page.locator("#product-search")).toBeVisible();
    expect((await catalogResponse).status()).toBe(200);

    const adminResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/admin/rag/pages"));
    await page.goto("/rag-admin");
    expect((await adminResponse).status()).toBe(403);
    await expect(page.getByRole("alert")).toBeVisible();
  });
});
