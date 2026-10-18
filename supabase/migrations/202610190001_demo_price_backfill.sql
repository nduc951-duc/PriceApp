-- Demo prices are synthetic catalog fixtures. They remain sample rows so every
-- existing checkout RPC continues to reject them unless explicitly changed.
alter table public.price_lists
  add column if not exists is_demo boolean not null default false;

alter table public.price_lists
  add constraint price_lists_demo_requires_sample
  check (not is_demo or is_sample);

insert into public.suppliers (name, note, active)
values ('Giá mô phỏng Giá Chuẩn', 'Nguồn nội bộ dành riêng cho giá demo.', true)
on conflict (name) do update set note = excluded.note, active = true;

insert into public.price_lists (supplier_id, name, effective_date, note, is_sample, is_demo)
select id, 'DEMO — Giá giả lập', date '2099-01-01', 'Giá tổng hợp để thử ứng dụng; không phải giá bán.', true, true
from public.suppliers where name = 'Giá mô phỏng Giá Chuẩn'
on conflict (supplier_id, name, effective_date) do update
set note = excluded.note, is_sample = true, is_demo = true;

create table public.demo_price_batches (
  id text primary key,
  snapshot_hash text not null unique,
  rule_version text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz
);

create table public.demo_price_batch_items (
  batch_id text not null references public.demo_price_batches(id),
  variant_id bigint not null references public.product_variants(id),
  packaging_id bigint not null references public.packaging_options(id),
  price_id bigint not null unique references public.prices(id),
  amount numeric(18,2) not null check (amount > 0),
  method text not null check (method in ('same_package_median', 'fallback_fixture')),
  reference_price_ids bigint[] not null default '{}',
  primary key (batch_id, variant_id)
);

alter table public.demo_price_batches enable row level security;
alter table public.demo_price_batch_items enable row level security;
revoke all on public.demo_price_batches, public.demo_price_batch_items from anon, authenticated;

create or replace function public.preview_demo_price_backfill()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
  v_hash text;
begin
  if public.get_current_app_role() <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  with current_real_prices as (
    select distinct po.variant_id
    from public.prices pr
    join public.packaging_options po on po.id = pr.packaging_id
    join public.price_lists pl on pl.id = pr.price_list_id
    join public.suppliers s on s.id = pl.supplier_id and s.active
    where pr.active and not pl.is_sample
      and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  ), current_demo_prices as (
    select distinct po.variant_id
    from public.prices pr
    join public.packaging_options po on po.id = pr.packaging_id
    join public.price_lists pl on pl.id = pr.price_list_id and pl.is_demo
    where pr.active and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  ), missing as (
    select v.id as variant_id, v.product_id, p.category_id, po.id as packaging_id,
      po.quantity, po.base_unit
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    join lateral (
      select option.id, option.quantity, option.base_unit
      from public.packaging_options option
      where option.variant_id = v.id
      order by option.quantity, option.id
      limit 1
    ) po on true
    where v.active and v.verification_status = 'verified'
      and not exists (select 1 from current_real_prices r where r.variant_id = v.id)
      and not exists (select 1 from current_demo_prices d where d.variant_id = v.id)
  ), reference_prices as (
    select m.variant_id, ref.id as price_id, ref.amount
    from missing m
    join public.product_variants peer on peer.product_id = m.product_id and peer.id <> m.variant_id
      and peer.active and peer.verification_status = 'verified'
    join public.packaging_options peer_pack on peer_pack.variant_id = peer.id
      and peer_pack.quantity = m.quantity and peer_pack.base_unit = m.base_unit
    join public.prices ref on ref.packaging_id = peer_pack.id and ref.active and ref.price_type = 'retail'
      and ref.valid_from <= now() and (ref.valid_to is null or ref.valid_to >= now())
    join public.price_lists ref_list on ref_list.id = ref.price_list_id and not ref_list.is_sample
    join public.suppliers ref_supplier on ref_supplier.id = ref_list.supplier_id and ref_supplier.active
  ), price_basis as (
    select m.variant_id, m.product_id, m.packaging_id, m.quantity, m.base_unit,
      percentile_cont(0.5) within group (order by r.amount) as median_amount,
      array_agg(r.price_id order by r.price_id) as reference_price_ids
    from missing m
    left join reference_prices r on r.variant_id = m.variant_id
    group by m.variant_id, m.product_id, m.packaging_id, m.quantity, m.base_unit
  ), generated as (
    select basis.*,
      greatest(1000, round((coalesce(basis.median_amount::numeric, 50000::numeric)
        * (0.9 + (basis.variant_id % 21)::numeric / 100)) / 1000) * 1000) as amount,
      case when basis.median_amount is null then 'fallback_fixture' else 'same_package_median' end as method,
      coalesce(basis.reference_price_ids, '{}'::bigint[]) as reference_ids
    from price_basis basis
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', generated.variant_id,
      'productId', generated.product_id,
      'packagingId', generated.packaging_id,
      'quantity', generated.quantity,
      'unit', generated.base_unit,
      'amount', generated.amount,
      'method', generated.method,
      'referencePriceIds', generated.reference_ids
    ) order by generated.variant_id), '[]'::jsonb)
  into v_rows from generated;

  v_hash := md5('demo-price-v1|' || v_rows::text || '|' || (select count(*) from public.demo_price_batches)::text);
  return jsonb_build_object(
    'batchId', v_hash,
    'snapshotHash', v_hash,
    'ruleVersion', 'demo-price-v1',
    'count', jsonb_array_length(v_rows),
    'items', v_rows
  );
end;
$$;

revoke all on function public.preview_demo_price_backfill() from public, anon;
grant execute on function public.preview_demo_price_backfill() to authenticated;

create or replace function public.apply_demo_price_backfill(p_snapshot_hash text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_preview jsonb;
  v_item jsonb;
  v_price public.prices;
  v_batch_id text;
  v_created integer := 0;
begin
  if public.get_current_app_role() <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if p_snapshot_hash is null or p_snapshot_hash !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid_snapshot_hash' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('demo-price-backfill'));
  v_batch_id := p_snapshot_hash;
  if exists (select 1 from public.demo_price_batches where id = v_batch_id) then
    return jsonb_build_object('batchId', v_batch_id,
      'created', (select count(*) from public.demo_price_batch_items where batch_id = v_batch_id), 'resumed', true);
  end if;
  v_preview := public.preview_demo_price_backfill();
  if v_preview->>'snapshotHash' <> p_snapshot_hash then
    raise exception 'demo_price_preview_stale' using errcode = '40001';
  end if;
  if jsonb_array_length(v_preview->'items') > 100 then
    raise exception 'demo_price_batch_too_large' using errcode = '22023';
  end if;

  -- Lock source variants before inserting prices. New package/price writers use
  -- FK key-share locks and therefore wait until this transaction completes.
  perform v.id from public.product_variants v
  where v.id in (select (item->>'variantId')::bigint from jsonb_array_elements(v_preview->'items') item)
  order by v.id for update;
  if (public.preview_demo_price_backfill()->>'snapshotHash') <> p_snapshot_hash then
    raise exception 'demo_price_preview_stale' using errcode = '40001';
  end if;

  insert into public.demo_price_batches(id, snapshot_hash, rule_version, created_by)
  values (v_batch_id, p_snapshot_hash, 'demo-price-v1', auth.uid());

  for v_item in select value from jsonb_array_elements(v_preview->'items')
  loop
    insert into public.prices(packaging_id, price_list_id, price_type, minimum_quantity, amount,
      currency, valid_from, active, version)
    select (v_item->>'packagingId')::bigint, pl.id, 'retail', 1,
      (v_item->>'amount')::numeric, 'VND', now(), true, 1
    from public.price_lists pl
    join public.suppliers s on s.id = pl.supplier_id and s.active
    where pl.is_demo and pl.name = 'DEMO — Giá giả lập' and pl.effective_date = date '2099-01-01'
    returning * into v_price;

    insert into public.price_history(price_id, old_amount, new_amount, old_payload, new_payload, changed_by, reason, operation)
    values (v_price.id, null, v_price.amount, null, to_jsonb(v_price), auth.uid(),
      'Tạo giá demo theo lô ' || v_batch_id, 'create');
    insert into public.demo_price_batch_items(batch_id, variant_id, packaging_id, price_id, amount, method, reference_price_ids)
    values (v_batch_id, (v_item->>'variantId')::bigint, (v_item->>'packagingId')::bigint,
      v_price.id, v_price.amount, v_item->>'method',
      array(select jsonb_array_elements_text(v_item->'referencePriceIds')::bigint));
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('batchId', v_batch_id, 'created', v_created, 'resumed', false);
end;
$$;

revoke all on function public.apply_demo_price_backfill(text) from public, anon;
grant execute on function public.apply_demo_price_backfill(text) to authenticated;

create or replace function public.rollback_demo_price_backfill(p_batch_id text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if public.get_current_app_role() <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('demo-price-backfill'));
  update public.prices pr set active = false, valid_to = now(), version = version + 1, updated_at = now()
  from public.demo_price_batch_items item
  where item.batch_id = p_batch_id and item.price_id = pr.id and pr.active and pr.version = 1
    and not exists (select 1 from public.customer_order_request_items order_item where order_item.price_id = pr.id);
  get diagnostics v_count = row_count;
  if v_count <> (select count(*) from public.demo_price_batch_items where batch_id = p_batch_id) then
    raise exception 'demo_price_rollback_conflict' using errcode = '40001';
  end if;
  insert into public.price_history(price_id, old_amount, new_amount, old_payload, new_payload, changed_by, reason, operation)
  select pr.id, pr.amount, pr.amount, to_jsonb(pr), to_jsonb(pr), auth.uid(), 'Hoàn tác giá demo ' || p_batch_id, 'undo'
  from public.prices pr join public.demo_price_batch_items item on item.price_id = pr.id
  where item.batch_id = p_batch_id and not pr.active;
  update public.demo_price_batches set rolled_back_at = now() where id = p_batch_id and rolled_back_at is null;
  return jsonb_build_object('batchId', p_batch_id, 'deactivated', v_count);
end;
$$;

revoke all on function public.rollback_demo_price_backfill(text) from public, anon;
grant execute on function public.rollback_demo_price_backfill(text) to authenticated;
