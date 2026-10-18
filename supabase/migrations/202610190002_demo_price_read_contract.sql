-- Extend only catalog read RPCs to expose explicit demo provenance. Checkout
-- RPCs intentionally continue to require `not price_lists.is_sample`.
do $$
declare
  definition text;
  original text;
  target regprocedure;
begin
  target := 'public.get_public_customer_catalog()'::regprocedure;
  definition := pg_get_functiondef(target);
  original := definition;
  definition := replace(definition, 'amount numeric', 'amount numeric, is_demo boolean');
  definition := replace(definition, 'pr.minimum_quantity, pr.amount', 'pr.minimum_quantity, pr.amount, pl.is_demo');
  definition := replace(definition, 'not pl.is_sample', '(not pl.is_sample or pl.is_demo)');
  if definition = original then raise exception 'Could not extend get_public_customer_catalog'; end if;
  execute 'drop function public.get_public_customer_catalog()';
  execute definition;
  grant execute on function public.get_public_customer_catalog() to anon, authenticated;

  foreach target in array array[
    'public.get_public_rag_catalog(bigint[])'::regprocedure,
    'public.list_public_rag_product_variants(bigint[])'::regprocedure,
    'public.list_public_rag_catalog_page(text,text,bigint,integer)'::regprocedure,
    'public.list_staff_rag_catalog_page(text,text,bigint,integer)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    original := definition;
    definition := replace(definition, 'active_list.id = pr.price_list_id and not active_list.is_sample',
      'active_list.id = pr.price_list_id and (not active_list.is_sample or active_list.is_demo)');
    definition := replace(definition, 'pl.id = pr.price_list_id and not pl.is_sample',
      'pl.id = pr.price_list_id and (not pl.is_sample or pl.is_demo)');
    definition := replace(definition, 'join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample',
      'join public.price_lists pl on pl.id = pr.price_list_id and (not pl.is_sample or pl.is_demo)');
    definition := replace(definition, '''effective_date'', pl.effective_date,',
      '''effective_date'', pl.effective_date, ''is_sample'', pl.is_sample, ''is_demo'', pl.is_demo,');
    if definition = original then raise exception 'Could not extend demo reads for %', target; end if;
    execute definition;
  end loop;
end;
$$;

-- get_public_customer_catalog was recreated to add a return column above.
revoke all on function public.get_public_customer_catalog() from public;
grant execute on function public.get_public_customer_catalog() to anon, authenticated;
