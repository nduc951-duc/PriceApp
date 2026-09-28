-- Giá sỉ theo con của Tắc kê đạn Đài Loan 14 ly và 16 ly từ Trang 1.
-- Ảnh nguồn chưa cho biết số lượng tối thiểu nên không tự đặt ngưỡng sỉ.
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
      ('14 ly'::text, 7100::numeric),
      ('16 ly'::text, 8400::numeric)
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
      target_variant_id, '1 con (giá sỉ)', 1, 'con',
      'Chưa rõ số lượng tối thiểu để áp dụng giá sỉ; chỉ dùng sau khi xác nhận khách mua đủ số lượng.'
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
