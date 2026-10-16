create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.customer_order_security (
  singleton boolean primary key default true check (singleton),
  hmac_secret text not null check (char_length(hmac_secret) >= 32)
);
revoke all on private.customer_order_security from public, anon, authenticated;

create table if not exists private.customer_order_request_nonces (
  nonce uuid primary key,
  expires_at timestamptz not null
);
revoke all on private.customer_order_request_nonces from public, anon, authenticated;

create table public.customer_order_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('DH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  status text not null default 'pending_confirmation' check (status in ('pending_confirmation', 'contacted', 'confirmed', 'cancelled')),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 120),
  phone text not null check (char_length(btrim(phone)) between 8 and 24),
  delivery_address text check (delivery_address is null or char_length(delivery_address) <= 500),
  delivery_notes text check (delivery_notes is null or char_length(delivery_notes) <= 1000),
  subtotal numeric(18, 2) not null default 0 check (subtotal >= 0),
  item_count int not null check (item_count between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_order_request_items (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.customer_order_requests(id) on delete cascade,
  product_name text not null,
  variant_name text not null,
  packaging_name text not null,
  price_type text not null check (price_type in ('retail', 'wholesale')),
  price_id bigint not null references public.prices(id),
  price_version int not null,
  package_quantity numeric not null check (package_quantity > 0),
  quantity numeric not null check (quantity > 0 and quantity <= 10000),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  line_total numeric(20, 2) not null check (line_total >= 0),
  unit text not null,
  created_at timestamptz not null default now()
);

create index customer_order_requests_created_at on public.customer_order_requests(created_at desc);
create index customer_order_requests_status_created_at on public.customer_order_requests(status, created_at desc);
create index customer_order_items_request_id on public.customer_order_request_items(request_id);

alter table public.customer_order_requests enable row level security;
alter table public.customer_order_request_items enable row level security;

create policy "owner editor read customer requests" on public.customer_order_requests
  for select to authenticated using (public.get_current_app_role() in ('owner', 'editor'));
create policy "owner editor read customer request items" on public.customer_order_request_items
  for select to authenticated using (exists (
    select 1 from public.customer_order_requests r where r.id = request_id
      and public.get_current_app_role() in ('owner', 'editor')
  ));

revoke all on public.customer_order_requests, public.customer_order_request_items from anon, authenticated;
grant select on public.customer_order_requests, public.customer_order_request_items to authenticated;

create or replace function public.get_public_customer_catalog()
returns table (
  category text,
  product_name text,
  variant_name text,
  specification text,
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
    po.name, po.quantity, po.base_unit, pr.id, pr.version, pr.price_type,
    pr.minimum_quantity, pr.amount
  from public.prices pr
  join public.packaging_options po on po.id = pr.packaging_id
  join public.product_variants v on v.id = po.variant_id
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  join public.price_lists pl on pl.id = pr.price_list_id
  where c.active and p.active and v.active and v.verification_status = 'verified'
    and pr.active and not pl.is_sample and pr.price_type in ('retail', 'wholesale')
    and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  order by c.sort_order, c.name, p.name, v.display_name, po.quantity, pr.price_type, pr.minimum_quantity;
$$;

drop function if exists public.create_customer_order_request(text, text, text, text, jsonb);

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

create or replace function public.update_customer_order_request_status(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if public.get_current_app_role() not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('contacted', 'confirmed', 'cancelled') then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  select status into v_current from public.customer_order_requests where id = p_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_current = p_status then return; end if;
  if not ((v_current = 'pending_confirmation' and p_status in ('contacted', 'confirmed', 'cancelled'))
    or (v_current = 'contacted' and p_status in ('confirmed', 'cancelled'))) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  update public.customer_order_requests set status = p_status, updated_at = now() where id = p_request_id;
end;
$$;

revoke all on function public.get_public_customer_catalog() from public;
revoke all on function public.create_customer_order_request(text, text, text, text, jsonb, uuid, bigint, text) from public;
revoke all on function public.update_customer_order_request_status(uuid, text) from public;
grant execute on function public.get_public_customer_catalog() to anon, authenticated;
grant execute on function public.create_customer_order_request(text, text, text, text, jsonb, uuid, bigint, text) to anon, authenticated;
grant execute on function public.update_customer_order_request_status(uuid, text) to authenticated;
