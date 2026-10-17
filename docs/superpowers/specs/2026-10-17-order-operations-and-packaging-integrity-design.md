# Đơn khách, xử lý tại cửa hàng và đơn vị bao bì — đặc tả

## Mục tiêu

Khách có thể xem lại chính xác yêu cầu mua trước khi gửi; cửa hàng nhận và xử lý được đơn đã gửi. Mọi màn hình giữ đúng mối liên hệ giữa mặt hàng, quy cách đóng gói, đơn vị bán, số lượng, giá và thành tiền. Gửi lại sau lỗi mạng không được âm thầm tạo đơn trùng.

## Story và phạm vi

- **ORD-01:** nhân viên xem danh sách, mở chi tiết và chuyển trạng thái đơn trong phạm vi backend cho phép.
- **ORD-02:** khách kiểm tra thông tin liên hệ, giỏ và tạm tính; sửa lỗi hoặc xác nhận giá mới trước khi gửi.
- **PRICE-02:** giá và đơn vị bán luôn khớp với đúng bao bì đã chọn.
- **Audit A1–A2:** sửa nhãn số lượng sai đơn vị và lỗi vượt giới hạn API không chỉ dẫn người dùng cách khắc phục.

Đặc tả này bổ sung [luồng đặt hàng khách hàng đã duyệt](2026-10-16-customer-order-flow-design.md), không thay thế luồng tạo đơn nháp hay báo giá nội bộ của nhân viên.

## Quy tắc dữ liệu và nghiệp vụ

- SQL là nguồn chuẩn cho giá. Client gửi mã giá, phiên bản và số lượng; server đọc lại giá, trạng thái, hạn hiệu lực, ngưỡng tối thiểu và bao bì trước khi tính tiền hoặc ghi đơn.
- Đơn vị bán là tên bao bì được lưu cho dòng giá, ví dụ `bịch`, `hộp`, `cuộn`. Đơn vị cơ sở như `cái` hoặc `mét` chỉ mô tả lượng chứa trong bao bì. Không gắn cứng nhãn `/gói` hoặc suy bao bì từ tên mặt hàng.
- Nếu một bao bì chứa `N` đơn vị cơ sở, số lượng đặt vẫn là số bao bì bán; thành tiền bằng `số bao bì × giá của chính bao bì đó`. Chỉ hiển thị lượng cơ sở tương đương khi phép đổi dùng đúng `package_quantity` của cùng biến thể và bao bì.
- Ngưỡng tối thiểu được diễn đạt theo đơn vị mà API kiểm tra. Nếu API kiểm tra số bao bì, UI ghi số bao bì; có thể kèm lượng cơ sở quy đổi khi xác định được chính xác.
- Nếu thiếu hoặc không xác định tên đơn vị bán, không tự đoán. Không cho gửi mặt hàng đó và chỉ rõ cần cửa hàng cập nhật dữ liệu.
- Mọi dòng đơn lưu ảnh chụp tên sản phẩm, quy cách, bao bì, loại giá, số lượng, đơn giá, thành tiền và đơn vị tại thời điểm gửi. Chỉnh sửa giá về sau không làm thay đổi nội dung đơn cũ.
- Đơn khách là yêu cầu để cửa hàng xác nhận. Không thu tiền, không hứa phí giao, không trừ tồn kho và không coi đơn là doanh thu.

## Luồng khách gửi đơn

1. Tại giỏ, khách thấy tên hàng, quy cách, loại giá, đơn vị bao bì, lượng trong bao bì, số lượng đang đặt, đơn giá và thành tiền từng dòng. Tổng cộng được tính từ các dòng hợp lệ.
2. Trước khi gửi, khách xem lại tên/số điện thoại bắt buộc, địa chỉ và ghi chú giao hàng tùy chọn, giỏ và lời nhắc rằng cửa hàng sẽ gọi xác nhận.
3. Client chặn trường bắt buộc thiếu, số lượng không hợp lệ, quá 50 dòng hoặc quá 10.000 đơn vị bán mỗi dòng theo hợp đồng API hiện có. Lỗi xuất hiện cạnh trường/dòng cần sửa; nút gửi không bật khi form chưa hợp lệ.
4. Backend xác minh lại quyền bán, trạng thái đã duyệt, hạn giá, phiên bản và số lượng tối thiểu. Khi giá thay đổi, trả xung đột có dữ liệu báo giá mới; UI giữ thông tin liên hệ và giỏ, đánh dấu dòng đổi giá và yêu cầu khách xem/xác nhận lại trước lần gửi mới.
5. Mỗi lượt checkout có một khóa idempotency ổn định. Backend lưu ánh xạ khóa, hash payload đã chuẩn hóa và mã yêu cầu trong cùng giao dịch tạo đơn; các lần retry cùng khóa/nội dung trả lại cùng biên nhận, còn cùng khóa với nội dung khác bị từ chối. Giữ khóa đủ lâu để retry sau timeout (tối thiểu 24 giờ). Chỉ tạo khóa mới sau khi khách sửa giỏ hoặc bắt đầu lượt gửi mới. Nonce/chữ ký chống replay hiện có tiếp tục bảo vệ request, nhưng không thay thế idempotency khi lỗi mạng.
6. Chỉ hiển thị thành công sau khi server trả biên nhận hợp lệ. Khi timeout hoặc lỗi, giữ giỏ và dữ liệu liên hệ để khách thử lại mà không tạo yêu cầu thứ hai.

## Luồng nhân viên xử lý đơn

- Hộp thư lấy dữ liệu từ API đã xác thực. Có trạng thái tải, lỗi có thể thử lại, danh sách rỗng và danh sách có đơn; lỗi tải không được trình bày như cửa hàng không có đơn.
- Mỗi hàng hiển thị mã tham chiếu, khách, thời điểm, trạng thái, số dòng và tổng tiền đã chụp. Mở đơn hiển thị toàn bộ dòng với quy cách/bao bì/đơn vị/số lượng/đơn giá/thành tiền tại thời điểm khách gửi, cùng thông tin giao hàng khách đã cung cấp.
- Chuyển trạng thái theo máy trạng thái hiện hành: `pending_confirmation` → `contacted`, `confirmed` hoặc `cancelled`; `contacted` → `confirmed` hoặc `cancelled`; trạng thái kết thúc không được sửa lại bằng UI nếu backend từ chối.
- Quyền đọc và cập nhật đơn do API/RLS quyết định. Chỉ hiện thao tác thành công sau phản hồi server; khi xung đột/lỗi, giữ chi tiết đang xem và cập nhật trạng thái từ server.

## Xử lý lỗi và trạng thái

- **Giá đổi/không còn hợp lệ:** không tạo đơn; tải báo giá mới, đánh dấu dòng bị ảnh hưởng, giữ form và yêu cầu xác nhận lại.
- **Số lượng hoặc số dòng vượt giới hạn:** chỉ lỗi đúng dòng/trường; cho sửa hoặc xóa để tiếp tục. Giới hạn UI lấy từ cùng hợp đồng API, không nới giới hạn ở client.
- **Mạng/API lỗi:** không xóa giỏ, không làm rỗng form, không báo gửi thành công. Retry dùng lại khóa idempotency hiện tại.
- **Dữ liệu đơn cũ thiếu metadata bao bì:** hiển thị đúng giá trị đã lưu và nhãn thiếu thông tin; không suy diễn từ tên sản phẩm.
- **Tải hộp thư lỗi:** phân biệt lỗi, đang tải và rỗng; có nút thử lại rõ ràng.

## Tiêu chí nghiệm thu

1. Bao bì `bịch`, `hộp`, `cuộn` hiển thị đúng ở thẻ hàng, giỏ, xác nhận và chi tiết đơn; không còn nhãn đơn vị bán mặc định sai.
2. Tạm tính mỗi dòng bằng số lượng đơn vị bán nhân giá của đúng mã giá/bao bì; tổng đơn bằng tổng các dòng, khớp số server xác nhận.
3. Ngưỡng tối thiểu giá sỉ được diễn đạt đúng theo đơn vị server kiểm tra. Ca ngưỡng 1, ngưỡng 5 và ngưỡng chưa biết không hiển thị số lượng quy đổi gây hiểu sai.
4. Giá/phiên bản đổi trước khi gửi yêu cầu khách xem và xác nhận lại; giỏ và thông tin liên hệ vẫn còn.
5. Gửi hai lần do double-click hoặc retry sau timeout với cùng khóa chỉ tạo một yêu cầu; retry trả cùng mã tham chiếu. Cùng khóa nhưng nội dung khác bị từ chối.
6. 10.000/10.001 đơn vị bán mỗi dòng và 50/51 dòng được kiểm tra nhất quán ở UI và API; lỗi chỉ đúng vị trí, khách sửa được và gửi lại được.
7. Hộp thư nhân viên phân biệt loading/error/empty, hiển thị snapshot đúng và chỉ cho chuyển trạng thái hợp lệ.
8. Khách ẩn danh không thể đọc hoặc cập nhật đơn; nhân viên chỉ thấy và sửa đơn theo quyền backend hiện có.

## Kiểm thử cần có

- Unit: format đơn vị/bao bì, ngưỡng tối thiểu, tính tổng theo đơn vị bán và validation giới hạn.
- API/repository/SQL cô lập: giá đổi giữa báo giá và gửi, giá hết hạn, mặt hàng bị bỏ duyệt, snapshot đơn, idempotency cùng request/lệch payload, chuyển trạng thái hợp lệ và trái phép, RLS đối với khách và nhân viên.
- Browser: checkout bình thường; lỗi trường; 10.000/10.001 và 50/51; giá đổi; timeout rồi retry; double-click; dữ liệu giỏ được giữ; hộp thư loading/error/empty/detail/status; desktop và mobile.
- Kiểm tra thủ công với các loại bao bì có dữ liệu đã xác nhận trước khi kết luận đơn vị thương mại đúng.

## Ngoài phạm vi

Thanh toán, chốt phí giao, tính phí vận chuyển tự động, quản lý tồn kho, phát hành hóa đơn, thay đổi quyền nhân viên và sửa dữ liệu giá hàng loạt.

## Tài liệu liên quan

- [Thiết kế luồng đặt hàng khách hàng](2026-10-16-customer-order-flow-design.md)
- [User story tra cứu giá đúng mặt hàng/quy cách](../../PRICE_QUERY_USER_STORIES.md)
- [UI audit ngày 16/10/2026](../../UI_AUDIT_3_AGENTS_2026-10-16.md), phát hiện A1–A2
