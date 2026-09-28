-- Confirmed large steel-anchor prices from source Page 01.
-- Wholesale amounts are per piece; the minimum wholesale quantity is unknown.
begin;

create temporary table large_steel_anchor_price_stage (
  specification text primary key,
  retail_each numeric not null check (retail_each >= 0),
  wholesale_each numeric not null check (wholesale_each >= 0)
) on commit drop;

insert into large_steel_anchor_price_stage
  (specification, retail_each, wholesale_each)
values
  ('14x80 day',  12000,  7840),
  ('14x100 day', 13000,  8520),
  ('14x120 day', 14000, 10500),
  ('14x150 day', 16000, 13100),
  ('14x200 day', 22000, 18500),
  ('16x100 day', 14000, 12000),
  ('16x120 day', 16000, 13200),
  ('16x150 day', 20000, 16000),
  ('16x200 day', 26000, 21700);

create temporary table large_steel_anchor_prices (
  specification text,
  package_name text,
  package_quantity numeric,
  price_type text,
  amount numeric
) on commit drop;

insert into large_steel_anchor_prices
select specification, '1 con', 1, 'retail', retail_each
from large_steel_anchor_price_stage
union all
select specification, '1 con (giá sỉ)', 1, 'wholesale', wholesale_each
from large_steel_anchor_price_stage;

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select variant.id, stage.package_name, stage.package_quantity, 'con',
       case
         when stage.price_type = 'wholesale'
           then 'Chưa rõ số lượng tối thiểu để áp dụng giá sỉ; chỉ dùng sau khi xác nhận đủ số lượng.'
         else 'Giá lẻ mỗi con; xác nhận từ Trang 1.'
       end
from large_steel_anchor_prices stage
join public.products product
  on product.name in ('Tắc kê sắt', 'Tac ke sat')
join public.product_variants variant
  on variant.product_id = product.id
 and variant.raw_specification = stage.specification
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group,
   minimum_quantity, amount, currency, valid_from, active)
select packaging.id, price_list.id, stage.price_type, 'needs_review', 1,
       stage.amount, 'VND', timestamptz '2026-08-12 00:00:00+07', true
from large_steel_anchor_prices stage
join public.products product
  on product.name in ('Tắc kê sắt', 'Tac ke sat')
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
