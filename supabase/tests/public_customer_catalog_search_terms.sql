-- Run after migrations on an isolated test database. This checks that direct
-- catalog search fields stay behind the existing narrow customer RPC.
begin;

do $$
declare
  result_signature text;
begin
  if to_regprocedure('public.get_public_customer_catalog()') is null then
    raise exception 'public customer catalog RPC is missing';
  end if;

  result_signature := pg_get_function_result('public.get_public_customer_catalog()'::regprocedure);
  if position('product_code text' in result_signature) = 0
     or position('aliases text[]' in result_signature) = 0 then
    raise exception 'public customer catalog does not return the existing SKU and aliases';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.get_public_customer_catalog()'::regprocedure)
     or not has_function_privilege('anon', 'public.get_public_customer_catalog()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_public_customer_catalog()', 'execute') then
    raise exception 'public customer catalog lost its existing scoped execution behavior';
  end if;
end $$;

rollback;
