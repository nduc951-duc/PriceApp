create extension if not exists unaccent;

create extension if not exists pg_trgm;

create type public.app_role as enum('owner', 'editor', 'viewer');

create type public.verification_status as enum(
  'verified',
  'needs_review',
  'unreadable',
  'sample'
);

create type public.price_operation as enum('create', 'update', 'undo');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  role app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id bigint generated always as identity primary key,
  parent_id bigint references public.categories,
  name text not null,
  slug text not null unique,
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.products (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.categories,
  name text not null,
  description text,
  default_brand text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create table public.product_aliases (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products on delete cascade,
  alias text not null,
  normalized_alias text not null,
  unique (product_id, normalized_alias)
);

create table public.source_pages (
  id bigint generated always as identity primary key,
  page_number int,
  storage_path text not null unique,
  raw_note text,
  verification_status verification_status not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products on delete cascade,
  sku text,
  display_name text not null,
  raw_specification text,
  attributes jsonb not null default '{}',
  search_text text not null default '',
  verification_status verification_status not null default 'needs_review',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, display_name)
);

create table public.variant_sources (
  variant_id bigint references public.product_variants on delete cascade,
  source_page_id bigint references public.source_pages on delete cascade,
  primary key (variant_id, source_page_id)
);

create table public.packaging_options (
  id bigint generated always as identity primary key,
  variant_id bigint not null references public.product_variants on delete cascade,
  name text not null,
  quantity numeric not null check (quantity > 0),
  base_unit text not null,
  barcode text,
  note text,
  unique (variant_id, name, quantity, base_unit)
);

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  contact jsonb not null default '{}',
  note text,
  active boolean not null default true
);

create table public.price_lists (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers,
  name text not null,
  effective_date date not null,
  note text,
  is_sample boolean not null default false,
  unique (supplier_id, name, effective_date)
);

create table public.prices (
  id bigint generated always as identity primary key,
  packaging_id bigint not null references public.packaging_options,
  price_list_id bigint not null references public.price_lists,
  price_type text not null check (price_type in ('retail', 'wholesale', 'dealer')),
  customer_group text,
  minimum_quantity numeric not null default 1 check (minimum_quantity > 0),
  amount numeric(18, 2) not null check (amount >= 0),
  currency char(3) not null default 'VND',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    valid_to is null
    or valid_to >= valid_from
  ),
  unique (
    packaging_id,
    price_list_id,
    price_type,
    minimum_quantity,
    valid_from
  )
);

create table public.price_history (
  id bigint generated always as identity primary key,
  price_id bigint not null references public.prices,
  old_amount numeric(18, 2),
  new_amount numeric(18, 2) not null,
  old_payload jsonb,
  new_payload jsonb,
  changed_by uuid not null references auth.users,
  changed_at timestamptz not null default now(),
  reason text not null,
  operation price_operation not null
);

create table public.promotions (
  id bigint generated always as identity primary key,
  category_id bigint references public.categories,
  product_id bigint references public.products,
  variant_id bigint references public.product_variants,
  price_list_id bigint references public.price_lists,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  value numeric not null check (value >= 0),
  minimum_quantity numeric check (minimum_quantity > 0),
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  description text,
  check (valid_to >= valid_from)
);

create table public.favorites (
  user_id uuid references auth.users on delete cascade,
  product_id bigint references public.products on delete cascade,
  variant_id bigint references public.product_variants on delete cascade,
  created_at timestamptz not null default now(),
  check (
    product_id is not null
    or variant_id is not null
  )
);

create unique index favorites_unique on public.favorites (
  user_id,
  coalesce(product_id, 0),
  coalesce(variant_id, 0)
);

create table public.recent_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  query text not null,
  selected_type text,
  selected_id bigint,
  searched_at timestamptz not null default now()
);

create index variants_search_trgm on public.product_variants using gin (search_text gin_trgm_ops);

create index variants_attributes_gin on public.product_variants using gin (attributes);

create index variants_fts on public.product_variants using gin (to_tsvector('simple', search_text));

create index recent_user_time on public.recent_searches (user_id, searched_at desc);

create or replace function public.get_current_app_role () returns app_role language sql stable security definer
set
  search_path = public as $$select role from profiles where id=auth.uid()$$;

create or replace function public.update_price_with_history (
  p_price_id bigint,
  p_new_amount numeric,
  p_expected_version int,
  p_reason text
) returns public.prices language plpgsql security definer
set
  search_path = public as $$declare v_old prices;v_new prices;begin if public.get_current_app_role() not in ('owner','editor') then raise exception 'forbidden';end if;if p_new_amount<0 or p_reason is null or btrim(p_reason)='' then raise exception 'invalid input';end if;select * into v_old from prices where id=p_price_id for update;if not found then raise exception 'not found';end if;if v_old.version<>p_expected_version then raise exception 'version_conflict';end if;update prices set amount=p_new_amount,version=version+1,updated_at=now() where id=p_price_id returning * into v_new;insert into price_history(price_id,old_amount,new_amount,old_payload,new_payload,changed_by,reason,operation) values(p_price_id,v_old.amount,v_new.amount,to_jsonb(v_old),to_jsonb(v_new),auth.uid(),p_reason,'update');return v_new;end$$;

create or replace function public.undo_price_change (p_history_id bigint, p_expected_version int) returns public.prices language plpgsql security definer
set
  search_path = public as $$declare h price_history;p prices;begin if public.get_current_app_role() not in ('owner','editor') then raise exception 'forbidden';end if;select * into h from price_history where id=p_history_id;select * into p from prices where id=h.price_id for update;if p.version<>p_expected_version then raise exception 'version_conflict';end if;update prices set amount=h.old_amount,version=version+1,updated_at=now() where id=p.id returning * into p;insert into price_history(price_id,old_amount,new_amount,changed_by,reason,operation) values(p.id,h.new_amount,h.old_amount,auth.uid(),'Undo #'||h.id,'undo');return p;end$$;

create or replace function public.search_catalog (
  query text,
  result_limit int default 20,
  filter_category_id bigint default null
) returns table (
  result_type text,
  id bigint,
  display_name text,
  breadcrumbs text,
  attributes jsonb,
  price_summary jsonb,
  relevance numeric,
  match_reason text
) language sql stable security invoker as $$with q as(select lower(unaccent(query)) s) select 'variant',v.id,v.display_name,c.name||' / '||p.name,v.attributes,coalesce(jsonb_build_object('min',min(pr.amount),'currency','VND'),'{}'),case when lower(unaccent(v.display_name))=(select s from q) then 100 when lower(unaccent(v.search_text)) like (select s from q)||'%' then 85 else greatest(similarity(lower(unaccent(v.search_text)),(select s from q))*60,ts_rank(to_tsvector('simple',v.search_text),plainto_tsquery('simple',(select s from q)))*60) end,case when lower(unaccent(v.display_name))=(select s from q) then 'exact' else 'search' end from product_variants v join products p on p.id=v.product_id join categories c on c.id=p.category_id left join packaging_options po on po.variant_id=v.id left join prices pr on pr.packaging_id=po.id and pr.active where v.active and (filter_category_id is null or c.id=filter_category_id) and (v.search_text % (select s from q) or to_tsvector('simple',v.search_text)@@plainto_tsquery('simple',(select s from q))) group by v.id,c.name,p.name order by 7 desc limit least(result_limit,100)$$;

alter table profiles enable row level security;

alter table categories enable row level security;

alter table products enable row level security;

alter table product_aliases enable row level security;

alter table product_variants enable row level security;

alter table packaging_options enable row level security;

alter table suppliers enable row level security;

alter table price_lists enable row level security;

alter table prices enable row level security;

alter table price_history enable row level security;

alter table promotions enable row level security;

alter table source_pages enable row level security;

alter table variant_sources enable row level security;

alter table favorites enable row level security;

alter table recent_searches enable row level security;

create policy "authenticated read categories" on categories for
select
  to authenticated using (true);

create policy "authenticated read products" on products for
select
  to authenticated using (true);

create policy "authenticated read variants" on product_variants for
select
  to authenticated using (true);

create policy "authenticated read packaging" on packaging_options for
select
  to authenticated using (true);

create policy "authenticated read prices" on prices for
select
  to authenticated using (true);

create policy "own profile" on profiles for
select
  to authenticated using (id = auth.uid ());

create policy "read history" on price_history for
select
  to authenticated using (true);

create policy "own favorites" on favorites for all to authenticated using (user_id = auth.uid ())
with
  check (user_id = auth.uid ());

create policy "own searches" on recent_searches for all to authenticated using (user_id = auth.uid ())
with
  check (user_id = auth.uid ());

revoke
update on public.prices
from
  authenticated;

grant
execute on function public.update_price_with_history to authenticated;

grant
execute on function public.undo_price_change to authenticated;

grant
execute on function public.search_catalog to authenticated;

insert into
  storage.buckets (id, name, public)
values
  ('source-pages', 'source-pages', false)
on conflict (id) do nothing;
