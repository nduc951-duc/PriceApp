-- Temporarily hide Móc điện. No catalog or price data is deleted.
begin;

update public.product_variants variant
set active = false,
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and product.name in ('Móc điện', 'Mc dien');

update public.products
set active = false,
    updated_at = now()
where name in ('Móc điện', 'Mc dien');

commit;

-- To restore later:
-- update public.products set active = true, updated_at = now()
-- where name in ('Móc điện', 'Mc dien');
-- update public.product_variants variant set active = true, updated_at = now()
-- from public.products product
-- where variant.product_id = product.id
--   and product.name in ('Móc điện', 'Mc dien');
