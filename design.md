# Design — Tra giá, đặt hàng và xử lý sổ giá

Ngày soạn: 16/10/2026. Trạng thái: đặc tả thiết kế để đối chiếu trước khi triển khai.

## 1. Mục tiêu và phạm vi

Thiết kế một công cụ bán hàng thực dụng cho cửa hàng Việt Nam: khách tìm hàng, hiểu quy cách và giá, chọn số lượng rồi gửi yêu cầu; nhân viên tra giá, xử lý yêu cầu và chuẩn bị dữ liệu sổ giá. Nội dung hàng hóa phải là trọng tâm của màn hình.

Tài liệu này cụ thể hóa các spec customer-order và RAG đã có. Chỉ thay đổi cách trình bày và tương tác được mô tả; không thay quy tắc giá, tự mở quyền dữ liệu hay tự bổ sung thanh toán.

Yêu cầu đã xác nhận:

- Có bước chọn Khách hàng / Nhân viên. Người chưa đăng nhập không được vào nghiệp vụ nhân viên.
- Khách xem được giá lẻ và giá sỉ công khai; gửi yêu cầu chờ cửa hàng xác nhận. Chưa thanh toán, chưa chốt phí giao hàng.
- Dùng component Tailwind từ thư viện, không tự dựng lại toàn bộ control.
- Tham khảo sản phẩm Việt Nam; tránh giao diện landing page quảng cáo, nội dung sáo rỗng và font lỗi tiếng Việt.
- OCR 13 trang phải có ảnh nguồn, chữ sửa được, nhập từng đoạn và lưu nháp. Duyệt/index vẫn tuân theo quyền và workflow hiện có.

Chưa có bộ nhận diện chính thức. Giữ tên hiện có trong ứng dụng; không tự sáng tác logo, slogan, hotline, ưu đãi hay cam kết giao hàng.

## 2. Nguồn tham khảo và cách sử dụng

Các nguồn dưới đây được truy cập ngày 16/10/2026. Phân biệt rõ điều nguồn mô tả và quyết định áp dụng cho dự án. Các kích thước, màu và breakpoint ở phần sau là thông số đề xuất của dự án, không phải thông số được sao chép từ các hãng.

| Mã | Nguồn chính thức | Điều rút ra | Áp dụng cho dự án |
|---|---|---|---|
| R1 | [Sapo — Tổng quan Web Order](https://help.sapo.vn/tong-quan-kenh-dat-hang-online-web-order) | Khách tự xem sản phẩm, nhập thông tin đặt hàng; đơn chuyển về hệ thống quản lý | Luồng danh mục → giỏ → thông tin liên hệ → gửi yêu cầu → nhân viên tiếp nhận. Không mang phần thanh toán của Sapo sang dự án |
| R2 | [KiotViet — Màn hình bán hàng](https://www.kiotviet.vn/man-hinh-ban-hang-tren-kiotviet-lot-xac-hoan-toan-moi/) | Tổ chức thao tác trên một màn hình, thiết kế phẳng, tìm kiếm hàng hóa và phím tắt | Màn hình nhân viên ưu tiên tìm kiếm, danh sách và báo giá; hạn chế chuyển trang trong một tác vụ |
| R3 | [Sapo — Giao diện tổng quan](https://help.sapo.vn/gioi-thieu-giao-dien-tong-quan-phan-mem-quan-ly-ban-hang-sapo) | Màn hình tổng quan phục vụ theo dõi kinh doanh | Dùng để phân biệt dashboard quản lý với màn hình bán hàng; không đưa KPI/doanh thu lên trang mua hàng |
| R4 | [Flowbite React — Table](https://flowbite-react.com/docs/components/table) | Component bảng dữ liệu | Bảng tra giá nhân viên và danh sách yêu cầu |
| R5 | [Flowbite React — Forms](https://flowbite-react.com/docs/components/forms) | Input, label, select, textarea và trạng thái biểu mẫu | Tìm kiếm, số lượng, liên hệ, chỉnh văn bản OCR |
| R6 | [Flowbite React — Drawer](https://flowbite-react.com/docs/components/drawer) | Panel mở cạnh màn hình | Giỏ hàng trên màn hẹp, xem chi tiết mặt hàng |
| R7 | [Flowbite — CRUD layouts](https://flowbite.com/blocks/application/crud/) | Bố cục danh sách kết hợp thao tác và drawer | Tham khảo nhóm toolbar, bảng và chi tiết; chỉ dùng mẫu có quyền sử dụng phù hợp |

Giới hạn nghiên cứu: đã đọc nội dung tài liệu và ví dụ component. Ảnh minh họa KiotViet và trang chủ Bách Hóa Xanh không tải được qua công cụ trong lượt này; không coi chúng là bằng chứng đã kiểm tra trực quan. Bài KiotViet có mốc thời gian không nhất quán trong nội dung, nên chỉ dùng nguyên tắc workflow, không gọi đây là giao diện mới nhất. Không sao chép thương hiệu hay tài sản hình ảnh của các hãng.

## 3. Đánh giá giao diện hiện tại

Từ ảnh người dùng và lượt kiểm tra localhost:

| Vấn đề | Tác động | Yêu cầu sửa |
|---|---|---|
| Màn hình chọn vai trò và phần giới thiệu chiếm nhiều diện tích | Chậm tiếp cận hàng hóa | Giữ chọn vai trò gọn; trang mua hàng bắt đầu bằng tìm kiếm và danh mục |
| Nhiều nhãn lặp như “Bảng giá cửa hàng”, “Mặt hàng”, “Giá đang áp dụng” | Có vẻ được ghép từ template, ít thông tin hữu ích | Một tiêu đề tác vụ; bỏ nhãn trùng ý |
| Card lớn chứa rất ít thông tin, icon rỗng ở giữa | Màn hình có khoảng trống nhưng không có thứ bậc rõ | Bố cục theo hàng và đường phân cách, không bọc mỗi cụm chữ trong card |
| API 503 nhưng hiện “0 mức giá”, “Chưa có mặt hàng công khai” | Người dùng hiểu sai là không có dữ liệu | Chỉ hiện lỗi tải; không suy ra số lượng bằng 0 |
| Trình duyệt người dùng có ảnh mất CSS | Không thể sử dụng dù test thao tác đạt | Kiểm tra asset, computed style và screenshot; không kết luận nguyên nhân chỉ từ việc refresh hết lỗi |
| Test chủ yếu dùng API giả lập | Chưa chứng minh app thật dùng được | Báo cáo riêng kết quả UI giả lập và kết nối dữ liệu thật |

## 4. Hướng thiết kế đã chọn cho bản đặc tả

Ba hướng được cân nhắc:

1. **Danh mục gọn + giỏ bên cạnh:** phù hợp hàng nhiều quy cách, giá sỉ/lẻ, có thể thiếu ảnh sản phẩm. Chọn hướng này cho khách.
2. **Lưới ảnh như siêu thị trực tuyến:** phù hợp khi có bộ ảnh thật đồng nhất. Hiện chưa có bằng chứng đủ ảnh, nên không dùng lưới ảnh lớn làm cấu trúc mặc định.
3. **Bảng POS dày thông tin:** phù hợp nhân viên tra nhiều hàng liên tục; quá nhiều cột đối với khách trên điện thoại. Chỉ dùng cho khu nhân viên.

Định hướng này áp dụng workflow R1–R2, sử dụng các primitive R4–R6. Không ghép nhiều phong cách dashboard, landing page và chatbot trên cùng màn hình.

## 5. Cấu trúc màn hình và điều hướng

### 5.1 Chọn vai trò

- Tiêu đề ngắn: “Bạn muốn vào đâu?”. Không có eyebrow viết hoa hay slogan.
- Hai lựa chọn trong vùng rộng tối đa 480px: “Tra giá và đặt hàng” với nhãn Khách hàng; “Khu vực nhân viên”.
- Chưa đăng nhập: lựa chọn vào workspace nhân viên bị vô hiệu hóa, có dòng giải thích và nút “Đăng nhập nhân viên” riêng, luôn bấm được.
- Đã đăng nhập hợp lệ: cho vào khu nhân viên. Việc chọn vai trò không cấp thêm quyền.
- Lưu vị trí đang làm việc qua reload bằng URL. Đề xuất route triển khai: `/` chọn vai trò, `/shop` khách, `/staff` nhân viên; giữ `/questions` và `/rag-admin` theo luồng hiện có. Đây là route đề xuất, chưa khẳng định đã tồn tại.
- Đổi vai trò giữ giỏ khách trong phiên; đăng xuất phải xóa dữ liệu riêng của nhân viên theo cơ chế hiện có.

### 5.2 Cửa hàng cho khách — ưu tiên cao nhất

Khung trang tối đa 1280px, căn giữa. Header cao 64px: tên cửa hàng trái, ô tìm kiếm ở giữa, “Giỏ hàng (n)” bên phải. Nút đổi vai trò là liên kết phụ. Không hiển thị trạng thái kết nối như huy hiệu quảng cáo.

Desktop từ 1024px: nội dung hàng hóa co giãn, giỏ rộng 320px, khoảng cách 24px. Danh mục dùng hàng lọc ngay trên danh sách; chưa cần sidebar nếu ít nhóm hàng.

```text
Tên cửa hàng     [Tìm tên hàng, mã hoặc quy cách…]     Giỏ hàng (3)
Tra giá           [Nhóm hàng ▾] [Tất cả / Giá lẻ / Giá sỉ]
----------------------------------------------------------------
Tên hàng, quy cách                     | Đơn đang chọn
Gói bán / đơn vị                       | Tên hàng + quy cách
Giá lẻ … / gói   Giá sỉ … / gói         | Số lượng × giá / gói
Điều kiện giá sỉ      [SL] [Thêm]       | Thành tiền
--------------------------------------|-------------------------
Các mặt hàng tiếp theo                 | Tạm tính … đ
                                      | [Tiếp tục]
```

Mỗi hàng sản phẩm:

- Tên 16px/600; quy cách và đóng gói 14px. Không giấu thông tin phân biệt biến thể sau hover.
- Hiển thị giá theo đúng đơn vị bán, ví dụ “15.000 đ / gói 100 cái”. Dữ liệu ví dụ chỉ dùng trong fixture thiết kế.
- Giá lẻ và giá sỉ có nhãn chữ. Giá sỉ hiển thị điều kiện tối thiểu ngay bên cạnh.
- Người dùng chọn dòng giá và số lượng gói hợp lệ. Không tự đổi mức giá sau khi đã thêm mà không giải thích.
- Nút “Thêm” cỡ thường, không mỗi dòng một nút khổng lồ. Khi thêm thành công, cập nhật giỏ và thông báo ngắn, không mở modal chặn thao tác.
- Chỉ có thumbnail khi có ảnh hàng thật. Không dùng ảnh sổ giá hoặc ảnh sinh tự động để giả làm ảnh sản phẩm; nếu cả danh mục thiếu ảnh, bỏ cột ảnh.
- Giỏ rỗng chỉ cần một câu hướng dẫn trong panel gọn; không chiếm nửa màn hình bằng biểu tượng lớn.

Mobile dưới 768px: header 56px, ô tìm kiếm xuống hàng riêng; sản phẩm chuyển thành các hàng xếp dọc, có đường phân cách. Giỏ mở bằng Drawer; thanh dưới “3 mặt hàng · Tạm tính … đ · Xem giỏ” chỉ xuất hiện khi đã chọn hàng, chừa safe-area và không che dòng cuối.

Tablet 768–1023px: danh sách toàn chiều ngang, giỏ dùng Drawer. Không ép hai cột hẹp như desktop.

### 5.3 Xem đơn và gửi yêu cầu

- “Tiếp tục” dẫn đến bước xem lại hàng và thông tin liên hệ; không đưa biểu mẫu dài vào giỏ ngay lúc chưa chọn gì.
- Bắt buộc: tên, số điện thoại. Địa chỉ và ghi chú giao hàng để tùy chọn, nhãn nói rõ.
- Giữ nhãn field trên input; placeholder chỉ làm ví dụ. Lỗi nằm cạnh field và có tóm tắt khi gửi thất bại.
- Tạm tính, đơn vị bán và số lượng luôn nhìn thấy. Ghi “Phí giao hàng: trao đổi khi xác nhận”, không hiển thị 0 đ như đã miễn phí.
- Nút cuối: “Gửi yêu cầu đặt hàng”. Thành công chỉ sau server trả mã yêu cầu; trạng thái “Chờ cửa hàng xác nhận”.
- Gửi thất bại giữ giỏ và thông tin đã nhập trong phiên. Giá thay đổi hiển thị dòng bị ảnh hưởng, yêu cầu xem lại trước khi gửi.
- Không tạo nút thanh toán, mã giảm giá, đếm ngược, thông báo tồn kho hoặc thời gian giao nếu dữ liệu thật chưa hỗ trợ.

### 5.4 Khu nhân viên

Dựa trên nguyên tắc thao tác tập trung của R2. Navigation gọn gồm Tra giá, Yêu cầu đặt hàng, Hỏi giá, Sổ giá. Chỉ hiển thị tác vụ phù hợp quyền hiện có.

- Desktop: ô tìm kiếm trên cùng; bảng hàng ở giữa; báo giá hoặc chi tiết dòng đang chọn ở cạnh phải. Tránh cùng lúc ba panel hẹp.
- Bảng: Tên/quy cách, Đóng gói, Loại giá, Đơn giá, Trạng thái kiểm chứng, Thao tác. Số căn phải; tên căn trái.
- Chi tiết chỉ mở khi chọn hàng; cập nhật giá giữ cơ chế kiểm tra phiên bản và nhật ký hiện có.
- Yêu cầu đặt hàng dùng Table với mã, thời gian, khách, tổng tạm tính, trạng thái. Bấm dòng mở Drawer chi tiết; số điện thoại chỉ có trong vùng đã xác thực.
- Các phím tắt nếu triển khai phải có hướng dẫn, không chiếm phím khi đang nhập nội dung.

### 5.5 Hỏi giá và OCR/RAG

- Hỏi giá có ô nhập rõ ràng và kết quả dạng danh sách hàng/bảng giá kèm nguồn. Không dùng bong bóng chat trang trí để che giá hoặc quy cách.
- Không đủ bằng chứng: nói chưa tìm thấy dữ liệu phù hợp và cho sửa câu hỏi. Lỗi dịch vụ: hiện lỗi dịch vụ; không giả thành kết quả tìm kiếm rỗng.
- OCR desktop từ 1280px: hàng đợi trang rộng 200px, phần còn lại chia ảnh và văn bản gần 1:1. Tablet dùng chọn trang dạng dropdown và hai vùng ảnh/văn bản; mobile dùng tabs “Ảnh nguồn”, “Văn bản”, “Các đoạn”.
- Thanh tác vụ: “Quét OCR”, “Lưu nháp”, trạng thái lưu. Duyệt/index nằm trong nhóm thao tác có quyền, không trộn với lưu nháp.
- Mỗi đoạn có số thứ tự, nội dung sửa được, nguồn trang và nút “Nhập đoạn”. OCR lại phải bảo vệ chữ người dùng đã sửa.
- Hiển thị từng trạng thái bằng chữ: Chưa quét, Đang quét, Có bản nháp, Cần kiểm tra, Đã duyệt, Lỗi. Tiến độ phải lấy từ dữ liệu tác vụ thực tế.
- Không dùng mẫu retail bên ngoài làm căn cứ cho độ chính xác OCR; đây là workflow riêng đã được xác nhận trong spec RAG.

## 6. Hệ thống thị giác

Thông số sau là theme đề xuất để triển khai nhất quán trên Flowbite, không phải màu nhận diện của KiotViet/Sapo.

| Thành phần | Quy tắc |
|---|---|
| Nền trang | Gray 50 `#F9FAFB`; bề mặt nội dung trắng `#FFFFFF`; bỏ nền kem phủ toàn bộ app |
| Chữ chính / phụ | Gray 900 `#111827` / Gray 600 `#4B5563` |
| Màu hành động | Blue 700 `#1D4ED8`; chỉ dùng cho nút chính, focus, liên kết và lựa chọn đang hoạt động |
| Viền | Gray 200 `#E5E7EB`; 1px |
| Trạng thái | Thành công xanh lá, cảnh báo amber, lỗi đỏ; luôn có nhãn chữ kèm màu |
| Font | `"Segoe UI", Roboto, Arial, sans-serif`; không phụ thuộc tải font từ mạng |
| Cỡ chữ | Tiêu đề trang 24/32px; tiêu đề vùng 18/28px; nội dung 16/24px; label/phụ 14/20px |
| Độ đậm | 400 nội dung; 500 label; 600 tên hàng, tiêu đề và giá; không dùng mọi thứ in đậm |
| Số tiền | Tabular numerals; định dạng vi-VN, đơn vị bán ghi rõ; không cắt giá bằng ellipsis |
| Spacing | 4, 8, 12, 16, 24, 32px. Padding trang desktop 24px, mobile 16px |
| Bo góc | 8px control/panel, 12px dialog; không bo pill cho mọi nút |
| Bóng | Không bóng cho hàng sản phẩm; bóng nhẹ chỉ cho lớp nổi như Drawer/Modal |
| Control | Cao tối thiểu 44px cho thao tác chạm; không dùng icon đơn độc khi nhãn giúp hiểu tác vụ |

Kiểm tra tương phản ở theme cuối: chữ thường tối thiểu 4.5:1, chữ lớn 3:1; focus nhìn thấy trên mọi control. Phóng to 200% không mất thao tác. Không coi việc dùng màu Tailwind mặc định là đã tự động đạt accessibility.

## 7. Component phải có nguồn

Dự án đang dùng `flowbite-react` và Tailwind; tiếp tục bộ này. Không thêm một design system khác chỉ để thay ngoại hình.

| Vùng UI | Component gốc | Được tùy chỉnh |
|---|---|---|
| Danh sách quản trị | Flowbite Table — R4 | Cột, mật độ hàng, nhãn và trạng thái |
| Tìm kiếm, liên hệ, OCR | Flowbite Forms — R5 | Label, validation, helper text, kích thước |
| Giỏ mobile / chi tiết | Flowbite Drawer — R6 | Vị trí, chiều rộng, footer tác vụ |
| Hàng sản phẩm | Composition từ Table hoặc List + Forms + Button của Flowbite | Layout tên/quy cách/giá; dùng CSS Grid cho bố cục |

Button, Modal, Tabs, Alert, Skeleton lấy từ cùng thư viện; đối chiếu tài liệu API đúng phiên bản đang cài khi triển khai. Dùng theme chung, tránh CSS global ghi đè tất cả `button`, `input` hay `table`. Layout sản phẩm vẫn cần composition phù hợp nghiệp vụ; “dùng component” không có nghĩa bọc nội dung bằng một Button rồi tự viết lại toàn bộ giao diện.

Mỗi component tổng hợp mới phải ghi nguồn component trong tài liệu hoặc comment ngắn. Với Flowbite Blocks: kiểm tra mẫu free/pro và giấy phép trước khi lấy code; không coi toàn bộ block là miễn phí.

## 8. Ma trận trạng thái bắt buộc

| Trạng thái | Hiển thị | Không được hiển thị |
|---|---|---|
| Đang tải lần đầu | Skeleton đúng cấu trúc hàng; “Đang tải bảng giá” | Số lượng 0, thông báo chưa có hàng |
| Thành công có dữ liệu | Hàng hóa, bộ lọc và số kết quả thật | Huy hiệu “đã kiểm chứng” nếu API không cung cấp căn cứ |
| Thành công, dữ liệu rỗng | “Cửa hàng chưa công bố bảng giá” | Lỗi kết nối |
| Tìm kiếm không khớp | “Không tìm thấy…” và nút xóa bộ lọc | “Cửa hàng chưa có mặt hàng” |
| API lỗi / mất mạng | “Chưa tải được bảng giá” + “Thử lại” | “0 mức giá”, “Giá đang áp dụng”, thông báo dữ liệu rỗng |
| Có cache khi offline | Bảng lưu gần nhất + thời điểm lưu, chỉ đọc | Gửi yêu cầu như đã kết nối thành công |
| Đang gửi đơn | Giữ nội dung, khóa gửi lặp, có nhãn đang gửi | Xóa giỏ hoặc báo thành công sớm |
| Giá thay đổi | Dòng giá thay đổi và thao tác xem lại | Âm thầm thay tổng tiền |

Đây là điều kiện chặn nghiệm thu, vì ảnh thực tế hiện đang vi phạm phân biệt lỗi tải và danh mục rỗng.

## 9. Quy tắc tránh giao diện sáo mòn

- Không hero lớn, gradient nền, glassmorphism, card nổi khắp trang, icon “AI” hoặc biểu đồ không phục vụ tác vụ.
- Không tự tạo câu khẩu hiệu. Nhãn dùng ngôn ngữ cửa hàng: Tìm hàng, Quy cách, Giá lẻ, Giá sỉ, Số lượng, Tạm tính, Chờ xác nhận.
- Không dùng ảnh stock hoặc ảnh AI thay sản phẩm thật. Dữ liệu test phải được ghi là fixture và không xuất hiện trong môi trường thật.
- Không biến mỗi metadata thành badge. Chỉ badge cho trạng thái cần phân biệt nhanh.
- Không tạo nhiều nút chính cạnh nhau: mỗi vùng có một bước tiếp theo rõ ràng.
- Không lấy việc “nhìn tối giản” làm lý do giảm cỡ chữ hoặc giấu đơn vị bán.
- Không nghiệm thu chỉ bằng screenshot trang rỗng. Phải xem có hàng, tên dài, nhiều quy cách, lỗi, đang tải và giỏ nhiều dòng.

## 10. Tiêu chí nghiệm thu và bằng chứng

### Giao diện

- Chụp đủ 390×844, 768×1024, 1024×768 và 1440×900; không cuộn ngang toàn trang.
- Desktop 1440×900 nhìn thấy ô tìm kiếm, bộ lọc, ít nhất 5 hàng sản phẩm mẫu tiêu chuẩn và tạm tính giỏ mà không cần cuộn. Với tên dài, ưu tiên đọc đủ hơn ép đạt số hàng.
- Tiếng Việt đúng dấu ở font fallback; nhãn “Số lượng”, “Quy cách”, “Đã gửi yêu cầu” không lỗi encoding hoặc cắt dấu.
- Drawer/Modal thao tác được bằng bàn phím, Escape đóng, focus quay về nút mở. Thanh sticky không che field khi bàn phím điện thoại mở.

### Tác vụ

1. Khách mới: chọn vai trò → tìm một quy cách → xem điều kiện giá sỉ → chọn số lượng → xem tạm tính → gửi yêu cầu.
2. Khách sửa giỏ và gặp giá mới: thấy dòng thay đổi, giữ dữ liệu nhập, xác nhận lại.
3. API 503: chỉ thấy trạng thái lỗi tải; retry thành công thì trở lại danh sách.
4. Nhân viên: đăng nhập → tìm hàng → báo giá → xem yêu cầu khách. Khách không mở được dữ liệu nhân viên bằng URL trực tiếp.
5. OCR: chọn trang → xem ảnh → quét → sửa đoạn → nhập đoạn → lưu nháp; tải lại vẫn còn bản nháp theo cơ chế lưu thực tế.

### Cách báo cáo test

- UI test dùng fixture để kiểm tra đủ trạng thái; dữ liệu ví dụ không chứng minh Supabase thật hoạt động.
- Kiểm tra tích hợp thật riêng: API danh mục, phiên đăng nhập và các nghiệp vụ ghi trong môi trường test được cấu hình. Thiếu môi trường thì ghi rõ chưa kiểm tra, không báo toàn bộ ứng dụng hoàn tất.
- CSS: ghi status của stylesheet, kiểm tra computed font/layout và so sánh ảnh sau tải mới, reload, đổi vai trò. HTTP 200 ở trang HTML chưa đủ.
- Tách output build E2E khỏi dev hoặc dừng dev khi build và khởi động lại sau; kiểm tra cách cấu hình theo tài liệu Next đang cài. Việc build/dev xung đột hiện mới là giả thuyết, không ghi là nguyên nhân đã chứng minh của ảnh mất CSS.
- Không thay baseline screenshot tự động để làm test xanh; phải đối chiếu nguồn và tiêu chí thị giác.

## 11. Thứ tự triển khai sau khi dùng đặc tả này

1. Chuẩn hóa theme và component nguồn; dựng cửa hàng với fixture có ít nhất 12 mặt hàng, tên dài và đủ mức giá.
2. Hoàn thiện bố cục desktop/mobile, giỏ và thông tin liên hệ; chụp ảnh đối chiếu với đặc tả.
3. Thực hiện đầy đủ ma trận loading/error/empty/cache và kiểm tra CSS.
4. Áp dụng cùng hệ thống thị giác vào nhân viên, hỏi giá và OCR; không đổi quy tắc dữ liệu vì lý do thẩm mỹ.
5. Kiểm tra tích hợp thật và báo cáo rõ phần đã xác minh/phần còn thiếu.

Tài liệu này là sản phẩm của lượt thiết kế hiện tại. Chưa triển khai thay đổi giao diện, chưa khẳng định kết nối Supabase hoặc chất lượng OCR đã được sửa.
