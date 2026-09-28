-- Tạm ẩn Nối ty khỏi trang; không xóa sản phẩm, biến thể hoặc dữ liệu liên quan.
begin;

update public.product_variants variant
set active = false,
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and (
    lower(public.unaccent(product.name)) in ('noi ty', 'n ty')
    or exists (
      select 1
      from public.product_aliases alias
      where alias.product_id = product.id
        and alias.normalized_alias in ('noi ty', 'no ty', 'tac k ty')
    )
  );

update public.products product
set active = false,
    updated_at = now()
where lower(public.unaccent(product.name)) in ('noi ty', 'n ty')
   or exists (
     select 1
     from public.product_aliases alias
     where alias.product_id = product.id
       and alias.normalized_alias in ('noi ty', 'no ty', 'tac k ty')
   );

commit;

-- Khôi phục khi cần:
-- update public.products set active = true, updated_at = now()
-- where lower(public.unaccent(name)) in ('noi ty', 'n ty');
-- update public.product_variants variant set active = true, updated_at = now()
-- from public.products product
-- where variant.product_id = product.id
--   and lower(public.unaccent(product.name)) in ('noi ty', 'n ty');
