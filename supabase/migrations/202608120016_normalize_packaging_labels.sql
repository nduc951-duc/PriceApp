-- Normalize package labels to "quantity unit/container" for easier reading.
begin;

update public.packaging_options
set name = case name
  when 'Lẻ 10 con' then '10 con/bịch'
  when 'Bịch 95 con' then '95 con/bịch'
  when 'Hộp 50 con' then '50 con/hộp'
  when 'Lẻ 1 con' then '1 con'
  when 'Gói nhỏ 100 con' then '100 con/gói'
  when 'Bịch lớn 1.000 con' then '1.000 con/bịch'
  when 'Lẻ 1 bánh' then '1 bánh/cái'
  when 'Le 10 bo' then '10 bộ/bịch'
  when 'Bich 100 bo' then '100 bộ/bịch'
  when 'Le 1 met' then '1 mét'
  when 'Cuon 100 met' then '100 mét/cuộn'
  else name
end
where name in (
  'Lẻ 10 con', 'Bịch 95 con', 'Hộp 50 con', 'Lẻ 1 con',
  'Gói nhỏ 100 con', 'Bịch lớn 1.000 con', 'Lẻ 1 bánh',
  'Le 10 bo', 'Bich 100 bo', 'Le 1 met', 'Cuon 100 met'
);

commit;
