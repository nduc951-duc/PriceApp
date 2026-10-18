import { expect, test, type Route } from "@playwright/test";

const user = {
  id: "rag-ui-test-user",
  aud: "authenticated",
  role: "authenticated",
  email: "rag-ui@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

const answer = {
  status: "answered",
  answer: "Giá lẻ bulong có tán 10 ly x 1T là 34.000 đồng cho bịch 10 bộ.",
  items: [{
    id: 6,
    productName: "Bulong có tán",
    category: "Bu lông",
    variant: "10 ly x 1T",
    verificationStatus: "verified",
    sourcePages: [5],
    prices: [{
      id: 2,
      packagingId: 10,
      version: 1,
      amount: 34000,
      priceType: "retail",
      packagingName: "10 bộ/bịch",
      packageQuantity: 10,
      unit: "bộ",
      packageNote: "",
      minimumQuantity: 1,
      priceList: "Nhập từ Trang 1-13",
      supplier: "Sổ giá viết tay",
      verificationStatus: "verified",
    }],
  }],
  sources: [{
    pageNumber: 5,
    chunkId: 1,
    chunkKey: "page:5:variant:6:0",
    sourceRevision: null,
    sourceSpan: null,
    excerpt: "Bulong có tán 10 ly x 1T",
    evidenceKind: "verified_catalog",
    verifiedVariantId: 6,
    verifiedPriceId: 2,
  }],
  retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" },
  conversationId: "rag-ui-test-conversation",
  feedbackMessageId: "7b13a427-85b6-49c4-b3b9-3e20dab29d44",
};

async function fulfill(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("asking the AI submits the question and renders its cited price", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/auth/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/token")) {
      return fulfill(route, 200, {
        access_token: "mock-access-token", token_type: "bearer", expires_in: 3600,
        refresh_token: "mock-refresh-token", user,
      });
    }
    if (pathname.endsWith("/user")) return fulfill(route, 200, user);
    await route.fulfill({ status: 204, body: "" });
  });

  let submittedQuestion = "";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/catalog") && request.method() === "GET") {
      return fulfill(route, 200, { syncedAt: new Date().toISOString(), entries: [], prices: [] });
    }
    if (pathname.endsWith("/rag/conversations") && request.method() === "POST") {
      return fulfill(route, 201, { id: answer.conversationId });
    }
    if (pathname.endsWith("/rag/query") && request.method() === "POST") {
      submittedQuestion = (request.postDataJSON() as { question: string }).question;
      return fulfill(route, 200, answer);
    }
    return fulfill(route, 404, { error: { code: "NOT_FOUND", message: "Not found" }, requestId: "rag-ui-test" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();

  await page.goto("/questions");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Giá lẻ bulong có tán 10 ly x 1T là bao nhiêu?");
  const queryResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/rag/query") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await queryResponse;

  await expect(page.getByText(answer.answer, { exact: true })).toBeVisible();
  await expect(page.getByText(answer.answer, { exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByText(answer.answer, { exact: true }).locator("xpath=../..")).toHaveClass(/bg-slate-800/);
  expect(submittedQuestion).toBe("Giá lẻ bulong có tán 10 ly x 1T là bao nhiêu?");
  await expect(page.locator("body")).toContainText("34.000");
  await expect(page.locator("body")).toContainText("34.000 ₫ / 10 bộ/bịch");
  await expect(page.getByRole("link", { name: "Trang 5" })).toBeVisible();
  await page.getByText("Đoạn catalog đã truy xuất (1)", { exact: true }).click();
  await expect(page.locator("details").filter({ hasText: "Đoạn catalog đã truy xuất" })).not.toContainText("undefined");
  await expect(page.getByRole("link", { name: "Chọn mức này" })).toHaveAttribute("href", "/staff?variantId=6&priceId=2&priceVersion=1");
});

test("staff variant listing shows all specifications and only priced variants can be selected", async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/token")) return fulfill(route, 200, { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user });
    if (pathname.endsWith("/user")) return fulfill(route, 200, user);
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/catalog") && request.method() === "GET") return fulfill(route, 200, { syncedAt: new Date().toISOString(), entries: [], prices: [] });
    if (pathname.endsWith("/rag/conversations") && request.method() === "POST") return fulfill(route, 201, { id: "variant-listing-conversation" });
    if (pathname.endsWith("/rag/query") && request.method() === "POST") return fulfill(route, 200, {
      status: "answered", answer: "Tắc kê đạn có 2 quy cách đã xác minh.",
      items: [
        { id: 1, productName: "Tắc kê đạn", category: "Tắc kê", variant: "6x50", verificationStatus: "verified", sourcePages: [2], prices: [{ id: 301, packagingId: 31, version: 2, amount: 34000, priceType: "retail", minimumQuantity: 1, packagingName: "Bịch 10 cái", packageQuantity: 10, unit: "cái", packageNote: "", priceList: "Sổ hiện hành", supplier: "Cửa hàng", verificationStatus: "verified" }] },
        { id: 2, productName: "Tắc kê đạn", category: "Tắc kê", variant: "8x60", verificationStatus: "verified", sourcePages: [3], prices: [] },
      ],
      sources: [], retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" }, conversationId: "variant-listing-conversation", feedbackMessageId: "variant-listing-message",
    });
    return fulfill(route, 404, { error: { code: "NOT_FOUND", message: "Not found" }, requestId: "variant-listing-test" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Nhân viên" }).click();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  await page.goto("/questions");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Cửa hàng có bao nhiêu loại tắc kê đạn?");
  await page.getByLabel("Câu hỏi cho trợ lý AI").press("Enter");

  await expect(page.getByRole("heading", { name: "Tắc kê đạn · 6x50" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê đạn · 8x60" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chọn mức này" })).toHaveCount(1);
  await expect(page.locator('a[href="/staff?variantId=1&priceId=301&priceVersion=2"]')).toBeVisible();
  await expect(page.getByText("Không có mức giá phù hợp với câu hỏi này.")).toBeVisible();
});
