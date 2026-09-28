-- Hide the discontinued/unwanted 12 × 200 dày steel-anchor variant.
-- No product, source, packaging, or price data is deleted.
begin;

update public.product_variants variant
set active = false,
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and product.name in ('Tắc kê sắt', 'Tac ke sat')
  and variant.raw_specification in ('12x200 day', '12 × 200 dày');

commit;

-- To restore later:
-- update public.product_variants variant
-- set active = true, updated_at = now()
-- from public.products product
-- where variant.product_id = product.id
--   and product.name in ('Tắc kê sắt', 'Tac ke sat')
--   and variant.raw_specification in ('12x200 day', '12 × 200 dày');
