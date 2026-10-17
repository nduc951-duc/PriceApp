# Độ tin cậy giao diện tra giá khách và nhân viên — đặc tả

## Mục tiêu

Sửa các lỗi hiển thị và thao tác đã được tái hiện trong audit, giúp người dùng luôn biết đang nhập ở đâu, đang ở chế độ nào và kết quả có dùng được hay không. Đây là đợt sửa theo phát hiện, không phải thay giao diện toàn bộ sản phẩm.

## Story và phạm vi

- **UI-01:** khung tìm kiếm rõ, không chồng viền, icon hay phím tắt.
- **UI-02:** trang chọn khu vực và nút dễ đọc ở cả sáng/tối; thay đổi khu vực giao diện không đổi quyền.
- **UI-03:** thẻ nhóm hàng lọc trực quan trên điện thoại.
- **Audit A7, A9, A10:** typography nhân viên, nội dung dài bị cắt và icon select đè chữ.
- **CATALOG-01:** giữ ô tìm catalog riêng với ô chat; tìm catalog chỉ đổi danh sách hàng.

Các phát hiện OCR A6/A8 thuộc [spec workbench OCR 13 trang](2026-10-16-rag-13-page-operator-workbench-design.md), không sao chép vào đây. Nội dung hỏi đáp, ý định RAG và liệt kê quy cách tuân theo [epic trợ lý vật tư](2026-10-17-ai-material-assistant-epic-design.md) và [spec liệt kê quy cách](2026-10-17-rag-product-variant-listing-design.md).

## Nguyên tắc giao diện

- Dùng control dùng chung của `flowbite-react` và Tailwind đã cấu hình. Không dựng lại Button/Input/Select/Card bằng CSS riêng; CSS riêng chỉ xử lý layout, responsive và token thương hiệu theo [quy tắc frontend](../../../frontend/AGENTS.md).
- Giữ mục tiêu thao tác cửa hàng: danh sách hàng, tìm kiếm, lựa chọn và trạng thái. Không thêm hero, KPI trang trí, gradient hoặc nhãn “AI” không giúp người dùng ra quyết định.
- Dùng typography dễ đọc tiếng Việt ở 100% zoom; giảm chữ hoa/monospace cho nhãn nghiệp vụ. Số tiền có thể dùng tabular numerals nhưng không thu nhỏ nội dung cần đọc.
- Tương phản, focus, hover, selected và disabled phân biệt ở theme sáng/tối. Theme không thay vai trò đăng nhập hay cho phép hành động backend cấm.
- Text dài phải xuống dòng trong container và giữ đủ nội dung; không chấp nhận test chỉ dựa vào `document.scrollWidth` nếu phần tử con bị `overflow:hidden` cắt.
- Search, category filter, price-tier filter và chat là điều khiển riêng. Lọc nhóm giữ từ khóa; xóa nhóm không xóa từ khóa; gửi câu hỏi AI không đổi bộ lọc.

## Hành vi theo thành phần

### Ô tìm kiếm và bộ lọc

- Nhãn truy cập, placeholder, icon, phím tắt và nút xóa không chiếm cùng vùng hoặc che chữ. Focus không làm đổi kích thước gây giật layout.
- Thẻ nhóm thể hiện trạng thái chọn bằng chữ và hình thức không chỉ dựa vào màu; có lựa chọn **Tất cả** để bỏ lọc. Trên màn hình hẹp, thẻ xuống hàng hoặc cuộn có kiểm soát mà không đẩy danh sách khỏi vùng thao tác.
- Kết quả/tổng số chỉ cập nhật sau khi API trả trạng thái thành công. Lỗi tải không hiện như danh sách rỗng; cache (nếu có) có nhãn riêng và thời điểm đồng bộ.
- Trạng thái hover/focus/selected/disabled có tương phản rõ. Dùng được bằng bàn phím, công nghệ hỗ trợ và thao tác chạm.

### Chọn khu vực khách/nhân viên và chế độ tối

- Card và nút lựa chọn khu vực có nền/chữ/viền dễ đọc trong light và dark mode; focus bàn phím nhìn thấy rõ.
- Chọn “Nhân viên” chỉ điều hướng tới xác thực; khách chưa đăng nhập không vào workspace. Thay đổi giao diện không sửa session, role, token hoặc quyền API.

### Văn bản và control nhân viên

- Nhãn nghiệp vụ có cỡ đọc được và câu chữ tiếng Việt tự nhiên; nhãn phụ tối thiểu 14px, nội dung chính tối thiểu 16px tại viewport desktop phổ biến. Phóng to 200% không che thao tác chính.
- Select có padding dành cho icon; chữ dài không đè mũi tên ở bề rộng responsive.
- Quy cách, tên hàng, alias dài và chuỗi không có dấu cách được bẻ dòng; vùng nội dung có `min-width: 0` phù hợp. Không cắt nội dung để giữ bề rộng trang.

## Tiêu chí nghiệm thu

1. Ở viewport 320px, 390px, tablet và desktop, placeholder, icon, phím tắt và viền ô tìm không chồng lấn hoặc che nhau.
2. Focus bàn phím rõ; di chuyển focus không gây nhảy kích thước; Enter/Space chọn thẻ lọc đúng và selected đọc được bằng công nghệ hỗ trợ.
3. Đổi nhóm hàng cập nhật sản phẩm và số kết quả, giữ từ khóa; gửi câu hỏi AI không làm thay đổi danh sách hoặc bộ lọc catalog.
4. Màn chọn khu vực, nút và trạng thái tương tác đọc được trong light/dark mode. Người chưa đăng nhập chọn nhân viên vẫn qua đăng nhập; quyền server không đổi.
5. Quy cách dài 100 ký tự hiển thị đầy đủ ở 320px và 390px; không bị cắt dù trang không cuộn ngang.
6. Select với nhãn dài không có vùng chữ giao icon ở bề rộng hẹp và khi zoom 200%.
7. Typography nhân viên giữ nhãn phụ tối thiểu 14px và nội dung chính tối thiểu 16px tại 100%; tiền và dấu tiếng Việt vẫn đọc rõ.
8. Loading, lỗi API, cache, tải thành công rỗng, lọc không khớp và có kết quả là các trạng thái riêng, với thông điệp/thao tác phù hợp.
9. Không thêm CSS thay thế không cần thiết cho control Flowbite; font fallback vẫn hiển thị đúng dấu tiếng Việt khi font mạng không tải.

## Kiểm thử cần có

- Component/unit: trạng thái lọc, focus/selected, giữ từ khóa khi đổi nhóm và mapping trạng thái dữ liệu.
- Browser: 320/390/768/1440px; light/dark; bàn phím; chuỗi dài 100 ký tự; select nhãn dài và zoom 200%; chọn nhân viên khi chưa đăng nhập; lọc catalog rồi hỏi RAG; lỗi API vs dữ liệu rỗng.
- Kiểm tra trực quan bằng ảnh chụp, đồng thời đo bounding box của nội dung cần đọc để phát hiện cắt/chồng. Không kết luận accessibility chỉ từ ảnh hoặc assertion không tràn ngang.
- Browser dùng API fixture hoặc Supabase local cô lập. Ghi rõ mock hay dữ liệu local; không dùng production làm môi trường kiểm thử UI.

## Ngoài phạm vi

Đổi thương hiệu, thiết kế lại toàn bộ storefront/POS, thay nghiệp vụ đơn hàng, thay logic giá, đổi flow OCR, thay role/RLS hoặc thêm animation trang trí.

## Tài liệu liên quan

- [UI audit ngày 16/10/2026](../../UI_AUDIT_3_AGENTS_2026-10-16.md)
- [User story tra cứu giá đúng mặt hàng/quy cách](../../PRICE_QUERY_USER_STORIES.md)
- [Kế hoạch chỉnh storefront](../plans/2026-10-16-storefront-redesign.md)
- [Spec workbench OCR 13 trang](2026-10-16-rag-13-page-operator-workbench-design.md)
- [Epic trợ lý vật tư có căn cứ](2026-10-17-ai-material-assistant-epic-design.md)
