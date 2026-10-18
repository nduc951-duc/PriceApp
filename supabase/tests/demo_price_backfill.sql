-- Run after all migrations on an isolated local database only.
-- Fixtures, created demo prices, history rows, and the synthetic owner all roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000097', 'authenticated', 'authenticated',
  'demo-price-backfill@example.test', '{}'::jsonb, '{}'::jsonb
)
on conflict (id) do nothing;
insert into public.profiles (id, role)
values ('00000000-0000-4000-8000-000000000097', 'owner')
on conflict (id) do update set role = 'owner';

do $$
declare
  constraint_ok boolean;
  preview jsonb;
  next_preview jsonb;
  stale_hash text;
  v_batch_id text;
  first_variant_id bigint;
  first_price_id bigint;
  created_count integer;
  expected_count integer;
  expected_remaining integer;
  resumed boolean;
  deactivated_count integer;
  bad_real_changes integer;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'price_lists'
      and column_name = 'is_demo' and is_nullable = 'NO'
  ) into constraint_ok;
  if not constraint_ok then raise exception 'price_lists.is_demo is missing or nullable'; end if;

  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.price_lists'::regclass
      and conname = 'price_lists_demo_requires_sample'
  ) into constraint_ok;
  if not constraint_ok then raise exception 'demo price list sample constraint is missing'; end if;

  if not exists (
    select 1 from public.price_lists list
    join public.suppliers supplier on supplier.id = list.supplier_id
    where list.is_sample and list.is_demo and supplier.active
  ) then raise exception 'active demo price list seed is missing'; end if;

  if has_table_privilege('anon', 'public.demo_price_batches', 'select')
     or has_table_privilege('authenticated', 'public.demo_price_batches', 'select')
     or has_table_privilege('anon', 'public.demo_price_batch_items', 'select')
     or has_table_privilege('authenticated', 'public.demo_price_batch_items', 'select') then
    raise exception 'demo batch tables must not be directly readable';
  end if;

  if not has_function_privilege('authenticated', 'public.preview_demo_price_backfill()', 'execute')
     or has_function_privilege('anon', 'public.preview_demo_price_backfill()', 'execute')
     or not has_function_privilege('authenticated', 'public.apply_demo_price_backfill(text)', 'execute')
     or has_function_privilege('anon', 'public.apply_demo_price_backfill(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.rollback_demo_price_backfill(text)', 'execute')
     or has_function_privilege('anon', 'public.rollback_demo_price_backfill(text)', 'execute') then
    raise exception 'demo RPC grants are not owner-authenticated only';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000097', true);
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000097","role":"authenticated"}', true);
  preview := public.preview_demo_price_backfill();
  if preview->>'snapshotHash' !~ '^[0-9a-f]{32}$' then raise exception 'preview hash is invalid'; end if;
  if (preview->>'count')::integer > 100 then raise exception 'preview batch exceeds 100'; end if;
  if (preview->>'totalCount')::integer < (preview->>'count')::integer then raise exception 'preview total is below batch count'; end if;
  if (preview->>'remainingCount')::integer <>
     (preview->>'totalCount')::integer - (preview->>'count')::integer then
    raise exception 'preview remaining count is inconsistent';
  end if;

  stale_hash := preview->>'snapshotHash';
  first_variant_id := nullif(preview #>> '{items,0,variantId}', '')::bigint;
  if first_variant_id is not null then
    update public.product_variants set active = false where id = first_variant_id;
    begin
      perform public.apply_demo_price_backfill(stale_hash);
      raise exception 'stale demo preview was accepted';
    exception when serialization_failure then
      if sqlerrm <> 'demo_price_preview_stale' then raise; end if;
    end;
    update public.product_variants set active = true where id = first_variant_id;
    preview := public.preview_demo_price_backfill();
  end if;

  stale_hash := preview->>'snapshotHash';
  expected_remaining := (preview->>'remainingCount')::integer;
  execute 'create temporary table demo_price_real_snapshot on commit drop as
    select price.id, price.amount, price.version, price.active from public.prices price
    join public.price_lists list on list.id = price.price_list_id
    where not list.is_sample';

  expected_count := (preview->>'count')::integer;

  preview := public.apply_demo_price_backfill(stale_hash);
  v_batch_id := preview->>'batchId';
  created_count := (preview->>'created')::integer;
  resumed := (preview->>'resumed')::boolean;
  if resumed or created_count <> expected_count then
    raise exception 'apply did not create exactly the preview batch';
  end if;

  next_preview := public.preview_demo_price_backfill();
  if (next_preview->>'totalCount')::integer <> expected_remaining
     or (next_preview->>'count')::integer > 100 then
    raise exception 'next preview did not advance to the remaining batch';
  end if;

  preview := public.apply_demo_price_backfill(stale_hash);
  if not (preview->>'resumed')::boolean or (preview->>'created')::integer <> created_count then
    raise exception 'retry did not resume the existing batch';
  end if;

  select count(*) into bad_real_changes
  from demo_price_real_snapshot snapshot
  join public.prices price on price.id = snapshot.id
  where price.amount <> snapshot.amount or price.version <> snapshot.version or price.active <> snapshot.active;
  if bad_real_changes <> 0 then raise exception 'a real price changed during demo apply'; end if;

  if exists (
    select 1 from public.demo_price_batch_items item
    join public.prices price on price.id = item.price_id
    join public.price_lists list on list.id = price.price_list_id
    where item.batch_id = v_batch_id and (not list.is_sample or not list.is_demo or price.price_type <> 'retail')
  ) then raise exception 'created rows are not sample demo retail prices'; end if;

  if created_count > 0 then
    select price.id into first_price_id
    from public.demo_price_batch_items item
    join public.prices price on price.id = item.price_id
    where item.batch_id = v_batch_id order by price.id limit 1;

    if not exists (
      select 1 from public.get_public_customer_catalog() catalog
      where catalog.price_id = first_price_id and catalog.is_demo
    ) then raise exception 'public catalog did not expose demo provenance'; end if;

    update public.prices set version = 2 where id = first_price_id;
    begin
      perform public.rollback_demo_price_backfill(v_batch_id);
      raise exception 'rollback accepted a changed demo price';
    exception when serialization_failure then
      if sqlerrm <> 'demo_price_rollback_conflict' then raise; end if;
    end;
    update public.prices set version = 1 where id = first_price_id;
  end if;

  preview := public.rollback_demo_price_backfill(v_batch_id);
  deactivated_count := (preview->>'deactivated')::integer;
  if deactivated_count <> created_count then raise exception 'rollback count does not match apply'; end if;

  if exists (
    select 1 from public.demo_price_batch_items item
    join public.prices price on price.id = item.price_id
    where item.batch_id = v_batch_id and (price.active or price.version <> 2)
  ) then raise exception 'rollback did not deactivate and version every created price'; end if;
end $$;

rollback;
