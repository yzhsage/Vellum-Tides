-- 歲時錄 · Vellum Tides V2
-- 警告：本檔會刪除「歲時錄」既有帳本、帳頁、發票、品項、邀請、分類與同步資料。
-- 不會刪除 Supabase Authentication → Users 中的登入帳號。
-- 僅在已確認不保留舊帳務資料時，完整貼入 Supabase SQL Editor 後執行一次。

begin;

drop function if exists public.post_invoice(uuid) cascade;
drop function if exists public.apply_ledger_mutation(jsonb) cascade;
drop function if exists public.accept_household_invite(text, text) cascade;
drop function if exists public.create_household_invite(uuid) cascade;
drop function if exists public.ensure_personal_household(text) cascade;
drop function if exists public.is_household_member(uuid) cascade;
drop function if exists public.normalise_ledger_tags() cascade;
drop function if exists public.normalise_suggested_tags() cascade;
drop function if exists public.assert_ledger_handler_is_member() cascade;
drop function if exists public.assert_invoice_item_handler_is_member() cascade;

drop table if exists public.sync_events cascade;
drop table if exists public.keyword_rules cascade;
drop table if exists public.invoice_items cascade;
drop table if exists public.invoices cascade;
drop table if exists public.ledger_entries cascade;
drop table if exists public.categories cascade;
drop table if exists public.household_invites cascade;
drop table if exists public.household_members cascade;
drop table if exists public.households cascade;

drop type if exists public.invoice_state cascade;
drop type if exists public.member_role cascade;
drop type if exists public.ledger_kind cascade;
drop type if exists public.ledger_direction cascade;
drop type if exists public.ledger_major cascade;

create type public.ledger_direction as enum ('outflow', 'inflow');
create type public.ledger_major as enum (
  'food', 'home', 'transport', 'culture', 'misc',
  'salary', 'gain', 'windfall'
);
create type public.member_role as enum ('keeper', 'companion');
create type public.invoice_state as enum ('draft', 'awaiting_confirmation', 'posted', 'archived');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '帳友' check (char_length(trim(display_name)) between 1 and 40),
  role public.member_role not null default 'companion',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  direction public.ledger_direction not null,
  major public.ledger_major not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  amount numeric(12, 0) not null check (amount > 0),
  occurred_on date not null,
  tags text[] not null default '{}'::text[] check (coalesce(array_length(tags, 1), 0) <= 12),
  note text not null default '',
  handled_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at_ms bigint not null,
  device_id text not null,
  deleted_at timestamptz,
  source_invoice_item_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (direction = 'outflow' and major in ('food', 'home', 'transport', 'culture', 'misc'))
    or
    (direction = 'inflow' and major in ('salary', 'gain', 'windfall'))
  )
);
create index ledger_entries_household_date on public.ledger_entries (household_id, occurred_on desc);
create index ledger_entries_household_major on public.ledger_entries (household_id, major);
create index ledger_entries_tags_gin on public.ledger_entries using gin (tags);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invoice_number text,
  invoice_date date,
  random_code text,
  seller_name text not null default '',
  total_amount numeric(12, 0) not null default 0,
  source text not null check (source in ('official_api', 'qr_barcode', 'photo_ocr', 'manual', 'csv')),
  raw_payload jsonb not null default '{}'::jsonb,
  image_storage_key text,
  state public.invoice_state not null default 'awaiting_confirmation',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  title text not null default '' check (char_length(trim(title)) <= 120),
  quantity numeric(12, 3) not null default 1,
  unit_price numeric(12, 0) not null default 0,
  amount numeric(12, 0) not null default 0,
  major public.ledger_major,
  tags text[] not null default '{}'::text[] check (coalesce(array_length(tags, 1), 0) <= 12),
  handled_by uuid references auth.users(id) on delete set null,
  classification_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  check (major is null or major in ('food', 'home', 'transport', 'culture', 'misc'))
);

alter table public.ledger_entries
  add constraint ledger_entries_source_invoice_item_fk
  foreign key (source_invoice_item_id) references public.invoice_items(id) on delete set null;
create index invoice_items_tags_gin on public.invoice_items using gin (tags);

create table public.keyword_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  keyword text not null check (char_length(trim(keyword)) between 1 and 48),
  major public.ledger_major not null,
  suggested_tags text[] not null default '{}'::text[] check (coalesce(array_length(suggested_tags, 1), 0) <= 12),
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, keyword),
  check (major in ('food', 'home', 'transport', 'culture', 'misc'))
);

create table public.sync_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('created', 'updated', 'deleted', 'rejected')),
  accepted_at timestamptz not null default now(),
  client_updated_at_ms bigint not null,
  device_id text not null,
  actor_id uuid not null references auth.users(id) on delete restrict
);

create or replace function public.is_household_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.normalise_ledger_tags()
returns trigger language plpgsql set search_path = public as $$
begin
  new.tags := coalesce((
    select array_agg(tag order by tag)
    from (
      select distinct case
        when left(trim(raw_tag), 1) = '#' then lower(trim(raw_tag))
        else '#' || lower(trim(raw_tag))
      end as tag
      from unnest(coalesce(new.tags, '{}'::text[])) as item(raw_tag)
      where trim(raw_tag) <> '' and char_length(trim(raw_tag)) <= 31
    ) normalized
  ), '{}'::text[]);
  return new;
end;
$$;

create or replace function public.normalise_suggested_tags()
returns trigger language plpgsql set search_path = public as $$
begin
  new.suggested_tags := coalesce((
    select array_agg(tag order by tag)
    from (
      select distinct case
        when left(trim(raw_tag), 1) = '#' then lower(trim(raw_tag))
        else '#' || lower(trim(raw_tag))
      end as tag
      from unnest(coalesce(new.suggested_tags, '{}'::text[])) as item(raw_tag)
      where trim(raw_tag) <> '' and char_length(trim(raw_tag)) <= 31
    ) normalized
  ), '{}'::text[]);
  return new;
end;
$$;

create or replace function public.assert_ledger_handler_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.handled_by is not null and not exists (
    select 1 from public.household_members
    where household_id = new.household_id and user_id = new.handled_by
  ) then
    raise exception '掌簿須為此帳本成員';
  end if;
  return new;
end;
$$;

create or replace function public.assert_invoice_item_handler_is_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare invoice_household uuid;
begin
  select household_id into invoice_household from public.invoices where id = new.invoice_id;
  if new.handled_by is not null and not exists (
    select 1 from public.household_members
    where household_id = invoice_household and user_id = new.handled_by
  ) then
    raise exception '掌簿須為此帳本成員';
  end if;
  return new;
end;
$$;

create trigger normalise_ledger_entry_tags before insert or update of tags on public.ledger_entries
for each row execute function public.normalise_ledger_tags();
create trigger normalise_invoice_item_tags before insert or update of tags on public.invoice_items
for each row execute function public.normalise_ledger_tags();
create trigger normalise_keyword_rule_tags before insert or update of suggested_tags on public.keyword_rules
for each row execute function public.normalise_suggested_tags();
create trigger validate_ledger_handler before insert or update of household_id, handled_by on public.ledger_entries
for each row execute function public.assert_ledger_handler_is_member();
create trigger validate_invoice_item_handler before insert or update of invoice_id, handled_by on public.invoice_items
for each row execute function public.assert_invoice_item_handler_is_member();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.keyword_rules enable row level security;
alter table public.sync_events enable row level security;

create policy "帳本成員可閱覽帳本" on public.households for select to authenticated using (public.is_household_member(id));
create policy "建立者可建立帳本" on public.households for insert to authenticated with check (owner_id = auth.uid());
create policy "帳本守頁人可更新帳本" on public.households for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "帳本成員可閱覽同伴" on public.household_members for select to authenticated using (public.is_household_member(household_id));
create policy "帳本成員可閱覽邀請" on public.household_invites for select to authenticated using (public.is_household_member(household_id));
create policy "成員可管理帳頁" on public.ledger_entries for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "成員可管理發票" on public.invoices for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "成員可管理發票品項" on public.invoice_items for all to authenticated using (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.is_household_member(i.household_id))
) with check (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.is_household_member(i.household_id))
);
create policy "成員可管理分卷規則" on public.keyword_rules for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "成員可閱覽同步軌跡" on public.sync_events for select to authenticated using (public.is_household_member(household_id));

create or replace function public.ensure_personal_household(p_title text default '歲時帳本')
returns uuid language plpgsql security definer set search_path = public as $$
declare found_household uuid; new_household uuid; profile_name text;
begin
  if auth.uid() is null then raise exception '未登入'; end if;
  select hm.household_id into found_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  order by (select count(*) from public.household_members peers where peers.household_id = hm.household_id) desc, hm.joined_at asc
  limit 1;
  if found_household is not null then return found_household; end if;
  select nullif(trim(raw_user_meta_data ->> 'display_name'), '') into profile_name from auth.users where id = auth.uid();
  insert into public.households (title, owner_id) values (coalesce(nullif(trim(p_title), ''), '歲時帳本'), auth.uid()) returning id into new_household;
  insert into public.household_members (household_id, user_id, display_name, role) values (new_household, auth.uid(), coalesce(profile_name, '我'), 'keeper');
  return new_household;
end;
$$;

create or replace function public.create_household_invite(p_household_id uuid)
returns table(code text, expires_at timestamptz) language plpgsql security definer set search_path = public as $$
declare member_count integer; new_code text;
begin
  if not exists (select 1 from public.households where id = p_household_id and owner_id = auth.uid()) then raise exception '僅守頁人可發出邀請'; end if;
  select count(*) into member_count from public.household_members where household_id = p_household_id;
  if member_count >= 2 then raise exception '此帳本已滿兩位成員'; end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.household_invites (household_id, code, created_by) values (p_household_id, new_code, auth.uid())
  returning household_invites.code, household_invites.expires_at into code, expires_at;
  return next;
end;
$$;

create or replace function public.accept_household_invite(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare invite_row public.household_invites; member_count integer; profile_name text;
begin
  if auth.uid() is null then raise exception '未登入'; end if;
  select * into invite_row from public.household_invites where code = upper(trim(p_code)) and accepted_at is null and expires_at > now() limit 1;
  if invite_row.id is null then raise exception '邀請碼無效或已逾期'; end if;
  if exists (select 1 from public.household_members where household_id = invite_row.household_id and user_id = auth.uid()) then return invite_row.household_id; end if;
  select count(*) into member_count from public.household_members where household_id = invite_row.household_id;
  if member_count >= 2 then raise exception '此帳本已滿兩位成員'; end if;
  select nullif(trim(raw_user_meta_data ->> 'display_name'), '') into profile_name from auth.users where id = auth.uid();
  insert into public.household_members (household_id, user_id, display_name, role)
  values (invite_row.household_id, auth.uid(), coalesce(nullif(trim(p_display_name), ''), profile_name, '帳友'), 'companion');
  update public.household_invites set accepted_by = auth.uid(), accepted_at = now() where id = invite_row.id;
  return invite_row.household_id;
end;
$$;

create or replace function public.apply_ledger_mutation(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing public.ledger_entries;
  incoming_id uuid := (p_payload->>'id')::uuid;
  incoming_household uuid := (p_payload->>'household_id')::uuid;
  incoming_stamp bigint := (p_payload->>'updated_at_ms')::bigint;
  incoming_device text := coalesce(p_payload->>'device_id', '');
  incoming_tags text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'tags', '[]'::jsonb))), '{}'::text[]);
  accepted boolean := false;
begin
  if auth.uid() is null or not public.is_household_member(incoming_household) then raise exception '無帳本權限'; end if;
  select * into existing from public.ledger_entries where id = incoming_id for update;
  if existing.id is null then
    insert into public.ledger_entries (id, household_id, direction, major, title, amount, occurred_on, tags, note, handled_by, created_by, updated_by, updated_at_ms, device_id, deleted_at)
    values (incoming_id, incoming_household, (p_payload->>'direction')::public.ledger_direction, (p_payload->>'major')::public.ledger_major, coalesce(p_payload->>'title', ''), (p_payload->>'amount')::numeric, (p_payload->>'occurred_on')::date, incoming_tags, coalesce(p_payload->>'note', ''), auth.uid(), auth.uid(), auth.uid(), incoming_stamp, incoming_device, nullif(p_payload->>'deleted_at', '')::timestamptz);
    accepted := true;
  elsif incoming_stamp > existing.updated_at_ms or (incoming_stamp = existing.updated_at_ms and incoming_device > existing.device_id) then
    update public.ledger_entries set direction = (p_payload->>'direction')::public.ledger_direction, major = (p_payload->>'major')::public.ledger_major, title = coalesce(p_payload->>'title', ''), amount = (p_payload->>'amount')::numeric, occurred_on = (p_payload->>'occurred_on')::date, tags = incoming_tags, note = coalesce(p_payload->>'note', ''), handled_by = auth.uid(), updated_by = auth.uid(), updated_at_ms = incoming_stamp, device_id = incoming_device, deleted_at = nullif(p_payload->>'deleted_at', '')::timestamptz, updated_at = now() where id = incoming_id;
    accepted := true;
  end if;
  insert into public.sync_events (household_id, entity_type, entity_id, operation, client_updated_at_ms, device_id, actor_id)
  values (incoming_household, 'ledger_entry', incoming_id, case when accepted then case when nullif(p_payload->>'deleted_at', '') is null then 'updated' else 'deleted' end else 'rejected' end, incoming_stamp, incoming_device, auth.uid());
  return jsonb_build_object('accepted', accepted);
end;
$$;

create or replace function public.post_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare invoice_row public.invoices; item_row public.invoice_items; now_ms bigint;
begin
  select * into invoice_row from public.invoices where id = p_invoice_id for update;
  if invoice_row.id is null or not public.is_household_member(invoice_row.household_id) then raise exception '無待確認頁權限'; end if;
  if invoice_row.state <> 'awaiting_confirmation' then raise exception '此待確認頁已完成'; end if;
  if exists (select 1 from public.invoice_items where invoice_id = p_invoice_id and (major is null or trim(title) = '')) then raise exception '請先為每項填妥大目與名目'; end if;
  now_ms := floor(extract(epoch from clock_timestamp()) * 1000);
  for item_row in select * from public.invoice_items where invoice_id = p_invoice_id loop
    insert into public.ledger_entries (id, household_id, direction, major, title, amount, occurred_on, tags, note, handled_by, created_by, updated_by, updated_at_ms, device_id, source_invoice_item_id)
    values (gen_random_uuid(), invoice_row.household_id, 'outflow', item_row.major, item_row.title, item_row.amount, coalesce(invoice_row.invoice_date, current_date), item_row.tags, nullif(invoice_row.seller_name, ''), auth.uid(), auth.uid(), auth.uid(), now_ms, 'invoice-post', item_row.id);
    now_ms := now_ms + 1;
  end loop;
  update public.invoices set state = 'posted', updated_at = now() where id = p_invoice_id;
end;
$$;

grant execute on function public.ensure_personal_household(text) to authenticated;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(text, text) to authenticated;
grant execute on function public.apply_ledger_mutation(jsonb) to authenticated;
grant execute on function public.post_invoice(uuid) to authenticated;
grant usage on schema public to authenticated;
grant select on table public.households, public.household_members, public.household_invites, public.ledger_entries, public.invoices, public.invoice_items, public.keyword_rules, public.sync_events to authenticated;
grant insert on table public.invoices to authenticated;
grant insert, update on table public.invoice_items to authenticated;

commit;
