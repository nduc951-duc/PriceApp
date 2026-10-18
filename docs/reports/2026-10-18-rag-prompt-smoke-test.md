# Báo cáo smoke test RAG (10 câu ban đầu + 15 câu mở rộng)

**Ngày chạy:** 2026-10-18  
**Nguồn:** danh mục Supabase công khai đã xác minh; giá hiện hành trong catalog.  
**Phạm vi:** chạy service RAG ở chế độ catalog công khai. Các prompt được xác nhận đi qua fast path trước khi truy vấn; harness chỉ cho phép kết nối tới Supabase và chặn mọi host khác.

## Đợt 1 — 10 câu đã chạy trước đó

| # | Prompt | Kết quả thực tế | Đánh giá |
|---:|---|---|---|
| 1 | “Tôi muốn mua tắc kê, bên bạn có những sản phẩm gì về tắc kê?” | **Đã trả lời.** Tìm thấy 3 nhóm: tắc kê đạn Đài Loan (6 quy cách), tắc kê nhựa Tiến Phát (11), tắc kê sắt (31). Liệt kê các cỡ có trong từng nhóm và gợi ý câu hỏi, ví dụ “Tắc kê đạn Đài Loan 8 ly có những quy cách nào?”. `lexicalProducts=3`, không dùng vector. | Đạt: có nhóm hàng và câu hỏi mẫu dựa trên dữ liệu. |
| 2 | “Tắc kê sắt có những quy cách nào?” | **Đã trả lời.** Tìm thấy 31 quy cách; mỗi dòng có giá hiện hành, đóng gói và nguồn. Ví dụ `8x100`: 30.000 ₫/10 con và 184.000 ₫/95 con. `lexicalProducts=31`, không dùng vector. | Đạt: liệt kê được cả danh sách và giá. |
| 3 | “Bulong 8 ly có quy cách gì?” | **Đã trả lời.** Tìm thấy 12 quy cách, gồm `8 ly x 1F5`, `8 ly x 1T2`, `8 ly x 2F`…; kết quả có giá và đóng gói. Có diễn giải `1F5 = 15 mm` và `1T2 = 120 mm`. `lexicalProducts=12`, không dùng vector. | Đạt: trả lời theo các biến thể có trong catalog. |
| 4 | “Giá tắc kê sắt 8 ly bao nhiêu?” | **Đã trả lời.** Có 4 biến thể: `8x60` (20.000 ₫/10; 116.000 ₫/95), `8x80` (25.000 ₫/10; 148.000 ₫/95), `8x100` (30.000 ₫/10; 184.000 ₫/95), `8x120` (35.000 ₫/10; 218.000 ₫/95). `lexicalProducts=4`, không dùng vector. | Đạt: truy vấn cỡ 8 ly trả đủ các chiều dài có giá. |
| 5 | “Giá tắc kê sắt 8x100 bao nhiêu?” | **Cần làm rõ.** Hệ thống tìm thấy mặt hàng nhưng hỏi chọn đóng gói `10 con/bịch` hay `95 con/bịch`, chưa trả cả hai giá ngay. `lexicalProducts=1`, không dùng vector. | Một phần: dữ liệu đã tìm thấy; có thể trả hữu ích hơn bằng cách liệt kê giá của cả hai gói. |
| 6 | “Thông tin về Bulong có tán 8 ly 1T2?” | **Chưa đủ dữ liệu.** Trả lời không tìm thấy mặt hàng/quy cách. `lexicalProducts=0`, không dùng vector. | Lỗi: câu 3 vừa tìm thấy biến thể `8 ly x 1T2`, nhưng nhánh hỏi thông tin không tìm lại được. |
| 7 | “Thông tin về Bulong có tán 8 ly 1F5?” | **Chưa đủ dữ liệu.** Trả lời không tìm thấy mặt hàng/quy cách. `lexicalProducts=0`, không dùng vector. | Lỗi: câu 3 vừa tìm thấy biến thể `8 ly x 1F5`, nhưng nhánh hỏi thông tin không tìm lại được. |
| 8 | “Đóng gói Bulong có tán 8 ly 1T2?” | **Chưa đủ dữ liệu.** Không tìm thấy mặt hàng/quy cách trong nhánh hỏi thông tin. `lexicalProducts=0`, không dùng vector. | Lỗi: dữ liệu đóng gói cần được tra cùng biến thể mà câu 3 đã tìm thấy. |
| 9 | “Giá máy khoan pin model XYZ123 bao nhiêu?” | **Chưa đủ dữ liệu.** Hệ thống từ chối báo giá khi không tìm được mặt hàng đã xác minh. `lexicalProducts=0`, không dùng vector. | Đạt: không bịa giá cho mặt hàng không có căn cứ. |
| 10 | “Giá tắc kê sắt 999 ly bao nhiêu?” | **Chưa đủ dữ liệu.** Không tìm thấy quy cách đã xác minh phù hợp. `lexicalProducts=0`, không dùng vector. | Đạt: không bịa giá cho quy cách không có trong catalog. |

## Nhận xét đợt 1

Trong 10 câu, 6 câu cho kết quả phù hợp với mục đích hỏi; 1 câu đã tìm thấy hàng nhưng hỏi lại về đóng gói; 3 câu hỏi thông tin/đóng gói Bulong thất bại dù danh sách biến thể xác nhận mặt hàng có tồn tại. Lỗi đáng ưu tiên là sự không nhất quán giữa nhánh liệt kê quy cách và nhánh tra thông tin/đóng gói.

Các câu trong đợt này đi theo fast path tra catalog/giá: `vectorChunks=0`, `embeddingModel=not_used`. Báo cáo này đánh giá luồng tra dữ liệu Supabase và câu hỏi gợi ý; **chưa đánh giá system prompt hoặc chất lượng câu trả lời do AI sinh**, vì harness đã chặn gọi AI provider.

## Cách chạy đợt 1

Đã xác nhận trước từng prompt được phân loại mà không gọi planner AI, sau đó chạy `queryRag` với `publicCatalogOnly: true`. Harness chặn network tới mọi host ngoài Supabase. Chỉ đọc dữ liệu; không cập nhật catalog hoặc giá.
## Đợt 2 — 15 prompt với nhiều cách hỏi

**Ngày chạy:** 2026-10-18  
**Môi trường:** service `queryRag`, `publicCatalogOnly: true`, catalog Supabase live. Mỗi prompt được kiểm tra trước để xác nhận đi qua fast path; harness chặn mọi host khác Supabase. Không gọi planner hoặc answer model, không ghi dữ liệu.

| # | Prompt | Kết quả thực tế | Đánh giá |
|---:|---|---|---|
| 1 | “Tôi muốn mua tắc kê sắt, bạn có không?” | **Đã trả lời:** 31 quy cách; mỗi dòng có giá lẻ, giá sỉ và nguồn. `vectorChunks=0`. | Đạt; câu hỏi có/không đang trả danh sách đầy đủ 31 dòng nên khá dài. |
| 2 | “Tôi muốn mua tắc kê sắt có quy cách nào?” | **Đã trả lời:** 31 quy cách đã xác minh, giá và nguồn. `vectorChunks=0`. | Đạt dữ liệu; câu trả lời rộng hơn mức hỏi. |
| 3 | “Tắc kê sắt có những quy cách nào?” | **Đã trả lời:** 31 quy cách, kèm giá và nguồn. | Đạt. |
| 4 | “Tắc kê sắt 8 ly có những quy cách nào?” | **Đã trả lời:** `8x60`, `8x80`, `8x100`, `8x120`, mỗi cỡ có hai giá gói hiện hành. | Đạt; lọc theo đường kính đúng. |
| 5 | “Tắc kê sắt 8x100 giá bao nhiêu?” | **Cần làm rõ:** tìm thấy đúng biến thể nhưng hỏi chọn `10 con/bịch` hay `95 con/bịch`. | Một phần; nên trả luôn cả hai giá khi người dùng chưa chỉ định gói. |
| 6 | “Giá lẻ tắc kê sắt 8x100 bao nhiêu?” | **Đã trả lời:** 30.000 ₫/10 con. | Đạt; nhận đúng tầng giá lẻ. |
| 7 | “Tắc kê sắt 8x100 giá sỉ bao nhiêu?” | **Đã trả lời:** 184.000 ₫/95 con. | Đạt; nhận đúng tầng giá sỉ. |
| 8 | “Giá tắc kê sắt 8x100 gói 10 con?” | **Chưa đủ dữ liệu:** trả 0 kết quả dù biến thể và gói 10 con có trong catalog. | Lỗi; cách diễn đạt “gói 10 con” chưa khớp với dữ liệu đóng gói `10 con/bịch`. |
| 9 | “gia tac ke sat 8x100 bao nhieu” | **Cần làm rõ:** tìm thấy đúng biến thể nhưng hỏi chọn hai gói. | Một phần; bỏ dấu tiếng Việt được, nhưng giá chưa được trả cùng lúc. |
| 10 | “Giá tắc kê sắt 8×100 bao nhiêu?” | **Cần làm rõ:** tìm thấy đúng biến thể nhưng hỏi chọn hai gói. | Một phần; nhận được dấu nhân `×`, cùng vấn đề hỏi gói. |
| 11 | “Bạn có sản phẩm gì về tắc kê?” | **Chưa đủ dữ liệu:** 0 nhóm sản phẩm. Planner tách `productText` thành `Bạn tắc kê`. | Lỗi phân tích câu; cần bỏ từ xưng hô “Bạn” trước khi tìm catalog. |
| 12 | “Thông tin bulong 8 ly x 1F5” | **Chưa đủ dữ liệu:** 0 quy cách. Planner tạo `productText=bulong x` dù catalog có biến thể bulong. | Lỗi; nhánh hỏi thông tin chưa tận dụng danh sách quy cách đã xác minh. |
| 13 | “Đóng gói tắc kê sắt 8x100 thế nào?” | **Chưa đủ dữ liệu:** 0 quy cách. Planner tạo `productText=tắc kê thế`. | Lỗi phân tích câu; cụm hỏi “thế nào” bị dính vào tên mặt hàng. |
| 14 | “Giá máy khoan pin model XYZ123 bao nhiêu?” | **Chưa đủ dữ liệu:** không tìm thấy mặt hàng. | Đạt; không bịa giá. |
| 15 | “Giá tắc kê sắt 999 ly bao nhiêu?” | **Chưa đủ dữ liệu:** không tìm thấy quy cách. | Đạt; không bịa giá cho cỡ không có trong catalog. |

### Nhận xét đợt 2

Trong 15 prompt live, 6 câu trả lời đúng theo dữ liệu, 2 câu từ chối có căn cứ vì không có dữ liệu, 3 câu tìm thấy biến thể nhưng hỏi lại về gói, và 4 câu truy vấn thất bại do cụm từ hội thoại lọt vào tên mặt hàng hoặc nhánh hỏi thông tin không tìm đúng biến thể. Lỗi ưu tiên là nhận dạng cụm hỏi “Bạn có sản phẩm gì…”, “đóng gói … thế nào”, và cách gọi quy cách bulong `1F5`; kế tiếp là hiểu “gói 10 con” và trả cả hai lựa chọn giá khi chưa nêu loại gói.

Cả 15 câu đều dùng tra cứu catalog Supabase; `vectorChunks=0`, `embeddingModel=not_used`. Đây là luồng truy vấn SQL/lexical trên danh mục, không phải thử nghiệm chunking, embedding hay chất lượng câu trả lời do model sinh. Câu tư vấn chọn tắc kê theo ứng dụng và câu so sánh hai quy cách cần planner/answer model nên không được gọi trong đợt chạy này.

**Cách chạy đợt 2:** chạy `queryRag` trực tiếp với `publicCatalogOnly: true`; trước mỗi câu, truyền generator chặn để xác nhận planner không gọi model. Harness chỉ cho phép hostname Supabase, chặn các host khác, và chỉ đọc catalog/giá hiện hành.

## Kiểm tra lại sau khi sửa

**Ngày chạy:** 2026-10-18. Chạy lại trực tiếp trên Supabase bằng `queryRag`, catalog công khai; harness chỉ cho phép kết nối tới hostname Supabase và chặn mọi host khác. Các câu đều không gọi planner AI, không dùng embedding và không ghi dữ liệu.

| Prompt | Kết quả sau sửa | Kết luận |
|---|---|---|
| “Bạn có sản phẩm gì về tắc kê?” | Tìm thấy 3 nhóm đã xác minh: tắc kê đạn Đài Loan (6 quy cách), tắc kê nhựa Tiến Phát (11), tắc kê sắt (31); có gợi ý câu hỏi tiếp theo. | Đã bỏ từ xưng hô khỏi truy vấn. |
| “Thông tin bulong 8 ly x 1F5” | Tìm thấy “Bulong có tán — 8 ly x 1F5”, diễn giải `1F5 = 15 mm`, có thông tin đóng gói và trang nguồn 5. | Đã đưa kích thước/mã quy cách vào truy vấn lexical; trước đây tìm “bulong” đơn lẻ nên bỏ lỡ biến thể nằm ngoài top kết quả. |
| “Đóng gói tắc kê sắt 8x100 thế nào?” | Tìm thấy quy cách 8x100 cùng các gói 10 con/bịch và 95 con/bịch. | Cụm “thế nào” không còn dính vào tên hàng. |
| “Giá tắc kê sắt 8x100 gói 10 con?” | Trả 30.000 ₫ giá lẻ cho gói 10 con/bịch. | Lọc theo số lượng và đơn vị, không đòi từ “gói” phải trùng tên bao bì “bịch”. |
| “Giá tắc kê sắt 8x100 bao nhiêu?” | Trả cả hai giá hiện hành: 30.000 ₫/10 con giá lẻ và 184.000 ₫/95 con giá sỉ. | Không hỏi vòng lại khi câu hỏi chưa chỉ định gói. |
| “gia tac ke sat 8x100 bao nhieu” và “Giá tắc kê sắt 8×100 bao nhiêu?” | Cả hai đều trả đúng hai giá trên. | Giữ xử lý được câu không dấu và dấu nhân `×`. |

Mọi kết quả trên có `vectorChunks=0`, `embeddingModel=not_used`; fast path tra catalog Supabase trực tiếp. Mã sản phẩm, quy cách, giá và gói hiển thị trong bảng là bằng chứng được đối chiếu lúc chạy.

Kiểm tra lại thêm hai prompt cũ về Bulong có tán `8 ly x 1T2`: cả câu hỏi thông tin và đóng gói đều tìm đúng biến thể, diễn giải `1T2 = 120 mm`, gói 10 bộ và 100 bộ; `vectorChunks=0`, `lexicalProducts=1`.

## Browser E2E sau khi sửa

Chạy Playwright với cấu hình mock cô lập, không dùng Supabase production và không gọi AI provider, trên Chromium desktop và mobile:

- Lượt đầy đủ đầu: **94 đạt, 12 skip**.
- Lượt lặp mặc định: **93 đạt, 12 skip, 1 lỗi** tại screenshot của test mobile `storefront-design.spec.ts` (`Page.captureScreenshot: Unable to capture screenshot`); không phải assertion RAG.
- Cô lập test mobile liên quan, lặp 5 lần: **10/10 đạt**.
- Chạy lại đầy đủ với `--workers=5`: **94 đạt, 12 skip**.

12 test skip là 6 test integration chạy trên hai browser project; cấu hình chỉ bật chúng khi có project Supabase test biệt lập và tài khoản test. Bằng chứng hiện tại phù hợp với một lỗi chụp ảnh Chromium chập chờn khi suite chạy tải cao; test tái hiện đã đạt khi cô lập và toàn suite đã đạt ở lượt xác nhận cuối.


