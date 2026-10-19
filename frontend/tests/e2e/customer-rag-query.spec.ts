import { expect, test } from "@playwright/test";

const price = {
  id: 149, packagingId: 1, version: 1, amount: 80000, isDemo: false, purchasable: true, priceType: "retail",
  minimumQuantity: 1, packagingName: "1 bánh/cái", packageQuantity: 1, unit: "bánh",
  packageNote: "", priceList: "Sổ giá viết tay", supplier: "Nhập từ Trang 1-13", verificationStatus: "verified",
};

test("RAG shows generated prices normally and offers the order action", async ({ page }) => {
  const generatedPrice = { ...price, amount: 50000, isDemo: true, purchasable: true, priceList: null, supplier: null };
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ json: { items: [], syncedAt: new Date().toISOString() } }));
  await page.route("**/api/v1/public/rag/query", route => route.fulfill({ json: {
    status: "answered",
    answer: "Bolt - M6: 50,000 VND per box.",
    items: [{ id: 686, productName: "Bolt", category: "Test", variant: "M6", verificationStatus: "verified", sourcePages: [], prices: [generatedPrice] }],
    sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 1, embeddingModel: "bge-m3" },
  } }));
  await page.goto("/shop");
  await page.locator("#price-question").fill("Bolt M6 price?");
  await page.locator("#price-question").locator("xpath=ancestor::form").getByRole("button").click();
  await expect(page.getByRole("heading", { name: /Bolt/ })).toBeVisible();
  await expect(page.getByText(/demo|fake|simulation/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Th/ })).toBeVisible();
});

test("a guest can ask RAG for a price, see its source, and add the chosen price to the order", async ({ page }) => {
  const publicCatalog = [{
    category: "Bánh xe", name: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", specification: "Đỏ mận khóa ĐL 1T",
    packaging: "1 bánh/cái", packageQuantity: 1, unit: "bánh", priceId: price.id, version: price.version,
    priceType: "retail", minimumQuantity: 1, price: price.amount, isDemo: false, purchasable: true,
  }];
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: publicCatalog, syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    if ((route.request().postDataJSON() as { question: string }).question.toLowerCase().includes("pizza")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        status: "insufficient_evidence", answer: "Mình chưa tìm thấy dữ liệu giá phù hợp.", items: [], sources: [],
        retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "bge-m3" },
      }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        status: "answered",
        answer: "Bánh xe — Đỏ mận khóa ĐL 1T: Giá lẻ 80.000 ₫ / 1 bánh/cái. Nguồn: Sổ giá viết tay · trang 11.",
        items: [{ id: 686, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", verificationStatus: "verified", sourcePages: [11], prices: [price] }],
        sources: [{ pageNumber: 11, chunkId: 1, chunkKey: "page:11:variant:686:0", sourceRevision: null, sourceSpan: null, excerpt: "Bánh xe Đỏ mận khóa ĐL 1T", evidenceKind: "verified_catalog", verifiedVariantId: 686 }],
        retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" },
      }),
    });
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/shop");
  await expect(page.getByRole("heading", { name: "Hỏi đáp với AI" })).toBeVisible();
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Giá bánh xe đỏ mận khóa ĐL 1T bao nhiêu?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();

  await expect(page.getByRole("heading", { name: "Bánh xe · Đỏ mận khóa ĐL 1T" })).toBeVisible();
  await expect(page.getByLabel("Hỏi đáp với AI").getByText("80.000 ₫ / 1 bánh/cái")).toBeVisible();
  await expect(page.locator("#price-question")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const questionColor = await page.locator("#price-question").evaluate((element) => getComputedStyle(element).color);
  expect(questionColor).not.toBe("rgb(255, 255, 255)");
  await expect(page.getByText("Nguồn sổ: Trang 11")).toBeVisible();
  await page.getByRole("button", { name: "Thêm vào đơn" }).click();
  await expect(page.getByRole("button", { name: "Giỏ hàng (1)", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Giỏ hàng" })).toBeHidden();

  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Giá pizza Hawaii size L là bao nhiêu?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByText("Mình chưa tìm thấy dữ liệu giá phù hợp.")).toBeVisible();
  await expect(page.getByLabel("Hỏi đáp với AI").getByRole("heading", { name: "Bánh xe · Đỏ mận khóa ĐL 1T" })).toHaveCount(0);
});

test("Alt+Enter inserts a line break and Enter sends the customer question", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }),
  }));

  let submittedQuestion = "";
  await page.route("**/api/v1/public/rag/query", async (route) => {
    submittedQuestion = (route.request().postDataJSON() as { question: string }).question;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      status: "insufficient_evidence",
      answer: "Mình chưa tìm thấy dữ liệu giá phù hợp.",
      items: [],
      sources: [],
      retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "bge-m3" },
    }) });
  });

  await page.goto("/shop");
  const question = page.getByLabel("Câu hỏi cho trợ lý AI");
  await question.fill("Giá vít tole");
  await question.press("Alt+Enter");
  await expect(question).toHaveValue("Giá vít tole\n");
  expect(submittedQuestion).toBe("");

  await question.fill("Giá vít tole\ntrang 11");
  await question.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  expect(submittedQuestion).toBe("");
  await expect(question).toHaveValue("Giá vít tole\ntrang 11");
  const queryResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/public/rag/query") && response.request().method() === "POST");
  await question.press("Enter");
  await queryResponse;
  expect(submittedQuestion).toBe("Giá vít tole\ntrang 11");
});

test("customer catalog search is accent-insensitive and independent from AI answers", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [
    { category: "Bánh xe", name: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", specification: "Đỏ mận khóa ĐL 1T", productCode: "BX-1T", aliases: ["Bánh xe đỏ mận"], packaging: "1 bánh/cái", packageQuantity: 1, unit: "bánh", priceId: 149, version: 1, priceType: "retail", minimumQuantity: 1, price: 80000, isDemo: false, purchasable: true},
    { category: "Tắc kê", name: "Tắc kê sắt", variant: "6x50", specification: "6x50", productCode: "TK-650", aliases: ["Tắc kê đạn"], packaging: "Bịch 10 cái", packageQuantity: 10, unit: "cái", priceId: 150, version: 1, priceType: "retail", minimumQuantity: 1, price: 40000, isDemo: false, purchasable: true},
  ], syncedAt: new Date().toISOString() }) }));
  let answerCount = 0;
  await page.route("**/api/v1/public/rag/query", async (route) => {
    answerCount++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      status: "answered", answer: "Thông tin về vít tole nằm ở trang 11.", items: [],
      sources: [{ pageNumber: 11, chunkId: 4, chunkKey: "page:11:4", sourceRevision: 1, sourceSpan: { start: 0, end: 20 }, excerpt: "Vít tole: thông tin trong sổ giá.", evidenceKind: "document" }],
      retrieval: { vectorChunks: 1, lexicalProducts: 0, embeddingModel: "bge-m3" },
    }) });
  });

  await page.goto("/shop");
  const productSearch = page.getByLabel("Tìm sản phẩm");
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toBeVisible();
  await page.getByLabel("Lọc theo nhóm hàng").selectOption({ label: "Bánh xe" });
  await productSearch.fill("do man khoa dl 1t");
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toHaveCount(0);
  expect(answerCount).toBe(0);
  await productSearch.fill("khong co mat hang nay");
  await expect(page.getByRole("heading", { name: "Không tìm thấy mặt hàng" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toHaveCount(0);
  await productSearch.fill("");
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toHaveCount(0);
  await page.getByLabel("Lọc theo nhóm hàng").selectOption({ label: "Tất cả nhóm hàng" });
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toBeVisible();
  await productSearch.fill("tk-650");
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toHaveCount(0);
  await productSearch.fill("tac ke dan");
  await expect(page.getByRole("heading", { name: "Tắc kê sắt", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toHaveCount(0);
  await page.getByLabel("Lọc theo nhóm hàng").selectOption({ label: "Bánh xe" });
  await productSearch.fill("do man khoa dl 1t");

  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Trang nào có thông tin về vít tole?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByText("Thông tin về vít tole nằm ở trang 11.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Trang 11" })).toBeVisible();
  await expect(productSearch).toHaveValue("do man khoa dl 1t");
  await expect(page.getByRole("heading", { name: "Bánh xe", exact: true })).toBeVisible();
  expect(answerCount).toBe(1);
});

test("a guest follow-up carries the last question and IDs from the prior result", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  const requests: Array<{ question: string; previousQuestion?: string; previousVariantIds?: number[]; history?: Array<{ role: string; content: string }> }> = [];
  await page.route("**/api/v1/public/rag/query", async (route) => {
    const body = route.request().postDataJSON() as { question: string; previousQuestion?: string; previousVariantIds?: number[] };
    requests.push(body);
    const response = body.question === "Bánh xe giá bao nhiêu?"
      ? { status: "clarify", answer: "Bạn cần loại bánh xe nào?", items: [], sources: [], retrieval: { vectorChunks: 2, lexicalProducts: 2, embeddingModel: "bge-m3" } }
      : { status: "answered", answer: "Bánh xe — Đỏ mận ĐL 1T2: Giá lẻ 82.000 ₫ / bánh. Nguồn: trang 11.", items: [{ id: 687, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận ĐL 1T2", verificationStatus: "verified", sourcePages: [11], prices: [{ ...price, id: 152, amount: 82000, isDemo: false, purchasable: true, packagingName: "bánh" }] }], sources: [{ pageNumber: 11, chunkId: 2, chunkKey: "page:11:variant:687:0", sourceRevision: null, sourceSpan: null, excerpt: "Bánh xe Đỏ mận ĐL 1T2", evidenceKind: "verified_catalog", verifiedVariantId: 687 }], retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });

  await page.goto("/shop");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Bánh xe giá bao nhiêu?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByText("Bạn cần loại bánh xe nào?")).toBeVisible();
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("1T2");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByRole("heading", { name: "Bánh xe · Đỏ mận ĐL 1T2" })).toBeVisible();
  await expect(page.getByLabel("Hỏi đáp với AI").getByText("82.000 ₫ / bánh")).toBeVisible();
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Cái đó giá sao?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(page.getByRole("heading", { name: "Bánh xe · Đỏ mận ĐL 1T2" })).toBeVisible();
  expect(requests).toMatchObject([
    { question: "Bánh xe giá bao nhiêu?" },
    { question: "1T2", previousQuestion: "Bánh xe giá bao nhiêu?" },
    { question: "Cái đó giá sao?", previousQuestion: "1T2", previousVariantIds: [687] },
  ]);
  expect(requests[1]?.history).toEqual([
    { role: "user", content: "Bánh xe giá bao nhiêu?" },
    { role: "assistant", content: "Bạn cần loại bánh xe nào?" },
  ]);
  expect(requests[2]?.history?.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  expect(requests[2]?.history?.[2]?.content).toBe("1T2");
});

test("customer sees a validated comparison block and its cited source", async ({ page }, testInfo) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "answered", answer: "The documented options differ.", publicFeedbackHandle: "response-handle",
    answerBlocks: [{ kind: "comparison", text: "The source describes different material details for each option.", variantIds: [687, 688], evidenceIds: ["variant:687", "variant:688", "chunk:11", "chunk:12"] }],
    items: [{ id: 687, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận ĐL 1T2", verificationStatus: "verified", sourcePages: [11], prices: [{ ...price, id: 152, amount: 82000}] }],
    sources: [{ pageNumber: 11, chunkId: 11, chunkKey: "page:11:variant:687:0", sourceRevision: 1, sourceSpan: { start: 0, end: 20 }, excerpt: "Verified material detail", evidenceKind: "verified_catalog", verifiedVariantId: 687 }],
    retrieval: { vectorChunks: 2, lexicalProducts: 2, embeddingModel: "bge-m3" },
  }) }));

  await page.goto("/shop");
  await page.locator("#price-question").fill("compare material details");
  await page.locator("#price-question").press("Enter");

  await expect(page.getByText("So s\u00e1nh c\u00f3 c\u0103n c\u1ee9")).toBeVisible();
  await expect(page.getByText("The source describes different material details for each option.")).toBeVisible();
  await expect(page.getByLabel("Hỏi đáp với AI").getByText("82.000 ₫ / 1 bánh/cái", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trang 11" })).toBeVisible();
  await expect(page.getByText("Câu trả lời này có hữu ích không?")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Các đoạn dữ liệu tìm thấy" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("grounded-comparison.png"), fullPage: true });
});

test("retrieval panel shows only the first four sources in API order", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ json: { items: [], syncedAt: new Date().toISOString() } }));
  await page.route("**/api/v1/public/rag/query", route => route.fulfill({ json: {
    status: "answered", answer: "Found catalog evidence", publicFeedbackHandle: "handle", items: [],
    sources: Array.from({ length: 6 }, (_, index) => ({ chunkId: index + 1, chunkKey: `catalog:${index + 1}`, pageNumber: 13, excerpt: `Retrieved chunk ${index + 1}`, evidenceKind: "verified_catalog", verifiedVariantId: 320 + index, sourceRevision: null, sourceSpan: null })),
    retrieval: { vectorChunks: 6, lexicalProducts: 1, embeddingModel: "bge-m3" },
  } }));
  await page.goto("/shop");
  await page.locator("#price-question").fill("silicon a500");
  await page.locator("#price-question").press("Enter");
  const panel = page.getByRole("region", { name: "Các đoạn dữ liệu tìm thấy" });
  await expect(panel.getByRole("listitem")).toHaveCount(4);
  await expect(panel.getByRole("listitem").first()).toContainText("Retrieved chunk 1");
  await expect(panel.getByRole("listitem").last()).toContainText("Retrieved chunk 4");
  await expect(page.getByText("Retrieved chunk 5", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("public-rag-feedback")).toHaveCount(0);
});

test("catalog listing uses structured totals even when the answer wording changes", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "answered", answer: "Các quy cách phù hợp có trong danh mục dưới đây.",
    catalogPage: { total: 2, nextCursor: 687, complete: false },
    items: [{ id: 687, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận ĐL 1T2", verificationStatus: "verified", sourcePages: [11], prices: [] }],
    sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 1, embeddingModel: "bge-m3" },
  }) }));
  await page.goto("/shop");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Liệt kê các loại bánh xe");
  await page.getByLabel("Câu hỏi cho trợ lý AI").press("Enter");
  await expect(page.getByText("Đang hiển thị 1 / 2 quy cách đã xác minh.", { exact: true })).toBeVisible();
  await expect(page.getByText("Danh sách chưa đầy đủ. Hãy thêm quy cách hoặc nhóm hàng để thu hẹp kết quả.", { exact: true })).toBeVisible();
});

test("clarification never lets a customer add a candidate or displays its price as a quote", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "clarify", answer: "Bạn cần bánh xe quy cách nào?",
    items: [{ id: 687, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận ĐL 1T2", verificationStatus: "verified", sourcePages: [11], prices: [price] }],
    sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 1, embeddingModel: "bge-m3" },
  }) }));
  await page.goto("/shop");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Bánh xe bao nhiêu?");
  await page.getByLabel("Câu hỏi cho trợ lý AI").press("Enter");
  await expect(page.getByText("Bạn cần bánh xe quy cách nào?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm vào đơn", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Hỏi đáp với AI")).not.toContainText("80.000");
});

for (const change of ["changed", "removed", "unavailable"] as const) {
  test(`RAG add revalidates the current SQL catalog when the selected price is ${change}`, async ({ page }) => {
    const catalogPrice = { category: "Bánh xe", name: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", specification: "Đỏ mận khóa ĐL 1T", packaging: "1 bánh/cái", packageQuantity: 1, unit: "bánh", priceId: price.id, version: price.version, priceType: "retail", minimumQuantity: 1, price: price.amount , isDemo: false, purchasable: true};
    let revalidating = false;
    let revalidationReads = 0;
    await page.route("**/api/v1/public/catalog", route => {
      if (revalidating) revalidationReads++;
      if (revalidating && change === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Unavailable" }, requestId: "revalidation" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: !revalidating ? [catalogPrice] : change === "removed" ? [] : [{ ...catalogPrice, version: 2, price: 85000}], syncedAt: new Date().toISOString() }) });
    });
    await page.route("**/api/v1/public/rag/query", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      status: "answered", answer: "Giá hiện hành trong bảng bên dưới.",
      items: [{ id: 686, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", verificationStatus: "verified", sourcePages: [11], prices: [price] }],
      sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 1, embeddingModel: "bge-m3" },
    }) }));
    await page.goto("/shop");
    await expect(page.getByText("1 mặt hàng", { exact: true })).toBeVisible();
    await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Giá bánh xe đỏ mận khóa ĐL 1T");
    await page.getByLabel("Câu hỏi cho trợ lý AI").press("Enter");
    revalidating = true;
    await page.getByRole("button", { name: "Thêm vào đơn", exact: true }).click();
    await expect(page.getByRole("button", { name: "Giỏ hàng (0)", exact: true })).toBeVisible();
    if (change === "changed") {
      const notice = page.getByRole("alert").filter({ hasText: "Giá vừa thay đổi" });
      await expect(notice).toContainText("85.000");
      await notice.getByRole("button", { name: "Xác nhận giá mới" }).click();
      await expect(page.getByRole("button", { name: "Giỏ hàng (1)", exact: true })).toBeVisible();
      expect(revalidationReads).toBe(2);
    } else {
      await expect(page.getByRole("alert").filter({ hasText: change === "removed" ? "Mức giá này không còn được bán" : "Chưa kiểm tra được giá hiện hành" })).toBeVisible();
      expect(revalidationReads).toBe(1);
    }
  });
}

test("customer variant listing shows every specification and only priced variants can be added", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  await page.route("**/api/v1/public/rag/query", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    status: "answered",
    answer: "Tắc kê đạn có 2 quy cách đã xác minh: 6x50 34.000 ₫; 8x60 chưa có giá hiện hành.",
    items: [
      { id: 1, productName: "Tắc kê đạn", category: "Tắc kê", variant: "6x50", verificationStatus: "verified", sourcePages: [2], prices: [{ ...price, id: 301, amount: 34000, isDemo: false, purchasable: true, packagingName: "Bịch 10 cái", packageQuantity: 10, unit: "cái" }] },
      { id: 2, productName: "Tắc kê đạn", category: "Tắc kê", variant: "8x60", verificationStatus: "verified", sourcePages: [3], prices: [] },
    ],
    sources: [], retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" },
  }) }));

  await page.goto("/shop");
  await page.getByLabel("Câu hỏi cho trợ lý AI").fill("Cửa hàng có bao nhiêu loại tắc kê đạn?");
  await page.getByLabel("Câu hỏi cho trợ lý AI").press("Enter");

  await expect(page.getByText("Tắc kê đạn có 2 quy cách đã xác minh", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê đạn · 6x50" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tắc kê đạn · 8x60" })).toBeVisible();
  await expect(page.getByText("Không có mức giá phù hợp với câu hỏi này.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm vào đơn" })).toHaveCount(1);
});
