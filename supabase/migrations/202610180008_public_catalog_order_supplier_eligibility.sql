-- Align customer search and authoritative checkout with the existing public RAG
-- eligibility contract: prices from inactive suppliers cannot be offered for
-- sale. Preserve the exact function signatures/security modes and existing ACLs.
-- No table data, RLS policy, worker permission or price amount is changed.
create or replace function public.get_public_customer_catalog()
returns table (
  category text,
  product_name text,
  variant_name text,
  specification text,
  product_code text,
  aliases text[],
  packaging_name text,
  package_quantity numeric,
  unit text,
  price_id bigint,
  price_version int,
  price_type text,
  minimum_quantity numeric,
  amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.name, p.name, v.display_name, coalesce(v.raw_specification, v.display_name),
    v.sku,
    coalesce((
      select array_agg(alias.alias order by alias.alias)
      from public.product_aliases alias
      where alias.product_id = p.id
    ), '{}'::text[]),
    po.name, po.quantity, po.base_unit, pr.id, pr.version, pr.price_type,
    pr.minimum_quantity, pr.amount
  from public.prices pr
  join public.packaging_options po on po.id = pr.packaging_id
  join public.product_variants v on v.id = po.variant_id
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  join public.price_lists pl on pl.id = pr.price_list_id
  join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
  where c.active and p.active and v.active and v.verification_status = 'verified'
    and pr.active and not pl.is_sample and pr.price_type in ('retail', 'wholesale')
    and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  order by c.sort_order, c.name, p.name, v.display_name, po.quantity, pr.price_type, pr.minimum_quantity;
$$;

create or replace function public.create_customer_order_request(
  p_customer_name text,
  p_phone text,
  p_delivery_address text,
  p_delivery_notes text,
  p_items jsonb,
  p_nonce uuid,
  p_timestamp bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_request public.customer_order_requests;
  v_price record;
  v_price_id bigint;
  v_version int;
  v_quantity numeric;
  v_subtotal numeric(18, 2) := 0;
  v_count int;
  v_hmac_secret text;
  v_now bigint;
begin
  select hmac_secret into v_hmac_secret from private.customer_order_security where singleton = true;
  v_now := floor(extract(epoch from clock_timestamp()))::bigint;
  if v_hmac_secret is null or p_nonce is null or p_timestamp is null
    or p_timestamp < v_now - 120 or p_timestamp > v_now + 120
    or p_signature is null or p_signature !~ '^[0-9a-f]{64}$'
    or encode(extensions.hmac(convert_to(p_nonce::text || '|' || p_timestamp::text, 'UTF8'), convert_to(v_hmac_secret, 'UTF8'), 'sha256'), 'hex') <> p_signature then
    raise exception 'invalid_submission_signature' using errcode = '42501';
  end if;

  delete from private.customer_order_request_nonces where expires_at < clock_timestamp();
  insert into private.customer_order_request_nonces(nonce, expires_at)
  values (p_nonce, to_timestamp(p_timestamp + 120))
  on conflict (nonce) do nothing;
  if not found then
    raise exception 'submission_replayed' using errcode = '42501';
  end if;

  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 2 and 120
    or p_phone is null or char_length(btrim(p_phone)) not between 8 and 24
    or btrim(p_phone) !~ '^[0-9+() .-]+$'
    or (p_delivery_address is not null and char_length(btrim(p_delivery_address)) > 500)
    or (p_delivery_notes is not null and char_length(btrim(p_delivery_notes)) > 1000)
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_order_item' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 50 then
    raise exception 'invalid_order_item' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as entry(value)
    where jsonb_typeof(value) is distinct from 'object'
      or coalesce(value->>'price_id', '') !~ '^[1-9][0-9]{0,17}$'
      or coalesce(value->>'version', '') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(value->>'quantity', '') !~ '^[0-9]+(\.[0-9]+)?$'
      or char_length(coalesce(value->>'quantity', '')) > 16
  ) then
    raise exception 'invalid_order_item' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(price_id bigint)
    group by price_id having count(*) > 1
  ) then
    raise exception 'invalid_order_item' using errcode = 'P0001';
  end if;

  -- Lock canonical price rows while validating to prevent a price edit racing the snapshot.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_price_id := (v_item->>'price_id')::bigint;
    v_version := (v_item->>'version')::int;
    v_quantity := (v_item->>'quantity')::numeric;

    if v_price_id is null or v_version is null or v_quantity is null or v_quantity <= 0 or v_quantity > 10000 then
      raise exception 'invalid_order_item' using errcode = 'P0001';
    end if;

    select pr.id, pr.version, pr.price_type, pr.amount, pr.minimum_quantity, po.quantity as package_quantity,
      po.name as packaging_name, po.base_unit as unit, v.display_name as variant_name,
      coalesce(v.raw_specification, v.display_name) as specification, p.name as product_name,
      c.name as category_name
    into v_price
    from public.prices pr
    join public.packaging_options po on po.id = pr.packaging_id
    join public.product_variants v on v.id = po.variant_id
    join public.products p on p.id = v.product_id
    join public.categories c on c.id = p.category_id
    join public.price_lists pl on pl.id = pr.price_list_id
    join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
    where pr.id = v_price_id and pr.active and not pl.is_sample
      and pr.price_type in ('retail', 'wholesale')
      and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
      and c.active and p.active and v.active and v.verification_status = 'verified'
    for share of pr;

    if not found then
      raise exception 'price_not_public' using errcode = 'P0001';
    end if;
    if v_price.version <> v_version then
      raise exception 'price_version_conflict' using errcode = 'P0001';
    end if;
    if v_quantity < v_price.minimum_quantity then
      raise exception 'below_minimum' using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + (v_quantity * v_price.amount);
  end loop;

  insert into public.customer_order_requests(customer_name, phone, delivery_address, delivery_notes, subtotal, item_count)
  values (btrim(p_customer_name), btrim(p_phone), nullif(btrim(p_delivery_address), ''), nullif(btrim(p_delivery_notes), ''), v_subtotal, v_count)
  returning * into v_request;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_price_id := (v_item->>'price_id')::bigint;
    v_version := (v_item->>'version')::int;
    v_quantity := (v_item->>'quantity')::numeric;
    select pr.id, pr.version, pr.price_type, pr.amount, pr.minimum_quantity, po.quantity as package_quantity,
      po.name as packaging_name, po.base_unit as unit, v.display_name as variant_name, p.name as product_name
    into v_price
    from public.prices pr
    join public.packaging_options po on po.id = pr.packaging_id
    join public.product_variants v on v.id = po.variant_id
    join public.products p on p.id = v.product_id
    join public.price_lists pl on pl.id = pr.price_list_id
    join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
    where pr.id = v_price_id and pr.version = v_version and pr.active and not pl.is_sample
      and pr.price_type in ('retail', 'wholesale') and pr.valid_from <= now()
      and (pr.valid_to is null or pr.valid_to >= now()) and v.active and v.verification_status = 'verified'
    for share of pr;
    insert into public.customer_order_request_items(request_id, product_name, variant_name, packaging_name,
      price_type, price_id, price_version, package_quantity, quantity, unit_price, line_total, unit)
    values (v_request.id, v_price.product_name, v_price.variant_name, v_price.packaging_name, v_price.price_type,
      v_price.id, v_price.version, v_price.package_quantity, v_quantity, v_price.amount, v_quantity * v_price.amount, v_price.unit);
  end loop;

  return jsonb_build_object('request_id', v_request.id, 'reference', v_request.reference,
    'subtotal', v_request.subtotal, 'status', v_request.status, 'item_count', v_request.item_count);
end;
$$;

