# PriceApp · RAG Roadmap

> **Trợ lý tra cứu và lập báo giá vật tư bằng Hybrid RAG kết hợp dữ liệu giá có cấu trúc.**

| Thông tin | Nội dung |
| :--- | :--- |
| Ngày rà soát | **10/10/2026** |
| Dữ liệu ban đầu | **13 trang** sổ giá |
| Tài liệu | Đánh giá kỹ thuật · User stories · Backlog triển khai |
| Tiến độ task | **3/45** đã đánh dấu hoàn thành |
| Bước đề xuất tiếp theo | [Duyệt bản chép nguồn, chạy index và nghiệm thu L4 trên dữ liệu thật](#kiem-tra-l0-l4) |

**Phạm vi rà soát:** source, migration, giao diện quản trị, local configuration và tài liệu tham khảo.

> **Lưu ý về trạng thái**
>
> Build/unit tests không chứng minh database cloud hoặc model đã chạy thành công. Các ô `[ ]` là công việc dự kiến; chỉ đánh dấu `[x]` khi đã kiểm chứng.

<a id="muc-luc"></a>

## Mục lục

1. [Hướng đề tài và sản phẩm](#dinh-huong)
2. [Đã có và đã kiểm chứng](#hien-trang)
3. [Khoảng trống kỹ thuật, theo mức ưu tiên](#khoang-trong)
4. [Học gì từ ứng dụng tương tự](#tham-khao)
5. [Phạm vi chức năng](#pham-vi)
6. [User stories và các lần triển khai](#user-stories)
7. [Bộ đánh giá đề xuất](#danh-gia)
8. [Cách giao việc ở mỗi lượt tiếp theo](#cach-giao-viec)

---

<a id="tien-do"></a>

## Tổng quan các đợt triển khai

| Đợt | Trọng tâm | User story | Tiến độ task | Trạng thái |
| :--- | :--- | :--- | :---: | :--- |
| [**L0**](#l0) | Sửa chữ tiếng Việt | US-00 | 3/4 | Đã sửa · chờ kiểm tra UI |
| [**L1**](#l1) | Chạy được một luồng RAG thật | US-01 | 0/4 | Owner đã khởi tạo; thiếu nguồn duyệt, phiên UI và kiểm thử thật |
| [**L2**](#l2) | Thu hồi tài liệu và quyền truy cập đúng | US-02, US-03 | 0/4 | Code có; thiếu integration owner/viewer |
| [**L3**](#l3) | Quản trị 13 trang và xem trước chunk | US-04, US-05 | 0/5 | Đã triển khai report, record preview, cấu hình chunk và liên kết variant; migration đã áp dụng, còn kiểm tra UI/mapping với corpus thật ([trạng thái](RAG_L3_STATUS.md)) |
| [**L4**](#l4) | Lập chỉ mục ổn định và tiết kiệm | US-06 | 0/5 | Migration đã đồng bộ; thiếu corpus đã duyệt và kiểm thử index thật |
| [**L5**](#l5) | Tìm đúng quy cách và bao bì | US-07, US-08 | 0/5 | Đã thêm parser/filter thuộc tính rõ ràng và hỏi lại khi xung đột loại giá; thiếu 80–100 câu đã duyệt, debug retrieval và benchmark |
| [**L6**](#l6) | Trả lời có dẫn chứng và giá kiểm tra được | US-09, US-10 | 0/5 | Đã thêm trạng thái trả lời, ID/phiên bản SQL và citation chunk/revision/span; migration provenance đã áp, RPC remote đã xác minh; còn nghiệm thu giá/OCR và E2E |
| [**L7**](#l7) | Hỏi tiếp và đưa sang hóa đơn | US-11, US-12 | 0/4 | Đã thêm conversation RLS/API, follow-up theo tên mặt hàng và kiểm tra lại giá trước khi thêm/sao chép; migration đã áp, FORCE RLS đã xác minh; còn E2E qua phiên thật |
| [**L8**](#l8) | Đánh giá và vòng phản hồi | US-13, US-14 | 0/5 | Đã thêm metric, chia nhóm tune/test, runner, phản hồi theo nhóm lỗi, tổng hợp và CSV; thiếu corpus adjudicated và baseline đo thật |
| [**L9**](#l9) | Hoàn thiện bản bảo vệ | US-15 | 0/4 | Đã cập nhật setup/runbook và hướng dẫn đánh giá; thiếu demo owner/nhân viên, video/slide và nghiệm thu môi trường thật |

**Quy ước:** `[x]` đã kiểm chứng · `[ ]` chưa hoàn thành. Tiến độ trên được tổng hợp từ checklist bên dưới.

<a id="kiem-tra-l0-l4"></a>

### Kiểm tra L0–L4 ngày 04/10/2026

> Kết quả L4 trong bảng dưới là ảnh chụp lịch sử ngày 04/10; xem [bằng chứng remote cập nhật ngày 05/10](RAG_L4_STATUS.md) để biết tình hình migration hiện tại.

| Đợt | Đã kiểm chứng | Chưa được chứng minh / còn thiếu |
| :--- | :--- | :--- |
| L0 | Nhãn tiếng Việt trong file đã sửa và test chunking đọc đúng; lint, typecheck, 32 unit tests, build qua. | T00.4: chưa xem `/rag-admin` sau đăng nhập trên desktop/mobile. |
| L1 | Schema RAG nền có thể đọc bằng publishable key; Ollama có `bge-m3:latest`, `qwen2.5:3b`; embedding trả 1 vector 1.024 chiều, chat API trả lời. Có 20 câu hỏi **ứng viên** và route lưu trace. | Chưa có owner session để kiểm tra health từ app, số trang duyệt, index và câu hỏi xuyên suốt dữ liệu thật. Chưa khóa đáp án 20 câu; chưa thử đổi giá bằng RPC audited trên DB. |
| L2 | Unit/route tests kiểm tra auth, no-store, cache, nguồn thu hồi và giá động bằng mock; migration có revision/RLS/RPC lọc nguồn hiện hành. | Chưa kiểm thử quyền owner/viewer/anon, thu hồi và đổi phiên trên Supabase thật; test mock không chứng minh RLS đang hoạt động. |
| L3 | Có màn hình nhập/duyệt bản chép cơ bản, nằm ngoài phạm vi nghiệm thu L3. | Chưa có bố cục ảnh cạnh bản chép, dirty guard, preview chunk, offset/source span tin cậy và báo cáo 13 trang. Giữ 0/5. |
| L4 | Đã viết migration generation/run, API batch/resume, fingerprint model artifact, UI tiến độ; unit tests kiểm tra reuse và lỗi giữa batch. | Tại thời điểm kiểm tra, hai bảng trả 404. Schema sau đó được đối chiếu, lịch sử được sửa và migration nguồn còn thiếu đã áp. Chưa chạy index với nguồn duyệt. |

**Cổng kiểm thử phiên này:** `npm.cmd run lint` qua với 1 cảnh báo font ở `layout.tsx`; `npm.cmd run typecheck` qua; `npm.cmd test` qua **9 file/32 tests**; `npm.cmd run build` qua. `npm.cmd run test:e2e` **không qua** trên desktop và mobile: smoke test chờ heading “Tìm đúng vật tư”, còn app hiển thị màn hình đăng nhập vì không có phiên; đây không phải bằng chứng UI RAG đã kiểm tra. Chi tiết lỗi nằm ở `test-results/smoke-search-and-inline-price-edit-*/error-context.md`. Build cũng cảnh báo lockfile ở thư mục cha bị Next bỏ qua.

**Trạng thái và bước tiếp theo ngày 05/10/2026:**

1. Migration RAG đã hiện diện và lịch sử remote khớp; `db push --dry-run` không còn file pending.
2. Owner profile đã tạo cho tài khoản được xác nhận. Đăng nhập tài khoản đó, đối chiếu nội dung 13 trang với ảnh sổ, duyệt bản chép và các variant đúng; không duyệt khi chưa khớp.
3. Chạy `/rag-admin` health/index, lưu run ID/checkpoint/chunk count/content hash/model digest; chạy lại cùng nội dung phải reuse embedding. Sau đó thử ngắt provider giữa batch và resume.
4. Khóa 20 đáp án ứng viên, kiểm tra query → chunk → variant → SQL price ID → answer; sửa giá bằng audited RPC có `expected_version`, hỏi lại và xác nhận embedding không đổi.
5. Kiểm thử thu hồi trang và E2E sau đăng nhập owner/viewer trên desktop/mobile; hoàn thiện L3/L8/L9 theo backlog và ghi metric thật.

Xem thêm [bằng chứng L1–L2](RAG_L1_L2_STATUS.md) và [bằng chứng L4](RAG_L4_STATUS.md). Chỉ đổi ô checklist khi có kết quả đúng phạm vi của task.

---

<a id="dinh-huong"></a>

## 1. Hướng đề tài và sản phẩm

**Tên gợi ý:** Trợ lý tra cứu và lập báo giá vật tư bằng Hybrid RAG kết hợp dữ liệu giá có cấu trúc.

### Người dùng chính

| Vai trò | Nhu cầu |
| :--- | :--- |
| Nhân viên bán hàng | Tra mặt hàng và lập báo giá |
| Chủ cửa hàng | Duyệt tài liệu, cập nhật giá và kiểm tra nguồn |
| Nhóm thực hiện đồ án | Đo chất lượng hệ thống |

### Luồng demo mục tiêu

1. Hỏi bằng ngôn ngữ tự nhiên
2. Xác định đúng sản phẩm/quy cách
3. Hỏi lại khi mơ hồ
4. Tìm đoạn nguồn
5. SQL lấy giá theo bao bì/loại giá/hiệu lực
6. Trả lời có dẫn chứng
7. Người bán nhấn thêm vào hóa đơn
8. Tính tiền bằng code.

13 trang đủ cho nguyên mẫu có phạm vi xác định. Giá trị nghiên cứu nằm ở việc xử lý tên Việt, cách viết tắt, quy cách gần nhau, dữ liệu thiếu/chưa duyệt, giá thay đổi và chứng minh cải thiện bằng số liệu. Không dùng số trang ít để suy ra bài toán đơn giản; cũng không suy rộng kết quả sang mọi cửa hàng.

> **Nguyên tắc dữ liệu giá**
>
> `prices.amount` luôn là số tiền chuẩn. Không chia/chuẩn hóa số tiền để suy giá. Chỉ quy đổi số lượng/bao bì khi có dữ liệu và quy tắc nghiệp vụ đã được xác nhận; chọn dòng giá hợp lệ rồi tính số gói được chọn × amount nguyên bản. Tuân thủ AGENTS.md.

[↑ Mục lục](#muc-luc)

---

<a id="hien-trang"></a>

## 2. Đã có và đã kiểm chứng

- Có schema catalog, bao bì, mức giá, nguồn và lịch sử sửa giá; UI tra cứu, sửa giá, giỏ hàng/hóa đơn tạm lưu trên thiết bị.
- Có code cho bản chép được duyệt, chunking, pgvector 1.024 chiều, embedding provider, tái sử dụng hash và API kết hợp truy xuất với LLM.
- Các migration hiện đã được áp dụng và đối chiếu remote. Chưa chạy indexing/generation trên corpus được cửa hàng duyệt; Ollama đã được xác nhận ở lần rà soát trước, nhưng chưa có benchmark RAG trên dữ liệu cửa hàng.
- Đã sửa chuỗi UTF-8 bị đọc sai thành Windows-1252 trong `src/components/rag-admin.tsx` và dữ liệu tiếng Việt của `src/lib/rag/chunking.test.ts`. Đây là sửa nội dung file, không phải đổi font để che lỗi.
- Lint không có lỗi (còn cảnh báo font cũ), typecheck, 15 unit tests và production build qua sau sửa. Browser không có kết nối khả dụng, chưa kiểm tra hình ảnh/render sau đăng nhập.
- Các chức năng bên dưới là backlog, chưa được triển khai trong lượt đánh giá này.

[↑ Mục lục](#muc-luc)

---

<a id="khoang-trong"></a>

## 3. Khoảng trống kỹ thuật, theo mức ưu tiên

**P0:** xử lý trước khi dùng dữ liệu thật · **P1:** chất lượng cốt lõi của RAG · **P2:** trải nghiệm và vận hành.

### P0 · Nguồn dữ liệu và quyền truy cập

#### P0.1 — Thu hồi tài liệu và chunk cũ

**Hiện tại:** `pages/route.ts` đổi nội dung/trạng thái nhưng không vô hiệu chunk. RPC `match_rag_chunks` không kiểm tra bản duyệt hiện tại. `index/route.ts` return sớm khi không có drafts.

**Hệ quả / hướng xử lý:** Bản chép đã thu hồi có thể vẫn xuất hiện; trường hợp mọi bản chép/variant bị bỏ duyệt còn giữ index cũ. Cần ràng buộc revision và loại khỏi retrieval ngay khi thu hồi, kể cả chưa chạy lại job.

#### P0.2 — Cache API có xác thực

**Hiện tại:** `public/sw.js` cache mọi GET cùng origin, bao gồm `/api/rag/pages`, chưa phân tách dữ liệu theo phiên.

**Hệ quả / hướng xử lý:** Cần loại API có xác thực khỏi cache, `Cache-Control: no-store`, xóa dữ liệu nhạy cảm khi đăng xuất và test đổi owner → viewer/offline.

### P1 · Độ đúng và khả năng kiểm chứng

#### P1.1 — Hợp nhất kết quả truy xuất

**Hiện tại:** `query/route.ts` nối IDs từ vector rồi lexical, sau đó cắt danh sách.

**Hệ quả / hướng xử lý:** Đây là hai nhánh truy xuất nhưng chưa có hợp nhất thứ hạng như RRF; kết quả lexical chính xác có thể bị đẩy xuống. Chấm lại sau khi trộn; reranker chỉ thêm nếu benchmark chứng minh lợi ích.

#### P1.2 — Hiểu điều kiện câu hỏi và hiệu chỉnh ngưỡng

**Hiện tại:** Ngưỡng cosine 0,20 và top-k cố định; câu hỏi đi thẳng vào retrieval.

**Hệ quả / hướng xử lý:** Chưa đo ngưỡng; chưa lọc cứng kích thước, vật liệu, bao bì, loại giá và số lượng. Cần parser có schema + lọc metadata; điểm cosine không phải phần trăm độ tin cậy.

#### P1.3 — Chunk theo cấu trúc tài liệu

**Hiện tại:** Chunker theo số ký tự/dòng/câu, chưa nhận dạng hàng bảng, tiêu đề hoặc token budget.

**Hệ quả / hướng xử lý:** Không nên gọi đây là semantic chunking đã hoàn thiện. Cần chunk theo nhóm sản phẩm/variant/ghi chú, kèm heading; so sánh với baseline hiện tại.

#### P1.4 — Vị trí đoạn trích trong nguồn

**Hiện tại:** `chunking.ts` tính offset bằng `indexOf` sau khi trim từng dòng; nội dung lặp tìm lại từ đầu.

**Hệ quả / hướng xử lý:** Đã tái hiện: `source.slice(start,end)` khác `content` khi dòng thụt đầu. Highlight nguồn sẽ sai. Cần mapping từ raw text sang normalized text hoặc offsets xác định trên phiên bản văn bản chuẩn.

#### P1.5 — Liên kết đoạn OCR với sản phẩm

**Hiện tại:** OCR/page chunks có `product_variant_id = null`, chưa có liên kết thực thể trong từng đoạn.

**Hệ quả / hướng xử lý:** Một đoạn có tên mặt hàng nhưng lexical không khớp có thể không dẫn tới SQL giá đúng. Thêm liên kết do người duyệt xác nhận hoặc entity resolution có kiểm tra ID.

#### P1.6 — Kiểm tra giá và đầu ra LLM

**Hiện tại:** LLM trả text tự do; số tiền và citation chỉ được ràng buộc bằng prompt.

**Hệ quả / hướng xử lý:** Thẻ giá SQL có thể đúng trong khi lời văn sai. Cần output schema, kiểm tra price/variant/source IDs; số tiền hiển thị do code render; hỏi lại khi thiếu quy cách/bao bì/loại giá.

#### P1.7 — Dẫn chứng theo đoạn và phiên bản

**Hiện tại:** Evidence lấy trang đầu của variant; sources Map theo số trang làm mất các đoạn khác cùng trang.

**Hệ quả / hướng xử lý:** Link trang chưa chứng minh phát biểu cụ thể. Cần citation tới chunk/revision/span, phân biệt ảnh gốc với thay đổi giá đã được ghi audit.

#### P1.8 — Lập chỉ mục và xử lý lỗi

**Hiện tại:** Index chạy trong một HTTP request, upsert nhiều batch rồi xóa, không khóa job hay chuyển phiên bản atomically.

**Hệ quả / hướng xử lý:** Timeout/lỗi/chạy đồng thời có thể để index chưa nhất quán. Cần job/checkpoint/retry và kích hoạt generation hoàn chỉnh; phân trang dữ liệu thay vì phụ thuộc hạn mức response mặc định.

#### P1.9 — Phiên bản của embedding

**Hiện tại:** Hash hiện gắn nội dung và tên model, chưa có phiên bản chunker/provider/model artifact.

**Hệ quả / hướng xử lý:** Đổi thuật toán hoặc trọng số cùng tên model có thể giữ vector cũ. Cần fingerprint đầy đủ và index generation.

#### P1.10 — Dữ liệu chưa duyệt và kiểm thử thực tế

**Hiện tại:** Nhánh lexical vẫn lấy biến thể chưa verified; không có bộ kiểm thử RAG/DB thật.

**Hệ quả / hướng xử lý:** Phải thống nhất cách hiển thị dữ liệu chưa duyệt và quyền dùng để báo giá. Test không được khẳng định giá chắc chắn với nguồn chưa được xác nhận.

### P2 · Trải nghiệm và vận hành

#### P2.1 — Hội thoại, phản hồi và nhập liệu

**Hiện tại:** Chỉ một lượt hỏi, thiếu session/feedback/trace; ingestion chủ yếu nhập tay.

**Hệ quả / hướng xử lý:** Thiếu trải nghiệm hỏi tiếp và dữ liệu để cải thiện. OCR tự động chỉ là trợ giúp; bản chép giá viết tay vẫn phải duyệt.

#### P2.2 — Cấu hình provider và giới hạn vận hành

**Hiện tại:** Model/key dùng chung cấu hình provider; API trả thông báo upstream thô, giới hạn context/output và retry còn đơn giản.

**Hệ quả / hướng xử lý:** Tách cấu hình embedding/chat khi cần, giới hạn request/token, lỗi dễ hiểu + request ID, log không lưu khóa; tránh thêm hạ tầng phức tạp trước khi cần.

[↑ Mục lục](#muc-luc)

---

<a id="tham-khao"></a>

## 4. Học gì từ ứng dụng tương tự

- **Dify:** màn hình thử truy xuất với cấu hình riêng cho lần thử và lịch sử kết quả. PriceApp nên có “Kiểm tra tìm kiếm”: nhập câu hỏi → xem chunks, xếp hạng, trang và variant tìm được, chưa cần gọi LLM. [Tài liệu Dify](https://docs.dify.ai/en/cloud/use-dify/knowledge/test-retrieval).
- **Open WebUI:** bộ sưu tập tài liệu, extraction, tìm kiếm hybrid kết hợp keyword/vector/reranking. Với PriceApp chỉ cần một bộ nguồn rõ ràng cho cửa hàng, quản lý trạng thái từng tài liệu và luồng đọc nguồn. [Tài liệu Knowledge](https://docs.openwebui.com/features/workspace/knowledge/).
- **Ragas:** tham khảo cách đo faithfulness giữa câu trả lời và context. Giá/số lượng/quy cách cần thêm đối chiếu tự động bằng SQL và đánh giá người, không chỉ dựa vào một LLM làm giám khảo. [Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/).

[↑ Mục lục](#muc-luc)

---

<a id="pham-vi"></a>

## 5. Phạm vi chức năng

### Bắt buộc cho bản đồ án

1. RAG thực sự chạy được trên dữ liệu đã duyệt, kèm bằng chứng vector/chunk/model/version.
2. Quản trị 13 trang: ảnh và bản chép cạnh nhau, lưu nháp, duyệt/thu hồi, trạng thái đã index/chưa index/lỗi.
3. Chunk preview và truy vết đoạn gốc; không trộn các quy cách khác nhau.
4. Hỏi giá tiếng Việt có/không dấu, alias, mã hàng và các quy cách gần giống; hỏi lại nếu thiếu điều kiện.
5. Câu trả lời gắn nguồn, giá SQL hiện hành; có trạng thái “chưa có giá”, “chờ duyệt”, “không có bằng chứng”. Không suy “hết hàng” từ “không có giá”.
6. Chuyển mặt hàng đã xác định sang giỏ hiện tại, người dùng chủ động nhấn, kiểm tra lại giá/version ở thời điểm thêm.
7. Bộ đánh giá có baseline, dashboard/CSV kết quả và các case thất bại trung thực.

### Nâng cao sau MVP

- Upload ảnh/PDF, OCR hỗ trợ, sửa và duyệt; chỉ tự động hóa nếu thử nghiệm trên chữ viết tay đạt mức hữu ích.
- Nhập danh sách nhiều món, tách từng dòng và hỏi lại từng dòng còn mơ hồ; không cho LLM tự quyết định sản phẩm thay thế.
- Lưu báo giá theo khách hàng, xuất/in PDF, snapshot giá tại lúc lập; đối chiếu giá hiện tại khi mở lại.
- Lịch sử thay đổi giá từ `price_history` và nguồn sửa; so sánh cùng một quy cách/bao bì/loại giá.
- Báo cáo câu hỏi chưa trả lời được để người quản trị biết dữ liệu nào cần bổ sung.
- Thêm 3–5 tài liệu thật về quy cách/cách gọi/chính sách bán sỉ được chủ cửa hàng duyệt, nếu muốn kiểm tra RAG văn bản ngoài catalog. Không tự tạo nội dung giả rồi coi là dữ liệu kinh doanh.

Chưa ưu tiên: GraphRAG, nhiều agent, fine-tuning, nhiều vector DB, thanh toán thật, kế toán/tồn kho đầy đủ hoặc dự báo giá thị trường. Dữ liệu hiện có chưa hỗ trợ các kết luận đó.

[↑ Mục lục](#muc-luc)

---

<a id="user-stories"></a>

## 6. User stories và các lần triển khai

Mỗi “lần” là một phần việc có thể review/demo độc lập; không hứa hoàn thành trong một chat. Nếu vượt một buổi triển khai, tách theo mã task. Thời gian còn phụ thuộc model/hardware, quyền DB và việc duyệt nguồn. Chưa biết deadline/team size nên không gán lịch tuần cứng.

---

<a id="l0"></a>

### L0 · Sửa chữ tiếng Việt

**Tiến độ:** 3/4 task · **User story:** US-00

#### User stories

> **US-00**
> Là người quản trị, tôi muốn đọc rõ nhãn, lỗi và nội dung tiếng Việt để duyệt nguồn chính xác.

#### Tasks

- [x] **T00.1** — Khôi phục encoding đúng trong `rag-admin.tsx`.

- [x] **T00.2** — Khôi phục dữ liệu tiếng Việt của test chunking; kiểm tra lại chuỗi mojibake.

- [x] **T00.3** — Lint/typecheck/15 tests/build.

- [ ] **T00.4** — Kiểm tra bằng trình duyệt sau đăng nhập ở desktop/mobile; Browser phiên này chưa khả dụng.

#### Điều kiện nghiệm thu

> Không còn chữ kiểu `ChÆ°a`, `Táº¡o` trong các file đã sửa; phần UI cần xác nhận trực quan riêng. Mọi đọc/ghi file sau này chỉ định UTF-8 rõ ràng.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l1"></a>

### L1 · Chạy được một luồng RAG thật

**Tiến độ:** 0/4 task · **User story:** US-01

**Triển khai:** [Code và các bước nghiệm thu còn lại](RAG_L1_L2_STATUS.md) · [20 câu hỏi ứng viên](RAG_L1_CASES.md). Checklist chỉ đổi trạng thái sau khi chạy trên dữ liệu thật.

**Phụ thuộc:** tài khoản owner, DB target xác định, model có thể truy cập từ Next server.

#### User stories

> **US-01**
> Là người demo, tôi muốn hỏi một món có dữ liệu và kiểm tra toàn bộ đường đi từ nguồn tới câu trả lời.

#### Tasks

- [ ] **T01.1** — Kiểm tra schema/migration thực tế của Supabase; áp migration cần thiết, không sửa migration đã chạy.

- [ ] **T01.2** — Chọn/chạy embedding và chat model; health check riêng DB, embedding, chat, chiều vector, model fingerprint. Khi Ollama lỗi, màn hình tra cứu SQL hiện tại vẫn dùng được.

- [ ] **T01.3** — Dùng 1–2 trang/nhóm hàng đã được người phụ trách duyệt; chạy index và lưu số chunks/dimension/hash/model, không tự đánh dấu verified hàng chưa đối chiếu.

- [ ] **T01.4** — Lập 20 câu hỏi chuẩn đầu tiên; log query → chunks → variant IDs → SQL price IDs → answer.

#### Điều kiện nghiệm thu

> ít nhất một câu hỏi đi hết pipeline thật; giá đổi qua RPC audited thì câu trả lời dùng giá mới trong khi content hash/vector không thay đổi; thiếu giá trả “chưa có giá”. Lưu lại lỗi và kết quả thực, chưa gọi là đạt accuracy khi chưa đo.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l2"></a>

### L2 · Thu hồi tài liệu và quyền truy cập đúng

**Tiến độ:** 0/4 task · **User story:** US-02, US-03

**Triển khai:** [Code và các bước nghiệm thu còn lại](RAG_L1_L2_STATUS.md). Kiểm thử mock đã có; cần kiểm thử owner/viewer và thu hồi nguồn trên Supabase thật.

#### User stories

> **US-02**
> Là chủ cửa hàng, tôi muốn bản chép bỏ duyệt ngừng được dùng ngay để tránh báo sai.

> **US-03**
> Là người dùng nội bộ, tôi chỉ thấy dữ liệu phù hợp với phiên đăng nhập.

#### Tasks

- [ ] **T02.1** — Thêm revision/status liên kết chunk với bản đã duyệt; truy vấn kiểm tra trạng thái hiện tại, không đợi job cleanup.

- [ ] **T02.2** — Xử lý index trống, xóa nguồn, variant inactive/unverified và thu hồi toàn bộ nguồn; không return sớm để giữ chunk cũ dùng tiếp.

- [ ] **T02.3** — Loại API authenticated khỏi service-worker cache, no-store và xử lý cache cũ/logout.

- [ ] **T02.4** — Integration tests owner/viewer/anon, source revoked và session đổi người.

#### Điều kiện nghiệm thu

> một nguồn đã thu hồi biến mất khỏi retrieval ngay; owner đọc nháp được, viewer không đọc nháp qua API/cache; thao tác không động đến bảng giá.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l3"></a>

### L3 · Quản trị 13 trang và xem trước chunk

**Tiến độ:** 0/5 task · **User story:** US-04, US-05

#### User stories

> **US-04**
> Là người duyệt, tôi muốn nhìn ảnh gốc cạnh bản chép để sửa nhanh và không mất công đã nhập.

> **US-05**
> Là người duyệt, tôi muốn biết chính xác đoạn nào và sản phẩm nào sẽ được đưa vào tìm kiếm.

#### Tasks

- [ ] **T03.1** — Bố cục ảnh/bản chép hai cột, phóng ảnh; trạng thái saved/dirty/error; chống đổi trang làm mất nháp.

- [ ] **T03.2** — Danh sách 13 trang có revision, người duyệt, số chunk, thời điểm index, lỗi; thông báo loading/empty/forbidden riêng.

- [ ] **T03.3** — Chunk theo record sản phẩm/quy cách; kế thừa tên nhóm/heading; văn bản dài theo đoạn/câu với giới hạn token thực tế. Cấu hình trong admin lab, không rải số magic.

- [ ] **T03.4** — Sửa offset, thêm `chunker_version`, source span; test Unicode, whitespace, dòng lặp, đoạn dài, số thập phân và header bảng.

- [ ] **T03.5** — Preview chunk và gắn variant ID đã tồn tại; phân biệt raw OCR với văn bản phục vụ tìm kiếm. Giữ số đo/mã hàng, không tự xóa mọi chữ số vì sợ giá.

#### Điều kiện nghiệm thu

> click chunk mở đúng đoạn nguồn theo revision; mỗi dòng/ghi chú được giữ đúng; bản chưa duyệt không vào retrieval. Báo cáo 13 trang có trạng thái thật, không ép trang khó đọc thành hoàn tất.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l4"></a>

### L4 · Lập chỉ mục ổn định và tiết kiệm

**Tiến độ:** 0/5 task · **User story:** US-06

#### User stories

> **US-06**
> Là chủ cửa hàng, tôi muốn theo dõi tiến độ và chạy tiếp sau lỗi mà không trả chi phí embedding lại mọi thứ.

#### Tasks

- [ ] **T04.1** — Bảng `rag_index_runs` và checkpoint theo batch; khóa một run cho cùng corpus; retry có giới hạn.

- [ ] **T04.2** — Phân trang đọc/ghi và chuẩn hóa embedding response theo input index; test response sai dimension/sai count.

- [ ] **T04.3** — Fingerprint gồm content hash, chunker version, provider/model artifact; embedding text không đọc số tiền từ `prices`.

- [ ] **T04.4** — Stage một generation mới, chỉ kích hoạt khi đủ; giữ bản đang phục vụ nếu generation mới thất bại, trừ tài liệu đã bị thu hồi.

- [ ] **T04.5** — UI tiến độ/error/resume và thống kê changed/reused/removed; không hiển thị raw provider error/khóa.

#### Điều kiện nghiệm thu

> chạy lại không thay text tạo 0 embedding mới; sửa một đoạn chỉ cập nhật phần cần thiết; sửa giá tạo 0 embedding mới; lỗi giữa batch không phục vụ một generation dở dang. Với 13 trang, ưu tiên Postgres job state + worker đơn giản, chưa cần Redis/Kafka.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l5"></a>

### L5 · Tìm đúng quy cách và bao bì

**Tiến độ:** 0/5 task · **User story:** US-07, US-08

#### User stories

> **US-07**
> Là người bán, tôi muốn hỏi bằng tên quen dùng và vẫn tìm đúng loại 8 ly thay vì 10 ly.

> **US-08**
> Khi thiếu điều kiện chọn hàng, tôi muốn hệ thống hỏi lại thay vì tự chọn.

#### Tasks

- [ ] **T05.1** — Mở rộng bộ chuẩn lên 80–100 câu từ hàng đã duyệt; chia tune/test theo nhóm hàng/câu gốc để paraphrase cùng ý không rò sang test.

- [ ] **T05.2** — Parse có schema: tên/alias, kích thước, vật liệu, đơn vị, bao bì, số lượng, loại giá; không tự chuyển đơn vị mơ hồ.

- [ ] **T05.3** — Lọc cứng thuộc tính xác định; truy xuất keyword/vector riêng rồi RRF, khử trùng variant/chunk. Exact match được ưu tiên có lý do.

- [ ] **T05.4** — Điều chỉnh top-k/threshold trên tune set; reranker chỉ thử như thí nghiệm tùy chọn.

- [ ] **T05.5** — Trang “Kiểm tra tìm kiếm” hiển thị truy vấn đã hiểu, top chunks, lexical/vector/RRF ranks và liên kết nguồn; không cần gọi LLM.

#### Điều kiện nghiệm thu

> các case 8/10 ly, tên gần nhau, bao bì khác nhau được phân biệt hoặc hỏi lại; câu không có dữ liệu không đưa giá một món tương tự làm đáp án. Có baseline trước/sau và không dùng cosine score như % chính xác.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l6"></a>

### L6 · Trả lời có dẫn chứng và giá kiểm tra được

**Tiến độ:** 0/5 task · **User story:** US-09, US-10

#### User stories

> **US-09**
> Là người bán, tôi muốn mọi giá báo ra tương ứng một dòng SQL hiện hành và có điều kiện áp dụng rõ.

> **US-10**
> Tôi muốn mở được đoạn chứng minh câu trả lời và biết khi nào hệ thống chưa chắc.

#### Tasks

- [ ] **T06.1** — SQL/tool có tham số variant/package/tier/quantity/effective time; không cho LLM viết SQL tùy ý.

- [ ] **T06.2** — Schema response: `answered | clarify | insufficient_evidence`, matched variant/package/price IDs và citations. Backend đối chiếu ID/context trước khi trả.

- [ ] **T06.3** — Render số tiền/tổng bằng code; không tin số tiền trong text model. Chặn khẳng định không có bằng chứng; tách nguồn ảnh gốc với lần sửa giá audit.

- [ ] **T06.4** — Citation theo chunk/revision/span, không gộp mất nhiều chunks cùng trang; phiên bản/price ID dùng để tái hiện câu trả lời.

- [ ] **T06.5** — Test thiếu giá, ngưỡng sỉ chưa rõ, nguồn mâu thuẫn/chưa duyệt và instruction độc hại nằm trong OCR.

#### Điều kiện nghiệm thu

> nguồn thiếu → thiếu bằng chứng; query mơ hồ → hỏi lại; ID ngoài context bị từ chối; số tiền và bao bì khớp DB. Dù thẻ giá đúng, lời văn sai vẫn tính là đáp án sai.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l7"></a>

### L7 · Hỏi tiếp và đưa sang hóa đơn

**Tiến độ:** 0/4 task · **User story:** US-11, US-12

#### User stories

> **US-11**
> Là người bán, tôi muốn hỏi “còn loại 10 ly?” trong cùng cuộc trao đổi mà không nhập lại tên hàng.

> **US-12**
> Tôi muốn nhấn thêm mặt hàng chatbot đã xác định vào giỏ hiện có.

#### Tasks

- [ ] **T07.1** — Lưu hội thoại theo user/session với RLS; chỉ mang sang các thuộc tính đã xác nhận, không dùng câu trả lời cũ làm nguồn giá mới.

- [ ] **T07.2** — Resolve follow-up theo ngữ cảnh, hỏi lại khi đổi loại hàng làm điều kiện cũ không còn phù hợp.

- [ ] **T07.3** — Dùng chung store/service giỏ hàng; nút thêm truyền IDs và số lượng, backend/logic giá kiểm tra lại price version và bao bì.

- [ ] **T07.4** — Người dùng xác nhận thêm; tính tổng theo nguyên tắc AGENTS.md; vẫn dùng UI giỏ hiện có.

#### Điều kiện nghiệm thu

> đổi giá giữa lúc chat và lúc thêm được phát hiện, không dùng đơn giá cũ im lặng; hai người không đọc lịch sử nhau; model không tự thêm hoặc thanh toán.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l8"></a>

### L8 · Đánh giá và vòng phản hồi

**Tiến độ:** 0/5 task · **User story:** US-13, US-14

#### User stories

> **US-13**
> Là nhóm đồ án, tôi muốn chứng minh cách truy xuất mới tốt hơn baseline trên cùng dữ liệu.

> **US-14**
> Là chủ cửa hàng, tôi muốn biết câu hỏi nào bị trả sai hoặc còn thiếu tài liệu.

#### Tasks

- [ ] **T08.1** — Đóng băng test set, phiên bản corpus/model/prompt/chunker và chính sách giá trước khi đo.

- [ ] **T08.2** — Chạy keyword-only, vector-only, hybrid với cùng candidate budget và generator; tùy thời gian thêm hybrid + reranker. Đo riêng chất lượng retrieval và end-to-end.

- [ ] **T08.3** — Log Recall@5/MRR, đúng variant/bao bì/loại giá/số tiền, citation correctness, abstention, p50/p95 latency và token usage nếu provider trả; local model ghi thời gian/phần cứng, không gán giá API giả.

- [ ] **T08.4** — Thumb up/down + lý do và ví dụ đúng; dashboard lỗi theo thiếu dữ liệu/sai retrieval/sai generation, export CSV.

- [ ] **T08.5** — Người kiểm tra đọc lại mẫu và toàn bộ lỗi tiền; faithfulness tự động chỉ là chỉ báo bổ sung.

#### Điều kiện nghiệm thu

> có báo cáo tái chạy được, công bố cả trường hợp hybrid không tốt hơn baseline; không đổi test set để làm đẹp điểm. Ngưỡng mục tiêu ở mục 7 là đề xuất, không phải kết quả đã đạt.

[↑ Bảng tiến độ](#tien-do)

---

<a id="l9"></a>

### L9 · Hoàn thiện bản bảo vệ

**Tiến độ:** 0/4 task · **User story:** US-15

#### User stories

> **US-15**
> Là người trình bày, tôi muốn chạy một demo ngắn thể hiện nghiệp vụ, kỹ thuật RAG và giới hạn hệ thống.

#### Tasks

- [ ] **T09.1** — ERD, sequence diagram, lựa chọn thiết kế và hướng dẫn setup từ máy sạch; model/DB health, lỗi dễ hiểu và phương án tra SQL khi model tắt.

- [ ] **T09.2** — Review role/rate limit/context budget/log secrets; E2E luồng owner và nhân viên; xác nhận cache/source revocation.

- [ ] **T09.3** — Demo: hỏi alias → phân biệt quy cách → đọc nguồn → hỏi tiếp → thêm giỏ → thay giá SQL mà không re-embed → câu không có bằng chứng → bảng so sánh baseline.

- [ ] **T09.4** — Chốt README, video dự phòng, slides/báo cáo, backlog còn lại; phát hành khi môi trường thật đã được kiểm tra.

#### Điều kiện nghiệm thu

> người khác setup được theo tài liệu; số liệu có ngày/cấu hình; không gọi hệ thống là đã chạy đầy đủ chỉ vì build pass.

[↑ Bảng tiến độ](#tien-do)

[↑ Mục lục](#muc-luc)

---

<a id="danh-gia"></a>

## 7. Bộ đánh giá đề xuất

100 câu ban đầu, người phụ trách dữ liệu xác nhận đáp án/ID; điều chỉnh số lượng theo dữ liệu thật:

| Nhóm | Số câu dự kiến | Điều cần kiểm tra |
|---|---:|---|
| Tên trực tiếp/giá | 25 | Đúng variant, bao bì, loại giá và amount |
| Không dấu/alias/lỗi gõ | 20 | Có lợi ích so với keyword baseline |
| Quy cách/bao bì gần nhau | 20 | Không nhầm số đo, mã hàng, đơn vị |
| Mơ hồ/thiếu giá/ngoài dữ liệu | 15 | Hỏi lại hoặc từ chối phù hợp |
| Trích nguồn/ghi chú nhiều dòng | 10 | Đúng chunk, trang và revision |
| Giá đổi/nguồn thu hồi/đoạn có instruction | 10 | Dùng đúng dữ liệu hợp lệ ở thời điểm hỏi |

Tối thiểu mỗi case: question, expected outcome, expected variant IDs, package/tier/price ID khi có, expected source span/page, corpus/price version và ghi chú người duyệt. Case động dùng DB test hoặc dữ liệu test tách biệt; không ghi giá giả vào giá bán thật.

### Mục tiêu sau baseline

> **Đây là mục tiêu đề xuất, chưa phải kết quả đã đạt.**

Recall@5 ≥ 90%, citation correctness ≥ 95%, xử lý không có đáp án đúng ≥ 90%. Với trường hợp được phép báo giá, price-ID/bao bì/amount phải khớp SQL 100%; công bố thêm tỷ lệ câu được trả lời để tránh đạt 100% bằng cách từ chối mọi câu. Đo mức đúng chọn dòng giá riêng với mức đúng sao chép số tiền. Chưa đặt latency tuyệt đối trước khi biết phần cứng.

[↑ Mục lục](#muc-luc)

---

<a id="cach-giao-viec"></a>

## 8. Cách giao việc ở mỗi lượt tiếp theo

### Mẫu yêu cầu

> Làm L1 trong docs/PRICEAPP_RAG_ROADMAP.md. Hoàn thành T01.1–T01.4, dùng dữ liệu thật đã duyệt, ghi kết quả chạy thực tế và blocker. Giữ nguyên nguyên tắc giá SQL, không tự approve nguồn. Cập nhật trạng thái task và báo kiểm thử.

### Nhịp làm việc

Mỗi lần thực hiện: chốt một lát cắt → sửa/viết migration mới nếu cần → test đúng rủi ro → demo/ghi evidence → cập nhật task. Chỉ đánh dấu hoàn tất phần đã được kiểm chứng. Nếu deadline ngắn, giữ L1–L6 và L8; L7 là điểm cộng nghiệp vụ, OCR tự động và tính năng nâng cao làm sau.

[↑ Mục lục](#muc-luc)
