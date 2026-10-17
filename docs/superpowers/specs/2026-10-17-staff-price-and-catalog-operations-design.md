# Tra cứu danh mục và cập nhật giá cho nhân viên — đặc tả

## Mục tiêu

Nhân viên tìm được đúng mặt hàng/quy cách trong danh mục, xem được trạng thái dữ liệu và mở đúng biểu mẫu cập nhật. Việc chỉnh sửa giá tách khỏi thao tác tra cứu/bán hàng nhưng dùng chung nguồn dữ liệu và giữ nguyên quyền ghi có kiểm toán.

## Story và phạm vi

- **PRICE-01:** trang riêng để tìm mặt hàng rồi cập nhật thông tin hoặc giá.
- **Audit A3–A5:** hiển thị đúng ngưỡng giá sỉ/bao bì; phân biệt trạng thái tải lỗi, cache, danh mục rỗng và lọc không có kết quả.
- **CATALOG-01:** là luồng tìm kiếm khách đã có trong backlog và phần triển khai hiện hữu; spec này chỉ ghi nhận tích hợp, không định nghĩa lại RPC hay UX khách.

Đặc tả này không thay đổi quyền truy cập hay cách quản lý giá đã quy định trong [epic trợ lý vật tư](2026-10-17-ai-material-assistant-epic-design.md), [luồng đơn khách](2026-10-16-customer-order-flow-design.md) và [user story tra giá](../../PRICE_QUERY_USER_STORIES.md).

## Điều hướng và luồng làm việc

1. Nhân viên vào mục riêng **Cập nhật & sửa giá** từ workspace. Mục này mở quy trình chỉnh sửa tách khỏi **Tra cứu & bán hàng** và **Báo giá quầy**.
2. Tìm theo tên, tên gọi khác, mã hàng/SKU hoặc quy cách; hỗ trợ không dấu theo hợp đồng tìm kiếm hiện có. Kết quả thể hiện đủ nhóm hàng, tên, mã nếu có, quy cách và trạng thái để chọn đúng bản ghi.
3. Chọn kết quả mở đúng sản phẩm, biến thể, bao bì và các mức giá liên quan. Trước khi lưu, nhân viên nhìn thấy rõ thuộc tính sản phẩm, quy cách, đơn vị bán, lượng cơ sở trong bao bì, loại giá, số lượng tối thiểu, hiệu lực và trạng thái duyệt.
4. Lưu bằng API/RPC ghi giá đang được phân quyền và kiểm toán. Server kiểm tra vai trò, `expected_version`, trạng thái bản ghi và quy tắc nghiệp vụ. Nếu phiên bản thay đổi, báo xung đột và nạp dữ liệu mới; không ghi đè âm thầm.
5. Sau cập nhật thành công, xác nhận trường đã đổi, phản ánh giá/bao bì mới vào danh mục và lịch sử, rồi cho quay lại trang tra cứu. Sửa giá không tự chuyển biến thể chưa duyệt sang đã duyệt.

## Quy tắc giá và đơn vị

- `prices.amount` là giá chuẩn; UI không chia, chuẩn hóa, quy đổi hoặc thay giá để làm các bao bì so sánh được.
- Giá gắn với bao bì được lưu cho dòng giá. Không suy tên bao bì từ tên sản phẩm hoặc map ngoại lệ theo tên hàng như `Móc U`.
- `minimum_quantity` được hiển thị theo đơn vị mà API và thao tác chọn giá áp dụng. Nếu hiển thị thêm lượng cơ sở tương đương, phép tính dùng lượng trong chính bao bì đó và ghi cả hai đơn vị. Nếu metadata không đủ, chỉ hiển thị ngưỡng theo bao bì hoặc báo thiếu dữ liệu.
- Mức “Giá sỉ từ…” lấy từ ngưỡng tối thiểu của dòng giá sỉ đủ điều kiện; không lấy số lượng bao bì lẻ tối thiểu thay thế. Không gộp ngưỡng của biến thể/bao bì khác nhau thành một ngưỡng chung.
- Giá trên trang tra cứu, chi tiết, báo giá và câu trả lời RAG tiếp tục lấy từ SQL/API hiện hành. Chỉnh một dòng không làm đổi dòng khác có bao bì hoặc phiên bản riêng.
- Lịch sử giá giữ khả năng truy vết; thao tác cập nhật không xóa hoặc sửa bản ghi lịch sử.

## Trạng thái danh mục

Giao diện phân biệt các tình huống sau thay vì gom thành danh sách rỗng:

- **Đang tải:** hiện trạng thái tải; không khẳng định số kết quả cuối cùng.
- **Tải lỗi, có cache:** hiện dữ liệu cache cùng thời điểm lưu và nhãn chưa đồng bộ; có hành động thử lại. Cache chỉ để đọc, không dùng lưu sửa giá.
- **Tải lỗi, không có cache:** thông báo không tải được danh mục và nút thử lại; không hiện “0 mặt hàng”.
- **Tải thành công nhưng không có bản ghi:** thông báo danh mục hiện rỗng.
- **Lọc không có kết quả:** nêu từ khóa/bộ lọc hiện tại và cho xóa riêng bộ lọc hoặc từ khóa; dữ liệu nguồn vẫn được coi là tải thành công.

## Quyền và an toàn

- Không cấp role hoặc quyền DB mới. Client có thể ẩn nút nhưng backend/RLS vẫn quyết định ai được đọc và ghi.
- Chỉ người dùng đã xác thực với quyền ghi hiện có mới cập nhật giá; người không đủ quyền bị server từ chối.
- Không duyệt dữ liệu OCR hoặc chuyển trạng thái sang verified như hệ quả phụ của sửa giá. Quy trình duyệt giữ theo workflow hiện hành.
- Lỗi UI không tiết lộ SQL, secret hoặc thông tin xác thực; log dùng request ID và không ghi dữ liệu nhạy cảm.

## Tiêu chí nghiệm thu

1. Có mục **Cập nhật & sửa giá** riêng; nhập ở đây không đổi truy vấn catalog hay nội dung hội thoại RAG.
2. Tìm được theo tên, alias, mã/SKU và quy cách; tìm không dấu theo hợp đồng catalog hiện có. Kết quả chọn mở đúng ID sản phẩm/biến thể/bao bì.
3. Biểu mẫu phân biệt thuộc tính sản phẩm với từng dòng giá. Bao bì, đơn vị, lượng chứa, ngưỡng, loại giá và hiệu lực không nhập nhằng.
4. Giá hiển thị giữ nguyên số tiền SQL. Các ca giá sỉ ngưỡng 1, ngưỡng 5 và chưa xác định được ngưỡng không bị diễn đạt sai.
5. Bao bì `hộp`, `bịch`, `cuộn` và sản phẩm mới không bị ép nhãn theo tên legacy; hiển thị tên bao bì nguồn hoặc dữ liệu chuẩn hóa đã được xác nhận.
6. Cập nhật gửi đúng `expected_version`; xung đột không ghi đè, dữ liệu mới được nạp lại và lịch sử giá truy vết được.
7. Lỗi API không hiển thị thành “0 mức giá” hay “không có mặt hàng”; cache có nhãn riêng và không cho lưu khi offline.
8. Người không có quyền không thể ghi qua API dù gọi trực tiếp; quyền hiện hữu của viewer/owner/editor tiếp tục đúng hợp đồng.

## Kiểm thử cần có

- Unit: ngưỡng theo đơn vị bán, định dạng giá, mapping bao bì, trạng thái cache và lọc không kết quả.
- API/repository: lọc alias/SKU/quy cách, ID được chọn, quyền ghi, xung đột phiên bản, lịch sử và validation.
- Browser: tìm trên trang riêng, mở đúng biến thể/bao bì, lỗi tải và cache, rỗng thật vs rỗng do lọc, giá sỉ theo ngưỡng, xung đột khi người khác sửa, responsive và bàn phím.
- SQL regression cô lập nếu thay đổi RPC, RLS hoặc schema. Không dùng production làm môi trường kiểm thử.

## Ngoài phạm vi

Thay thiết kế catalog khách hàng, sửa giá tự động từ OCR, duyệt OCR, thay cơ chế xác thực/role, sửa giá hàng loạt và thay đổi thuật toán tính tổng báo giá.

## Tài liệu liên quan

- [User story tra cứu giá đúng mặt hàng/quy cách](../../PRICE_QUERY_USER_STORIES.md)
- [UI audit ngày 16/10/2026](../../UI_AUDIT_3_AGENTS_2026-10-16.md), phát hiện A3–A5
- [Epic trợ lý vật tư có căn cứ](2026-10-17-ai-material-assistant-epic-design.md)
- [Thiết kế liệt kê nhóm quy cách RAG](2026-10-17-rag-product-variant-listing-design.md)
