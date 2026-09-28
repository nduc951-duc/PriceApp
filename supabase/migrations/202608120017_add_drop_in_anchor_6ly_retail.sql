-- Add the confirmed 6 ly retail price only. Box quantity for 6 ly and 8 ly
-- remains unknown, so no wholesale/box packaging is created for either size.
begin;

-- Hide any previously guessed 50-piece box price for 6 ly or 8 ly.
update public.prices price
set active = false,
    updated_at = now()
from public.packaging_options packaging
join public.product_variants variant on variant.id = packaging.variant_id
join public.products product on product.id = variant.product_id
where price.packaging_id = packaging.id
  and product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
  and variant.raw_specification in ('6 ly', '8 ly')
  and packaging.quantity = 50;

insert into public.packaging_options
  (variant_id, name, quantity, base_unit, note)
select variant.id, '10 con/bịch', 10, 'con',
       'Giá lẻ xác nhận từ Trang 1; chưa rõ số lượng trong hộp lớn.'
from public.products product
join public.product_variants variant on variant.product_id = product.id
where product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
  and variant.raw_specification = '6 ly'
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group,
   minimum_quantity, amount, currency, valid_from, active)
select packaging.id, price_list.id, 'retail', 'needs_review', 1,
       10000, 'VND', timestamptz '2026-08-12 00:00:00+07', true
from public.products product
join public.product_variants variant
  on variant.product_id = product.id and variant.raw_specification = '6 ly'
join public.packaging_options packaging
  on packaging.variant_id = variant.id
 and packaging.name = '10 con/bịch'
 and packaging.quantity = 10
 and packaging.base_unit = 'con'
join public.suppliers supplier
  on supplier.name in ('Sổ giá viết tay', 'So gia viet tay')
join public.price_lists price_list
  on price_list.supplier_id = supplier.id
 and price_list.name in ('Nhập từ Trang 1-13', 'Nhap tu Trang 1-13')
 and price_list.effective_date = date '2026-08-12'
where product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
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
