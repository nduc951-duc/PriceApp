# Bổ sung giá demo cho quy cách chưa có giá

Trạng thái: thiết kế đề xuất, chưa triển khai và chưa đọc/ghi database đang chạy.

## Mục đích và phạm vi đã xác nhận

Người dùng chưa nhập kịp giá một số sản phẩm, muốn tự động bổ sung giá giả, yêu cầu brainstorming và planning trước. Người dùng đã chọn: **ngay trong app hiện tại, có nhãn giá demo**. Giá demo cần xuất hiện ở danh mục và chatbot. Đây là dữ liệu giả phục vụ trải nghiệm, không phải giá thị trường hoặc báo giá nhà cung cấp.

Phạm vi đề xuất: công cụ chạy theo đợt, tạo giá cho các quy cách đang hoạt động và đã xác minh nhưng chưa có giá bán hiện hành hợp lệ. Không tạo thêm sản phẩm, quy cách, đóng gói hoặc thuộc tính kỹ thuật. Không sửa kiến trúc RAG ngoài việc truyền nguồn gốc giá demo đến câu trả lời.

## Các phương án và lựa chọn

1. Sinh ngẫu nhiên rồi nhập như giá thường: nhanh nhưng mất dấu dữ liệu giả, khó dọn và dễ đi vào đơn hàng.
2. Bảng giá demo riêng trong app hiện tại, nhãn xuyên suốt API/UI/chatbot: phù hợp lựa chọn của người dùng; cần điều chỉnh bộ lọc đọc giá.
3. Database demo riêng: ít ảnh hưởng dữ liệu hiện tại nhưng không đáp ứng lựa chọn hiển thị ngay trong app đang dùng.

Chọn phương án 2. Không cần agent tự định giá, không cần model suy đoán giá mỗi lượt chat. Sinh một lần, lưu SQL và đọc nhất quán.

## Hiện trạng ảnh hưởng thiết kế

- `prices.amount` là giá nguyên gói có thẩm quyền; không chia hoặc thay đổi nó trong UI/tính tiền.
- `price_lists.is_sample` hiện bị loại ở SQL public catalog, nhiều RPC RAG, `rag-query.service.ts` và `rag/evidence.ts`.
- Luồng đặt hàng hiện cũng loại `is_sample`; giữ nguyên giới hạn này đối với giá demo.
- API nhân viên `catalog.repository.ts` chưa truyền nguồn gốc giá mẫu; phải cập nhật cùng API khách hàng.
- RPC cập nhật giá hiện có yêu cầu `expected_version` và ghi lịch sử; bổ sung giá mới cần RPC tạo có audit, không dùng insert trực tiếp từ script.
- Không có số lượng thiếu giá đã xác nhận ở thời điểm lập kế hoạch.

## Quy tắc dữ liệu

1. Thêm `price_lists.is_demo boolean not null default false`, ràng buộc `is_demo => is_sample`. Bảng giá demo luôn có `is_sample=true, is_demo=true`, tên `DEMO — Giá giả lập`, note ghi nguồn sinh và batch ID. Không sửa cờ bảng giá thật hoặc bảng sample cũ.
2. Giá thật hợp lệ: sản phẩm/quy cách/nhóm đang hoạt động, quy cách verified, giá active trong khoảng hiệu lực, supplier active, bảng giá không sample. Kiểm kê xét cả retail/wholesale/dealer; số 0 đang được schema cho phép nên không tự hiểu là thiếu.
3. Chỉ bổ sung khi quy cách không có bất kỳ giá thật hiện hành hợp lệ nào. Giá hết hạn, tương lai, bảng sample cũ hoặc supplier ngừng hoạt động được báo riêng, không sửa.
4. Mỗi quy cách đủ điều kiện tạo một giá retail, minimum_quantity=1, VND, trên đóng gói nhỏ nhất đang có. Chỉ so sánh quantity khi base_unit giống nhau; đồng hạng chọn ID nhỏ nhất. Thiếu đóng gói hoặc nhiều base_unit không thể đối chiếu thì bỏ qua và báo lý do.
5. Không tự tạo giá sỉ/đại lý, chiết khấu, tồn kho hoặc gói hàng giả. Không tự bật lại hàng bị ẩn hoặc đổi trạng thái xác minh.
6. Khi có giá thật hợp lệ ở quy cách đó, các API đọc ẩn giá demo của quy cách. Giá demo còn lưu để audit, không cạnh tranh với giá thật.

## Quy tắc sinh số tiền

- Tìm giá retail thật hiện hành của quy cách khác cùng product, cùng package quantity và base_unit; lấy median làm mốc. Không chia giá gói lớn thành giá đơn vị, không lấy giá demo làm mốc.
- Nếu không có mốc: dùng cấu hình cố định theo category + base_unit + package quantity. Bản đầu chưa có cấu hình riêng dùng 50.000 VND/gói như fixture thuần túy, nhãn phương pháp `fallback_fixture`; đây không phải ước tính giá thị trường.
- Hệ số cố định theo variant ID: `0.9 + (variantId % 21)/100`; làm tròn tới 1.000 VND, tối thiểu 1.000 VND. Chỉ áp dụng khi tạo số giả mới, không sửa giá nguồn.
- Manifest lưu input hash, ruleVersion=`demo-price-v1`, IDs của giá mốc, phương pháp, amount, package, tier và lý do đủ điều kiện. Cùng snapshot/rules phải cho cùng kết quả.

## Hiển thị và giao dịch

- Contract giá có `isDemo: boolean`, `purchasable: boolean`; demo luôn purchasable=false. Giá thật giữ các điều kiện mua hiện hành.
- Mọi nơi hiển thị demo ghi **Giá demo** và giải thích **Giá giả lập để trải nghiệm, chưa phải giá bán chính thức.**
- Chatbot vẫn đọc giá từ SQL, phần trả lời giá do ứng dụng định dạng thêm nhãn demo, không giao model tự nhận biết nguồn gốc. Không gắn trang catalog làm bằng chứng xác minh số tiền demo.
- Tách trạng thái sản phẩm đã xác minh khỏi trạng thái giá giả. Không dùng badge verified của sản phẩm để mô tả độ tin cậy của giá.
- Catalog/RAG cho phép đọc bảng demo rõ ràng, vẫn loại mọi bảng sample không demo. Giữ giá demo ngoài giỏ hàng, đơn hàng, báo giá và hóa đơn thật; kiểm tra tại server/RPC, không chỉ nút UI.
- Giá thật xuất hiện sau đó được ưu tiên ngay khi đọc dữ liệu mới. Offline không phát sinh thao tác ghi; cache phải lưu được isDemo/purchasable.

## Chạy theo đợt và hoàn tác

Preview chỉ đọc: thống kê có giá thật, có demo, thiếu giá, thiếu gói, bị ẩn/chưa xác minh; xuất JSON manifest và CSV xem trước. Không dùng danh mục public làm nguồn kiểm kê vì có thể đã lọc mất hàng chưa có giá.

Apply là thao tác riêng sau khi triển khai: tài khoản owner, RPC có audit, kiểm tra lại snapshot dưới khóa của từng variant, expected_version=0 nghĩa là kỳ vọng chưa có giá đích. Kiểm tra eligibility lại tại thời điểm commit. Nếu dữ liệu liên quan thay đổi, dừng lô và yêu cầu tạo preview mới. Batch key chống chạy trùng; mỗi lô tối đa 100 dòng và atomic. Chạy lại không tạo bản sao. Báo cáo rõ lô nào đã thành công khi quá trình bị gián đoạn.

Rollback chỉ ngừng hiệu lực các giá do batch tạo, không xóa lịch sử. So sánh expected_version; hàng đã sửa hoặc được tham chiếu phải báo conflict và giữ nguyên. Trước khi chạy apply thực tế, trình bày manifest có số lượng, tổng hợp theo nhóm và môi trường đích.

## Tiêu chí nghiệm thu

- Mọi quy cách đủ điều kiện có một giá demo sau apply; mọi quy cách bị bỏ qua có lý do.
- Giá thật, gói và dữ liệu xác minh không đổi.
- Chatbot, danh mục nhân viên và khách hiển thị cùng amount nguyên gói và cùng nhãn demo.
- Sample cũ vẫn bị ẩn; demo không thể gửi vào giao dịch thật dù gọi API trực tiếp.
- Giá thật mới xuất hiện được ưu tiên; chạy lại và rollback không phá chỉnh sửa của nhân viên.
- Báo cáo thử nghiệm ghi rõ sử dụng giá tổng hợp; không trình bày chúng như giá bán đã xác minh.
