import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeImage } from "./ocr.js";

describe("GLM OCR transcription", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("sends the image to the configured local vision model and returns readable text", async () => {
    vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("RAG_OCR_MODEL", "glm-ocr");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "```text\nTắc kê sắt:\n6 x 50 | 12\n```" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeImage({ imageBase64: "QUJDREVGR0hJSktMTU4=", mimeType: "image/jpeg" });

    expect(result).toEqual({ model: "glm-ocr", text: "Tắc kê sắt:\n6 x 50 | 12" });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"images":["QUJDREVGR0hJSktMTU4="]'),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      model: "glm-ocr", stream: false,
      messages: [{ role: "user", images: ["QUJDREVGR0hJSktMTU4="] }],
    });
  });

  it("rejects unsupported image types and malformed base64 before calling Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeImage({ imageBase64: "QUJDREVGR0hJSktMTU4=", mimeType: "image/gif" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(transcribeImage({ imageBase64: "%%%", mimeType: "image/jpeg" })).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
