-- Catalog transcribed from handwritten source pages 01-13.
-- All imported records remain needs_review until a shop owner verifies them.
-- Prices are inserted only where the photographed table was sufficiently legible.

begin;

insert into public.source_pages (page_number, storage_path, raw_note, verification_status)
select p, format('source-pages/page-%s.png', lpad(p::text, 2, '0')),
       format('So gia viet tay - Trang %s. anh nguon can upload vao bucket source-pages.', p),
       'needs_review'::public.verification_status
from generate_series(1, 13) p
on conflict (storage_path) do update
set page_number = excluded.page_number,
    raw_note = excluded.raw_note,
    verification_status = excluded.verification_status,
    updated_at = now();

insert into public.categories (name, slug, sort_order)
values
  ('Tac ke & neo', 'tac-ke', 10),
  ('Bulong, vit & phu kien', 'bulong-oc-vit', 20),
  ('Ke & phu kien ke', 'ke-phu-kien', 30),
  ('Cap, xich & phu kien nang', 'cap-xich', 40),
  ('Banh xe', 'banh-xe', 50),
  ('Dinh & dung cu', 'dinh-dung-cu', 60),
  ('Keo, bang keo & hoa pham', 'keo-silicon', 70)
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true;

create temporary table catalog_product_stage (
  page_number int not null,
  category_slug text not null,
  product_name text not null,
  brand text,
  specs text[] not null,
  aliases text[] not null default '{}'
) on commit drop;

insert into catalog_product_stage
  (page_number, category_slug, product_name, brand, specs, aliases)
values
  (1, 'tac-ke', 'Tac ke sat', null,
   array['6x50','6x60','6x80','6x100','moc 6','8x60','8x80','8x100','8x120','moc 8','10x60 mong','10x60 day','10x80 mong','10x80 day','10x100 day','10x120 day','moc 10','12x80 day','12x100 day','12x120 day','12x150 day','12x200 day','14x80 day','14x100 day','14x120 day','14x150 day','14x200 day','16x100 day','16x120 day','16x150 day','16x200 day'],
   array['tac k sat','tac ke sat','c no sat','no sat']),
  (1, 'tac-ke', 'Tac ke dan Dai Loan', null,
   array['6 ly','8 ly','10 ly','12 ly','14 ly','16 ly'],
   array['tac k dan','tac ke dan','no dan','tac k dan dui loan']),
  (1, 'tac-ke', 'Tac ke nhua Tien Phat', 'Tien Phat',
   array['2F','3F','4F','5F','6F','7F','7F DBKS','6F d','8F d','bum'],
   array['tac k nhua','tac ke nhua','no nhua','tac k tin pht']),
  (1, 'tac-ke', 'Mc dien', null,
   array['M5','M6','M8','M10','M11+13','M16','M21','M28','M40'],
   array['moc dien','moc dien']),

  (2, 'bulong-oc-vit', 'Vit tole sat go', null,
   array['2F5','4F','5F','6F','8F','1T','3F la','4F la','5F la','3F ngon','4F ngon','5F ngon','6F ngon','7F ngon'],
   array['vit tole','vit tole','vit sat go','vit tan']),
  (2, 'bulong-oc-vit', 'Vit ban du Dai Loan', null,
   array['1F3','1F6','2F','2F5','3F','4F'],
   array['vit ban du','vit ban du','vit du dui loan']),
  (2, 'bulong-oc-vit', 'Vit san om la', null,
   array['1F3','1F6','2F','2F5','3F','4F','5F'],
   array['vit san om la','vit san om la']),
  (2, 'bulong-oc-vit', 'Vit san map la', null,
   array['1F6','2F','2F5','3F','4F','5F','6F'],
   array['vit san map la','vit san map la']),
  (2, 'bulong-oc-vit', 'Vit den', null,
   array['1F5','2F','2F5','3F','4F','5F'],
   array['vit den','vit den']),
  (2, 'bulong-oc-vit', 'Vit vang', null,
   array['1F5 nhuyen','2F','2F5','3F','4F','5F'],
   array['vit vang','vit vang']),
  (2, 'tac-ke', 'N ty', null,
   array['6 ly','8 ly','10 ly','12 ly'],
   array['no ty','no ty','tac k ty']),

  (3, 'ke-phu-kien', 'Mc C', null,
   array['4 ly 1F','4 ly 1F5','4 ly 2F','4 ly 2F5','4 ly 3F','4 ly 4F','4 ly 5F','4 ly 6F','4 ly 7F','4 ly 8F','5 ly 1F','5 ly 1F5','5 ly 2F','5 ly 2F5','5 ly 3F','5 ly 4F','5 ly 5F','6 ly 1F','6 ly 1F5','6 ly 2F','6 ly 2F5','6 ly 3F','6 ly 4F','6 ly 5F','6 ly 6F'],
   array['moc c','moc c']),
  (3, 'ke-phu-kien', 'Mc U', null,
   array['6 ly 21','6 ly 27','6 ly 34','6 ly 42','6 ly 49','6 ly 60','6 ly 76','6 ly 90','6 ly 114','6 ly 140','6 ly 168','6 ly 220','8 ly 21','8 ly 27','8 ly 34','8 ly 42','8 ly 49','8 ly 60','8 ly 76','8 ly 90','8 ly 114','8 ly 140','8 ly 168','10 ly 60','10 ly 76','10 ly 90','10 ly 114','10 ly 140','10 ly 168','10 ly 220','12 ly 90','12 ly 114','12 ly 140','12 ly 168','12 ly 220','12 ly 260','12 ly 280','12 ly 330'],
   array['moc u','moc u','u bolt','com u']),

  (4, 'bulong-oc-vit', 'Rive ban', null,
   array['3 ly x 10','3 ly x 12','3 ly x 16','3 ly x 19','4 ly x 10','4 ly x 12','4 ly x 16','4 ly x 19','5 ly x 10','5 ly x 12','5 ly x 16','5 ly x 19'],
   array['rive ban','rive ban','dinh rive','rivet']),
  (4, 'bulong-oc-vit', 'Vit khung bao', null,
   array['10x100 cam','10x120 cam'],
   array['vit khung bao','vit khung bao']),
  (4, 'tac-ke', 'Khoen tac no van tay', null,
   array['6 ly','8 ly','10 ly','12 ly'],
   array['khoen tac no','khoen tac no','khoen van tay']),
  (4, 'bulong-oc-vit', 'Tan', null,
   array['6 ly','8 ly','10 ly','12 ly','14 ly','16 ly'],
   array['tan','tan',' cu','ecu','dai c']),
  (4, 'bulong-oc-vit', 'Long dan', null,
   array['3 ly','4 ly','5 ly','6 ly ban 23 mong','6 ly ban 23 day','8 ly ban 30 day','10 ly','12 ly'],
   array['long dan','long den','vang dm','washer']),

  (5, 'bulong-oc-vit', 'Bulong', null,
   array['6 ly x 1F5','6 ly x 2F','6 ly x 2F5','6 ly x 3F','6 ly x 4F','6 ly x 5F','6 ly x 6F','6 ly x 7F','6 ly x 8F','6 ly x 1T','6 ly x 1T2','6 ly x 1T5','8 ly x 1F5','8 ly x 2F','8 ly x 2F5','8 ly x 3F','8 ly x 4F','8 ly x 5F','8 ly x 6F','8 ly x 7F','8 ly x 8F','8 ly x 1T','8 ly x 1T2','8 ly x 1T5','10 ly x 2F','10 ly x 2F5','10 ly x 3F','10 ly x 4F','10 ly x 5F','10 ly x 6F','10 ly x 7F','10 ly x 8F','10 ly x 1T','10 ly x 1T2','10 ly x 1T5','12 ly x 1F5','12 ly x 2F','12 ly x 2F5','12 ly x 3F','12 ly x 4F','12 ly x 5F','12 ly x 6F','12 ly x 7F','12 ly x 8F','12 ly x 1T','12 ly x 1T2','12 ly x 1T5'],
   array['bulong','bu long','buloong','b lon','bolt']),
  (5, 'bulong-oc-vit', 'Vit trang dau la', null,
   array['4 ly 1F5','4 ly 2F','4 ly 2F5','4 ly 3F','4 ly 4F','4 ly 5F','5 ly 2F','5 ly 2F5','5 ly 3F','5 ly 4F','5 ly 5F','5 ly 6F','5 ly 7F','5 ly 8F','5 ly 1T','6 ly 2F','6 ly 2F5','6 ly 3F','6 ly 4F','6 ly 5F','6 ly 6F','6 ly 7F','6 ly 8F','6 ly 1T'],
   array['vit trang dau la','vit trang dau la']),
  (5, 'bulong-oc-vit', 'Vit trang dau du', null,
   array['4 ly 1F5','4 ly 2F','4 ly 2F5','4 ly 3F','4 ly 4F','4 ly 5F','5 ly 1F5','5 ly 2F','5 ly 2F5','5 ly 3F','5 ly 4F','5 ly 5F','5 ly 6F','5 ly 7F','5 ly 8F','6 ly 2F','6 ly 2F5','6 ly 3F','6 ly 4F','6 ly 5F','6 ly 6F','6 ly 7F','6 ly 8F'],
   array['vit trang dau du','vit trang dau du']),

  (6, 'ke-phu-kien', 'Com bi', null,
   array['21','27','34','42','49','60','76','90','114','140'],
   array['com bi','cum bi']),
  (6, 'ke-phu-kien', 'Bas treo sat', null,
   array['21','27','34','42','49','60','76','90','114','140','168','200','220'],
   array['bas treo sat','bat treo sat','bat treo sat']),
  (6, 'ke-phu-kien', 'Bas treo inox 304', 'Inox 304',
   array['21','27','34','42','49','60','76','90','114','140','168'],
   array['bas treo inox 304','bat treo inox','bat treo inox']),
  (6, 'ke-phu-kien', 'Omega sat', null,
   array['21','27','34','42','49','60','76','90','114','140','168','190','220'],
   array['omega sat','omega sat']),
  (6, 'bulong-oc-vit', 'Ty ren loai I', null,
   array['6 ly x 1m','8 ly x 1m','10 ly x 1m','12 ly x 1m','14 ly x 1m','16 ly x 1m','6 ly x 2m','8 ly x 2m','10 ly x 2m','12 ly x 2m','6 ly x 3m','8 ly x 3m','10 ly x 3m','12 ly x 3m'],
   array['ty ren','tyren','ty ren loai 1','thanh ren']),

  (7, 'ke-phu-kien', 'Sat V lo', null,
   array['V1/3','3/3','3/5','4/6','4/8','LA6','LA8'],
   array['sat v lo','sat v lo','v lo','v dc lo']),
  (7, 'ke-phu-kien', 'Mom ke', null,
   array['dui 60 rong 3T','dui 60 rong 4T','dui 80 rong 3T','dui 80 rong 4T','dui 80 rong 5T','dui 80 rong 6T','dui 100 rong 3T','dui 100 rong 4T','dui 100 rong 5T','dui 100 rong 6T','dui 120 rong 3T','dui 120 rong 4T','dui 120 rong 5T','dui 120 rong 6T','dui 150 rong 3T','dui 150 rong 4T','dui 150 rong 5T','dui 150 rong 6T'],
   array['mom ke','mam ke','mom sat ke']),
  (7, 'ke-phu-kien', 'Ke den 5 tang', null,
   array['2m x 40 x 100','2m x 40 x 120'],
   array['ke den','ke den','ke 5 tang']),
  (7, 'ke-phu-kien', 'Ke trung tai', null,
   array['R40 dui 1m5 4 tang','R50 dui 1m5 5 tang','R60 dui 1m5 5 tang'],
   array['ke trung tai','ke trung tai']),
  (7, 'ke-phu-kien', 'Luoi ke', null,
   array['50x100 trang','50x100 den','100x100 trang','100x100 den','50x130','80x130','90x130'],
   array['luoi ke','luoi ke','luoi treo']),
  (7, 'ke-phu-kien', 'Mc luoi', null,
   array['1T2','1T5','2T','2T5','3T'],
   array['moc luoi','moc luoi']),

  (8, 'ke-phu-kien', 'Ke V3 tinh dien', null,
   array['1T5','2T','2T5','3T','3T5','4T','4T5','5T'],
   array['ke v3 tinh dien','ke v3 tinh dien']),
  (8, 'ke-phu-kien', 'Ke trang', null,
   array['1T5','2T','2T5','3T','3T5','4T'],
   array['ke trang','ke trang']),
  (8, 'ke-phu-kien', 'Ke inox 201', 'Inox 201',
   array['2T','2T5','3T','3T5','4T','5T','4T5'],
   array['ke inox 201','ke inox 201']),
  (8, 'ke-phu-kien', 'Ke mini', null,
   array['mong 3F','mong 4F','mong 5F','mong 6F','day 3F','day 4F','day 5F','day 6F','day 8F','day 1T','day 1T2','day 1T5','day 2T'],
   array['ke mini','ke mini']),
  (8, 'ke-phu-kien', 'Ke ban 225', null,
   array['2F','3F','4F','5F','6F','8F','1T','1T2','1T5','2T'],
   array['ke ban 225','ke ban 225']),
  (8, 'ke-phu-kien', 'Ke ban 495', null,
   array['4F','5F','6F','8F','1T','1T2','1T5','2T'],
   array['ke ban 495','ke ban 495']),
  (8, 'ke-phu-kien', 'Ke mini inox', null,
   array['3F','4F','5F'],
   array['ke mini inox','ke mini inox']),
  (8, 'ke-phu-kien', 'Bas tay', null,
   array['ngon','dui'],
   array['bas tay','bat tay','bat tay']),

  (9, 'cap-xich', 'Day cap m trang', null,
   array['1.5 ly','2 ly','3 ly','4 ly','5 ly','6 ly','8 ly','10 ly','12 ly'],
   array['day cap m trang','day cap ma trang','cap thp m']),
  (9, 'cap-xich', 'Day cap inox', null,
   array['3 ly','4 ly','5 ly','6 ly'],
   array['day cap inox','day cap inox']),
  (9, 'cap-xich', 'Day cap boc nhua', null,
   array['3 ly','4 ly','5 ly','6 ly'],
   array['day cap boc nhua','day cap boc nhua']),
  (9, 'cap-xich', 'c xiet cap', null,
   array['5 ly','6 ly','8 ly','10 ly','12 ly','15 ly','16 ly','20 ly'],
   array['c xiet cap','oc xiet cap','khoa cap']),
  (9, 'cap-xich', 'Tang do', null,
   array['5 ly','6 ly','8 ly','10 ly','12 ly','15 ly','16 ly','20 ly'],
   array['tang do','tang do','tang cap']),
  (9, 'cap-xich', 'Ma ni', null,
   array['5 ly','6 ly','8 ly','10 ly','12 ly','15 ly','16 ly','20 ly'],
   array['ma ni','ma ni','m n','shackle']),
  (9, 'cap-xich', 'c xiet cap inox', null,
   array['5 ly','6 ly','8 ly','10 ly'],
   array['c xiet cap inox','oc xiet cap inox']),
  (9, 'cap-xich', 'Rong roc', null,
   array['30 kg','50 kg','100 kg','300 kg','500 kg'],
   array['rong roc','rong roc','puly']),

  (10, 'dinh-dung-cu', 'Dinh hoi F', null,
   array['F10','F15','F20','F25','F30','F40','F50'],
   array['dinh hoi f','dinh hoi f','dinh sang f']),
  (10, 'dinh-dung-cu', 'Dinh hoi chu U', null,
   array['1008','1010','1013','1016'],
   array['dinh hoi chu u','dinh hoi chu u','dinh u']),
  (10, 'dinh-dung-cu', 'Dinh hoi thau', null,
   array['6D','6D5','6D20','6D25','6D30'],
   array['dinh hoi thau','dinh hoi thau']),
  (10, 'dinh-dung-cu', 'Dinh hoi b tang', null,
   array['ST25','32','38','45','50','64'],
   array['dinh hoi b tang','dinh hoi be tong']),
  (10, 'ke-phu-kien', 'Rut tu 3 tang', null,
   array['2T5','3T','3T5','4T','4T5','5T'],
   array['rut tu 3 tang','rut tu 3 tang']),
  (10, 'cap-xich', 'Day xich sat', null,
   array['2 ly','3 ly','4 ly','5 ly','6 ly','8 ly','10 ly'],
   array['day xich sat','day xich sat','xich sat']),
  (10, 'cap-xich', 'Day xich inox', null,
   array['3 ly','4 ly','5 ly'],
   array['day xich inox','day xich inox','xich inox']),

  (11, 'banh-xe', 'Banh xe', null,
   array['vang 3F','vang 4F','vang 5F','vang 6F','vang 7F','vang 8F','vang 1T','vang 1T2','vang khoa 5F','vang khoa 6F','vang khoa 7F','vang khoa 8F','vang khoa 1T','vang khoa 1T2','den d 4F','den d 5F','den khoa d 4F','den khoa d 5F','den khoa d 6F5','den khoa d 7F5','d mom xoay 7F5','d mom khoa 7F5','gang 1T','gang 1T2','gian giao 1T5','gian giao 2T'],
   array['bnh xe','banh xe','caster']),

  (12, 'ke-phu-kien', 'Khung treo TV', null,
   array['32 inch c danh mom','32 inch khung','32 inch nghieng','32 inch xoay','42 inch c danh mom','42 inch khung','42 inch nghieng','42 inch xoay','60 inch c danh van nang','60 inch xoay','75 inch c danh','75 inch xoay','42 inch treo 1m','42 inch treo 1m5','chan bnh loc day','chan man hinh lon','chan man hinh c bnh xe','ke loa lon'],
   array['khung treo tv','khung treo man hinh','gia treo tv','gia treo tv']),
  (12, 'dinh-dung-cu', 'Dinh go dau ch', null,
   array['1F5','2F','2F5','3F','4F','5F','6F','7F','8F','1T'],
   array['dinh go dau ch','dinh go dau chi','dinh go']),
  (12, 'dinh-dung-cu', 'Dinh thp', null,
   array['1F5','2F','2F5','3F','4F','5F','6F','7F','8F','1T'],
   array['dinh thp','dinh thep']),
  (12, 'dinh-dung-cu', 'Bua nho dinh', null,
   array['200 g','300 g','1 kg','1.5 kg','2 kg','3 kg','5 kg','6 kg'],
   array['bua nho dinh','bua nho dinh','bua dung dinh']),
  (12, 'dinh-dung-cu', 'Bua do', null,
   array['2D','3D','4D'],
   array['bua do','bua deo']),
  (12, 'dinh-dung-cu', 'Bua cao su', null,
   array['nho','trung','lon'],
   array['bua cao su','bua cao su']),
  (12, 'dinh-dung-cu', 'Kem', null,
   array['6.5 inch','8 inch','10 inch','12 inch','3 ly'],
   array['kem','kem','kom']),

  (13, 'keo-silicon', 'Bang keo', null,
   array['trong 4F8','dc 4F8','giay 2.3F','giay 4F8','2 mat xanh 1F2','2 mat xanh 2F4','2 mat xanh 4F8','2 mat trang 2F4','2 mat trong','2 mat giay 1F2','2 mat giay 2F4'],
   array['bang keo','bang keo','bang dunh']),
  (13, 'keo-silicon', 'Keo cuon', null,
   array['keo vai','keo dien Nano','keo boc 25m','keo boc 30m','keo luoi nho','keo luoi lon','keo chung dt 5F 2T','keo chung dt 5F 1T'],
   array['keo cuon','keo vai','keo boc','keo luoi','keo chung dt']),
  (13, 'keo-silicon', 'Silicon', null,
   array['A100 sua','A200 trong','A300 sua trang','A500 trong','A500 sua xom den','Abond','Notobond','Xbond'],
   array['silicon','silicone','keo silicon']),
  (13, 'keo-silicon', 'Foam', null,
   array['foam thuong','foam sang','sang foam'],
   array['foam','bot no','sang foam']),
  (13, 'keo-silicon', 'Son xit ATM', 'ATM',
   array['123 chung dt gi','123 chung dt chai','mau thuong','mau A100/A400','mau A300'],
   array['son xit atm','son xit atm','son atm']),
  (13, 'keo-silicon', 'Keo sua ATM', 'ATM',
   array['chai'], array['keo sua atm','keo sua atm']),
  (13, 'keo-silicon', 'Keo V66', null,
   array['200 g','500 g','1 kg'], array['keo v66']),
  (13, 'keo-silicon', 'Keo 502', null,
   array['10 g','100 g','200 g','500 g'], array['keo 502','keo con voi']),
  (13, 'keo-silicon', 'Hoa phm', null,
   array['Cana lon','Cana nho','RP7 nho','RP7 lon','Vit','xit bng da','AB Thi den','AB Thi trong','tay Sumo'],
   array['cana','rp7','xit bng da','ab thi','tay sumo']);

insert into public.products (category_id, name, default_brand, description)
select distinct on (c.id, s.product_name)
       c.id, s.product_name, s.brand,
        format('Nhap tu so gia viet tay, Trang %s; can doi chieu anh nguon.', s.page_number)
from catalog_product_stage s
join public.categories c on c.slug = s.category_slug
order by c.id, s.product_name, s.page_number
on conflict (category_id, name) do update
set default_brand = coalesce(excluded.default_brand, public.products.default_brand),
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.product_aliases (product_id, alias, normalized_alias)
select distinct on (p.id, lower(public.unaccent(a.alias)))
       p.id, a.alias, lower(public.unaccent(a.alias))
from catalog_product_stage s
join public.categories c on c.slug = s.category_slug
join public.products p on p.category_id = c.id and p.name = s.product_name
cross join lateral unnest(s.aliases) a(alias)
order by p.id, lower(public.unaccent(a.alias)), a.alias
on conflict (product_id, normalized_alias) do update set alias = excluded.alias;

insert into public.product_variants
  (product_id, display_name, raw_specification, attributes, search_text, verification_status, active)
select distinct on (p.id, p.name || ' ' || x.spec)
       p.id,
       p.name || ' ' || x.spec,
       x.spec,
       jsonb_build_object('spec_code', x.spec, 'source_page', s.page_number),
       lower(public.unaccent(concat_ws(' ', p.name, x.spec, array_to_string(s.aliases, ' ')))),
       'needs_review'::public.verification_status,
       true
from catalog_product_stage s
join public.categories c on c.slug = s.category_slug
join public.products p on p.category_id = c.id and p.name = s.product_name
cross join lateral unnest(s.specs) x(spec)
order by p.id, p.name || ' ' || x.spec, s.page_number
on conflict (product_id, display_name) do update
set raw_specification = excluded.raw_specification,
    attributes = excluded.attributes,
    search_text = excluded.search_text,
    verification_status = excluded.verification_status,
    active = true,
    updated_at = now();

insert into public.variant_sources (variant_id, source_page_id)
select distinct v.id, sp.id
from catalog_product_stage s
join public.categories c on c.slug = s.category_slug
join public.products p on p.category_id = c.id and p.name = s.product_name
cross join lateral unnest(s.specs) x(spec)
join public.product_variants v on v.product_id = p.id and v.display_name = p.name || ' ' || x.spec
join public.source_pages sp on sp.page_number = s.page_number
on conflict do nothing;

insert into public.suppliers (name, note)
values ('So gia viet tay', 'Nguon gia chep tu so; moi gia phai duoc chu cua hang xac nhan truoc khi dung chinh thuc.')
on conflict (name) do update set note = excluded.note, active = true;

insert into public.price_lists (supplier_id, name, effective_date, note, is_sample)
select id, 'Nhap tu Trang 1-13', date '2026-08-12',
       'Ban nhap needs_review. Don vi nghin trong so duoc quy doi thanh VND.', false
from public.suppliers where name = 'So gia viet tay'
on conflict (supplier_id, name, effective_date) do update
set note = excluded.note, is_sample = false;

create temporary table catalog_price_stage (
  product_name text not null,
  spec text not null,
  package_name text not null,
  package_quantity numeric not null,
  base_unit text not null,
  price_type text not null,
  amount numeric not null
) on commit drop;

-- Page 5: Bulong. Values marked k in the source are converted to VND.
insert into catalog_price_stage values
('Bulong','6 ly x 1F5','10 bộ/bịch',10,'bo','retail',4000),('Bulong','6 ly x 1F5','100 bộ/bịch',100,'bo','wholesale',32000),
('Bulong','6 ly x 2F','10 bộ/bịch',10,'bo','retail',5000),('Bulong','6 ly x 2F','100 bộ/bịch',100,'bo','wholesale',35000),
('Bulong','6 ly x 2F5','10 bộ/bịch',10,'bo','retail',5000),('Bulong','6 ly x 2F5','100 bộ/bịch',100,'bo','wholesale',38000),
('Bulong','6 ly x 3F','10 bộ/bịch',10,'bo','retail',6000),('Bulong','6 ly x 3F','100 bộ/bịch',100,'bo','wholesale',40000),
('Bulong','6 ly x 4F','10 bộ/bịch',10,'bo','retail',7000),('Bulong','6 ly x 4F','100 bộ/bịch',100,'bo','wholesale',42000),
('Bulong','6 ly x 5F','10 bộ/bịch',10,'bo','retail',7000),('Bulong','6 ly x 5F','100 bộ/bịch',100,'bo','wholesale',50000),
('Bulong','6 ly x 6F','10 bộ/bịch',10,'bo','retail',8000),('Bulong','6 ly x 6F','100 bộ/bịch',100,'bo','wholesale',56000),
('Bulong','6 ly x 7F','10 bộ/bịch',10,'bo','retail',10000),('Bulong','6 ly x 7F','100 bộ/bịch',100,'bo','wholesale',70000),
('Bulong','6 ly x 8F','10 bộ/bịch',10,'bo','retail',10000),('Bulong','6 ly x 8F','100 bộ/bịch',100,'bo','wholesale',75000),
('Bulong','6 ly x 1T','10 bộ/bịch',10,'bo','retail',15000),('Bulong','6 ly x 1T','100 bộ/bịch',100,'bo','wholesale',95000),
('Bulong','6 ly x 1T2','10 bộ/bịch',10,'bo','retail',18000),('Bulong','6 ly x 1T2','100 bộ/bịch',100,'bo','wholesale',115000),
('Bulong','6 ly x 1T5','10 bộ/bịch',10,'bo','retail',22000),('Bulong','6 ly x 1T5','100 bộ/bịch',100,'bo','wholesale',145000),
('Bulong','8 ly x 1F5','10 bộ/bịch',10,'bo','retail',7000),('Bulong','8 ly x 1F5','100 bộ/bịch',100,'bo','wholesale',57000),
('Bulong','8 ly x 2F','10 bộ/bịch',10,'bo','retail',8000),('Bulong','8 ly x 2F','100 bộ/bịch',100,'bo','wholesale',62000),
('Bulong','8 ly x 2F5','10 bộ/bịch',10,'bo','retail',8000),('Bulong','8 ly x 2F5','100 bộ/bịch',100,'bo','wholesale',66000),
('Bulong','8 ly x 3F','10 bộ/bịch',10,'bo','retail',9000),('Bulong','8 ly x 3F','100 bộ/bịch',100,'bo','wholesale',70000),
('Bulong','8 ly x 4F','10 bộ/bịch',10,'bo','retail',10000),('Bulong','8 ly x 4F','100 bộ/bịch',100,'bo','wholesale',80000),
('Bulong','8 ly x 5F','10 bộ/bịch',10,'bo','retail',13000),('Bulong','8 ly x 5F','100 bộ/bịch',100,'bo','wholesale',90000),
('Bulong','8 ly x 6F','10 bộ/bịch',10,'bo','retail',14000),('Bulong','8 ly x 6F','100 bộ/bịch',100,'bo','wholesale',98000),
('Bulong','8 ly x 7F','10 bộ/bịch',10,'bo','retail',15000),('Bulong','8 ly x 7F','100 bộ/bịch',100,'bo','wholesale',114000),
('Bulong','8 ly x 8F','10 bộ/bịch',10,'bo','retail',17000),('Bulong','8 ly x 8F','100 bộ/bịch',100,'bo','wholesale',122000),
('Bulong','8 ly x 1T','10 bộ/bịch',10,'bo','retail',20000),('Bulong','8 ly x 1T','100 bộ/bịch',100,'bo','wholesale',143000),
('Bulong','8 ly x 1T2','10 bộ/bịch',10,'bo','retail',22000),('Bulong','8 ly x 1T2','100 bộ/bịch',100,'bo','wholesale',162000),
('Bulong','8 ly x 1T5','10 bộ/bịch',10,'bo','retail',30000),('Bulong','8 ly x 1T5','100 bộ/bịch',100,'bo','wholesale',198000),
('Bulong','10 ly x 2F','10 bộ/bịch',10,'bo','retail',18000),('Bulong','10 ly x 2F','100 bộ/bịch',100,'bo','wholesale',120000),
('Bulong','10 ly x 2F5','10 bộ/bịch',10,'bo','retail',20000),('Bulong','10 ly x 2F5','100 bộ/bịch',100,'bo','wholesale',128000),
('Bulong','10 ly x 3F','10 bộ/bịch',10,'bo','retail',20000),('Bulong','10 ly x 3F','100 bộ/bịch',100,'bo','wholesale',134000),
('Bulong','10 ly x 4F','10 bộ/bịch',10,'bo','retail',22000),('Bulong','10 ly x 4F','100 bộ/bịch',100,'bo','wholesale',150000),
('Bulong','10 ly x 5F','10 bộ/bịch',10,'bo','retail',24000),('Bulong','10 ly x 5F','100 bộ/bịch',100,'bo','wholesale',165000),
('Bulong','10 ly x 6F','10 bộ/bịch',10,'bo','retail',26000),('Bulong','10 ly x 6F','100 bộ/bịch',100,'bo','wholesale',180000),
('Bulong','10 ly x 7F','10 bộ/bịch',10,'bo','retail',28000),('Bulong','10 ly x 7F','100 bộ/bịch',100,'bo','wholesale',197000),
('Bulong','10 ly x 8F','10 bộ/bịch',10,'bo','retail',30000),('Bulong','10 ly x 8F','100 bộ/bịch',100,'bo','wholesale',210000),
('Bulong','10 ly x 1T','10 bộ/bịch',10,'bo','retail',34000),('Bulong','10 ly x 1T','100 bộ/bịch',100,'bo','wholesale',246000),
('Bulong','10 ly x 1T2','10 bộ/bịch',10,'bo','retail',38000),('Bulong','10 ly x 1T2','100 bộ/bịch',100,'bo','wholesale',278000),
('Bulong','10 ly x 1T5','10 bộ/bịch',10,'bo','retail',45000),('Bulong','10 ly x 1T5','100 bộ/bịch',100,'bo','wholesale',328000),
('Bulong','12 ly x 1F5','10 bộ/bịch',10,'bo','retail',22000),('Bulong','12 ly x 1F5','100 bộ/bịch',100,'bo','wholesale',164000),
('Bulong','12 ly x 2F','10 bộ/bịch',10,'bo','retail',24000),('Bulong','12 ly x 2F','100 bộ/bịch',100,'bo','wholesale',176000),
('Bulong','12 ly x 2F5','10 bộ/bịch',10,'bo','retail',24000),('Bulong','12 ly x 2F5','100 bộ/bịch',100,'bo','wholesale',176000),
('Bulong','12 ly x 3F','10 bộ/bịch',10,'bo','retail',26000),('Bulong','12 ly x 3F','100 bộ/bịch',100,'bo','wholesale',188000),
('Bulong','12 ly x 4F','10 bộ/bịch',10,'bo','retail',30000),('Bulong','12 ly x 4F','100 bộ/bịch',100,'bo','wholesale',210000),
('Bulong','12 ly x 5F','10 bộ/bịch',10,'bo','retail',32000),('Bulong','12 ly x 5F','100 bộ/bịch',100,'bo','wholesale',228000),
('Bulong','12 ly x 6F','10 bộ/bịch',10,'bo','retail',35000),('Bulong','12 ly x 6F','100 bộ/bịch',100,'bo','wholesale',250000),
('Bulong','12 ly x 7F','10 bộ/bịch',10,'bo','retail',38000),('Bulong','12 ly x 7F','100 bộ/bịch',100,'bo','wholesale',274000),
('Bulong','12 ly x 8F','10 bộ/bịch',10,'bo','retail',40000),('Bulong','12 ly x 8F','100 bộ/bịch',100,'bo','wholesale',297000),
('Bulong','12 ly x 1T','10 bộ/bịch',10,'bo','retail',45000),('Bulong','12 ly x 1T','100 bộ/bịch',100,'bo','wholesale',348000),
('Bulong','12 ly x 1T2','10 bộ/bịch',10,'bo','retail',50000),('Bulong','12 ly x 1T2','100 bộ/bịch',100,'bo','wholesale',390000),
('Bulong','12 ly x 1T5','10 bộ/bịch',10,'bo','retail',70000),('Bulong','12 ly x 1T5','100 bộ/bịch',100,'bo','wholesale',575000);

-- Page 9: cable prices that are clearly legible.
insert into catalog_price_stage values
('Day cap m trang','1.5 ly','1 mét',1,'met','retail',2500),('Day cap m trang','1.5 ly','100 mét/cuộn',100,'met','wholesale',180000),
('Day cap m trang','2 ly','1 mét',1,'met','retail',3000),('Day cap m trang','2 ly','100 mét/cuộn',100,'met','wholesale',200000),
('Day cap m trang','3 ly','1 mét',1,'met','retail',4000),('Day cap m trang','3 ly','100 mét/cuộn',100,'met','wholesale',300000),
('Day cap m trang','4 ly','1 mét',1,'met','retail',4500),('Day cap m trang','4 ly','100 mét/cuộn',100,'met','wholesale',380000),
('Day cap m trang','5 ly','1 mét',1,'met','retail',5000),('Day cap m trang','5 ly','100 mét/cuộn',100,'met','wholesale',480000),
('Day cap m trang','6 ly','1 mét',1,'met','retail',6000),('Day cap m trang','6 ly','100 mét/cuộn',100,'met','wholesale',500000),
('Day cap m trang','8 ly','1 mét',1,'met','retail',9000),('Day cap m trang','8 ly','100 mét/cuộn',100,'met','wholesale',800000),
('Day cap m trang','10 ly','1 mét',1,'met','retail',11000),('Day cap m trang','10 ly','100 mét/cuộn',100,'met','wholesale',950000),
('Day cap m trang','12 ly','1 mét',1,'met','retail',17000),('Day cap m trang','12 ly','100 mét/cuộn',100,'met','wholesale',1550000),
('Day cap inox','3 ly','1 mét',1,'met','retail',8000),('Day cap inox','3 ly','100 mét/cuộn',100,'met','wholesale',680000),
('Day cap inox','4 ly','1 mét',1,'met','retail',10000),('Day cap inox','4 ly','100 mét/cuộn',100,'met','wholesale',820000),
('Day cap inox','5 ly','1 mét',1,'met','retail',11000),('Day cap inox','5 ly','100 mét/cuộn',100,'met','wholesale',940000),
('Day cap inox','6 ly','1 mét',1,'met','retail',13000),('Day cap inox','6 ly','100 mét/cuộn',100,'met','wholesale',1150000),
('Day cap boc nhua','3 ly','1 mét',1,'met','retail',6000),('Day cap boc nhua','3 ly','100 mét/cuộn',100,'met','wholesale',400000),
('Day cap boc nhua','4 ly','1 mét',1,'met','retail',7000),('Day cap boc nhua','4 ly','100 mét/cuộn',100,'met','wholesale',500000),
('Day cap boc nhua','5 ly','1 mét',1,'met','retail',8000),('Day cap boc nhua','5 ly','100 mét/cuộn',100,'met','wholesale',620000),
('Day cap boc nhua','6 ly','1 mét',1,'met','retail',9000),('Day cap boc nhua','6 ly','100 mét/cuộn',100,'met','wholesale',700000);

insert into public.packaging_options (variant_id, name, quantity, base_unit, note)
select distinct on (v.id, s.package_name, s.package_quantity, s.base_unit)
       v.id, s.package_name, s.package_quantity, s.base_unit,
       'Gia chep tu anh; needs_review truoc khi dung chinh thuc.'
from catalog_price_stage s
join public.products p on p.name = s.product_name
join public.product_variants v on v.product_id = p.id and v.display_name = p.name || ' ' || s.spec
order by v.id, s.package_name, s.package_quantity, s.base_unit, s.amount
on conflict (variant_id, name, quantity, base_unit) do update
set note = excluded.note;

insert into public.prices
  (packaging_id, price_list_id, price_type, customer_group, minimum_quantity, amount, currency, valid_from, active)
select distinct on (po.id, pl.id, s.price_type)
       po.id, pl.id, s.price_type, 'needs_review', 1, s.amount, 'VND',
       timestamptz '2026-08-12 00:00:00+07', true
from catalog_price_stage s
join public.products p on p.name = s.product_name
join public.product_variants v on v.product_id = p.id and v.display_name = p.name || ' ' || s.spec
join public.packaging_options po on po.variant_id = v.id
 and po.name = s.package_name and po.quantity = s.package_quantity and po.base_unit = s.base_unit
join public.suppliers sup on sup.name = 'So gia viet tay'
join public.price_lists pl on pl.supplier_id = sup.id and pl.name = 'Nhap tu Trang 1-13' and pl.effective_date = date '2026-08-12'
order by po.id, pl.id, s.price_type, s.amount
on conflict (packaging_id, price_list_id, price_type, minimum_quantity, valid_from) do update
set amount = excluded.amount,
    customer_group = excluded.customer_group,
    active = true,
    updated_at = now();

-- Hide original demo variants that were never verified and were not upgraded by this import.
update public.product_variants
set active = false, updated_at = now()
where verification_status = 'sample';

commit;
