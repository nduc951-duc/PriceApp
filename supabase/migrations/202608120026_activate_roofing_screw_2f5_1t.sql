-- Bảo đảm hai quy cách đã xác nhận được hiển thị trên ứng dụng.
begin;

update public.product_variants variant
set active = true,
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and (
    lower(public.unaccent(product.name)) = 'vit tole sat go'
    or exists (
      select 1
      from public.product_aliases alias
      where alias.product_id = product.id
        and alias.normalized_alias in ('vit tole', 'vit sat go', 'vit tan')
    )
  )
  and lower(public.unaccent(variant.raw_specification)) in ('2f5', '1t');

commit;
