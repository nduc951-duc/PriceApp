import { ApiError } from "../middleware/errors.js";

const OCR_PROMPT = [
  "Chép lại nội dung trong ảnh bảng giá viết tay bằng tiếng Việt.",
  "Trả về văn bản thuần, dễ đọc; giữ tiêu đề nhóm và xuống dòng riêng cho từng mặt hàng.",
  "Nếu một ký tự, mã hàng hoặc con số không nhìn rõ, ghi [?] đúng vị trí đó; tuyệt đối không đoán hay tự sửa giá.",
  "Giữ nguyên đơn vị, kích thước và cách viết số nhìn thấy trong ảnh. Không thêm lời giải thích.",
].join(" ");

export type OcrImageInput = { imageBase64: string; mimeType: "image/jpeg" | "image/png" };

function ollamaRoot() {
  const configured = process.env.RAG_AI_BASE_URL?.trim();
  if (!configured || (process.env.RAG_AI_PROVIDER?.trim().toLowerCase() && process.env.RAG_AI_PROVIDER?.trim().toLowerCase() !== "ollama")) {
    throw new ApiError(503, "OCR_UNAVAILABLE", "Cần bật Ollama cục bộ để quét OCR.");
  }
  return configured.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
}

function cleanOcrText(value: string) {
  return value.replace(/^\s*```(?:markdown|text|plaintext)?\s*/i, "").replace(/\s*```\s*$/, "")
    .replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n").trim();
}

export async function transcribeImage(input: OcrImageInput): Promise<{ model: string; text: string }> {
  if (!/^image\/(jpeg|png)$/.test(input.mimeType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.imageBase64) || input.imageBase64.length < 16) {
    throw new ApiError(400, "INVALID_INPUT", "Ảnh OCR phải là JPEG/PNG hợp lệ.");
  }
  const model = process.env.RAG_OCR_MODEL?.trim() || "glm-ocr";
  let response: Response;
  try {
    response = await fetch(`${ollamaRoot()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false,
        messages: [{ role: "user", content: OCR_PROMPT, images: [input.imageBase64] }],
        options: { temperature: 0, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new ApiError(503, "OCR_UNAVAILABLE", "Không kết nối được Ollama. Hãy mở Ollama và thử lại.");
  }
  if (!response.ok) throw new ApiError(503, "OCR_UNAVAILABLE", "Model OCR chưa sẵn sàng. Kiểm tra Ollama và model GLM-OCR.");
  const body = await response.json().catch(() => null) as { message?: { content?: unknown } } | null;
  const text = typeof body?.message?.content === "string" ? cleanOcrText(body.message.content) : "";
  if (!text) throw new ApiError(503, "OCR_UNAVAILABLE", "Model OCR không trả về nội dung. Hãy thử quét lại.");
  return { model, text };
}
