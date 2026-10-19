# Nguyên nhân câu giới thiệu bulong trả không đủ dữ liệu

Ngày: 19/10/2026. Câu hỏi nguyên văn: `tôi muốn mua bulong, giới thiệu cho tôi`.

## Kết luận đã tái hiện

Lỗi nằm ở trích xuất định danh bằng quy tắc và bộ lọc sau retrieval. Không cần lịch sử hội thoại để tái hiện. Không phải thiếu sản phẩm hay chưa lập embedding.

Ba lần kiểm tra đều trả `insufficient_evidence`, 0 item và đúng thông báo trong ảnh: hai lần chạy mã nguồn hiện tại với Supabase/model thật, một lần gọi HTTP vào backend đang chạy tại port 4000. Hai lượt có trace được lưu trong `2026-10-19-introduction-root-cause.json`. Chưa thực hiện phiên staff có đăng nhập trực tiếp trong lượt này; lỗi đã được tái hiện qua route công khai dùng chung pipeline catalog.

## Chuỗi nguyên nhân

1. Model trả JSON hợp lệ: `catalog_list`, requestedFields `variants`, specifications rỗng, nhưng **bỏ trống productText**.
2. `planRagQuery` tự bù productText bằng `understandQuery`. Bộ này loại một số từ dừng nhưng giữ `muốn`, `giới`, `thiệu`, nên bù thành **`muốn bulong giới thiệu`**. Đây là giá trị code tự tạo, không phải tên hàng model đã trích đúng.
3. `queryCatalogRag` gửi RPC catalog với `p_query = "muốn bulong giới thiệu"`, nhận 0. Truy vấn từ câu gốc chỉ bỏ thêm `muốn`, còn **`bulong giới thiệu`**, cũng nhận 0.
4. Dense retrieval vẫn tìm được **8 chunk `Bulong có tán`**, similarity khoảng **0,6496–0,6531**, vượt ngưỡng 0,2. Pipeline tiếp tục mở rộng nhóm sản phẩm từ các chunk đó.
5. Bộ lọc `matchesNamedCandidate` lại kiểm các ứng viên bằng định danh bị nhiễu ở trên. Các từ không thuộc tên sản phẩm bị coi như điều kiện phải có trong quy cách. `giới` và `thiệu` không xuất hiện trong `8 ly x 3F`, nên ứng viên bulong bị loại.
6. Danh sách sau lọc rỗng. Pipeline tạo câu “Chưa tìm thấy đúng quy cách...” dù người dùng không yêu cầu kích thước và retrieval đã tìm thấy đúng họ sản phẩm.

## Kiểm tra đối chứng

Với cùng ứng viên `Bulong có tán`, quy cách `8 ly x 3F`:

- Kiểm định danh `bulong`: **true**.
- Kiểm định danh từ câu gốc `muốn bulong giới thiệu`: **false**.
- Kiểm định danh đã bù vào plan `muốn bulong giới thiệu`: **false**.

Điều này xác nhận bộ lọc dùng sai định danh có thể làm mất kết quả đúng, ngay cả khi model/embedding tìm đúng nhóm.

## Vì sao trace cuối báo vectorChunks = 0?

Trường này được tính từ `supportedChunks` sau khi lọc theo các variant còn lại, không phải số chunk thô trả về từ RPC vector. Vì variant bị loại hết nên trace cuối là 0, trong khi RPC thực tế đã trả 8 chunk. Cần phân biệt số truy xuất ban đầu và số giữ lại sau lọc khi chẩn đoán.

## Phạm vi khắc phục cần thiết

- Tách yêu cầu hội thoại khỏi định danh hàng; không dùng nguyên phần dư sau stop-word như một tên hàng bắt buộc.
- Khi planner bỏ định danh, cần phục hồi định danh có căn cứ từ tên/alias catalog và ứng viên retrieval, đồng thời giữ kiểm tra họ sản phẩm và kích thước thật sự được nêu. Tránh chỉ thêm riêng hai từ `giới thiệu` vào danh sách từ dừng rồi coi là giải quyết tổng quát.
- Không áp từ hội thoại thành bộ lọc quy cách; tránh để bộ lọc từ khóa loại toàn bộ kết quả ngữ nghĩa đúng.
- Giữ các ca bảo vệ: tắc kê không bị thay bằng bulong, đúng kích thước, không bịa giá. Thêm regression cho nhiều cách yêu cầu giới thiệu và kiểm tra cả staff/public.
- Sửa thông báo khi không có kết quả để phản ánh đúng yêu cầu: câu hỏi khám phá sản phẩm không nên bị mô tả như thiếu quy cách.

Lượt này chỉ điều tra và lưu bằng chứng, chưa sửa logic sản phẩm. Giả thuyết rò điều kiện từ lịch sử đã tìm được trước đó là vấn đề riêng; không cần giả thuyết ấy để giải thích lỗi nguyên văn lần này.
