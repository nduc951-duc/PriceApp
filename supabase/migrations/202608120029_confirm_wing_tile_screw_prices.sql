-- Bảng giá Vít bắn cánh và vít ngói do chủ cửa hàng xác nhận.
begin;

create temporary table wing_tile_screw_prices (
  specification text primary key,
  aliases text[] not null,
  retail_amount numeric not null,
  wholesale_amount numeric not null
) on commit drop;

insert into wing_tile_screw_prices values
  ('3F cánh', array['3f canh'], 26000, 195000),
  ('4F cánh', array['4f canh'], 30000, 232000),
  ('4F ngói', array['4f ngoi'], 24000, 172000),
  ('5F ngói', array['5f ngoi'], 30000, 233000),
  ('6F ngói', array['6f ngoi'], 34000, 266000),
  ('7F ngói', array['7f ngoi'], 40000, 314000);

do $$
declare
  target_price_list_id bigint;
  stage record;
  package_stage record;
  target_variant_id bigint;
  target_packaging_id bigint;
  target_product_id bigint;
  target_product_name text;
begin
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

  select product.id, product.name
  into target_product_id, target_product_name
  from public.products product
  where lower(public.unaccent(product.name)) = 'vit tole sat go'
     or exists (
       select 1 from public.product_aliases alias
       where alias.product_id = product.id
         and alias.normalized_alias in ('vit tole', 'vit sat go', 'vit tan')
     )
  order by (lower(public.unaccent(product.name)) = 'vit tole sat go') desc
  limit 1;

  if target_product_id is null then
    raise exception 'Không tìm thấy sản phẩm Vít tole sắt gỗ';
  end if;

  for stage in select * from wing_tile_screw_prices loop
    select variant.id into target_variant_id
    from public.product_variants variant
    where variant.product_id = target_product_id
      and lower(public.unaccent(variant.raw_specification)) = any(stage.aliases)
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
    end if;

    update public.product_variants
    set raw_specification = stage.specification,
        display_name = target_product_name || ' ' || stage.specification,
        search_text = lower(public.unaccent(concat_ws(
          ' ', target_product_name, stage.specification, search_text
        ))),
        active = true,
        updated_at = now()
    where id = target_variant_id;

    for package_stage in
      select * from (values
        ('100 con/bịch'::text, 100::numeric, 'retail'::text, stage.retail_amount),
        ('1.000 con/bịch'::text, 1000::numeric, 'wholesale'::text, stage.wholesale_amount)
      ) as package_price(package_name, package_quantity, price_type, amount)
    loop
      insert into public.packaging_options
        (variant_id, name, quantity, base_unit, note)
      values (
        target_variant_id, package_stage.package_name,
        package_stage.package_quantity, 'con',
        'Giá do chủ cửa hàng xác nhận từ ảnh bảng giá.'
      )
      on conflict (variant_id, name, quantity, base_unit) do update
      set note = excluded.note
      returning id into target_packaging_id;

      insert into public.prices
        (packaging_id, price_list_id, price_type, customer_group,
         minimum_quantity, amount, currency, valid_from, active)
      values (
        target_packaging_id, target_price_list_id, package_stage.price_type,
        'confirmed', 1, package_stage.amount, 'VND',
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
  end loop;
end
$$;

commit;
