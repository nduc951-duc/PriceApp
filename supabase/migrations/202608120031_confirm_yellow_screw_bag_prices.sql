-- Giá bịch Vít vàng; ảnh nguồn chưa ghi rõ số con trong mỗi bịch.
begin;

create temporary table yellow_screw_prices (
  specification text primary key,
  amount numeric not null
) on commit drop;

insert into yellow_screw_prices values
  ('1F5 nhuyễn', 80000),
  ('2F',         58000),
  ('2F5',        57000),
  ('3F',         57000),
  ('4F',         57000),
  ('5F',         57000),
  ('6F',         65000),
  ('7F',         68000);

do $$
declare
  target_product_id bigint;
  target_product_name text;
  target_price_list_id bigint;
  stage record;
  target_variant_id bigint;
  target_packaging_id bigint;
begin
  select product.id, product.name
  into target_product_id, target_product_name
  from public.products product
  where lower(public.unaccent(product.name)) = 'vit vang'
     or exists (
       select 1 from public.product_aliases alias
       where alias.product_id = product.id
         and alias.normalized_alias = 'vit vang'
     )
  order by (lower(public.unaccent(product.name)) = 'vit vang') desc
  limit 1;

  if target_product_id is null then
    raise exception 'Không tìm thấy sản phẩm Vít vàng';
  end if;

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

  for stage in select * from yellow_screw_prices loop
    select variant.id into target_variant_id
    from public.product_variants variant
    where variant.product_id = target_product_id
      and lower(public.unaccent(variant.raw_specification)) =
          lower(public.unaccent(stage.specification))
    order by variant.active desc
    limit 1;

    if target_variant_id is null then
      insert into public.product_variants
        (product_id, display_name, raw_specification, attributes, search_text,
         verification_status, active)
      values (
        target_product_id, target_product_name || ' ' || stage.specification,
        stage.specification, jsonb_build_object('source_page', 2),
        lower(public.unaccent(target_product_name || ' ' || stage.specification)),
        'needs_review'::public.verification_status, true
      )
      returning id into target_variant_id;
    else
      update public.product_variants
      set active = true, updated_at = now()
      where id = target_variant_id;
    end if;

    insert into public.packaging_options
      (variant_id, name, quantity, base_unit, note)
    values (
      target_variant_id, '1 bịch (chưa rõ số con)', 1, 'bịch',
      'Giá theo bịch; ảnh nguồn chưa ghi rõ số con trong một bịch.'
    )
    on conflict (variant_id, name, quantity, base_unit) do update
    set note = excluded.note
    returning id into target_packaging_id;

    insert into public.prices
      (packaging_id, price_list_id, price_type, customer_group,
       minimum_quantity, amount, currency, valid_from, active)
    values (
      target_packaging_id, target_price_list_id, 'retail',
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
