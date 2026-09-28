-- The Page 01 notebook gives wholesale prices per piece for 14–16 ly anchors,
-- but does not confirm the minimum wholesale quantity. Undo the earlier 95-piece
-- assumption while preserving the confirmed unit prices.
begin;

update public.prices price
set amount = price.amount / 95,
    version = price.version + 1,
    updated_at = now()
from public.packaging_options packaging
join public.product_variants variant on variant.id = packaging.variant_id
join public.products product on product.id = variant.product_id
where price.packaging_id = packaging.id
  and price.price_type = 'wholesale'
  and product.name in ('Tắc kê sắt', 'Tac ke sat')
  and variant.raw_specification in (
    '14x80 day', '14x100 day', '14x120 day', '14x150 day', '14x200 day',
    '16x100 day', '16x120 day', '16x150 day', '16x200 day'
  )
  and packaging.quantity = 95;

update public.packaging_options packaging
set name = '1 con (giá sỉ)',
    quantity = 1,
    note = 'Chưa rõ số lượng tối thiểu để áp dụng giá sỉ; chỉ dùng sau khi xác nhận đủ số lượng.'
from public.product_variants variant
join public.products product on product.id = variant.product_id
where packaging.variant_id = variant.id
  and product.name in ('Tắc kê sắt', 'Tac ke sat')
  and variant.raw_specification in (
    '14x80 day', '14x100 day', '14x120 day', '14x150 day', '14x200 day',
    '16x100 day', '16x120 day', '16x150 day', '16x200 day'
  )
  and packaging.quantity = 95;

commit;
