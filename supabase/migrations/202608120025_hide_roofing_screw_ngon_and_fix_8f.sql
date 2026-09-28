-- Ẩn các biến thể "ngọn/ngon" và xác nhận lại giá 8F.
-- Không xóa biến thể hoặc lịch sử giá.
begin;

update public.product_variants variant
set active = false,
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
  and lower(public.unaccent(variant.raw_specification)) like '%ngon%';

do $$
declare
  target_variant_id bigint;
  target_price_list_id bigint;
  target_packaging_id bigint;
  stage record;
begin
  select variant.id into target_variant_id
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  where (
      lower(public.unaccent(product.name)) = 'vit tole sat go'
      or exists (
        select 1
        from public.product_aliases alias
        where alias.product_id = product.id
          and alias.normalized_alias in ('vit tole', 'vit sat go', 'vit tan')
      )
    )
    and lower(public.unaccent(variant.raw_specification)) = '8f'
  order by variant.active desc,
           (lower(public.unaccent(product.name)) = 'vit tole sat go') desc
  limit 1;

  if target_variant_id is null then
    raise exception 'Không tìm thấy biến thể Vít tole sắt gỗ 8F';
  end if;

  update public.product_variants
  set active = true, updated_at = now()
  where id = target_variant_id;

  select price_list.id into target_price_list_id
  from public.price_lists price_list
  join public.suppliers supplier on supplier.id = price_list.supplier_id
  where supplier.name in ('Sổ giá viết tay', 'So gia viet tay')
    and price_list.name in ('Nhập từ Trang 1-13', 'Nhap tu Trang 1-13')
    and price_list.effective_date = date '2026-08-12'
  order by (supplier.name = 'Sổ giá viết tay') desc
  limit 1;

  if target_price_list_id is null then
    raise exception 'Không tìm thấy bảng giá nhập Trang 1-13';
  end if;

  for stage in
    select * from (values
      ('10 con/bịch'::text, 10::numeric, 'retail'::text, 9000::numeric),
      ('200 con/bịch'::text, 200::numeric, 'wholesale'::text, 135000::numeric)
    ) as confirmed(package_name, package_quantity, price_type, amount)
  loop
    insert into public.packaging_options
      (variant_id, name, quantity, base_unit, note)
    values (
      target_variant_id, stage.package_name, stage.package_quantity, 'con',
      'Giá 8F do chủ cửa hàng xác nhận từ ảnh bảng giá.'
    )
    on conflict (variant_id, name, quantity, base_unit) do update
    set note = excluded.note
    returning id into target_packaging_id;

    insert into public.prices
      (packaging_id, price_list_id, price_type, customer_group,
       minimum_quantity, amount, currency, valid_from, active)
    values (
      target_packaging_id, target_price_list_id, stage.price_type,
      'confirmed', 1, stage.amount, 'VND',
      timestamptz '2026-08-12 00:00:00+07', true
    )
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
  end loop;
end
$$;

commit;
