# Đánh giá giao diện bởi ba subagent — 16/10/2026

## Kết luận

**Chưa đạt nghiệm thu toàn bộ theo `design.md`.** Trang khách đã có cấu trúc sử dụng được và tốt hơn phiên bản trước. Màn nhân viên và OCR còn lệch thiết kế; có lỗi nhãn nghiệp vụ và giới hạn đầu vào cần sửa trước khi gọi ứng dụng hoàn thiện.

Không chấm điểm đẹp/xấu tùy ý. Chuẩn đối chiếu là [design.md](../design.md), quy tắc component trong `frontend/AGENTS.md` và các tình huống sử dụng tái hiện được. Không tuyên bố đạt WCAG chỉ từ ảnh hoặc test tự động.

## Cách ba người phối hợp

| Reviewer | Phạm vi | Bằng chứng |
|---|---|---|
| `ui_visual_audit` | Bố cục, độ đọc, mật độ thông tin, đối chiếu thiết kế | Xem sáu ảnh ở [ui-review/2026-10-16](ui-review/2026-10-16/README.md), đối chiếu source và yêu cầu |
| `ui_code_audit` | Gắn cứng nghiệp vụ, Flowbite/theme, API contract, trạng thái tải | Đọc source có chỉ vị trí và tình huống ảnh hưởng |
| `ui_browser_audit` | Thao tác thực, responsive, focus, giới hạn input và đơn vị | Chromium với browser context riêng, API fixture; không ghi dữ liệu thật |

Các reviewer trao đổi trực tiếp: visual nhờ browser kiểm tra select và nhờ code xác nhận cỡ chữ nhân viên; code nhờ browser tái hiện đơn vị bán và giới hạn số lượng. Điều phối kiểm tra lại source hợp đồng API và phân biệt lỗi hiển thị với sai phép tính giá. Code sản phẩm được giữ nguyên trong lúc audit.

Localhost ban đầu từ chối kết nối. Điều phối bật lại frontend 3000/API 4000, sau đó browser reviewer tiếp tục kiểm tra. Đây là tình trạng môi trường khi bắt đầu lượt audit, không phải bằng chứng lỗi UI.

## Phát hiện ưu tiên sửa

### A1 — Nhãn đơn vị khách bị gắn cứng thành “gói”

- Bằng chứng source: `frontend/src/components/customer-storefront.tsx:135–136`, `customer-cart-panel.tsx:26–27`.
- Browser đã tái hiện với fixture `Cuộn 100 mét`, tối thiểu 5 đơn vị bán: hiện “Từ 5 gói”, label số lượng cũng gọi “Số gói”.
- Tác động: người mua không chắc mình đang đặt 5 cuộn hay 5 gói. Không có bằng chứng từ phát hiện này rằng giá authoritative bị đổi; đây là lỗi diễn đạt đơn vị.
- Sửa: dùng nhãn “Số lượng” trung tính hoặc trường đơn vị bán chính thức. Ghi rõ 100 mét/cuộn và số cuộn tối thiểu. Không dùng đơn vị cơ sở `mét` để thay đơn vị bán `cuộn`.
- Nghiệm thu: fixture gói, hộp, bịch, cuộn và bán lẻ theo mét đều thể hiện đúng; tổng vẫn là số lượng đơn vị bán × giá của dòng đã chọn.

### A2 — Giỏ vượt giới hạn API nhưng không biết sửa ở đâu

- Source: `backend/src/schemas/customer-orders.schema.ts:17` giới hạn 10.000 số lượng mỗi dòng, 50 dòng mỗi yêu cầu. UI nhập/thêm hàng không có giới hạn tương ứng; lỗi gửi chung tại `customer-storefront.tsx:101–102` không chỉ ra dòng cần sửa.
- Browser đã xác nhận 10.001 được input chấp nhận, không có `max`, nút Thêm vẫn bật.
- Khi chặn POST bằng response 400 mô phỏng, UI báo lỗi thử lại chung và giữ nguyên số lượng không hợp lệ. Thông tin liên hệ được giữ đúng, nhưng chưa có chỉ dẫn sửa số lượng.
- Tác động: tạo được giỏ không thể gửi; thử lại nguyên giỏ vẫn thất bại. Backend vẫn từ chối đầu vào vượt hợp đồng, không có bằng chứng bỏ qua validation phía server.
- Sửa: dùng chung giới hạn từ hợp đồng; chặn thêm vượt số dòng; validation cạnh dòng; lỗi 400/422 cần thông điệp sửa được, không chỉ khuyên thử lại.
- Nghiệm thu: 10.000/10.001 và 50/51 dòng; giữ giỏ và thông tin liên hệ khi lỗi; cho xóa/đổi số lượng để gửi lại.

### A3 — Ngưỡng giá sỉ nhân viên có thể hiển thị thấp hơn thực tế

- Source: `frontend/src/components/price-app.tsx:339–353` tính `wholesaleFrom` từ `packageQuantity`, bỏ qua `minimumQuantity`, rồi hiển thị tại dòng 801.
- Trường hợp: bao 100 cái, tối thiểu 5 bao; nhãn có thể ghi “từ 100 cái” thay vì 5 bao/500 cái.
- Bằng chứng: xác nhận qua source, chưa coi là đã tái hiện trên phiên nhân viên có dữ liệu thật.
- Sửa: hiển thị số đơn vị bán tối thiểu kèm quy cách; chỉ quy đổi cùng biến thể và cùng đơn vị cơ sở.
- Nghiệm thu: ngưỡng 1, 5 và dữ liệu chưa xác định ngưỡng. Kiểm tra riêng nhãn và điều kiện chọn giá; không suy diễn nhãn sai đồng nghĩa tổng tiền sai.

### A4 — Bao bì Móc U bị ép theo tên sản phẩm

- Source: `price-app.tsx:141–147` trả “10 con/bịch” hoặc “100 con/bịch” theo tên `Móc U` và số lượng, không theo `packageName` đã lưu. Dòng 118–137 còn bảng chuyển tên legacy.
- Tác động: sửa bao bì thành hộp có thể vẫn hiển thị bịch. Ngoại lệ tên hàng nằm trong UI khiến dữ liệu đúng bị diễn đạt sai.
- Sửa: chuẩn hóa dữ liệu nhập hoặc migration; hiển thị trường bao bì chính thức. Bảng legacy chỉ nên ở lớp chuẩn hóa có kiểm chứng, không rải trong component.
- Nghiệm thu: sửa bao bì cùng số lượng, tên gần giống Móc U và sản phẩm mới không bị ép nhãn cũ.

### A5 — Trạng thái lỗi danh mục nhân viên vẫn giống danh mục rỗng

- Source: `price-app.tsx:791,796,801` có số lượng 0 và thông báo tìm không thấy khi dữ liệu chưa tải được, không có cache. Shop đã tách trạng thái tốt hơn.
- Tác động: nhân viên có thể hiểu nhầm cửa hàng chưa có hàng/giá khi thực tế request lỗi.
- Sửa: mô hình loading/success/error/cache rõ ràng; chỉ đếm khi có kết quả hợp lệ, thêm retry.
- Nghiệm thu: API lỗi không cache, API lỗi có cache, thành công rỗng, lọc không khớp phải là bốn tình huống khác nhau.

### A6 — OCR mobile chưa đưa người nhập đến vùng làm việc nhanh

- Source: `rag-admin.tsx:303–310` render 13 thẻ chọn trang trước editor, mỗi thẻ tối thiểu 80px. Theo CSS, riêng hàng đợi đã tối thiểu khoảng 1.136px gồm gap, chưa tính nội dung khác.
- Đối chiếu: `design.md:128` yêu cầu dropdown trên tablet và tabs Ảnh nguồn / Văn bản / Các đoạn trên mobile.
- Ngoài ra các đoạn OCR tại dòng 301 nằm trước grid ảnh/editor, nên nhiều đoạn khiến đối chiếu ảnh phải cuộn qua lại.
- Sửa: desktop đặt đoạn trong vùng soạn thảo cạnh ảnh; tablet dropdown chọn trang; mobile tabs của cùng trang đang chọn, có trạng thái lưu.
- Nghiệm thu: chọn trang 13 trên 390px rồi sửa một đoạn không phải đi qua cả 13 thẻ; ảnh và đoạn đang sửa giữ đúng trang khi chuyển tab.

### A7 — Typography nhân viên chưa đạt mức đã thống nhất

- Bằng chứng: [ảnh staff](ui-review/2026-10-16/staff-desktop.png), `globals.css:71,87–91,105` có nhiều nhãn 8–11px, monospace và uppercase. Visual và code reviewer cùng xác nhận.
- Đối chiếu: thiết kế quy định phụ/label 14px, nội dung 16px. Shop đã gần mức này hơn nhân viên.
- Sửa: dùng typography chung, giữ tabular numerals cho số tiền; bớt chữ đậm và chữ hoa. Giảm thông tin dư thay vì thu nhỏ chữ nghiệp vụ.
- Nghiệm thu: quy cách, ngưỡng sỉ và trạng thái kiểm chứng đọc rõ ở zoom 100%; kiểm tra 200% không mất thao tác.

### A8 — Phóng ảnh OCR còn là modal tự dựng thiếu quản lý bàn phím

- Source: `rag-admin.tsx:323` dựng `div role="dialog"`, chưa có hook Escape/focus trap/return focus như Drawer của shop.
- Sửa: Flowbite Modal, giữ tên truy cập rõ; khóa focus đúng và trả focus về nút phóng ảnh.
- Nghiệm thu: Tab/Shift+Tab không ra nền, Escape đóng, focus trở lại nút mở. Không đánh đồng modal này với Drawer shop đã có quản lý focus.

### A9 — Tràn nội dung bị che, dù trang không cuộn ngang

- Browser tái hiện ở 320px với quy cách liền 100 ký tự: article rộng nội dung 790px trong viewport 320px, nhưng parent `overflow-hidden` che phần dư.
- Bằng chứng: [browser-longname-320.png](ui-review/2026-10-16/browser-longname-320.png).
- Tác động: assertion `document.scrollWidth <= innerWidth` vẫn qua trong khi người dùng mất một phần quy cách. Đây là lỗ hổng kiểm tra, không phải responsive đã đạt.
- Sửa: `overflow-wrap:anywhere`/break phù hợp cho variant và specification, giữ `min-width:0` cho cột; kiểm tra bounding box của nội dung thực thay vì chỉ document.
- Nghiệm thu: tên, quy cách có khoảng trắng và chuỗi liền dài ở 320/390px; đọc được toàn bộ thông tin, không chỉ giấu overflow.

### A10 — Mũi tên select đè chữ

- Browser đo hai select có padding phải 10px. Select rộng 134px có chữ kết thúc khoảng 122,62px, mũi tên bắt đầu 111,5px; select rộng 111px có chữ kết thúc 99,09px, mũi tên bắt đầu 88,5px. Cả hai chồng khoảng 11px.
- Visual reviewer phát hiện từ ảnh; browser reviewer đã xác nhận bằng đo style và vùng chữ. Xem [browser-filter-overlap.png](ui-review/2026-10-16/browser-filter-overlap.png).
- Sửa: khôi phục padding chừa chỗ cho icon trong theme Select, đủ chiều rộng cho nhãn; không chỉ tăng min-width wrapper.
- Nghiệm thu: nhãn mặc định, tên nhóm dài và zoom 200% không chạm vùng icon.

## Chưa đồng bộ với design system

- Màn nhân viên còn ba panel card/chip (`globals.css:66`, `price-app.tsx:798–804`); mới đổi theme, chưa thành bảng tra giá như `design.md:118–119`.
- Import Flowbite chưa đồng nghĩa control giữ thiết kế thư viện. `globals.css:48,98,105,112–119,174–176` vẫn viết lại nền/viền/font/disabled của nhiều control. Cần theme Flowbite chung, giữ CSS riêng cho layout và responsive.
- Một số control shop chưa đạt tiêu chí chạm 44px trong thiết kế: browser đo nút 40px, select 42px, nút đóng Drawer 32×32px. Đây là so sánh với tiêu chí nội bộ, không tự suy ra một chứng nhận WCAG thất bại.
- Giỏ không cho xóa tạm giá trị số lượng để gõ lại: browser `fill("")` lập tức khôi phục số cũ. Nên giữ text draft trong lúc nhập, kiểm tra khi blur/tiếp tục thay vì chặn từng ký tự.
- OCR còn lộ `needs_review`, `Revision`, `Chunk`, `source span` trong luồng nhập liệu. Dùng nhãn Việt; chi tiết kỹ thuật nằm trong vùng mở rộng riêng.

## Gắn cứng nên cải thiện sau

- “CA TRỰC · QUẦY CHÍNH” không có dữ liệu ca/quầy đi kèm.
- Ba gợi ý tìm kiếm cố định là gợi ý mẫu, không phải lịch sử tìm kiếm thật; nên lấy từ danh mục hoặc ghi rõ ý nghĩa.
- “13 trang”, phiên bản chunker và phiên bản cache v7 lặp nhiều nơi cần một nguồn cấu hình khi mở rộng.
- Màu, spacing, breakpoint, giỏ rộng 320px và safe-area là token/layout hợp lệ có căn cứ trong thiết kế; không gọi chúng là hardcode có hại.

## Những phần có bằng chứng hoạt động tốt

- Shop ưu tiên tìm kiếm/hàng hóa; desktop 1440px thấy khoảng sáu hàng tiêu chuẩn, giỏ rỗng gọn.
- Vietnamese trong ảnh đọc đúng dấu, không ảnh sản phẩm giả, hero quảng cáo hay KPI trang trí.
- Nhãn field liên hệ rõ, địa chỉ/ghi chú tùy chọn; không khẳng định miễn phí giao hay thanh toán thành công.
- Browser kiểm tra giỏ 12 dòng: vùng Drawer cuộn độc lập, focus được giữ; Escape trả focus về nút Xem giỏ. Đây là bằng chứng tốt, không phải lỗi cần viết lại.
- Lượt regression trước audit: 108 test frontend, 178 test backend, 2 dev-runner; 40 browser test đạt, 12 live integration bỏ qua. Kết quả này chứng minh các ca đã viết, không bao phủ mọi tiêu chí thiết kế.

## Giới hạn và thứ tự cải thiện

Live catalog từng trả 503/fetch failed; đó là chặn luồng dùng dữ liệu thật, không chứng minh Supabase không có dữ liệu. Ảnh trong thư mục review dùng fixture. Chưa có đủ bằng chứng cho thiết bị di động vật lý, bàn phím ảo và luồng nhân viên xác thực với Supabase thật.

Thứ tự đề xuất:

1. Sửa đơn vị/ngưỡng/bao bì và validation để không gây hiểu sai hoặc giỏ không thể gửi (A1–A5).
2. Sửa điều hướng OCR mobile, modal bàn phím và thông tin bị che/chồng (A6, A8–A10).
3. Đồng bộ typography, kích thước chạm và cấu trúc bảng nhân viên (A7 và design system).
4. Hoàn tất tích hợp thật và test với nhân viên/khách thật; chỉ nghiệm thu khi có bằng chứng tương ứng.

Lượt này là đánh giá và đề xuất; chưa áp dụng các sửa đổi trên vào code sản phẩm.

## Phụ lục bằng chứng browser

- [Bộ lọc đè chữ](ui-review/2026-10-16/browser-filter-overlap.png).
- [Giỏ vượt giới hạn và lỗi gửi](ui-review/2026-10-16/browser-overlimit-checkout.png).
- [Giỏ nhiều dòng](ui-review/2026-10-16/browser-manylines-mobile.png).
- [Hàng bán theo cuộn trên mobile](ui-review/2026-10-16/browser-longname-unit-mobile.png).
- [Quy cách dài bị che ở 320px](ui-review/2026-10-16/browser-longname-320.png).

Các response POST được giả lập trong context kiểm thử. Không có đơn thật được gửi; không thay dữ liệu production. Luồng nhân viên/OCR có xác thực chưa được browser reviewer chạy lại trong lượt audit này; các nhận xét tương ứng dựa trên source và ảnh của lượt regression trước.
