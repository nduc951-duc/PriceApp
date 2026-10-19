# Model hiện tại có góp phần gây lỗi không?

Ngày kiểm tra: 19/10/2026. Chỉ đọc cấu hình, mã nguồn, đầu ra model đã lưu và tài liệu chính thức nhà cung cấp. Chưa đổi cấu hình hay gọi model cloud.

## Bằng chứng của dự án

Cấu hình chat là Ollama `qwen2.5:3b`; embedding là `bge-m3`.

1. `2026-10-19-introduction-root-cause.json`: cả hai lượt của câu “tôi muốn mua bulong, giới thiệu cho tôi” đều có JSON planner bỏ `productText`, và chọn `variants` thay vì tổng quan `products`.
2. `2026-10-19-span-check.jsonl`: sau khi yêu cầu thêm các trường bắt buộc, model trích đúng `productText: bulong`, nhưng có lúc chỉ trả `conversationPhrases: [giới thiệu cho tôi]` dù câu còn vế “tôi muốn mua ... và hãy”. Câu đảo thứ tự lại có lúc bị gom cả tên `bulong` vào conversationPhrases.
3. Trace root cause cho thấy vector retrieval đã trả 8 chunk Bulong có tán, similarity khoảng 0,65. Code bù định danh và bộ lọc sau retrieval loại hết kết quả đúng. `vectorChunks: 0` trong response cuối là số giữ lại sau lọc, không phải số ban đầu.

**Kết luận:** có lỗi trích xuất/tuân thủ hướng dẫn ở model trong cấu hình và prompt đã thử, đồng thời có lỗi orchestration ở app. Không có cơ sở quy toàn bộ lỗi cho model, cho kích thước 3B, hay cho embedding. Cũng chưa có benchmark đối chứng chứng minh cloud model cụ thể tốt hơn. Đổi chat model là thử nghiệm hợp lý, cần giữ cùng bộ câu hỏi, catalog và retrieval để so sánh.

## Hướng chuyển cloud phù hợp

Ưu tiên thử chat/planner qua Gemini Flash free tier, giữ embedding `bge-m3` local và chỉ mục hiện có. Tài liệu chính thức hiện có gói Free cho một số model, bảng giá Gemini 3.8 Flash ghi input/output miễn phí ở Free Tier; quota và model thực tế cần kiểm tra trong tài khoản.

- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- API tương thích OpenAI: https://ai.google.dev/gemini-api/docs/openai
- Lựa chọn khác có free plan: Groq, kiểm tra quota của model trong tài khoản: https://console.groq.com/docs/rate-limits
- JSON schema trên Groq có phạm vi model hỗ trợ riêng: https://console.groq.com/docs/structured-outputs

Không kết luận chất lượng tiếng Việt hoặc độ chính xác catalog của Gemini/Groq chỉ từ tài liệu marketing. Chưa có API key cloud nên chưa thực hiện A/B thực tế.

## Điều kiện kỹ thuật trước khi đổi

`backend/src/rag/provider.ts` hiện dùng chung `RAG_AI_PROVIDER`, `RAG_AI_BASE_URL` và API key cho cả chat lẫn embedding. Chỉ đổi base URL sang cloud sẽ khiến embedding cũng gọi sang cloud bằng tên `bge-m3`, thường không phù hợp endpoint mới. Cần tách cấu hình chat và embedding; giữ provider/model/artifact của embedding để không vô tình làm thay đổi vector space.

Nhánh OpenAI-compatible hiện gửi `response_format: json_object`, trong khi Ollama có JSON Schema riêng. Khi chọn cloud cần kiểm tra hỗ trợ schema, định dạng response và quota, không chỉ thay tên model.

So sánh trước/sau nên ghi riêng: trích đúng tên hàng/điều kiện, hiểu hai vế, phân biệt câu mới với tham chiếu, tỷ lệ phải sửa plan/làm rõ, độ chính xác hàng và giá, độ trễ, số lượt gọi model và lỗi quota. Giữ các regression chống trả sai màu, sai họ sản phẩm và sai kích thước.
