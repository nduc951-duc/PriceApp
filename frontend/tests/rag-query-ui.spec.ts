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
  expect(submittedQuestion).toBe("Giá lẻ bulong có tán 10 ly x 1T là bao nhiêu?");
  await expect(page.locator("body")).toContainText("34.000");
  await expect(page.locator("body")).toContainText("34.000 ₫ / 10 bộ/bịch");
  await expect(page.getByRole("link", { name: "Trang 5" })).toBeVisible();
});
