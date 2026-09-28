begin;

create or replace function public.update_catalog_item(
  p_category_id bigint,
  p_category_name text,
  p_product_id bigint,
  p_product_name text,
  p_variant_id bigint,
  p_variant_display_name text,
  p_raw_specification text,
  p_packaging_id bigint default null,
  p_package_name text default null,
  p_package_quantity numeric default null,
  p_base_unit text default null,
  p_price_id bigint default null,
  p_price_type text default null,
  p_minimum_quantity numeric default null,
  p_amount numeric default null,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_price public.prices;
begin
  if public.get_current_app_role() <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if nullif(btrim(p_category_name), '') is null
     or nullif(btrim(p_product_name), '') is null
     or nullif(btrim(p_variant_display_name), '') is null
     or nullif(btrim(p_raw_specification), '') is null then
    raise exception 'required_catalog_field_missing' using errcode = '22023';
  end if;

  update public.categories
  set name = btrim(p_category_name)
  where id = p_category_id;
  if not found then raise exception 'category_not_found'; end if;

  update public.products
  set name = btrim(p_product_name), updated_at = now()
  where id = p_product_id and category_id = p_category_id;
  if not found then raise exception 'product_not_found'; end if;

  update public.product_variants
  set display_name = btrim(p_variant_display_name),
      raw_specification = btrim(p_raw_specification),
      search_text = lower(public.unaccent(concat_ws(' ', p_product_name, p_variant_display_name, p_raw_specification))),
      updated_at = now()
  where id = p_variant_id and product_id = p_product_id;
  if not found then raise exception 'variant_not_found'; end if;

  if p_packaging_id is not null then
    if nullif(btrim(p_package_name), '') is null
       or nullif(btrim(p_base_unit), '') is null
       or p_package_quantity is null or p_package_quantity <= 0 then
      raise exception 'invalid_packaging' using errcode = '22023';
    end if;
    update public.packaging_options
    set name = btrim(p_package_name),
        quantity = p_package_quantity,
        base_unit = btrim(p_base_unit)
    where id = p_packaging_id and variant_id = p_variant_id;
    if not found then raise exception 'packaging_not_found'; end if;
  end if;

  if p_price_id is not null then
    if p_price_type not in ('retail', 'wholesale', 'dealer')
       or p_minimum_quantity is null or p_minimum_quantity <= 0
       or p_amount is null or p_amount < 0
       or p_expected_version is null then
      raise exception 'invalid_price' using errcode = '22023';
    end if;
    update public.prices
    set price_type = p_price_type,
        minimum_quantity = p_minimum_quantity,
        updated_at = now()
    where id = p_price_id and packaging_id = p_packaging_id;
    if not found then raise exception 'price_not_found'; end if;

    select * into changed_price
    from public.update_price_with_history(
      p_price_id,
      p_amount,
      p_expected_version,
      'Cập nhật toàn bộ thông tin sản phẩm'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'price_version', coalesce(changed_price.version, p_expected_version)
  );
end;
$$;

revoke all on function public.update_catalog_item(
  bigint, text, bigint, text, bigint, text, text,
  bigint, text, numeric, text, bigint, text, numeric, numeric, int
) from public, anon;

grant execute on function public.update_catalog_item(
  bigint, text, bigint, text, bigint, text, text,
  bigint, text, numeric, text, bigint, text, numeric, numeric, int
) to authenticated;

commit;
