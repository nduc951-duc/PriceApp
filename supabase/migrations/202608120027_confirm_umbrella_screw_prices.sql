-- Bảng giá Vít bắn dù Đài Loan do chủ cửa hàng xác nhận.
begin;

create temporary table umbrella_screw_prices (
  specification text,
  package_name text,
  package_quantity numeric,
  price_type text,
  amount numeric,
  primary key (specification, package_name, package_quantity, price_type)
) on commit drop;

insert into umbrella_screw_prices values
  ('1F3', '100 con/bịch',  100, 'retail',     13000),
  ('1F3', '1.000 con/bịch',1000, 'wholesale',100000),
  ('1F6', '100 con/bịch',  100, 'retail',     14000),
  ('1F6', '1.000 con/bịch',1000, 'wholesale',112000),
  ('2F',  '100 con/bịch',  100, 'retail',     15000),
  ('2F',  '1.000 con/bịch',1000, 'wholesale',124000),
  ('2F5', '100 con/bịch',  100, 'retail',     18000),
  ('2F5', '1.000 con/bịch',1000, 'wholesale',146000),
  ('3F',  '100 con/bịch',  100, 'retail',     22000),
  ('3F',  '1.000 con/bịch',1000, 'wholesale',168000),
  ('4F',  '100 con/bịch',  100, 'retail',     26000),
  ('4F',  '1.000 con/bịch',1000, 'wholesale',208000);

do $$
declare
  target_price_list_id bigint;
  stage record;
  target_variant_id bigint;
  target_packaging_id bigint;
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

  for stage in select * from umbrella_screw_prices loop
    select variant.id into target_variant_id
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where (
        lower(public.unaccent(product.name)) = 'vit ban du dai loan'
        or exists (
          select 1
          from public.product_aliases alias
          where alias.product_id = product.id
            and alias.normalized_alias in ('vit ban du', 'vit du dui loan')
        )
      )
      and lower(public.unaccent(variant.raw_specification)) = lower(stage.specification)
    order by
      variant.active desc,
      (lower(public.unaccent(product.name)) = 'vit ban du dai loan') desc
    limit 1;

    if target_variant_id is null then
      raise exception 'Không tìm thấy biến thể Vít bắn dù Đài Loan %', stage.specification;
    end if;

    update public.product_variants
    set active = true, updated_at = now()
    where id = target_variant_id;

    insert into public.packaging_options
      (variant_id, name, quantity, base_unit, note)
    values (
      target_variant_id, stage.package_name, stage.package_quantity, 'con',
      'Giá do chủ cửa hàng xác nhận từ ảnh bảng giá.'
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
