-- Xác nhận lại bốn quy cách đặc biệt của Tắc kê nhựa Tiến Phát (Trang 1).
begin;

do $$
declare
  target_price_list_id bigint;
  stage record;
  target_variant_id bigint;
  target_packaging_id bigint;
  package_stage record;
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

  for stage in
    select * from (values
      ('6L đỏ'::text, array['6l do','6f do','6f d']::text[], 17000::numeric, 125000::numeric),
      ('8 ly đỏ'::text, array['8 ly do','8l do','8f do','8f d']::text[], 22000::numeric, 165000::numeric),
      ('Bướm'::text, array['buom','bum']::text[], 22000::numeric, 162000::numeric),
      ('Râu'::text, array['rau']::text[], 12000::numeric, 80000::numeric)
    ) as confirmed(specification, aliases, retail_amount, wholesale_amount)
  loop
    select variant.id into target_variant_id
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where product.name in ('Tắc kê nhựa Tiến Phát', 'Tac ke nhua Tien Phat')
      and lower(public.unaccent(variant.raw_specification)) = any(stage.aliases)
    order by
      (variant.raw_specification = stage.specification) desc,
      (product.name = 'Tắc kê nhựa Tiến Phát') desc
    limit 1;

    if target_variant_id is null then
      raise exception 'Không tìm thấy biến thể Tắc kê nhựa Tiến Phát %', stage.specification;
    end if;

    for package_stage in
      select * from (values
        ('100 con/gói'::text, 100::numeric, 'retail'::text, stage.retail_amount),
        ('1.000 con/bịch'::text, 1000::numeric, 'wholesale'::text, stage.wholesale_amount)
      ) as package_price(package_name, package_quantity, price_type, amount)
    loop
      insert into public.packaging_options
        (variant_id, name, quantity, base_unit, note)
      values (
        target_variant_id, package_stage.package_name,
        package_stage.package_quantity, 'con',
        'Giá xác nhận từ ảnh bảng giá Trang 1.'
      )
      on conflict (variant_id, name, quantity, base_unit) do update
      set note = excluded.note
      returning id into target_packaging_id;

      insert into public.prices
        (packaging_id, price_list_id, price_type, customer_group,
         minimum_quantity, amount, currency, valid_from, active)
      values (
        target_packaging_id, target_price_list_id, package_stage.price_type,
        'needs_review', 1, package_stage.amount, 'VND',
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
