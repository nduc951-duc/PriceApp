-- Thêm giá theo hộp cho Tắc kê đạn Đài Loan 6 ly và 8 ly.
-- Số con trong hộp chưa được xác nhận, vì vậy đơn vị cơ sở là "hộp"
-- và tuyệt đối không quy đổi thành hộp 50 con.
begin;

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

  for stage in
    select * from (values
      ('6 ly'::text,  76000::numeric),
      ('8 ly'::text, 106000::numeric)
    ) as confirmed_price(specification, amount)
  loop
    select variant.id into target_variant_id
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where product.name in ('Tắc kê đạn Đài Loan', 'Tac ke dan Dai Loan')
      and lower(public.unaccent(variant.raw_specification)) = stage.specification
    order by (product.name = 'Tắc kê đạn Đài Loan') desc
    limit 1;

    if target_variant_id is null then
      raise exception 'Không tìm thấy biến thể Tắc kê đạn Đài Loan %', stage.specification;
    end if;

    insert into public.packaging_options
      (variant_id, name, quantity, base_unit, note)
    values (
      target_variant_id, '1 hộp (chưa rõ số con)', 1, 'hộp',
      'Giá hộp xác nhận từ Trang 1; chưa rõ một hộp có bao nhiêu con.'
    )
    on conflict (variant_id, name, quantity, base_unit) do update
    set note = excluded.note
    returning id into target_packaging_id;

    insert into public.prices
      (packaging_id, price_list_id, price_type, customer_group,
       minimum_quantity, amount, currency, valid_from, active)
    values (
      target_packaging_id, target_price_list_id, 'wholesale', 'needs_review',
      1, stage.amount, 'VND', timestamptz '2026-08-12 00:00:00+07', true
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
