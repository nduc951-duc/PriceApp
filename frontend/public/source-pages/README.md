# Ảnh bảng giá nguồn

Đặt 13 ảnh bảng giá vào thư mục này với đúng tên:

- `page-01.jpg`
- `page-02.jpg`
- ...
- `page-13.jpg`

Ứng dụng ưu tiên mở ảnh trong thư mục này khi bấm **Xem ảnh đối chiếu**.
Nếu không có file cục bộ, ứng dụng sẽ thử lấy ảnh cùng tên từ bucket Supabase
Storage `source-pages`.

Không đổi tên file nếu chưa cập nhật cột `source_pages.storage_path` trong cơ sở
dữ liệu.
