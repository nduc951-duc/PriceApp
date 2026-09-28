-- Bảng giá Móc C: mỗi đơn vị tính là 100 bộ; ô không có giá được bỏ qua.
begin;

create temporary table hook_c_prices (
  diameter text,
  length text,
  price_type text,
  amount numeric,
  primary key (diameter, length, price_type)
) on commit drop;

insert into hook_c_prices values
  ('4 ly','1F',  'retail',15000), ('4 ly','1F',  'wholesale',18000),
  ('4 ly','1F5', 'retail',16000), ('4 ly','1F5', 'wholesale',19000),
  ('4 ly','2F',  'retail',18000), ('4 ly','2F',  'wholesale',20000),
  ('4 ly','2F5', 'retail',20000), ('4 ly','2F5', 'wholesale',22000),
  ('4 ly','3F',  'retail',22000), ('4 ly','3F',  'wholesale',25000),
  ('4 ly','4F',  'retail',25000), ('4 ly','4F',  'wholesale',27000),
  ('4 ly','5F',  'retail',30000), ('4 ly','5F',  'wholesale',34000),
  ('4 ly','6F',  'retail',38000), ('4 ly','6F',  'wholesale',42000),
  ('4 ly','7F',  'retail',48000), ('4 ly','7F',  'wholesale',53000),
  ('4 ly','8F',  'retail',55000), ('4 ly','8F',  'wholesale',60000),
  ('5 ly','1F',  'wholesale',24000),
  ('5 ly','1F5', 'wholesale',26000),
  ('5 ly','2F',  'wholesale',30000),
  ('5 ly','2F5', 'wholesale',30000),
  ('5 ly','3F',  'wholesale',33000),
  ('5 ly','4F',  'wholesale',36000),
  ('5 ly','5F',  'wholesale',40000),
  ('6 ly','1F',  'wholesale',29000),
  ('6 ly','1F5', 'wholesale',32000),
  ('6 ly','2F',  'wholesale',35000),
  ('6 ly','2F5', 'wholesale',38000),
  ('6 ly','3F',  'wholesale',42000),
  ('6 ly','4F',  'wholesale',45000),
  ('6 ly','5F',  'wholesale',55000),
  ('6 ly','6F',  'wholesale',62000);

do $$
declare
  target_product_id bigint;
  target_product_name text;
  target_price_list_id bigint;
  stage record;
  target_variant_id bigint;
  target_packaging_id bigint;
  target_specification text;
begin
  select product.id, product.name
  into target_product_id, target_product_name
  from public.products product
  where lower(public.unaccent(product.name)) = 'moc c'
     or exists (
       select 1 from public.product_aliases alias
       where alias.product_id = product.id
         and alias.normalized_alias = 'moc c'
     )
  order by (lower(public.unaccent(product.name)) = 'moc c') desc
  limit 1;

  if target_product_id is null then
    raise exception 'Không tìm thấy sản phẩm Móc C';
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

  for stage in select * from hook_c_prices loop
    target_specification := stage.diameter || ' ' || stage.length;

    select variant.id into target_variant_id
    from public.product_variants variant
    where variant.product_id = target_product_id
      and lower(public.unaccent(variant.raw_specification)) =
          lower(public.unaccent(target_specification))
    order by variant.active desc
    limit 1;

    if target_variant_id is null then
      raise exception 'Không tìm thấy biến thể Móc C %', target_specification;
    end if;

    update public.product_variants
    set active = true, updated_at = now()
    where id = target_variant_id;

    insert into public.packaging_options
      (variant_id, name, quantity, base_unit, note)
    values (
      target_variant_id, '100 bộ/bịch', 100, 'bộ',
      'Một đơn vị tính là 100 bộ; giá do chủ cửa hàng xác nhận.'
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
