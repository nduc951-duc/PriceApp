import { expect, test } from "@playwright/test";

const user = { id: "catalog-owner", aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };

test("catalog RAG administration has no OCR and exposes active coverage and pending revisions", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const obsoleteRequests: string[] = [];
  await page.route("**/auth/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/token") ? { access_token: "mock-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh", user } : user;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (/\/admin\/rag\/(?:ocr|pages|preview)$/.test(path)) obsoleteRequests.push(path);
    const body = path.endsWith("/me") ? { userId: user.id, role: "owner" }
      : path.endsWith("/catalog") ? { entries: [], prices: [], syncedAt: new Date().toISOString() }
      : path.endsWith("/index-job") ? { job: { status: "queued", requestedRevision: 7, completedRevision: 6, attempts: 0, maxAttempts: 5, availableAt: new Date().toISOString(), lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date().toISOString() } }
      : path.endsWith("/index") ? { run: { runId: 4, status: "completed", checkpoint: 8, chunks: 8, indexed: 8, reused: 0, removed: 0, embeddingModel: "bge-m3", contentHash: "abc" } }
      : path.endsWith("/feedback") ? { total: 0, helpful: 0, notHelpful: 0, reasons: [], truncated: false }
      : path.endsWith("/health") ? { ok: false, provider: "ollama", database: { ok: true, detail: "catalog", count: 8, catalogVariants: 10, embeddedVariants: 8, missingVariants: 2, activeGeneration: 4 }, embedding: { ok: true, detail: "Embedding hoạt động.", dimensions: 1024, model: "bge-m3", fingerprint: "0123456789abcdef" }, chat: { ok: false, detail: "Chat offline" } } : {};
    await route.fulfill({ status: path.endsWith("/health") ? 503 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/rag-admin");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.getByRole("heading", { name: "RAG từ danh mục Supabase" })).toBeVisible();
  const sourceText = page.getByText(/Sản phẩm, biến thể, thuộc tính/);
  await expect(sourceText).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(sourceText.locator("xpath=../..")).toHaveClass(/dark:bg-slate-800/);
  await expect(page.getByRole("button", { name: /OCR|Quét|Duyệt bản chép/i })).toHaveCount(0);
  await expect(page.getByText(/Danh mục đã thay đổi/)).toBeVisible();
  await page.getByRole("button", { name: "Kiểm tra kết nối và dữ liệu" }).click();
  await expect(page.getByText("2 biến thể chưa có vector với model hiện tại")).toBeVisible();
  await expect(page.getByText(/Chat chưa sẵn sàng/)).toBeVisible();
  expect(obsoleteRequests).toEqual([]);
  const width = page.viewportSize()!.width;
  expect(await page.locator("body").evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(width + 1);
  await page.screenshot({ path: test.info().outputPath("catalog-rag-admin.png"), fullPage: true });
});

test("a guest sees a single specification answer even when it has no price or embedding", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "answered", answer: "Tắc kê sắt — quy cách: 8x60. Đóng gói: Bịch: 10 cái. Nguồn: Supabase · product_variants #55.",
    items: [{ id: 55, productName: "Tắc kê sắt", variant: "8x60", category: "Tắc kê", verificationStatus: "verified", sourcePages: [], prices: [] }], sources: [],
    retrieval: { vectorChunks: 0, lexicalProducts: 1, embeddingModel: "not_used" },
  }) }));
  await page.goto("/shop");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Quy cách tắc kê sắt 8x60");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByText(/Đóng gói: Bịch: 10 cái/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm vào đơn" })).toHaveCount(0);
});
