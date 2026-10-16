# Epic: Tra cứu giá đúng mặt hàng, đúng quy cách

**Cập nhật:** 17/10/2026
**Phạm vi:** tìm kiếm giá cho nhân viên và khách hàng; hỏi làm rõ, đối chiếu nguồn và so sánh mặt hàng được nêu rõ.
**Mã story:** US-01–US-05 trong tài liệu này; độc lập với các mã lịch sử trong [roadmap RAG](PRICEAPP_RAG_ROADMAP.md).

## Quy tắc nghiệp vụ chung

- Giá hiện hành lấy từ SQL; RAG tìm đúng sản phẩm và bằng chứng nguồn. Mô hình không được tự tạo hoặc suy giá.
- Kết quả chỉ phù hợp khi tên hàng và thuộc tính được hỏi như mã, kích thước, loại hoặc quy cách không mâu thuẫn.
- Khi thiếu căn cứ, hỏi lại hoặc báo chưa tìm thấy; không ép khớp sản phẩm gần giống.
- Giữ đúng đơn vị tính, quy cách đóng gói, số lượng tối thiểu và nguồn theo dữ liệu hiện hành.

## US-01 — Tìm đúng mặt hàng khi câu hỏi đã cụ thể

**Là nhân viên hoặc khách hàng, tôi muốn hệ thống tìm đúng mặt hàng và quy cách mình đã nêu, để nhận được mức giá có thể đối chiếu và sử dụng.**

### Tiêu chí chấp nhận

- Khi câu hỏi khớp rõ một biến thể đã xác minh, chỉ trả biến thể đó, giá hiện hành, đơn vị và nguồn.
- Mã/quy cách cụ thể loại trừ các sản phẩm chỉ giống tên nhóm.
- Hiển thị rõ mức lẻ/sỉ và số lượng tối thiểu, phân biệt với số lượng đóng gói.
- Nếu tên hoặc quy cách không khớp chắc chắn, hỏi lại thay vì chọn biến thể gần giống.

**Ví dụ:** “Giá bánh xe Đỏ mận ĐL 1T2 là bao nhiêu?” chỉ hiển thị biến thể `Đỏ mận ĐL 1T2`; không kèm `1T`, `7F5`, loại khóa hoặc mặt hàng khác.

## US-02 — Được hỏi lại khi câu hỏi chưa đủ quy cách

**Là người tra giá, tôi muốn hệ thống hỏi thêm khi tên sản phẩm có nhiều quy cách, để chọn đúng mặt hàng mà không phải đọc danh sách dài.**

### Tiêu chí chấp nhận

- Với câu như “bánh xe giá bao nhiêu”, hỏi thuộc tính phân biệt cần thiết, chẳng hạn kích thước hoặc loại bánh.
- Có thể đưa ra một vài lựa chọn ngắn cùng nhóm, với thuộc tính phân biệt rõ; không đưa mặt hàng khác nhóm.
- Khi người dùng bổ sung quy cách, tìm lại theo thông tin mới và chỉ báo giá sau khi xác định biến thể.
- Nếu vẫn còn nhiều biến thể, hỏi tiếp; không tự chọn.

## US-03 — Báo chưa tìm thấy khi không có mặt hàng hoặc bằng chứng phù hợp

**Là người tra giá, tôi muốn hệ thống nói rõ khi không có mặt hàng hoặc giá phù hợp, để không nhầm kết quả gần giống với sản phẩm mình hỏi.**

### Tiêu chí chấp nhận

- Mặt hàng ngoài catalog: báo chưa tìm thấy và không đưa sản phẩm thay thế như câu trả lời.
- Mặt hàng không có giá hiện hành đã xác minh: báo chưa đủ căn cứ; không dùng giá cũ hoặc giá biến thể khác.
- Thiếu bằng chứng liên quan: không tự tạo giá, nguồn, đơn vị hoặc số trang.
- Câu hỏi ngoài phạm vi giá vật tư: trả lời ngắn gọn rằng chức năng này chỉ tra giá trong catalog.

**Ví dụ:** “Giá pizza Hawaii size L là bao nhiêu?” không được trả về bánh xe, vít hoặc mặt hàng bất kỳ.

## US-04 — So sánh đúng những mặt hàng được yêu cầu

**Là người tra giá, tôi muốn hệ thống chỉ so sánh các mặt hàng tôi nêu, để kết quả không bị lẫn sản phẩm khác.**

### Tiêu chí chấp nhận

- Khi yêu cầu nêu rõ từ hai mặt hàng, chỉ trả những mặt hàng đó, kèm quy cách, mức giá, đơn vị, điều kiện áp dụng và nguồn.
- Nếu thiếu dữ liệu cho một mặt hàng, nêu rõ mặt hàng nào chưa tìm thấy; không thay bằng mặt hàng gần giống.
- Nếu chỉ hỏi một sản phẩm, không tự mở rộng thành danh sách so sánh.

## US-05 — Đối chiếu giá và nguồn trên giao diện

**Là người tra giá, tôi muốn giá được ghi nhất quán giữa tóm tắt và thẻ sản phẩm, để biết chính xác mức giá áp dụng cho đơn vị nào.**

### Tiêu chí chấp nhận

- Các phần hiển thị cùng kết quả dùng cùng giá, đơn vị và quy cách đóng gói từ backend.
- Không ghi `/gói`, `/bịch` hoặc `/cái` nếu dữ liệu không xác nhận đơn vị đó.
- Nguồn sổ và trang phải hỗ trợ đúng mặt hàng hoặc mức giá đang hiển thị.
- Chưa xác định biến thể thì không có nút chọn giá/thêm giỏ.
- Truy vấn mới xóa kết quả truy vấn trước; trạng thái rỗng/thiếu dữ liệu không giữ thẻ cũ.

## Bộ kiểm thử tối thiểu

1. Tên và quy cách chính xác; cả tên thường gọi, cách viết khác và lỗi gõ nhẹ có đủ căn cứ.
2. Chỉ có tên nhóm: hỏi làm rõ; mặt hàng gần tên nhưng sai mã/quy cách không xuất hiện.
3. Mặt hàng ngoài catalog; mặt hàng có trong catalog nhưng không có giá hiện hành.
4. So sánh nhiều mặt hàng được nêu rõ; báo chính xác mục nào thiếu dữ liệu.
5. Giá, đơn vị, nguồn đồng nhất giữa tóm tắt, thẻ và thao tác chọn.
6. Truy vấn mới xóa kết quả cũ trên giao diện.

Không đánh dấu hoàn tất chỉ vì đã giảm số dòng hiển thị. Kết quả còn lại phải thật sự khớp ý định và quy cách người dùng hỏi.
