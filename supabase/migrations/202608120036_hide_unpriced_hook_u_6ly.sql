-- Móc U chỉ có giá đã xác nhận cho 8 ly, 10 ly và 12 ly.
-- Ẩn toàn bộ 6 ly vì không có giá trong bảng người dùng xác nhận.
begin;

update public.product_variants variant
set active = false,
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and (
    lower(public.unaccent(product.name)) = 'moc u'
    or exists (
      select 1
      from public.product_aliases alias
      where alias.product_id = product.id
        and alias.normalized_alias = 'moc u'
    )
  )
  and lower(public.unaccent(variant.raw_specification)) like '6 ly%';

commit;
