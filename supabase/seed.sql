-- The production catalog is loaded by migration
-- 202608120004_catalog_pages_01_13.sql.
--
-- Keep this file idempotent so `supabase db reset` can run repeatedly without
-- re-creating the original demo/SAMPLE rows or conflicting with real catalog
-- unique keys.

do $$
begin
  raise notice 'Catalog seed is managed by versioned migrations; no extra seed rows inserted.';
end
$$;
