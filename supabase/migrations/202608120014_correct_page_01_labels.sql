-- Apply confirmed Page 01 label corrections to databases that already ran 010.
begin;

create temporary table plastic_anchor_label_fixes (
  old_specification text primary key,
  new_specification text not null
) on commit drop;

insert into plastic_anchor_label_fixes values
  ('7F ĐBKS', '7F DB(HS)'),
  ('6F đỏ', '6L đỏ'),
  ('8F đỏ', '8L đỏ');

update public.product_variants variant
set raw_specification = fixes.new_specification,
    display_name = product.name || ' ' || fixes.new_specification,
    search_text = lower(public.unaccent(concat_ws(
      ' ', product.name, fixes.new_specification, variant.search_text
    ))),
    updated_at = now()
from public.products product,
     plastic_anchor_label_fixes fixes
where variant.product_id = product.id
  and product.name in ('Tắc kê nhựa Tiến Phát', 'Tac ke nhua Tien Phat')
  and variant.raw_specification = fixes.old_specification;

-- Reassert the confirmed 10 ly drop-in-anchor prices: 23k/10 pieces and
-- 86k/box of 50. This remains safe when migration 009 already has these values.
update public.prices price
set amount = confirmed.amount,
    version = case
      when price.amount is distinct from confirmed.amount then price.version + 1
      else price.version
    end,
    updated_at = now()
from (
  values
    ('10 con/bịch'::text, 10::numeric, 'retail'::text, 23000::numeric),
    ('50 con/hộp'::text, 50::numeric, 'wholesale'::text, 86000::numeric)
) as confirmed(package_name, package_quantity, price_type, amount)
join public.packaging_options packaging
  on packaging.name = confirmed.package_name
 and packaging.quantity = confirmed.package_quantity
 and packaging.base_unit = 'con'
join public.product_variants variant
  on variant.id = packaging.variant_id
 and variant.raw_specification = '10 ly'
join public.products product
  on product.id = variant.product_id
 and product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
where price.packaging_id = packaging.id
  and price.price_type = confirmed.price_type;

commit;
