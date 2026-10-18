# Đặt đơn khách và tạo đơn tại quầy

## Tạo đơn từ báo giá

Nhân viên có thể chọn hàng bằng luồng tra cứu hiện có → **Thêm vào báo giá** → mở báo giá → **Tạo đơn hàng**. Form lấy sẵn từng dòng giá và số lượng gói đã chọn, mở ngay phần thông tin khách. Không cần chọn lại mặt hàng hay quy cách. Giá không còn công bố hoặc thay phiên bản sẽ yêu cầu kiểm tra lại trước khi gửi.

Hủy hoặc gửi lỗi vẫn giữ báo giá ban đầu; thử lại ngay trong form dùng cùng khóa để tránh trùng đơn. Chỉ khi nhận được biên nhận thành công mới xóa báo giá và mở danh sách đơn với mã vừa tạo. F1/F4 không mở chồng màn hình khi hộp đơn đang mở.

Khách xem danh sách và đặt ngay tại `/shop`; tên khách và số điện thoại là bắt buộc ở bước gửi. Browser test kiểm tra để trống tên không phát sinh yêu cầu đặt đơn, sau đó điền đầy đủ thì gửi được.

## Cách sử dụng

- Khách: `/shop` → chọn hàng, quy cách, đóng gói và loại giá → thêm vào giỏ → điền liên hệ → gửi yêu cầu.
- Chủ cửa hàng/biên tập viên: `/staff` → **Đơn khách đặt → Tạo đơn** → chọn hàng từ bảng giá hiện hành → thêm vào đơn → điền liên hệ → gửi. Tạo thành công sẽ trở về danh sách và tải đơn từ máy chủ.
- Trong danh sách: đánh dấu đã gọi khách, xác nhận hoặc hủy. Người chỉ có quyền xem không được tạo hay xử lý đơn.

## Nguyên nhân và thay đổi

1. Cấu hình ký đơn bị thiếu ở backend và database, khiến luồng gửi công khai trả lỗi. Đã cấu hình khóa tương ứng trong môi trường local/private và khởi động lại backend; không lưu khóa trong mã nguồn.
2. Đơn khách đặt chưa có biểu mẫu tạo đơn tại quầy. Đã bổ sung biểu mẫu và API xác thực, dùng chung RPC có kiểm tra giá, phiên bản và số lượng tối thiểu với luồng khách.
3. Lỗi cập nhật trạng thái từng làm biến mất bảng đang tải thành công. Đã tách lỗi tải bảng và lỗi cập nhật; tải lại thành công sẽ xóa thông báo cập nhật cũ.
4. Đã sửa màu chữ/bảng trong hộp đơn ở chế độ tối.
5. Nếu tạo đơn thành công nhưng mất phản hồi, gửi lại cùng khóa sẽ nhận biên nhận tạo ban đầu, kể cả khi nhân viên đã xử lý đơn. Trạng thái xử lý trong database vẫn được giữ nguyên. Migration mới: `202610180013_stable_customer_order_receipts.sql`.

## Kiểm chứng

- Unit tests toàn dự án: 2 dev-runner + 83 frontend + 353 backend, đạt.
- Browser tests: 20 lượt desktop Chromium và mobile Pixel 7, đạt; kiểm tra đặt hàng công khai, tạo đơn tại quầy, gửi lại, tải lại bảng, cập nhật trạng thái và hồi quy tra cứu/thêm báo giá.
- Regression SQL đã tái hiện lỗi gửi lại sau chuyển trạng thái, sau đó đạt với bản sửa trên Supabase. Test chạy trong transaction rollback, không lưu đơn thử.
- Lint, typecheck, OpenAPI check và production build: đạt.
- Backend đã khởi động lại; API health và trang shop trả HTTP 200.

Browser tests dùng API giả lập; chưa gửi một đơn giá hợp lệ vào database thực để tránh để lại đơn giả. Kiểm tra API thực đã xác nhận route yêu cầu đăng nhập và RPC từ chối mã giá không tồn tại đúng cách.

Chỉ migration `202610180013` được áp dụng và ghi nhận trong lịch sử ở bước chốt này. Hai migration RAG `202610180011–012` vẫn chưa áp dụng; không đẩy kèm các thay đổi đó.

## Sửa tiếp lỗi tải danh sách trên database thật

Sau triển khai, người dùng vẫn gặp thông báo không tải được đơn; backend ghi nhận HTTP 503. Truy vấn dưới role `authenticated` trên Supabase tái hiện lỗi `permission denied for function get_current_app_role`. Chính sách RLS của cả bảng đơn và dòng hàng gọi helper này, nhưng migration hardening trước đây đã thu hồi quyền EXECUTE của role đăng nhập. Kiểm thử UI dùng API giả lập trước đó chưa phát hiện thiếu quyền database này.

Đã áp dụng riêng migration `202610180014_customer_order_role_helper_access.sql`, cấp EXECUTE helper cho `authenticated`. Hàm chỉ trả vai trò của chính người gọi; RLS vẫn giới hạn đơn cho owner/editor. Không cấp quyền cho anon hay PUBLIC, không đổi chính sách RLS, không mở quyền đọc đơn cho viewer.

Regression mới `supabase/tests/customer_order_inbox_access.sql` chạy trên Supabase thật trong transaction rollback: owner/editor đọc được đơn và dòng hàng, cập nhật được trạng thái; viewer không đọc được và không cập nhật được; anon không có quyền đọc bảng hay chạy helper. Test đã thất bại trước sửa và thành công sau khi áp dụng. Mọi tài khoản và đơn thử được rollback. Đây là sửa quyền database nên không cần restart backend hoặc đăng nhập lại.
