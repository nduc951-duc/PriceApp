create or replace function public.batch_update_prices (p_updates jsonb, p_reason text) returns setof public.prices language plpgsql security definer
set
  search_path = public as $$
declare item jsonb; old_row prices; new_row prices;
begin
  if public.get_current_app_role() not in ('owner','editor') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates)=0 then raise exception 'invalid batch'; end if;
  for item in select * from jsonb_array_elements(p_updates) loop
    select * into old_row from prices where id=(item->>'price_id')::bigint for update;
    if old_row.version <> (item->>'expected_version')::int then raise exception 'version_conflict'; end if;
    if (item->>'new_amount')::numeric < 0 then raise exception 'invalid amount'; end if;
    update prices set amount=(item->>'new_amount')::numeric,version=version+1,updated_at=now() where id=old_row.id returning * into new_row;
    insert into price_history(price_id,old_amount,new_amount,old_payload,new_payload,changed_by,reason,operation) values(old_row.id,old_row.amount,new_row.amount,to_jsonb(old_row),to_jsonb(new_row),auth.uid(),p_reason,'update');
    return next new_row;
  end loop;
end$$;

grant
execute on function public.batch_update_prices to authenticated;

create policy "authenticated read aliases" on product_aliases for
select
  to authenticated using (true);

create policy "authenticated read suppliers" on suppliers for
select
  to authenticated using (true);

create policy "authenticated read lists" on price_lists for
select
  to authenticated using (true);

create policy "authenticated read promotions" on promotions for
select
  to authenticated using (true);

create policy "authenticated read sources" on source_pages for
select
  to authenticated using (true);

create policy "authenticated read variant sources" on variant_sources for
select
  to authenticated using (true);
