import { expect, test } from "@playwright/test";

const user = {
  id: "rag-catalog-ui-user", aud: "authenticated", role: "authenticated", email: "catalog-ui@example.test",
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

for (const audience of ["customer", "employee"] as const) {
  for (const empty of [false, true]) {
    test(`${audience} reads the catalog explanation when ${empty ? "no exact rows were found" : "product groups have no item cards"}`, async ({ page }) => {
      const explanation = empty
        ? "Chưa tìm thấy đúng quy cách yêu cầu. Bạn có thể xem các quy cách bulong hiện có."
        : "Mình tìm thấy Bulong có tán với 47 quy cách, gồm các cỡ 6 ly, 8 ly, 10 ly và 12 ly.";
      await page.route("**/auth/v1/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/token")) return route.fulfill({ json: { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user } });
        if (path.endsWith("/user")) return route.fulfill({ json: user });
        return route.fulfill({ status: 204, body: "" });
      });
      await page.route("**/api/v1/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/public/catalog")) return route.fulfill({ json: { items: [], syncedAt: new Date().toISOString() } });
        if (path.endsWith("/catalog")) return route.fulfill({ json: { entries: [], prices: [], syncedAt: new Date().toISOString() } });
        if (path.endsWith("/rag/conversations")) return route.fulfill({ status: 201, json: { id: "ee994ce4-f252-429b-8f47-c5da6117a13b" } });
        if (path.endsWith("/rag/query")) return route.fulfill({ json: {
          status: empty ? "insufficient_evidence" : "answered", answer: explanation,
          items: [], sources: [], catalogPage: { total: empty ? 0 : 47, nextCursor: null, complete: !empty },
          retrieval: { vectorChunks: 0, lexicalProducts: empty ? 0 : 1, embeddingModel: "not_used" },
        } });
        return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } });
      });
      if (audience === "employee") {
        await page.goto("/");
        await page.getByRole("button", { name: "Nhân viên" }).click();
        await page.locator("#email").fill(user.email);
        await page.locator("#password").fill("mock-password");
        await page.getByRole("button", { name: "ĐĂNG NHẬP" }).click();
        await expect(page.locator("#product-search")).toBeVisible();
        await page.goto("/questions");
      } else {
        await page.goto("/shop");
      }
      await page.getByLabel("Câu hỏi cho trợ lý AI").fill("tôi muốn mua bulong, bên bạn có những mặt hàng nào");
      await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
      await expect(page.getByText(explanation, { exact: true })).toBeVisible();
      await expect(page.getByText(/Đang hiển thị 0 \/ /)).toHaveCount(0);
      await expect(page.getByText("Danh sách chưa đầy đủ. Hãy thêm quy cách hoặc nhóm hàng để thu hẹp kết quả.")).toHaveCount(0);
    });
  }
}
