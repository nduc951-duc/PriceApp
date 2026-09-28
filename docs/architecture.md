# Kiến trúc

Next.js App Router phụ trách UI; Supabase Auth/PostgreSQL/Storage là nguồn dữ liệu. Domain search, pricing và offline tách khỏi component. Client chỉ đọc theo RLS; mọi thay đổi giá đi qua RPC có version lock và audit. IndexedDB giữ snapshot chỉ đọc khi mất mạng.
