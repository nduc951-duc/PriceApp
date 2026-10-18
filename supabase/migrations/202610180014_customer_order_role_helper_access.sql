-- The order SELECT policies execute this helper as the authenticated caller.
-- Its original hardening migration revoked EXECUTE from authenticated as well
-- as anon/PUBLIC, causing the inbox queries to fail before RLS could evaluate.
-- The helper returns only the caller's role (viewer for a missing profile).
-- Order policies still restrict rows to owner/editor; anonymous access stays closed.
grant execute on function public.get_current_app_role() to authenticated;
