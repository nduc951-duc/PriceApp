# Rà soát PriceApp — 15/10/2026

## Kết luận

Ứng dụng đã có một chuỗi nghiệp vụ thực chất: tìm vật tư → chọn quy cách/bao bì → chọn mức giá → lập và sao chép báo giá; hỏi giá có thể chuyển về đúng variant/price/version; sửa giá có audit và kiểm soát phiên bản. Các kỹ thuật có phục vụ bài toán, đặc biệt việc tách truy xuất tài liệu khỏi nguồn giá SQL.

Ứng dụng có nền tảng tốt nhưng chưa đủ bằng chứng để tuyên bố hoàn thiện cho vận hành. Các lỗi có thể tái hiện về nhập giá, ngày hiệu lực, khớp quy cách, snapshot, cắt ngưỡng catalog và nhãn báo giá đã được xử lý bằng code cùng regression tests. Chất lượng RAG vẫn chưa có phép đo trên bộ câu hỏi đã duyệt. Không thể quy đổi số lượng tính năng hoặc unit test thành phần trăm sẵn sàng vận hành.

Phạm vi rà soát: mã và migrations trong workspace hiện tại, tài liệu kiến trúc/vận hành, CI, unit test, production build, các E2E hiện có, phép tái hiện cục bộ và ảnh viewport dùng dữ liệu giả lập ở desktop/mobile. Không truy cập database thật, không áp migration, không đọc hoặc ghi lại giá trị bí mật. Ảnh giao diện xác nhận bố cục/nhãn và phát hiện lỗi chồng nút; chưa nghiệm thu trên thiết bị bán hàng và dữ liệu cửa hàng thật.

Repository có nhiều thay đổi tracked/untracked từ trước đợt rà soát. Chúng được giữ nguyên. Mã ứng dụng được sửa trong các file liệt kê bên dưới; không áp migration, không thay dữ liệu trên cloud, và không commit.

## Mức độ áp dụng kỹ thuật

| Nhóm | Áp dụng thực tế | Nhận xét và giới hạn |
|---|---|---|
| Next.js, React, TypeScript | App Router, trang tra giá/hỏi giá/quản trị, client state, API types sinh từ contract | Phù hợp ứng dụng quầy hàng. Trang chính chủ yếu là client app; không nên giới thiệu như một hệ thống SSR phức tạp. Component POS dài 1.295 dòng, trộn hiển thị, dữ liệu và nghiệp vụ. |
| Fastify và phân lớp | Routes → controllers → services → repositories; schemas Zod, OpenAPI, request ID, lỗi chuẩn | Có ranh giới backend rõ. Tuy nhiên Next vẫn phục vụ các API RAG trực tiếp với nghiệp vụ riêng, khiến kiến trúc tách API chưa thống nhất hoàn toàn. |
| PostgreSQL/Supabase | Danh mục, bao bì, loại giá, nguồn, lịch sử; Auth, Storage, RLS, RPC | Đúng lựa chọn cho dữ liệu quan hệ và truy vết giá. SQL có version/row lock/audit và migrations gia cố. Chưa chạy lại cloud/RLS đa tài khoản trong đợt này. |
| Giá/quy cách | Giữ `prices.amount`, xét số gói nguyên tương đương, minimum quantity, trạng thái verified | Thuật toán chọn bao bì phục vụ đúng bài toán. Đợt này đã siết nhập số, ngày hiệu lực và độ chính xác hiển thị. |
| Tìm kiếm tiếng Việt | Bỏ dấu, nhận diện mã/kích thước, fuzzy match chỉ trên từ chữ, SQL lexical search | Matcher tại quầy dùng parser chuẩn hóa chung; token kỹ thuật có chữ số cần khớp chính xác. |
| Hybrid RAG | Chunking, embedding 1.024 chiều, pgvector + lexical, reciprocal rank fusion, explicit filters, nguồn/revision/span | Áp dụng nhiều bước thực chất, không chỉ gọi LLM. Câu hỏi giá dùng giá SQL và hàm dựng câu trả lời; câu hỏi khác có generation dựa trên evidence. Chưa có corpus adjudicated và báo cáo Recall/MRR/độ đúng giá/latency thực nghiệm. |
| Vòng đời RAG | Duyệt nguồn/chunk, freshness, index generations, hội thoại, follow-up, feedback, evaluation runner | Có thiết kế quản trị và khả năng đánh giá. Feedback không đồng nghĩa tự học/cải thiện model; runner có code không đồng nghĩa đã đo hiệu quả. |
| PWA/offline | Service worker cache shell/static, snapshot IndexedDB, chặn ghi offline | Luồng cold offline reload đã qua E2E mock. Snapshot được cập nhật sau thay đổi và tải mới khi reconnect; offline vẫn là chế độ đọc bản lưu. |
| Chất lượng | ESLint, TypeScript, Vitest, Playwright, OpenAPI check, CI | Nền tảng tốt. Đợt rà soát tìm thấy các biên nghiệp vụ trước đây thiếu regression test và đã bổ sung các ca liên quan. |

## Các tính năng phối hợp đến đâu?

**Đã liên kết tốt:** RAG trả price ID/version, POS kiểm lại catalog trước khi thêm và sao chép, cảnh báo thay đổi giá/bao bì, loại mức giá chưa duyệt, chặn ghi offline, xóa bản báo giá/snapshot khi đăng xuất. Mức giá SQL không phụ thuộc việc cập nhật embedding. Các kiểm thử mock bao phủ conflict, focus dialog, logout và offline.

**Đã cải thiện trong đợt này:** giá quầy lọc cùng cửa sổ hiệu lực với RAG; formatter tiền theo độ chính xác VND trong schema; cập nhật state ghi snapshot; reconnect tải catalog mới; lỗi API thử mở bản lưu và hiện trạng thái máy chủ riêng.

**Còn cần nghiệm thu:** các trang nội bộ hiện dùng Fastify; Next handler chỉ còn là rollback, nhưng vẫn có logic độc lập trong mã. Cần vượt authenticated E2E rồi xóa theo runbook để tránh duy trì hai thuật toán; xem F5.

## Phát hiện theo ưu tiên

### F1 — Cao: nhập giá có thể biến thành một giá trị khác

- Vị trí: `frontend/src/components/price-app.tsx:688`, trường amount của catalog editor quanh dòng 1103; `frontend/src/features/pricing/validation.ts:3`.
- Ô sửa nhanh dùng `priceSchema.safeParse(raw.replace(/\D/g, ""))`. Catalog editor cũng loại mọi ký tự không phải chữ số. Kiểm tra sau khi loại ký tự không bảo vệ được giá trị gốc.
- Tái hiện chính biểu thức đang dùng: `12345.50 → 1234550`, `-100 → 100`, chuỗi rỗng `→ 0` khi ép kiểu số. Đây là phép tái hiện cục bộ, không gửi ghi giá thật.
- Định dạng POS dùng 0 chữ số thập phân trong khi RAG dùng tối đa 2. Giá lưu `12345.5` được hiển thị tại POS là `12.346 ₫`, còn RAG là `12.345,5 ₫`.
- **Đã xử lý:** parser mới giữ số và hỗ trợ dấu thập phân `.`/`,` tối đa hai chữ số; từ chối rỗng, âm, quá độ chính xác hoặc cách viết mơ hồ. POS, báo giá và RAG cùng dùng formatter VND đến hai chữ số, khớp `numeric(18,2)` trong schema. Nhập `0` vẫn hợp lệ.
- Regression test bao phủ đầu vào hợp lệ, không hợp lệ và định dạng số lẻ.

### F2 — Cao: catalog có thể đưa giá hết hạn hoặc chưa có hiệu lực vào báo giá

- Vị trí: `backend/src/repositories/catalog.repository.ts:5`, `:31`, `:50`.
- Query không lấy `valid_from`/`valid_to`; mapper chỉ loại `!price.active`. Trong khi `backend/src/services/rag-query.service.ts` có lọc thời gian.
- Tái hiện: đưa một price active, verified nhưng `valid_to=2001-01-01` vào `mapCatalogRows`; price ID vẫn xuất hiện trong kết quả.
- Việc POS tải lại catalog trước khi thêm/sao chép không khắc phục điều kiện lọc bị thiếu tại nguồn catalog. RLS đọc prices trong migrations hiện có không bổ sung bộ lọc ngày này.
- **Đã xử lý:** mapper catalog lọc `valid_from <= now <= valid_to` theo mốc thời gian có thể truyền khi kiểm thử; thiếu hoặc sai ngày thì loại giá. Query đọc cả hai cột ngày. Regression test có giá tương lai, hết hạn, ngày lỗi và điểm cuối hiệu lực.

### F3 — Cao: tìm kiếm cho phép sai khác chữ số quy cách

- Vị trí: `frontend/src/features/search/parser.ts:21–24`; phần nhóm kết quả trong `price-app.tsx`.
- Trước sửa, `editDistance <= 1` áp dụng cho mọi token dài ít nhất 4 ký tự. Đã tái hiện `matchesCatalogQuery('bulong 6x50', 'Bulong 6x60') === true`.
- Trang chính trước sửa lọc cả nhóm tên + chuỗi ghép mọi variant rồi hiện toàn bộ variant của nhóm.
- **Đã xử lý:** fuzzy match chỉ áp dụng token chữ; token có số khớp chính xác. Matcher dùng parser chuẩn hóa chung. Mỗi variant được lọc riêng trước khi nhóm kết quả.

### F4 — Trung bình: snapshot và trạng thái đồng bộ có thể cũ

- Vị trí: `frontend/src/components/price-app.tsx` và `frontend/src/features/offline/cache.ts`.
- Trước sửa snapshot chỉ ghi lúc tải ban đầu, reconnect không tải lại và lỗi cache có thể giữ màn hình đang tải.
- **Đã xử lý:** state catalog/giá mới ghi lại snapshot; các thao tác IndexedDB được tuần tự hóa để lệnh xóa khi logout đợi lần ghi trước; lỗi cache không chặn dữ liệu online. Reconnect tải catalog mới. Nếu API lỗi, ứng dụng thử bản lưu, hiện thông báo và phân biệt trạng thái máy chủ.
- Cần nghiệm thu thêm trên thiết bị có giới hạn quota/storage.

### F5 — Trung bình: hai đường RAG có thể lệch nghiệp vụ

- Vị trí: `frontend/src/app/api/rag/*`, `frontend/src/lib/rag/*` so với `backend/src/services/rag-*` và `backend/src/rag/*`.
- Next API `/api/rag/query` vẫn có truy xuất/generation riêng, còn UI chính gọi Fastify `/api/v1/rag/query`. Luồng cũ không có đầy đủ explicit filtering, conversation và provenance như backend mới.
- Kiểm kê consumer: UI hỏi giá và admin đang gọi Fastify; tham chiếu tới các Next handler cũ chỉ còn ở tests. Fastify vì vậy là đường chạy chính. Route/helper Next được giữ làm rollback theo runbook cho đến khi authenticated desktop/mobile E2E qua trên Supabase thử nghiệm biệt lập; sau cổng đó mới xóa cùng rollback tag. Hiện code vẫn chứa hai implementation nên route cũ cần được dọn sau khi đạt cổng.

### F6 — Trung bình: khả năng mở rộng catalog bị giới hạn âm thầm

- Vị trí: `backend/src/repositories/catalog.repository.ts:51` và test tương ứng.
- **Đã xử lý:** catalog đọc theo các trang 500 bản ghi, sắp xếp ổn định theo ID và tiếp tục đến trang cuối. Nếu trang sau lỗi, request thất bại thay vì trả catalog một phần. Regression test có 1.200 dòng qua ba trang.

### F7 — Trung bình: giao diện chưa nhất quán với việc sử dụng tại quầy

- `globals.css` có hai bộ root tokens/body rồi các đoạn override; nhiều nhãn 8–11px, nhiều kiểu chữ và các patch kích thước về cuối file.
- Trang hỏi giá có nhãn RAG, PostgreSQL, embedding/vector và thống kê model ở khu vực người bán dùng thường xuyên; thiếu ưu tiên thông tin cần quyết định như quy cách, gói, ngưỡng, giá và nguồn.
- **Đã xử lý:** các nhãn giao dịch được thống nhất là “báo giá”, phản ánh đúng việc ứng dụng không xử lý thanh toán. E2E kiểm tra trên desktop/mobile và xác nhận hộp thoại không còn mô tả như hóa đơn.
- Các nhãn phụ 8–11px và cấu trúc CSS nhiều lớp vẫn cần rà soát trực quan toàn màn hình; kiểm tra hiện có thiên về luồng thao tác, chưa có ảnh chụp được duyệt.
- **Đã xử lý:** nút đăng xuất được đặt trong dải thao tác header của POS, tránh đè nút báo giá; E2E đo bounding box trên desktop/mobile và ảnh viewport xác nhận bố cục.
- Rà soát ảnh hiện tại dùng fixture giả lập, chưa nghiệm thu trên thiết bị bán hàng hoặc dữ liệu cửa hàng thật.
- Không có skill UI UX Pro Max trong catalog kỹ năng hiện có; tìm trong thư mục `.codex` không thấy SKILL.md phù hợp. Đây là yêu cầu tùy chọn của người dùng, không phải điều kiện để dừng rà soát.

### F8 — Trung bình: bằng chứng nghiệm thu chưa đủ cho các tuyên bố RAG/production

- Evaluation runner và metric đã có, nhưng chưa có bộ câu hỏi/nhãn đã duyệt cùng observations để kết luận chất lượng retrieval/answer/citation.
- 12 E2E cần project/account thử nghiệm được skip. Một số integration test hiện cũng mock catalog/RAG; dù bật secrets vẫn cần thêm ca thực sự chạy xuyên browser → API → DB để nghiệm thu các ranh giới đó.
- **Đã xử lý một phần:** CI chạy mocked desktop/mobile E2E trên mọi pull request; authenticated E2E vẫn là job riêng có điều kiện và cần test project/account biệt lập. Các bài mocked xác nhận giao diện và luồng client, không xác minh Supabase RLS hoặc dữ liệu thật. Chưa xóa các Next RAG handlers vì runbook yêu cầu qua cổng authenticated trước.

## Bằng chứng kiểm tra mới trong đợt này

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm.cmd run check` | Exit 0 ngày 16/10: lint (một cảnh báo font cũ), typecheck, root runner, 19 frontend files/98 tests, 29 backend files/153 tests, OpenAPI và build hai workspace qua. |
| Root runner | 2/2 tests qua. |
| Frontend Vitest | 19 files, 98 tests qua. |
| Backend Vitest | 29 files, 153 tests qua. |
| `npm.cmd run test:e2e` | Build qua; Playwright bị dừng với mã native 3221226505 trước khi có kết quả suite. Chưa xác định nguyên nhân gốc. |
| `npm.cmd run test:e2e` | Exit 0 ngày 16/10: 24 passed, 12 authenticated cases skipped; production builds, desktop Chromium và Pixel 7 emulation. Dùng cấu hình mock, không kết nối Supabase/provider. |
| E2E UI desktop/mobile | Test kiểm tra nhãn báo giá và khoảng cách nút đăng xuất/nút báo giá qua trên Chromium desktop và Pixel 7; ảnh viewport POS/dialog được xem trực tiếp. |
| CI `.github/workflows/ci.yml` | Thêm job E2E giả lập desktop/mobile chạy trên pull request; giữ job authenticated riêng cho Supabase test project biệt lập. Workflow chưa được chạy trên GitHub trong phiên này. |
| Probe F1/F2/F3 | Đã tái hiện bằng Node/tsx từ mã hiện tại, không ghi DB. |

Cảnh báo còn lại: custom font trong `layout.tsx` (ESLint), Vite native config loader, NO_COLOR/FORCE_COLOR. Chúng không làm các gates tương ứng thất bại. Một lần gọi E2E trên Windows kết thúc bằng mã native 3221226505 trước khi chạy suite; lần chạy root sau đó qua đầy đủ. Nguyên nhân của lần thoát đầu chưa xác định.

## Thay đổi hoàn tất

- `frontend/src/features/pricing/validation.ts`: parser giữ dấu thập phân hợp lệ và formatter VND hiển thị chính xác đến hai chữ số, theo `numeric(18,2)`.
- `frontend/src/components/price-app.tsx`: kiểm tra raw input ở cả hai form sửa giá; lọc từng quy cách khi tìm; nạp lại khi reconnect; thử snapshot khi API lỗi; ghi lại snapshot khi catalog/giá thay đổi. Nút mở invoice ghi “Báo giá”.
- `backend/src/repositories/catalog.repository.ts`: đọc `valid_from`/`valid_to` và loại giá nằm ngoài hạn.
- `backend/src/repositories/catalog.repository.ts`: phân trang theo ID để không bỏ sót catalog trên 1.000 variant; test mới kiểm tra 1.200 dòng và ranh giới ba trang.
- `frontend/src/features/search/parser.ts`: không fuzzy khớp mã/kích thước chứa số; tái sử dụng parser chuẩn hóa.
- `frontend/src/features/offline/cache.ts`: đóng kết nối IndexedDB và tuần tự hóa thao tác ghi/xóa để tránh race khi logout.
- `frontend/src/app/globals.css` và `frontend/src/components/price-question-assistant.tsx`: tăng chữ cơ sở và nhãn khó đọc; giảm bóng/viền; đưa số liệu model vào “Thông tin kỹ thuật”; giữ bảng màu hiện có.
- `frontend/src/components/price-app.tsx`: đồng nhất nhãn giao dịch “báo giá” trên màn quầy và dialog; test desktop/mobile xác nhận nội dung.
- `frontend/src/components/auth-gate.tsx`, `auth-actions-context.tsx`, `price-app.tsx`: chuyển đăng xuất vào header POS; E2E xác nhận không chồng nút. Các trang quản trị/câu hỏi tiếp tục dùng nút đăng xuất nổi hiện có.
- Thêm regression tests cho parsing giá, ngày hiệu lực và khớp quy cách.

## Trạng thái sau đợt hoàn thiện ngày 16/10

Đợt hoàn thiện đã giữ kiến trúc Next/Fastify/Supabase, sửa luồng đang có và không thêm subsystem hay dependency giao diện.

1. **API RAG:** consumer nội bộ đã được kiểm kê; UI dùng Fastify, Next routes chỉ còn là đường rollback. Chờ authenticated E2E trên Supabase thử nghiệm biệt lập rồi mới dọn route/helper cũ theo runbook.
2. **Đo chất lượng RAG:** cần câu hỏi, đáp án và citation đã được người phụ trách duyệt, cùng observations thực tế để báo cáo Recall/MRR/độ đúng giá/citation/latency.
3. **Auth/RLS:** cần project Supabase thử nghiệm và owner/employee accounts riêng để chạy các ca đa tài khoản; không dùng project production.
4. **Offline:** cần kiểm tra trên thiết bị thật có quota/storage hạn chế.

Các regression/unit tests, root check, production build và mock E2E desktop/mobile hiện đều qua: 19 frontend files/98 unit tests, 29 backend files/153 unit tests, 24 E2E pass. Có 12 E2E cần tài khoản/project biệt lập bị bỏ qua; không tuyên bố RLS cloud hoặc chất lượng RAG production đã nghiệm thu.
