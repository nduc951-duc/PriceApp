# Giá Chuẩn

PWA mobile-first tra cứu và cập nhật giá vật tư. Search hoàn toàn deterministic; không dùng AI để suy giá.

## Chạy app

Yêu cầu Node.js 20+. Chạy `npm install`, sao chép `.env.example` thành `.env.local`, điền Supabase URL/publishable key, sau đó `npm run dev`. Không commit `.env.local`.

Kiểm tra: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; E2E dùng `npx playwright install chromium` rồi `npm run test:e2e`.

## Supabase cloud

1. Tạo project mới tại Singapore, lưu database password trong password manager.
2. Cách không cần CLI: mở SQL Editor và chạy lần lượt các file trong `supabase/migrations` theo tên tăng dần, sau đó chạy `supabase/seed.sql` nếu cần demo.
3. Cách dùng CLI: `npx supabase link --project-ref <ref>` rồi `npx supabase db push`; chạy seed có nhãn SAMPLE khi cần.
4. Trong Authentication, tạo user email/mật khẩu. Thêm profile owner bằng SQL Editor: `insert into public.profiles(id, display_name, role) select id, email, 'owner' from auth.users where email='<email-cua-ban>';`.
5. Trong Project Settings > API, sao chép Project URL và Publishable key vào `.env.local`. Publishable key có thể dùng ở browser; tuyệt đối không dùng secret/service-role key.
4. Bucket `source-pages` do migration tạo là private. Chỉ backend được tạo signed URL ngắn hạn.

## Vận hành

- Deploy Vercel: import repo, khai báo hai biến trong `.env.example`, chạy build mặc định.
- Backup: bật Supabase backups hoặc `npx supabase db dump -f backup.sql`; restore vào project trống rồi chạy migration.
- Dữ liệu thật: upload ảnh vào bucket private, tạo `source_pages`, tách từng variant, giữ `raw_specification`, chỉ chuyển sang `verified` sau khi đối chiếu.
