-- Confirmed drop-in anchor prices from source Page 01.
-- Rows with uncertain amounts or unknown box quantities are intentionally omitted.
begin;

create temporary table drop_in_anchor_prices (
  specification text,
  package_name text,
  package_quantity numeric,
  price_type text,
  amount numeric,
  primary key (specification, package_name, package_quantity, price_type)
) on commit drop;

insert into drop_in_anchor_prices
  (specification, package_name, package_quantity, price_type, amount)
values
  ('6 ly',  '10 con/bịch', 10, 'retail',    10000),
  ('8 ly',  '10 con/bịch', 10, 'retail',    14000),
  ('10 ly', '10 con/bịch', 10, 'retail',    23000),
  ('10 ly', '50 con/hộp', 50, 'wholesale', 86000),
  ('12 ly', '10 con/bịch', 10, 'retail',    55000),
  ('12 ly', '50 con/hộp', 50, 'wholesale', 215000),
  ('14 ly', '1 con',        1, 'retail',     9000),
  ('16 ly', '1 con',        1, 'retail',    10000);

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select variant.id, stage.package_name, stage.package_quantity, 'con',
       'Giá xác nhận từ ảnh bảng giá Trang 1; trạng thái needs_review.'
from drop_in_anchor_prices stage
join public.products product
  on product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
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
from drop_in_anchor_prices stage
join public.products product
  on product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
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
