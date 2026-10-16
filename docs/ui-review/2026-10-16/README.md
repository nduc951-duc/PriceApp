# Ảnh đối chiếu giao diện — 16/10/2026

Ảnh được chụp bằng Playwright từ ứng dụng đã build, dùng API fixture của bộ test. Tên hàng, giá và tài khoản trong ảnh là dữ liệu kiểm thử; không phải bằng chứng Supabase thật hoạt động.

- `shop-desktop.png`: danh mục mẫu ở 1440×900.
- `shop-mobile.png`: danh mục mẫu ở 390×844.
- `checkout-mobile.png`: Drawer nhập liên hệ trên cấu hình Pixel 7.
- `role-entry.png`: màn chọn vai trò chưa đăng nhập.
- `staff-desktop.png`: tra giá nhân viên với fixture Test Bolt.
- `ocr-desktop.png`: màn OCR với hàng đợi và ảnh nguồn được giả lập. Mảng trống trong vùng ảnh không chứng minh ảnh thật bị lỗi.

Test liên quan: `storefront-design.spec.ts`, `customer-order.spec.ts`, `workspace-mocked.spec.ts`, `rag-ocr.spec.ts`. Lượt full E2E trước khi bắt đầu đánh giá ba subagent: 40 đạt, 12 bỏ qua do chưa có môi trường Supabase integration riêng. Các ảnh mô tả phiên bản lúc chụp; đối chiếu code hiện hành khi nhận xét.
