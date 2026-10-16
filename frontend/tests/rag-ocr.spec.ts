import { expect, test } from "@playwright/test";

const user = { id: "ocr-owner", aud: "authenticated", role: "authenticated", email: "owner@example.test", app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00.000Z" };
const transcript = "Tắc kê sắt:\n6 x 50 | 12\n6 x 60 | 15";
const pageRecord = {
  sourcePageId: 1, pageNumber: 1, storagePath: "page-01.jpg", sourceStatus: "needs_review", title: "Sổ giá - Trang 1",
  extractedText: "", reviewStatus: "draft", revision: 1, reviewedBy: null, reviewedAt: null,
  updatedAt: "2026-01-01T00:00:00.000Z", chunkSettings: { maxCharacters: 1100, overlapCharacters: 160 },
  chunkLinks: {}, chunkCount: 0, indexedAt: null, indexError: null, variants: [],
};

test("a signed-in viewer can load a stored source image, OCR it, and save one edited draft chunk", async ({ page }, testInfo) => {
  let activeUser: typeof user | null = null;
  let savedText = "";
  let ocrRequests = 0;
  let signedSourceRequests = 0;
  let meRole = "";
  await page.route("**/source-pages/page-01.jpg", (route) => route.abort("failed"));
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) {
      activeUser = user;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh", user }) });
    } else if (url.pathname.endsWith("/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(activeUser ?? user) });
    } else if (url.pathname.endsWith("/logout")) await route.fulfill({ status: 204, body: "" });
    else await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/me")) {
      meRole = "viewer";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: user.id, role: "viewer" }) });
    } else if (url.pathname.endsWith("/source-files/signed-url")) {
      signedSourceRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedUrl: new URL("/source-pages/page-02.jpg", page.url()).toString(), expiresIn: 300 }) });
    } else if (url.pathname.endsWith("/admin/rag/pages") && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pages: [pageRecord] }) });
    } else if (url.pathname.endsWith("/admin/rag/index")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: null }) });
    } else if (url.pathname.endsWith("/admin/rag/feedback")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 0, helpful: 0, notHelpful: 0, reasons: [], truncated: false }) });
    } else if (url.pathname.endsWith("/admin/rag/ocr")) {
      ocrRequests += 1;
      const payload = request.postDataJSON() as { imageBase64: string; mimeType: string };
      expect(payload.mimeType).toBe("image/jpeg");
      expect(payload.imageBase64.length).toBeGreaterThan(100);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "glm-ocr", text: transcript }) });
    } else if (url.pathname.endsWith("/admin/rag/preview")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ source: transcript, chunks: [
        { index: 0, content: "6 x 50 | 12", heading: "Tắc kê sắt", start: 12, end: 23 },
        { index: 1, content: "6 x 60 | 15", heading: "Tắc kê sắt", start: 24, end: 35 },
      ] }) });
    } else if (url.pathname.endsWith("/admin/rag/pages") && request.method() === "PUT") {
      savedText = (request.postDataJSON() as { extractedText: string }).extractedText;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, reviewStatus: "draft", revision: 2 }) });
    } else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await page.route("**/api/v1/me", (route) => { meRole = "viewer"; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: user.id, role: "viewer" }) }); });

  await page.goto("/rag-admin");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect.poll(() => meRole).toBe("viewer");
  await expect(page.getByRole("heading", { name: "Đọc trang nguồn thành bản nháp" })).toBeVisible();
  const sourceImage = page.getByRole("img", { name: "Ảnh sổ giá trang 1" });
  const zoomTrigger = page.getByRole("button", { name: "Phóng ảnh nguồn" });
  await zoomTrigger.click();
  await expect(page.getByRole("dialog", { name: "Ảnh sổ giá phóng to" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(zoomTrigger).toBeFocused();
  await page.getByRole("button", { name: "Quét OCR" }).click();
  await expect.poll(() => ocrRequests).toBe(1);
  await expect.poll(() => signedSourceRequests).toBeGreaterThan(0);
  await expect(page.getByText(/OCR bằng glm-ocr xong/)).toBeVisible();
  if (testInfo.project.name === "mobile") await page.getByRole("tab", { name: "Ảnh nguồn" }).click();
  await expect(sourceImage).toHaveAttribute("src", /page-02\.jpg/);
  if (testInfo.project.name === "mobile") await page.getByRole("tab", { name: "Các đoạn" }).click();
  await expect(page.getByRole("textbox", { name: "Nội dung đoạn 1" })).toHaveValue("6 x 50 | 12");

  await page.getByRole("textbox", { name: "Nội dung đoạn 1" }).fill("6 x 50 | 12 (đã sửa)");
  await page.getByRole("button", { name: "Nhập đoạn 1 vào bản chép" }).click();
  if (testInfo.project.name === "mobile") await page.getByRole("tab", { name: "Bản chép" }).click();
  await expect(page.getByLabel("Bản chép/OCR đã đối chiếu")).toHaveValue("Tắc kê sắt:\n6 x 50 | 12 (đã sửa)");
  await page.getByRole("button", { name: "Lưu bản nháp" }).click();
  await expect.poll(() => savedText).toBe("Tắc kê sắt:\n6 x 50 | 12 (đã sửa)");
  if (testInfo.project.name === "mobile") await page.getByRole("tab", { name: "Các đoạn" }).click();
  await expect(page.getByRole("textbox", { name: "Nội dung đoạn 2" })).toHaveValue("6 x 60 | 15");
});

test("batches 13 pages sequentially as drafts, skips protected text, retries one failure, and fits desktop/mobile", async ({ page }, testInfo) => {
  let activeUser: typeof user | null = null;
  const pages = Array.from({ length: 13 }, (_, index) => ({
    ...pageRecord,
    sourcePageId: index + 1,
    pageNumber: index + 1,
    storagePath: `page-${String(index + 1).padStart(2, "0")}.jpg`,
    title: `Sổ giá - Trang ${index + 1}`,
    extractedText: index === 1 ? "Bản chép đã có, không ghi đè." : index === 2 ? "Nội dung đã duyệt." : "",
    reviewStatus: index === 2 ? "approved" as const : "draft" as const,
  }));
  const saves: Array<{ sourcePageId: number; reviewStatus: string; extractedText: string }> = [];
  const forbiddenWrites: string[] = [];
  let ocrRequests = 0;
  let concurrentOcr = 0;
  let maximumConcurrentOcr = 0;
  let retried = false;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/source-pages/*.jpg", (route) => route.fulfill({
    status: 200, contentType: "image/jpeg", body: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////2wBDAf//////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=", "base64"),
  }));
  await page.route("**/auth/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) {
      activeUser = user;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh", user }) });
    } else if (url.pathname.endsWith("/user")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(activeUser ?? user) });
    else if (url.pathname.endsWith("/logout")) await route.fulfill({ status: 204, body: "" });
    else await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/me")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: user.id, role: "viewer" }) });
    else if (url.pathname.endsWith("/admin/rag/pages") && request.method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pages }) });
    else if (url.pathname.endsWith("/admin/rag/ocr")) {
      ocrRequests += 1;
      const requestIndex = ocrRequests;
      concurrentOcr += 1;
      maximumConcurrentOcr = Math.max(maximumConcurrentOcr, concurrentOcr);
      await new Promise((resolve) => setTimeout(resolve, 15));
      concurrentOcr -= 1;
      if (requestIndex === 3 && !retried) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "RAG_UNAVAILABLE", message: "OCR unavailable" } }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "glm-ocr", text: `Nội dung OCR trang ${requestIndex}` }) });
      }
    } else if (url.pathname.endsWith("/admin/rag/preview")) {
      const text = (request.postDataJSON() as { extractedText: string }).extractedText;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ source: text, chunks: [{ index: 0, content: text, heading: null, start: 0, end: text.length }] }) });
    } else if (url.pathname.endsWith("/admin/rag/pages") && request.method() === "PUT") {
      const payload = request.postDataJSON() as { sourcePageId: number; reviewStatus: string; extractedText: string };
      saves.push(payload);
      if (payload.reviewStatus !== "draft") forbiddenWrites.push(`status:${payload.reviewStatus}`);
      if (payload.sourcePageId === 2 || payload.sourcePageId === 3) forbiddenWrites.push(`protected-page:${payload.sourcePageId}`);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, reviewStatus: payload.reviewStatus, revision: 2 }) });
    } else {
      if (url.pathname.endsWith("/admin/rag/index")) forbiddenWrites.push("index");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    }
  });
  await page.goto("/rag-admin");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("mock-password");
  await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
  await expect(page.getByRole("heading", { name: "Đọc trang nguồn thành bản nháp" })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "OCR các trang chưa có bản chép" }).click();

  await expect(page.getByText("Đã lưu 10 bản nháp; 2 trang được bỏ qua; 1 trang cần thử lại.")).toBeVisible();
  await expect(page.getByText("Lỗi OCR · Thử lại", { exact: false })).toBeVisible();
  await expect(page.getByText("Bỏ qua · Có bản chép", { exact: false })).toBeVisible();
  await expect(page.getByText("Đã duyệt · Không quét", { exact: false })).toBeVisible();
  expect(ocrRequests).toBe(11);
  expect(maximumConcurrentOcr).toBe(1);
  expect(saves.map((item) => item.sourcePageId)).toEqual([1, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
  expect(saves.every((item) => item.reviewStatus === "draft" && item.extractedText.startsWith("Nội dung OCR trang"))).toBe(true);
  expect(forbiddenWrites).toEqual([]);

  await page.getByRole("button", { name: "Thử lại OCR trang 05" }).click();
  retried = true;
  await expect.poll(() => saves.filter((item) => item.sourcePageId === 5).length).toBe(1);
  await expect(page.getByRole("button", { name: "Thử lại OCR trang 05" })).toHaveCount(0);
  expect(ocrRequests).toBe(12);
  expect(maximumConcurrentOcr).toBe(1);
  expect(forbiddenWrites).toEqual([]);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("heading", { name: "Đọc trang nguồn thành bản nháp" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trang 01" }).last()).toBeVisible();
    const firstQueueItem = page.getByRole("button", { name: "Chọn trang 01" });
    if (width === 1440) expect(await firstQueueItem.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    const sourceImageButton = page.getByRole("button", { name: "Phóng ảnh nguồn" });
    expect(await sourceImageButton.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    if (width === 390) {
      const queueHeading = page.getByRole("heading", { name: "Nạp bản chép cho các trang còn trống" });
      expect((await queueHeading.boundingBox())?.width ?? 0).toBeGreaterThan(240);
      const pagePicker = page.getByRole("combobox", { name: "Chọn trang nguồn" });
      expect((await pagePicker.boundingBox())?.width ?? 0).toBeGreaterThan(300);
      await pagePicker.selectOption("1");
      expect(await page.getByRole("button", { name: "Đăng xuất" }).evaluate((element) => getComputedStyle(element).position)).not.toBe("fixed");
    }
    await page.getByRole("heading", { name: "Đọc trang nguồn thành bản nháp" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`ocr-workbench-${width}px.png`) });
    await page.getByRole("heading", { name: "Trang 01" }).last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`ocr-selected-page-${width}px.png`) });
  }
});
