-- Use a clear package label instead of the ambiguous "Lẻ 10 con" wording.
begin;

update public.packaging_options
set name = '10 con/bịch'
where name = 'Lẻ 10 con'
  and quantity = 10
  and base_unit = 'con';

commit;
