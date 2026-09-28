-- Tách các biến thể cánh/ngói khỏi Vít tole sắt gỗ thành một card riêng.
-- Giữ nguyên packaging, prices và lịch sử giá qua khóa variant_id.
begin;

do $$
declare
  source_product_id bigint;
  target_product_id bigint;
  target_category_id bigint;
begin
  select product.id, product.category_id
  into source_product_id, target_category_id
  from public.products product
  where lower(public.unaccent(product.name)) = 'vit tole sat go'
     or exists (
       select 1 from public.product_aliases alias
       where alias.product_id = product.id
         and alias.normalized_alias in ('vit tole', 'vit sat go', 'vit tan')
     )
  order by (lower(public.unaccent(product.name)) = 'vit tole sat go') desc
  limit 1;

  if source_product_id is null then
    raise exception 'Không tìm thấy sản phẩm Vít tole sắt gỗ';
  end if;

  select id into target_product_id
  from public.products
  where category_id = target_category_id
    and lower(public.unaccent(name)) = 'vit ban canh & ngoi'
  limit 1;

  if target_product_id is null then
    insert into public.products
      (category_id, name, description, active)
    values (
      target_category_id,
      'Vít bắn cánh & ngói',
      'Giá xác nhận từ ảnh bảng giá viết tay.',
      true
    )
    returning id into target_product_id;
  else
    update public.products
    set active = true, updated_at = now()
    where id = target_product_id;
  end if;

  update public.product_variants variant
  set product_id = target_product_id,
      display_name = 'Vít bắn cánh & ngói ' || variant.raw_specification,
      search_text = lower(public.unaccent(concat_ws(
        ' ', 'Vít bắn cánh ngói', variant.raw_specification, variant.search_text
      ))),
      active = true,
      updated_at = now()
  where variant.product_id = source_product_id
    and lower(public.unaccent(variant.raw_specification)) in (
      '3f canh', '4f canh', '4f ngoi',
      '5f ngoi', '6f ngoi', '7f ngoi'
    );

  if (
    select count(*)
    from public.product_variants
    where product_id = target_product_id
      and active
      and lower(public.unaccent(raw_specification)) in (
        '3f canh', '4f canh', '4f ngoi',
        '5f ngoi', '6f ngoi', '7f ngoi'
      )
  ) <> 6 then
    raise exception 'Không thể xác nhận đủ 6 biến thể Vít bắn cánh & ngói';
  end if;

  insert into public.product_aliases (product_id, alias, normalized_alias)
  values
    (target_product_id, 'vít bắn cánh', 'vit ban canh'),
    (target_product_id, 'vít ngói', 'vit ngoi'),
    (target_product_id, 'vít bắn ngói', 'vit ban ngoi')
  on conflict (product_id, normalized_alias) do update
  set alias = excluded.alias;
end
$$;

commit;
