-- Chuẩn hóa nhãn hiển thị theo cách gọi đã xác nhận.
begin;

update public.product_variants variant
set raw_specification = labels.new_specification,
    display_name = product.name || ' ' || labels.new_specification,
    search_text = lower(public.unaccent(concat_ws(
      ' ', product.name, labels.new_specification, variant.search_text
    ))),
    updated_at = now()
from public.products product,
     (values
       ('6l do'::text, '6L đỏ'::text),
       ('6f do'::text, '6L đỏ'::text),
       ('6f d'::text,  '6L đỏ'::text),
       ('8l do'::text, '8 ly đỏ'::text),
       ('8f do'::text, '8 ly đỏ'::text),
       ('8f d'::text,  '8 ly đỏ'::text),
       ('buom'::text,  'Bướm'::text),
       ('bum'::text,   'Bướm'::text),
       ('rau'::text,   'Râu'::text)
     ) as labels(old_normalized, new_specification)
where variant.product_id = product.id
  and product.name in ('Tắc kê nhựa Tiến Phát', 'Tac ke nhua Tien Phat')
  and lower(public.unaccent(variant.raw_specification)) = labels.old_normalized
  and not exists (
    select 1
    from public.product_variants existing
    where existing.product_id = variant.product_id
      and existing.id <> variant.id
      and existing.display_name = product.name || ' ' || labels.new_specification
  );

commit;
