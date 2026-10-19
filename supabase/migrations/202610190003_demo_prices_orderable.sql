-- Prices generated for the course demo use the same public order-request flow
-- as other catalog prices. This does not create or alter product specifications.
do $$
declare
  target regprocedure := 'public.create_customer_order_request(text,text,text,text,jsonb,uuid,bigint,text)'::regprocedure;
  definition text;
  original text;
begin
  definition := pg_get_functiondef(target);
  original := definition;
  definition := replace(definition, 'and not pl.is_sample', 'and (not pl.is_sample or pl.is_demo)');
  if definition = original or position('and not pl.is_sample' in definition) > 0 then
    raise exception 'Could not enable generated catalog prices in customer order requests';
  end if;
  execute definition;
end;
$$;
