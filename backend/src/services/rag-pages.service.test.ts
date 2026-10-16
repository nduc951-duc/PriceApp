import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./auth.service.js";
import { saveRagPage } from "./rag-pages.service.js";

function makeAuth(role: AuthContext["role"]) {
  const single = vi.fn().mockResolvedValue({ data: { revision: 2 }, error: null });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const readSelect = vi.fn(() => ({ eq }));
  const client = { from: vi.fn(() => ({ upsert, select: readSelect })) } as unknown as AuthContext["client"];
  const auth = { role, user: { id: "user-1" }, client } as unknown as AuthContext;
  return { auth, upsert, maybeSingle };
}

const pageDraft = {
  sourcePageId: 1,
  title: "Sổ giá - Trang 1",
  extractedText: "Tắc kê sắt:\n6 x 50 | 12",
  reviewStatus: "draft",
  chunkSettings: { maxCharacters: 1100, overlapCharacters: 160 },
  chunkLinks: {},
};

describe("RAG OCR draft access", () => {
  it("lets a signed-in viewer save OCR edits as a draft", async () => {
    const { auth, upsert } = makeAuth("viewer");
    await expect(saveRagPage(pageDraft, auth)).resolves.toMatchObject({ saved: true, reviewStatus: "draft", revision: 2 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ review_status: "draft", extracted_text: pageDraft.extractedText }), { onConflict: "source_page_id" });
  });

  it("does not let a signed-in viewer approve an OCR draft", async () => {
    const { auth, upsert } = makeAuth("viewer");
    await expect(saveRagPage({ ...pageDraft, reviewStatus: "approved" }, auth)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not let a signed-in viewer downgrade an already approved page", async () => {
    const { auth, upsert, maybeSingle } = makeAuth("viewer");
    maybeSingle.mockResolvedValue({ data: { review_status: "approved" }, error: null });
    await expect(saveRagPage(pageDraft, auth)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
