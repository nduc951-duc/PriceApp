import { expect, test } from "@playwright/test";

const price = {
  id: 149, packagingId: 1, version: 1, amount: 80000, priceType: "retail",
  minimumQuantity: 1, packagingName: "1 bánh/cái", packageQuantity: 1, unit: "bánh",
  packageNote: "", priceList: "Sổ giá viết tay", supplier: "Nhập từ Trang 1-13", verificationStatus: "verified",
};

test("a guest can ask RAG for a price, see its source, and add the chosen price to the order", async ({ page }) => {
  const publicCatalog = [{
    category: "Bánh xe", name: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", specification: "Đỏ mận khóa ĐL 1T",
    packaging: "1 bánh/cái", packageQuantity: 1, unit: "bánh", priceId: price.id, version: price.version,
    priceType: "retail", minimumQuantity: 1, price: price.amount,
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

test("customer catalog search is accent-insensitive and independent from AI answers", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [
    { category: "Bánh xe", name: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", specification: "Đỏ mận khóa ĐL 1T", productCode: "BX-1T", aliases: ["Bánh xe đỏ mận"], packaging: "1 bánh/cái", packageQuantity: 1, unit: "bánh", priceId: 149, version: 1, priceType: "retail", minimumQuantity: 1, price: 80000 },
    { category: "Tắc kê", name: "Tắc kê sắt", variant: "6x50", specification: "6x50", productCode: "TK-650", aliases: ["Tắc kê đạn"], packaging: "Bịch 10 cái", packageQuantity: 10, unit: "cái", priceId: 150, version: 1, priceType: "retail", minimumQuantity: 1, price: 40000 },
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

test("a guest clarification reply reuses only the previous product context", async ({ page }) => {
  await page.route("**/api/v1/public/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], syncedAt: new Date().toISOString() }) }));
  const requests: Array<{ question: string; previousQuestion?: string }> = [];
  await page.route("**/api/v1/public/rag/query", async (route) => {
    const body = route.request().postDataJSON() as { question: string; previousQuestion?: string };
    requests.push(body);
    const response = body.question === "Bánh xe giá bao nhiêu?"
      ? { status: "clarify", answer: "Bạn cần loại bánh xe nào?", items: [], sources: [], retrieval: { vectorChunks: 2, lexicalProducts: 2, embeddingModel: "bge-m3" } }
      : { status: "answered", answer: "Bánh xe — Đỏ mận ĐL 1T2: Giá lẻ 82.000 ₫ / bánh. Nguồn: trang 11.", items: [{ id: 687, productName: "Bánh xe", category: "Bánh xe", variant: "Đỏ mận ĐL 1T2", verificationStatus: "verified", sourcePages: [11], prices: [{ ...price, id: 152, amount: 82000, packagingName: "bánh" }] }], sources: [{ pageNumber: 11, chunkId: 2, chunkKey: "page:11:variant:687:0", sourceRevision: null, sourceSpan: null, excerpt: "Bánh xe Đỏ mận ĐL 1T2", evidenceKind: "verified_catalog", verifiedVariantId: 687 }], retrieval: { vectorChunks: 1, lexicalProducts: 1, embeddingModel: "bge-m3" } };
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
  expect(requests).toEqual([
    { question: "Bánh xe giá bao nhiêu?" },
    { question: "1T2", previousQuestion: "Bánh xe giá bao nhiêu?" },
  ]);
});
