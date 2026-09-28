-- Confirmed transcription from handwritten source Page 11.
-- Values in the notebook are thousands of VND; blank cells are not inserted.
begin;

create temporary table wheel_price_stage (
  specification text primary key,
  amount numeric not null check (amount >= 0)
) on commit drop;

insert into wheel_price_stage (specification, amount) values
  ('vang 3F', 10000),
  ('vang 4F', 12000),
  ('den d 4F', 28000),
  ('den khoa d 4F', 34000),
  ('vang 5F', 17000),
  ('vang khoa 5F', 18000),
  ('den d 5F', 32000),
  ('den khoa d 5F', 37000),
  ('vang 6F', 18000),
  ('vang khoa 6F', 22000),
  ('den khoa d 6F5', 64000),
  ('vang 7F', 23000),
  ('vang khoa 7F', 28000),
  ('den d 7F5', 62000),
  ('den khoa d 7F5', 70000),
  ('d mom xoay 7F5', 65000),
  ('d mom khoa 7F5', 75000),
  ('vang 8F', 30000),
  ('vang khoa 8F', 35000),
  ('d mom xoay 1T', 70000),
  ('d mom khoa 1T', 80000),
  ('vang 1T', 45000),
  ('vang khoa 1T', 40000),
  ('d mom xoay 1T2', 82000),
  ('d mom khoa 1T2', 94000),
  ('vang 1T2', 50000),
  ('vang khoa 1T2', 60000);

create temporary table wheel_variant_labels as
select specification,
       case
         when specification like 'vang khoa %' then 'Vàng khóa ' || substring(specification from 11)
         when specification like 'vang %' then 'Vàng ' || substring(specification from 6)
         when specification like 'den khoa d %' then 'Đen khóa ĐL ' || substring(specification from 12)
         when specification like 'den d %' then 'Đen ĐL ' || substring(specification from 7)
         when specification like 'd mom khoa %' then 'Đỏ mận khóa ĐL ' || substring(specification from 12)
         when specification like 'd mom xoay %' then 'Đỏ mận ĐL ' || substring(specification from 12)
       end as display_specification
from wheel_price_stage;

insert into public.product_variants
  (product_id, display_name, raw_specification, attributes, search_text,
   verification_status, active)
select p.id,
       p.name || ' ' || labels.display_specification,
       labels.display_specification,
       jsonb_build_object('spec_code', labels.specification, 'source_page', 11),
       lower(public.unaccent(concat_ws(' ', p.name, labels.display_specification))),
       'needs_review'::public.verification_status,
       true
from wheel_variant_labels labels
join public.products p on p.name in ('Bánh xe', 'Banh xe')
where not exists (
  select 1
  from public.product_variants existing
  where existing.product_id = p.id
    and existing.raw_specification in (labels.specification, labels.display_specification)
)
on conflict (product_id, display_name) do nothing;

create temporary table wheel_variant_map as
select labels.specification,
       labels.display_specification,
       v.id as variant_id,
       p.id as product_id,
       p.name as product_name
from wheel_variant_labels labels
join public.products p on p.name in ('Bánh xe', 'Banh xe')
join public.product_variants v
  on v.product_id = p.id
 and v.raw_specification in (labels.specification, labels.display_specification);

update public.product_variants v
set display_name = mapping.product_name || ' ' || mapping.display_specification,
    raw_specification = mapping.display_specification,
    search_text = lower(public.unaccent(concat_ws(
      ' ', mapping.product_name, mapping.display_specification, mapping.specification
    ))),
    attributes = v.attributes || jsonb_build_object(
      'spec_code', mapping.specification, 'source_page', 11
    ),
    updated_at = now()
from wheel_variant_map mapping
where v.id = mapping.variant_id;

insert into public.variant_sources (variant_id, source_page_id)
select mapping.variant_id, source.id
from wheel_variant_map mapping
join public.source_pages source on source.page_number = 11
on conflict (variant_id, source_page_id) do nothing;

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select v.id, '1 bánh/cái', 1, 'bánh',
       'Giá xác nhận từ ảnh bảng giá Trang 11; vẫn cần chủ cửa hàng duyệt.'
from wheel_variant_map mapping
join public.product_variants v on v.id = mapping.variant_id
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group,
   minimum_quantity, amount, currency, valid_from, active)
select po.id, pl.id, 'retail', 'needs_review', 1, s.amount, 'VND',
       timestamptz '2026-08-12 00:00:00+07', true
from wheel_price_stage s
join wheel_variant_map mapping on mapping.specification = s.specification
join public.product_variants v on v.id = mapping.variant_id
join public.packaging_options po
  on po.variant_id = v.id
 and po.name = '1 bánh/cái'
 and po.quantity = 1
 and po.base_unit = 'bánh'
join public.suppliers supplier
  on supplier.name in ('Sổ giá viết tay', 'So gia viet tay')
join public.price_lists pl
  on pl.supplier_id = supplier.id
 and pl.name in ('Nhập từ Trang 1-13', 'Nhap tu Trang 1-13')
 and pl.effective_date = date '2026-08-12'
on conflict (packaging_id, price_list_id, price_type, minimum_quantity, valid_from)
do update set
  amount = excluded.amount,
  customer_group = excluded.customer_group,
  active = true,
  version = case
    when public.prices.amount is distinct from excluded.amount
      then public.prices.version + 1
    else public.prices.version
  end,
  updated_at = now();

commit;
