-- SECURITY DEFINER functions are explicitly closed to PUBLIC/anon and opened only where needed.
revoke all on function public.get_current_app_role ()
from
  public,
  anon,
  authenticated;

revoke all on function public.update_price_with_history (bigint, numeric, int, text)
from
  public,
  anon;

revoke all on function public.undo_price_change (bigint, int)
from
  public,
  anon;

revoke all on function public.batch_update_prices (jsonb, text)
from
  public,
  anon;

revoke all on function public.search_catalog (text, int, bigint)
from
  public,
  anon;

grant
execute on function public.update_price_with_history (bigint, numeric, int, text) to authenticated;

grant
execute on function public.undo_price_change (bigint, int) to authenticated;

grant
execute on function public.batch_update_prices (jsonb, text) to authenticated;

grant
execute on function public.search_catalog (text, int, bigint) to authenticated;

-- Explicit Data API grants; RLS remains the row-level enforcement boundary.
grant
select
  on public.categories,
  public.products,
  public.product_aliases,
  public.product_variants,
  public.packaging_options,
  public.suppliers,
  public.price_lists,
  public.prices,
  public.price_history,
  public.promotions,
  public.source_pages,
  public.variant_sources to authenticated;

grant
select
,
  insert,
  delete on public.favorites,
  public.recent_searches to authenticated;

-- Signed URL creation requires SELECT access to objects in the private bucket.
create policy "authenticated read source images" on storage.objects for
select
  to authenticated using (bucket_id = 'source-pages');

create policy "owners manage source images" on storage.objects for all to authenticated using (
  bucket_id = 'source-pages'
  and exists (
    select
      1
    from
      public.profiles
    where
      id = (
        select
          auth.uid ()
      )
      and role = 'owner'
  )
)
with
  check (
    bucket_id = 'source-pages'
    and exists (
      select
        1
      from
        public.profiles
      where
        id = (
          select
            auth.uid ()
        )
        and role = 'owner'
    )
  );
