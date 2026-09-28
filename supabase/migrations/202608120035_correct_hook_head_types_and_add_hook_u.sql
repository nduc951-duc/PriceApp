-- Đổi Móc C thành Ốc (giá có tán) theo đúng tiêu đề nguồn và nhập Móc U.
begin;

update public.products product
set name = 'Ốc (giá có tán)',
    description = 'Ốc có tán, phân theo đường kính, chiều dài và loại đầu.',
    active = true,
    updated_at = now()
where lower(public.unaccent(product.name)) = 'moc c'
   or exists (
     select 1 from public.product_aliases alias
     where alias.product_id = product.id
       and alias.normalized_alias = 'moc c'
   );

update public.product_variants variant
set display_name = 'Ốc (giá có tán) ' || variant.raw_specification,
    search_text = lower(public.unaccent(concat_ws(
      ' ', 'Ốc giá có tán', variant.raw_specification, variant.search_text
    ))),
    updated_at = now()
from public.products product
where variant.product_id = product.id
  and (
    lower(public.unaccent(product.name)) = 'oc (gia co tan)'
    or exists (
      select 1 from public.product_aliases alias
      where alias.product_id = product.id
        and alias.normalized_alias = 'moc c'
    )
  );

create temporary table hook_price_stage (
  product_name text,
  specification text,
  package_name text,
  package_quantity numeric,
  base_unit text,
  amount numeric,
  primary key (product_name, specification, package_name)
) on commit drop;

-- Ốc (giá có tán): một đơn vị là 100 bộ.
insert into hook_price_stage values
  ('Móc C','4 ly 1F',  'Đầu tròn + lá · 100 bộ',100,'bộ',15000),
  ('Móc C','4 ly 1F',  'Đầu dù · 100 bộ',       100,'bộ',18000),
  ('Móc C','4 ly 1F5', 'Đầu tròn + lá · 100 bộ',100,'bộ',16000),
  ('Móc C','4 ly 1F5', 'Đầu dù · 100 bộ',       100,'bộ',19000),
  ('Móc C','4 ly 2F',  'Đầu tròn + lá · 100 bộ',100,'bộ',18000),
  ('Móc C','4 ly 2F',  'Đầu dù · 100 bộ',       100,'bộ',20000),
  ('Móc C','4 ly 2F5', 'Đầu tròn + lá · 100 bộ',100,'bộ',20000),
  ('Móc C','4 ly 2F5', 'Đầu dù · 100 bộ',       100,'bộ',22000),
  ('Móc C','4 ly 3F',  'Đầu tròn + lá · 100 bộ',100,'bộ',22000),
  ('Móc C','4 ly 3F',  'Đầu dù · 100 bộ',       100,'bộ',25000),
  ('Móc C','4 ly 4F',  'Đầu tròn + lá · 100 bộ',100,'bộ',25000),
  ('Móc C','4 ly 4F',  'Đầu dù · 100 bộ',       100,'bộ',27000),
  ('Móc C','4 ly 5F',  'Đầu tròn + lá · 100 bộ',100,'bộ',30000),
  ('Móc C','4 ly 5F',  'Đầu dù · 100 bộ',       100,'bộ',34000),
  ('Móc C','4 ly 6F',  'Đầu tròn + lá · 100 bộ',100,'bộ',38000),
  ('Móc C','4 ly 6F',  'Đầu dù · 100 bộ',       100,'bộ',42000),
  ('Móc C','4 ly 7F',  'Đầu tròn + lá · 100 bộ',100,'bộ',48000),
  ('Móc C','4 ly 7F',  'Đầu dù · 100 bộ',       100,'bộ',53000),
  ('Móc C','4 ly 8F',  'Đầu tròn + lá · 100 bộ',100,'bộ',55000),
  ('Móc C','4 ly 8F',  'Đầu dù · 100 bộ',       100,'bộ',60000),
  ('Móc C','5 ly 1F',  'Đầu dù · 100 bộ',100,'bộ',24000),
  ('Móc C','5 ly 1F5', 'Đầu dù · 100 bộ',100,'bộ',26000),
  ('Móc C','5 ly 2F',  'Đầu dù · 100 bộ',100,'bộ',30000),
  ('Móc C','5 ly 2F5', 'Đầu dù · 100 bộ',100,'bộ',30000),
  ('Móc C','5 ly 3F',  'Đầu dù · 100 bộ',100,'bộ',33000),
  ('Móc C','5 ly 4F',  'Đầu dù · 100 bộ',100,'bộ',36000),
  ('Móc C','5 ly 5F',  'Đầu dù · 100 bộ',100,'bộ',40000),
  ('Móc C','6 ly 1F',  'Đầu dù · 100 bộ',100,'bộ',29000),
  ('Móc C','6 ly 1F5', 'Đầu dù · 100 bộ',100,'bộ',32000),
  ('Móc C','6 ly 2F',  'Đầu dù · 100 bộ',100,'bộ',35000),
  ('Móc C','6 ly 2F5', 'Đầu dù · 100 bộ',100,'bộ',38000),
  ('Móc C','6 ly 3F',  'Đầu dù · 100 bộ',100,'bộ',42000),
  ('Móc C','6 ly 4F',  'Đầu dù · 100 bộ',100,'bộ',45000),
  ('Móc C','6 ly 5F',  'Đầu dù · 100 bộ',100,'bộ',55000),
  ('Móc C','6 ly 6F',  'Đầu dù · 100 bộ',100,'bộ',62000);

-- Móc U 8 ly và 10 ly: giữ đúng quy cách đóng gói người dùng cung cấp.
insert into hook_price_stage values
  ('Móc U','8 ly 21', 'Đầu tròn + lá · 10 con',10,'con',3000), ('Móc U','8 ly 21', 'Đầu dù · 100 con',100,'con',2000),
  ('Móc U','8 ly 27', 'Đầu tròn + lá · 10 con',10,'con',3000), ('Móc U','8 ly 27', 'Đầu dù · 100 con',100,'con',2200),
  ('Móc U','8 ly 34', 'Đầu tròn + lá · 10 con',10,'con',3200), ('Móc U','8 ly 34', 'Đầu dù · 100 con',100,'con',2400),
  ('Móc U','8 ly 42', 'Đầu tròn + lá · 10 con',10,'con',3500), ('Móc U','8 ly 42', 'Đầu dù · 100 con',100,'con',2800),
  ('Móc U','8 ly 49', 'Đầu tròn + lá · 10 con',10,'con',3800), ('Móc U','8 ly 49', 'Đầu dù · 100 con',100,'con',3300),
  ('Móc U','8 ly 60', 'Đầu tròn + lá · 10 con',10,'con',4000), ('Móc U','8 ly 60', 'Đầu dù · 100 con',100,'con',3300),
  ('Móc U','8 ly 76', 'Đầu tròn + lá · 10 con',10,'con',4800), ('Móc U','8 ly 76', 'Đầu dù · 100 con',100,'con',4000),
  ('Móc U','8 ly 90', 'Đầu tròn + lá · 10 con',10,'con',5500), ('Móc U','8 ly 90', 'Đầu dù · 100 con',100,'con',4500),
  ('Móc U','8 ly 114','Đầu tròn + lá · 10 con',10,'con',6500), ('Móc U','8 ly 114','Đầu dù · 100 con',100,'con',5200),
  ('Móc U','8 ly 140','Đầu tròn + lá · 10 con',10,'con',9000), ('Móc U','8 ly 140','Đầu dù · 100 con',100,'con',7600),
  ('Móc U','8 ly 168','Đầu tròn + lá · 10 con',10,'con',11000),('Móc U','8 ly 168','Đầu dù · 100 con',100,'con',9500),
  ('Móc U','10 ly 60', 'Đầu tròn + lá · 10 con',10,'con',7000), ('Móc U','10 ly 60', 'Đầu dù · 100 con',100,'con',5600),
  ('Móc U','10 ly 76', 'Đầu tròn + lá · 10 con',10,'con',7500), ('Móc U','10 ly 76', 'Đầu dù · 100 con',100,'con',6500),
  ('Móc U','10 ly 90', 'Đầu tròn + lá · 10 con',10,'con',8000), ('Móc U','10 ly 90', 'Đầu dù · 100 con',100,'con',6800),
  ('Móc U','10 ly 114','Đầu tròn + lá · 10 con',10,'con',9000), ('Móc U','10 ly 114','Đầu dù · 100 con',100,'con',7200),
  ('Móc U','10 ly 140','Đầu tròn + lá · 10 con',10,'con',12000),('Móc U','10 ly 140','Đầu dù · 100 con',100,'con',10500),
  ('Móc U','10 ly 168','Đầu tròn + lá · 10 con',10,'con',14000),('Móc U','10 ly 168','Đầu dù · 100 con',100,'con',12500),
  ('Móc U','10 ly 220','Đầu tròn + lá · 10 con',10,'con',18000),('Móc U','10 ly 220','Đầu dù · 100 con',100,'con',16000),
  ('Móc U','12 ly 90', 'Đầu tròn + lá · 1 con',1,'con',12000),
  ('Móc U','12 ly 114','Đầu tròn + lá · 1 con',1,'con',14000),
  ('Móc U','12 ly 140','Đầu tròn + lá · 1 con',1,'con',19000),
  ('Móc U','12 ly 168','Đầu tròn + lá · 1 con',1,'con',22000),
  ('Móc U','12 ly 220','Đầu tròn + lá · 1 con',1,'con',31000),
  ('Móc U','12 ly 260','Đầu tròn + lá · 1 con',1,'con',39000),
  ('Móc U','12 ly 280','Đầu tròn + lá · 1 con',1,'con',42000),
  ('Móc U','12 ly 330','Đầu tròn + lá · 1 con',1,'con',54000);

-- Tắt các giá cũ bị gắn nhầm retail/wholesale trên package chung.
update public.prices price
set active = false, updated_at = now()
from public.packaging_options packaging
join public.product_variants variant on variant.id = packaging.variant_id
join public.products product on product.id = variant.product_id
where price.packaging_id = packaging.id
  and (
    lower(public.unaccent(product.name)) = 'oc (gia co tan)'
    or exists (
      select 1 from public.product_aliases alias
      where alias.product_id = product.id
        and alias.normalized_alias = 'moc c'
    )
  )
  and packaging.name = '100 bộ/bịch';

do $$
declare
  target_price_list_id bigint;
  stage record;
  target_product_id bigint;
  target_product_name text;
  target_variant_id bigint;
  target_packaging_id bigint;
begin
  select price_list.id into target_price_list_id
  from public.price_lists price_list
  join public.suppliers supplier on supplier.id = price_list.supplier_id
  where supplier.name in ('Sổ giá viết tay', 'So gia viet tay')
    and price_list.name in ('Nhập từ Trang 1-13', 'Nhap tu Trang 1-13')
    and price_list.effective_date = date '2026-08-12'
  limit 1;

  for stage in select * from hook_price_stage loop
    target_product_id := null;
    target_product_name := null;
    target_variant_id := null;

    select product.id, product.name into target_product_id, target_product_name
    from public.products product
    where (
      stage.product_name = 'Móc C'
      and (
        lower(public.unaccent(product.name)) = 'oc (gia co tan)'
        or exists (
          select 1 from public.product_aliases alias
          where alias.product_id = product.id
            and alias.normalized_alias = 'moc c'
        )
      )
    ) or (
      stage.product_name = 'Móc U'
      and (
        lower(public.unaccent(product.name)) = 'moc u'
        or exists (
          select 1 from public.product_aliases alias
          where alias.product_id = product.id
            and alias.normalized_alias = 'moc u'
        )
      )
    )
    limit 1;

    if target_product_id is null then
      raise exception 'Không tìm thấy sản phẩm nguồn cho %', stage.product_name;
    end if;

    select variant.id into target_variant_id
    from public.product_variants variant
    where variant.product_id = target_product_id
      and lower(public.unaccent(variant.raw_specification)) = lower(public.unaccent(stage.specification))
    limit 1;

    if target_variant_id is null and stage.product_name = 'Móc C' then
      insert into public.product_variants
        (product_id, display_name, raw_specification, attributes, search_text,
         verification_status, active)
      values (
        target_product_id,
        target_product_name || ' ' || stage.specification,
        stage.specification,
        jsonb_build_object('source_page', 2),
        lower(public.unaccent(target_product_name || ' ' || stage.specification)),
        'needs_review'::public.verification_status,
        true
      )
      returning id into target_variant_id;
    elsif target_variant_id is null then
      raise exception 'Không tìm thấy biến thể % %', stage.product_name, stage.specification;
    end if;

    update public.product_variants set active = true, updated_at = now()
    where id = target_variant_id;

    insert into public.packaging_options (variant_id,name,quantity,base_unit,note)
    values (target_variant_id,stage.package_name,stage.package_quantity,stage.base_unit,
            'Giá phân theo loại đầu ốc; xác nhận từ bảng giá viết tay.')
    on conflict (variant_id,name,quantity,base_unit) do update set note=excluded.note
    returning id into target_packaging_id;

    insert into public.prices
      (packaging_id,price_list_id,price_type,customer_group,minimum_quantity,
       amount,currency,valid_from,active)
    values (target_packaging_id,target_price_list_id,
            case
              when stage.product_name = 'Móc U' and stage.package_quantity = 100
                then 'wholesale'
              else 'retail'
            end,
            'confirmed',1,
            stage.amount,'VND',timestamptz '2026-08-12 00:00:00+07',true)
    on conflict (packaging_id,price_list_id,price_type,minimum_quantity,valid_from)
    do update set amount=excluded.amount,customer_group=excluded.customer_group,
      active=true,version=case when public.prices.amount is distinct from excluded.amount
      then public.prices.version+1 else public.prices.version end,updated_at=now();
  end loop;
end
$$;

commit;
