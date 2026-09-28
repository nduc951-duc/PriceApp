begin;

-- Canonical source filenames. Upload the supplied photos to the private
-- source-pages bucket with these exact names.
update public.source_pages
set storage_path = format('page-%s.jpg', lpad(page_number::text, 2, '0')),
    raw_note = format('Sổ giá viết tay - Trang %s. Cần đối chiếu ảnh nguồn trước khi xác minh.', page_number),
    updated_at = now()
where page_number between 1 and 13;

update public.categories set name = case slug
  when 'tac-ke' then 'Tắc kê & neo'
  when 'bulong-oc-vit' then 'Bulong, vít & phụ kiện'
  when 'ke-phu-kien' then 'Kệ & phụ kiện kệ'
  when 'cap-xich' then 'Cáp, xích & phụ kiện nâng'
  when 'banh-xe' then 'Bánh xe'
  when 'dinh-dung-cu' then 'Đinh & dụng cụ'
  when 'keo-silicon' then 'Keo, băng keo & hóa phẩm'
  else name end
where slug in ('tac-ke','bulong-oc-vit','ke-phu-kien','cap-xich','banh-xe','dinh-dung-cu','keo-silicon');

create temporary table catalog_name_fixes (
  old_name text primary key,
  new_name text not null
) on commit drop;

insert into catalog_name_fixes (old_name, new_name) values
  ('Tac ke sat', 'Tắc kê sắt'),
  ('Tac ke dan Dai Loan', 'Tắc kê đạn Đài Loan'),
  ('Tac ke nhua Tien Phat', 'Tắc kê nhựa Tiến Phát'),
  ('Mc dien', 'Móc điện'),
  ('Vit tole sat go', 'Vít tole sắt gỗ'),
  ('Vit ban du Dai Loan', 'Vít bắn dù Đài Loan'),
  ('Vit san om la', 'Vít sàn ôm lá'),
  ('Vit san map la', 'Vít sàn mập lá'),
  ('Vit den', 'Vít đen'),
  ('Vit vang', 'Vít vàng'),
  ('N ty', 'Nở ty'),
  ('Mc C', 'Móc C'),
  ('Mc U', 'Móc U'),
  ('Rive ban', 'Rive bắn'),
  ('Vit khung bao', 'Vít khung bao'),
  ('Khoen tac no van tay', 'Khoen tắc nở vặn tay'),
  ('Tan', 'Tán'),
  ('Long dan', 'Long đền'),
  ('Bulong', 'Bulong'),
  ('Vit trang dau la', 'Vít trắng đầu lá'),
  ('Vit trang dau du', 'Vít trắng đầu dù'),
  ('Com bi', 'Cùm bi'),
  ('Bas treo sat', 'Bas treo sắt'),
  ('Bas treo inox 304', 'Bas treo inox 304'),
  ('Omega sat', 'Omega sắt'),
  ('Ty ren loai I', 'Ty ren loại I'),
  ('Sat V lo', 'Sắt V lỗ'),
  ('Mom ke', 'Mâm kệ'),
  ('Ke den 5 tang', 'Kệ đen 5 tầng'),
  ('Ke trung tai', 'Kệ trung tải'),
  ('Luoi ke', 'Lưới kệ'),
  ('Mc luoi', 'Móc lưới'),
  ('Ke V3 tinh dien', 'Kệ V3 tĩnh điện'),
  ('Ke trang', 'Kệ trắng'),
  ('Ke inox 201', 'Kệ inox 201'),
  ('Ke mini', 'Kệ mini'),
  ('Ke ban 225', 'Kệ bản 225'),
  ('Ke ban 495', 'Kệ bản 495'),
  ('Ke mini inox', 'Kệ mini inox'),
  ('Bas tay', 'Bas tay'),
  ('Day cap m trang', 'Dây cáp mạ trắng'),
  ('Day cap ma trang', 'Dây cáp mạ trắng'),
  ('Day cap inox', 'Dây cáp inox'),
  ('Day cap boc nhua', 'Dây cáp bọc nhựa'),
  ('c xiet cap', 'Ốc xiết cáp'),
  ('Tang do', 'Tăng đơ'),
  ('Ma ni', 'Ma ní'),
  ('c xiet cap inox', 'Ốc xiết cáp inox'),
  ('Rong roc', 'Ròng rọc'),
  ('Dinh hoi F', 'Đinh hơi F'),
  ('Dinh hoi chu U', 'Đinh hơi chữ U'),
  ('Dinh hoi thau', 'Đinh hơi thau'),
  ('Dinh hoi b tang', 'Đinh hơi bê tông'),
  ('Rut tu 3 tang', 'Rút tủ 3 tầng'),
  ('Day xich sat', 'Dây xích sắt'),
  ('Day xich inox', 'Dây xích inox'),
  ('Banh xe', 'Bánh xe'),
  ('Khung treo TV', 'Khung treo TV'),
  ('Dinh go dau ch', 'Đinh gỗ đầu chì'),
  ('Dinh thp', 'Đinh thép'),
  ('Bua nho dinh', 'Búa nhổ đinh'),
  ('Bua do', 'Búa dẻo'),
  ('Bua cao su', 'Búa cao su'),
  ('Kem', 'Kềm'),
  ('Bang keo', 'Băng keo'),
  ('Keo cuon', 'Keo cuộn'),
  ('Silicon', 'Silicon'),
  ('Foam', 'Foam'),
  ('Son xit ATM', 'Sơn xịt ATM'),
  ('Keo sua ATM', 'Keo sữa ATM'),
  ('Keo V66', 'Keo V66'),
  ('Keo 502', 'Keo 502'),
  ('Hoa phm', 'Hóa phẩm');

-- Some databases already contain a product with the accented name. Merge the
-- unaccented import into that canonical row before renaming the remaining rows.
create temporary table product_name_merges as
select old_product.id as old_id,
       canonical_product.id as canonical_id,
       f.old_name,
       f.new_name
from catalog_name_fixes f
join public.products old_product on old_product.name = f.old_name
join public.products canonical_product
  on canonical_product.category_id = old_product.category_id
 and canonical_product.name = f.new_name
where old_product.id <> canonical_product.id;

insert into public.product_aliases (product_id, alias, normalized_alias)
select m.canonical_id, a.alias, a.normalized_alias
from public.product_aliases a
join product_name_merges m on m.old_id = a.product_id
on conflict (product_id, normalized_alias) do update set alias = excluded.alias;

delete from public.product_aliases a
using product_name_merges m
where a.product_id = m.old_id;

-- Disambiguate the rare case where both products already have an identical
-- internal variant label. The raw specification and all price relations remain
-- unchanged, and the label is normalized again below.
update public.product_variants old_variant
set display_name = old_variant.display_name || ' [bản nhập ' || old_variant.id || ']',
    updated_at = now()
from product_name_merges m
where old_variant.product_id = m.old_id
  and exists (
    select 1
    from public.product_variants canonical_variant
    where canonical_variant.product_id = m.canonical_id
      and canonical_variant.display_name = old_variant.display_name
  );

update public.product_variants v
set product_id = m.canonical_id,
    updated_at = now()
from product_name_merges m
where v.product_id = m.old_id;

update public.promotions p
set product_id = m.canonical_id
from product_name_merges m
where p.product_id = m.old_id;

-- Favorites can conflict with an existing relationship for the canonical
-- product. Remove only that duplicate relationship before moving.
delete from public.favorites old_favorite
using product_name_merges m
where old_favorite.product_id = m.old_id
  and exists (
    select 1
    from public.favorites canonical_favorite
    where canonical_favorite.user_id = old_favorite.user_id
      and canonical_favorite.product_id = m.canonical_id
      and coalesce(canonical_favorite.variant_id, 0) = coalesce(old_favorite.variant_id, 0)
  );

update public.favorites f
set product_id = m.canonical_id
from product_name_merges m
where f.product_id = m.old_id;

delete from public.products p
using product_name_merges m
where p.id = m.old_id;

update public.products p
set name = f.new_name,
    description = regexp_replace(coalesce(p.description, ''), '^Nhap tu so gia viet tay', 'Nhập từ sổ giá viết tay'),
    updated_at = now()
from catalog_name_fixes f
where p.name = f.old_name
  and not exists (
    select 1
    from public.products existing
    where existing.category_id = p.category_id
      and existing.name = f.new_name
  );

-- Rename variant labels when that label is free. If an equivalent canonical
-- variant already exists, keep its internal label but still refresh search text;
-- the application displays the canonical product name and raw specification.
update public.product_variants v
set display_name = case
      when not exists (
         select 1
         from public.product_variants existing
         where existing.product_id = v.product_id
           and existing.id <> v.id
           and existing.display_name = f.new_name || substring(v.display_name from char_length(f.old_name) + 1)
       )
      then f.new_name || substring(v.display_name from char_length(f.old_name) + 1)
      else v.display_name
    end,
    updated_at = now()
from public.products p
join catalog_name_fixes f on f.new_name = p.name
where v.product_id = p.id
  and left(v.display_name, char_length(f.old_name)) = f.old_name;

update public.product_variants v
set search_text = lower(public.unaccent(concat_ws(' ', names.new_name, v.raw_specification, v.search_text))),
    updated_at = now()
from public.products p
join (select distinct new_name from catalog_name_fixes) names
  on names.new_name = p.name
where v.product_id = p.id;

update public.suppliers
set name = 'Sổ giá viết tay',
    note = 'Nguồn giá chép từ sổ; mọi giá phải được chủ cửa hàng xác nhận trước khi dùng chính thức.'
where name = 'So gia viet tay';

update public.price_lists
set name = 'Nhập từ Trang 1-13',
    note = 'Bản nhập cần xem lại. Đơn vị nghìn trong sổ đã được quy đổi thành VND.'
where name = 'Nhap tu Trang 1-13';

commit;
