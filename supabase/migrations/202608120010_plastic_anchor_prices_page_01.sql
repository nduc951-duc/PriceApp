-- Confirmed Tiến Phát plastic-anchor prices from source Page 01.
-- Notebook values are thousands of VND.
begin;

create temporary table plastic_anchor_price_stage (
  legacy_specification text primary key,
  display_specification text not null,
  small_100_amount numeric not null check (small_100_amount >= 0),
  large_1000_amount numeric not null check (large_1000_amount >= 0)
) on commit drop;

insert into plastic_anchor_price_stage
  (legacy_specification, display_specification, small_100_amount, large_1000_amount)
values
  ('2F',      '2F',      9000,  52000),
  ('3F',      '3F',     10000,  70000),
  ('4F',      '4F',     12000,  85000),
  ('5F',      '5F',     15000, 115000),
  ('6F',      '6F',     20000, 167000),
  ('7F',      '7F',     26000, 203000),
  ('7F DBKS', '7F DB(HS)',50000, 320000),
  ('6F d',    '6L đỏ',  17000, 125000),
  ('8F d',    '8L đỏ',  22000, 165000),
  ('bum',     'Bướm',   22000, 162000),
  ('rau',     'Râu',    12000,  80000);

insert into public.product_variants
  (product_id, display_name, raw_specification, attributes, search_text,
   verification_status, active)
select product.id,
       product.name || ' ' || stage.display_specification,
       stage.display_specification,
       jsonb_build_object('spec_code', stage.legacy_specification, 'source_page', 1),
       lower(public.unaccent(concat_ws(
         ' ', product.name, stage.display_specification, stage.legacy_specification
       ))),
       'needs_review'::public.verification_status,
       true
from plastic_anchor_price_stage stage
join public.products product
  on product.name in ('Tắc kê nhựa Tiến Phát', 'Tac ke nhua Tien Phat')
where not exists (
  select 1
  from public.product_variants existing
  where existing.product_id = product.id
    and existing.raw_specification in (
      stage.legacy_specification,
      stage.display_specification
    )
)
on conflict (product_id, display_name) do nothing;

create temporary table plastic_anchor_variant_map as
select stage.legacy_specification,
       stage.display_specification,
       variant.id as variant_id,
       product.name as product_name
from plastic_anchor_price_stage stage
join public.products product
  on product.name in ('Tắc kê nhựa Tiến Phát', 'Tac ke nhua Tien Phat')
join public.product_variants variant
  on variant.product_id = product.id
 and variant.raw_specification in (
   stage.legacy_specification,
   stage.display_specification
 );

update public.product_variants variant
set display_name = mapping.product_name || ' ' || mapping.display_specification,
    raw_specification = mapping.display_specification,
    search_text = lower(public.unaccent(concat_ws(
      ' ', mapping.product_name, mapping.display_specification,
      mapping.legacy_specification
    ))),
    attributes = variant.attributes || jsonb_build_object(
      'spec_code', mapping.legacy_specification, 'source_page', 1
    ),
    updated_at = now()
from plastic_anchor_variant_map mapping
where variant.id = mapping.variant_id;

insert into public.variant_sources (variant_id, source_page_id)
select mapping.variant_id, source.id
from plastic_anchor_variant_map mapping
join public.source_pages source on source.page_number = 1
on conflict (variant_id, source_page_id) do nothing;

create temporary table plastic_anchor_prices (
  legacy_specification text,
  package_name text,
  package_quantity numeric,
  price_type text,
  amount numeric
) on commit drop;

insert into plastic_anchor_prices
select legacy_specification, '100 con/gói', 100, 'retail', small_100_amount
from plastic_anchor_price_stage
union all
select legacy_specification, '1.000 con/bịch', 1000, 'wholesale', large_1000_amount
from plastic_anchor_price_stage;

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select mapping.variant_id, stage.package_name, stage.package_quantity, 'con',
       'Giá xác nhận từ ảnh bảng giá Trang 1; trạng thái needs_review.'
from plastic_anchor_prices stage
join plastic_anchor_variant_map mapping
  on mapping.legacy_specification = stage.legacy_specification
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group,
   minimum_quantity, amount, currency, valid_from, active)
select packaging.id, price_list.id, stage.price_type, 'needs_review', 1,
       stage.amount, 'VND', timestamptz '2026-08-12 00:00:00+07', true
from plastic_anchor_prices stage
join plastic_anchor_variant_map mapping
  on mapping.legacy_specification = stage.legacy_specification
join public.packaging_options packaging
  on packaging.variant_id = mapping.variant_id
 and packaging.name = stage.package_name
 and packaging.quantity = stage.package_quantity
 and packaging.base_unit = 'con'
join public.suppliers supplier
  on supplier.name in ('Sổ giá viết tay', 'So gia viet tay')
join public.price_lists price_list
  on price_list.supplier_id = supplier.id
 and price_list.name in ('Nhập từ Trang 1-13', 'Nhap tu Trang 1-13')
 and price_list.effective_date = date '2026-08-12'
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
