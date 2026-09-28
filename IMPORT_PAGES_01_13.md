# Import dữ liệu sổ giá Trang 1-13

## Nội dung

- `supabase/migrations/202608120004_catalog_pages_01_13.sql`
  - Tạo 13 trang nguồn.
  - Tạo/cập nhật 7 danh mục.
  - Tạo 72 nhóm sản phẩm và 678 biến thể có thể tìm kiếm.
  - Tạo alias tiếng Việt có dấu/không dấu và tên gọi thường dùng.
  - Liên kết từng biến thể với đúng trang nguồn.
  - Tạo 128 mức giá đọc rõ nhất từ Trang 5 và Trang 9.
  - Migration `007` bổ sung 27 mức giá bánh xe đã xác nhận từ Trang 11.
  - Migration `008` bổ sung 42 mức giá tắc kê sắt đã xác nhận từ Trang 1.
  - Migration `009` bổ sung 7 mức giá tắc kê đạn đã đủ giá và số lượng từ Trang 1.
  - Migration `010` bổ sung 22 mức giá tắc kê nhựa Tiến Phát từ Trang 1.
  - Migration `013` bổ sung 18 mức giá tắc kê sắt cỡ 14–16 ly từ Trang 1.
  - Migration `014` sửa nhãn tắc kê nhựa và xác nhận lại giá tắc kê đạn 10 ly.
  - Migration `016` chuẩn hóa toàn bộ tên đóng gói theo dạng `số lượng đơn vị/bao bì`.
  - Migration `017` bổ sung giá lẻ tắc kê đạn 6 ly và ẩn giá hộp chưa rõ của 6/8 ly.
  - Migration `018` sửa giá sỉ tắc kê sắt 14–16 ly về đơn giá mỗi con; ngưỡng sỉ vẫn chờ xác nhận.
  - Đánh dấu toàn bộ dữ liệu nhập là `needs_review`.
  - Tắt variant demo có trạng thái `sample`.
- `supabase/seed.sql`
  - Được đổi thành no-op có chủ đích để `supabase db reset` không chèn lại dữ liệu SAMPLE và không đụng unique key.

## Cách chạy local

Từ thư mục gốc dự án:

```bash
supabase db reset
```

Nếu database local đang chạy và chỉ muốn áp migration mới:

```bash
supabase migration up
```

## Cách đẩy lên Supabase cloud

Kiểm tra project đã link đúng rồi chạy:

```bash
supabase db push
```

Không chạy trực tiếp lên production trước khi có backup.

## Ảnh nguồn

Migration tạo các đường dẫn:

```text
source-pages/page-01.png
...
source-pages/page-13.png
```

Upload ảnh tương ứng vào private Storage bucket `source-pages`. Nếu chưa upload,
catalog và search vẫn hoạt động; nút xem ảnh nguồn sẽ chưa tải được.

## Chính sách xác minh

- Catalog: nhập mọi tên/quy cách có thể nhận diện để search được ngay.
- Giá rõ: được nhập nhưng vẫn mang ngữ cảnh `needs_review`.
- Giá mờ/lóa/chồng chữ: không nhập số 0 và không đoán.
- Sau khi chủ cửa hàng đối chiếu ảnh, đổi variant/source sang `verified` và sửa giá inline nếu cần.

## Kiểm tra nhanh sau import

```sql
select page_number, count(*) as variants
from source_pages sp
join variant_sources vs on vs.source_page_id = sp.id
group by page_number
order by page_number;

select c.name, count(distinct p.id) products, count(v.id) variants
from categories c
join products p on p.category_id = c.id
join product_variants v on v.product_id = p.id and v.active
group by c.name
order by c.name;

select count(*) as imported_prices
from prices pr
join price_lists pl on pl.id = pr.price_list_id
where pl.name = 'Nhập từ Trang 1-13';
```

Kết quả giá hoạt động kỳ vọng sau migration `017`: `245` dòng. Các trang còn lại cần một vòng xác nhận
giá trước khi bổ sung để tránh biến chữ viết tay không chắc thành giá bán thật.
