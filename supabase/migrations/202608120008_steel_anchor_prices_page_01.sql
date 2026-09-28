-- Confirmed steel-anchor prices transcribed from source Page 01.
-- Notebook values are thousands of VND; uncertain rows are intentionally omitted.
begin;

create temporary table steel_anchor_price_stage (
  specification text primary key,
  retail_10_amount numeric not null check (retail_10_amount >= 0),
  bag_95_amount numeric not null check (bag_95_amount >= 0)
) on commit drop;

insert into steel_anchor_price_stage
  (specification, retail_10_amount, bag_95_amount)
values
  ('6x50',       12000,  63000),
  ('6x60',       15000,  78000),
  ('6x80',       18000, 100000),
  ('6x100',      25000, 112000),
  ('moc 6',      28000, 190000),
  ('8x60',       20000, 116000),
  ('8x80',       25000, 148000),
  ('8x100',      30000, 184000),
  ('8x120',      35000, 218000),
  ('moc 8',      40000, 295000),
  ('10x60 mong', 25000, 187000),
  ('10x60 day',  30000, 238000),
  ('10x80 mong', 30000, 228000),
  ('10x80 day',  35000, 288000),
  ('10x100 day', 45000, 344000),
  ('10x120 day', 55000, 397000),
  ('moc 10',     55000, 416000),
  ('12x80 day',  55000, 425000),
  ('12x100 day', 70000, 520000),
  ('12x120 day', 80000, 620000),
  ('12x150 day', 90000, 745000);

create temporary table steel_anchor_prices (
  specification text,
  package_name text,
  package_quantity numeric,
  price_type text,
  amount numeric
) on commit drop;

insert into steel_anchor_prices
select specification, '10 con/bịch', 10, 'retail', retail_10_amount
from steel_anchor_price_stage
union all
select specification, '95 con/bịch', 95, 'wholesale', bag_95_amount
from steel_anchor_price_stage;

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select v.id, stage.package_name, stage.package_quantity, 'con',
       'Giá xác nhận từ ảnh bảng giá Trang 1; trạng thái needs_review.'
from steel_anchor_prices stage
join public.products p on p.name in ('Tắc kê sắt', 'Tac ke sat')
join public.product_variants v
  on v.product_id = p.id and v.raw_specification = stage.specification
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group,
   minimum_quantity, amount, currency, valid_from, active)
select packaging.id, price_list.id, stage.price_type, 'needs_review', 1,
       stage.amount, 'VND', timestamptz '2026-08-12 00:00:00+07', true
from steel_anchor_prices stage
join public.products product on product.name in ('Tắc kê sắt', 'Tac ke sat')
join public.product_variants variant
  on variant.product_id = product.id
 and variant.raw_specification = stage.specification
join public.packaging_options packaging
  on packaging.variant_id = variant.id
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
