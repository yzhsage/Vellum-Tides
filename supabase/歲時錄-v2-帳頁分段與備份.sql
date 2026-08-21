-- 歲時錄 · Vellum Tides｜帳頁分段瀏覽與帳本典藏
-- 執行位置：Supabase Dashboard → SQL Editor → New query → 貼上全部內容後 Run。
-- 本檔不會刪除帳頁、憑據或掌簿資料；還原採「僅補入缺頁」策略，既有同 ID 資料一律保留。

begin;

create or replace function public.ledger_browse_summary(
  p_household_id uuid,
  p_from date default null,
  p_to date default null,
  p_direction public.ledger_direction default null,
  p_major public.ledger_major default null,
  p_tag text default null,
  p_handler uuid default null
)
returns table(total_count bigint, outflow_total numeric, inflow_total numeric)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception '無帳本權限';
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(le.amount) filter (where le.direction = 'outflow'), 0)::numeric,
    coalesce(sum(le.amount) filter (where le.direction = 'inflow'), 0)::numeric
  from public.ledger_entries le
  where le.household_id = p_household_id
    and le.deleted_at is null
    and (p_from is null or le.occurred_on >= p_from)
    and (p_to is null or le.occurred_on <= p_to)
    and (p_direction is null or le.direction = p_direction)
    and (p_major is null or le.major = p_major)
    and (p_tag is null or lower(p_tag) = any(le.tags))
    and (p_handler is null or le.handled_by = p_handler);
end;
$$;

create or replace function public.ledger_browse_page(
  p_household_id uuid,
  p_from date default null,
  p_to date default null,
  p_direction public.ledger_direction default null,
  p_major public.ledger_major default null,
  p_tag text default null,
  p_handler uuid default null,
  p_page integer default 0,
  p_page_size integer default 45
)
returns table(
  id uuid,
  household_id uuid,
  direction public.ledger_direction,
  major public.ledger_major,
  title text,
  amount numeric,
  occurred_on date,
  tags text[],
  note text,
  handled_by uuid,
  created_by uuid,
  updated_by uuid,
  updated_at_ms bigint,
  device_id text,
  deleted_at timestamptz,
  source_invoice_item_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  safe_page integer := greatest(coalesce(p_page, 0), 0);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 45), 15), 90);
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception '無帳本權限';
  end if;

  return query
  select
    le.id, le.household_id, le.direction, le.major, le.title, le.amount,
    le.occurred_on, le.tags, le.note, le.handled_by, le.created_by,
    le.updated_by, le.updated_at_ms, le.device_id, le.deleted_at,
    le.source_invoice_item_id, le.created_at, le.updated_at
  from public.ledger_entries le
  where le.household_id = p_household_id
    and le.deleted_at is null
    and (p_from is null or le.occurred_on >= p_from)
    and (p_to is null or le.occurred_on <= p_to)
    and (p_direction is null or le.direction = p_direction)
    and (p_major is null or le.major = p_major)
    and (p_tag is null or lower(p_tag) = any(le.tags))
    and (p_handler is null or le.handled_by = p_handler)
  order by le.occurred_on desc, le.updated_at_ms desc, le.id desc
  offset safe_page * safe_page_size
  limit safe_page_size;
end;
$$;

create or replace function public.ledger_tag_index(p_household_id uuid)
returns table(tag text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception '無帳本權限';
  end if;

  return query
  select tags.tag
  from (
    select distinct tag_value as tag
    from public.ledger_entries le
    cross join lateral unnest(le.tags) as tag_value
    where le.household_id = p_household_id and le.deleted_at is null
  ) tags
  order by tags.tag collate "C";
end;
$$;

create or replace function public.export_ledger_backup(p_household_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  current_household public.households;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception '無帳本權限';
  end if;

  select * into current_household from public.households where id = p_household_id;
  if current_household.id is null or current_household.title <> '歲時錄 · Vellum Tides' then
    raise exception '僅能典藏固定共用帳本';
  end if;

  return jsonb_build_object(
    'format', 'vellum-tides/ledger-backup',
    'version', 1,
    'exported_at', now(),
    'household', jsonb_build_object('title', current_household.title),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', hm.user_id, 'display_name', hm.display_name) order by hm.display_name)
      from public.household_members hm where hm.household_id = p_household_id
    ), '[]'::jsonb),
    'ledger_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', le.id, 'direction', le.direction, 'major', le.major, 'title', le.title,
        'amount', le.amount, 'occurred_on', le.occurred_on, 'tags', le.tags, 'note', le.note,
        'handled_by', le.handled_by, 'created_by', le.created_by, 'updated_by', le.updated_by,
        'updated_at_ms', le.updated_at_ms, 'device_id', le.device_id, 'deleted_at', le.deleted_at,
        'source_invoice_item_id', le.source_invoice_item_id, 'created_at', le.created_at, 'updated_at', le.updated_at
      ) order by le.occurred_on desc, le.updated_at_ms desc, le.id desc)
      from public.ledger_entries le
      where le.household_id = p_household_id and le.deleted_at is null
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
        'random_code', i.random_code, 'seller_name', i.seller_name, 'total_amount', i.total_amount,
        'source', i.source, 'raw_payload', i.raw_payload, 'image_storage_key', i.image_storage_key,
        'state', i.state, 'created_by', i.created_by, 'created_at', i.created_at, 'updated_at', i.updated_at
      ) order by i.created_at desc, i.id desc)
      from public.invoices i where i.household_id = p_household_id
    ), '[]'::jsonb),
    'invoice_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ii.id, 'invoice_id', ii.invoice_id, 'title', ii.title, 'quantity', ii.quantity,
        'unit_price', ii.unit_price, 'amount', ii.amount, 'major', ii.major, 'tags', ii.tags,
        'handled_by', ii.handled_by, 'classification_confirmed', ii.classification_confirmed, 'created_at', ii.created_at
      ) order by ii.created_at desc, ii.id desc)
      from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
      where i.household_id = p_household_id
    ), '[]'::jsonb),
    'keyword_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', kr.id, 'keyword', kr.keyword, 'major', kr.major, 'suggested_tags', kr.suggested_tags,
        'priority', kr.priority, 'active', kr.active, 'created_at', kr.created_at
      ) order by kr.priority desc, kr.keyword asc)
      from public.keyword_rules kr where kr.household_id = p_household_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.restore_ledger_backup(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  shared_household uuid;
  allowed_users uuid[] := array[
    'f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid,
    '9108138a-e103-435b-a0c0-643e3af400ec'::uuid
  ];
  restored_invoices integer := 0;
  restored_items integer := 0;
  restored_entries integer := 0;
  revived_entries integer := 0;
  restored_rules integer := 0;
begin
  if auth.uid() is null or not (auth.uid() = any(allowed_users)) then
    raise exception '此帳頁僅限玉瑟與石琴登入';
  end if;
  if p_payload->>'format' <> 'vellum-tides/ledger-backup' or (p_payload->>'version')::integer <> 1 then
    raise exception '備份檔格式或版本不符';
  end if;
  if p_payload->'household'->>'title' <> '歲時錄 · Vellum Tides' then
    raise exception '備份帳本名稱不符';
  end if;

  select hm.household_id into shared_household
  from public.household_members hm
  where hm.user_id = any(allowed_users)
  group by hm.household_id
  having count(distinct hm.user_id) = 2
  order by min(hm.joined_at)
  limit 1;
  if shared_household is null or not public.is_household_member(shared_household) then
    raise exception '找不到固定共用帳本';
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value where coalesce(value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or exists (select 1 from jsonb_array_elements(coalesce(p_payload->'invoices', '[]'::jsonb)) value where coalesce(value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or exists (select 1 from jsonb_array_elements(coalesce(p_payload->'invoice_items', '[]'::jsonb)) value where coalesce(value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception '備份檔包含不合法的資料識別碼';
  end if;

  with inserted as (
    insert into public.invoices (id, household_id, invoice_number, invoice_date, random_code, seller_name, total_amount, source, raw_payload, image_storage_key, state, created_by, created_at, updated_at)
    select
      (value->>'id')::uuid, shared_household, nullif(value->>'invoice_number', ''), nullif(value->>'invoice_date', '')::date,
      nullif(value->>'random_code', ''), coalesce(value->>'seller_name', ''), coalesce((value->>'total_amount')::numeric, 0),
      (value->>'source')::text, coalesce(value->'raw_payload', '{}'::jsonb), nullif(value->>'image_storage_key', ''),
      (value->>'state')::public.invoice_state,
      case when value->>'created_by' ~* '^[0-9a-f-]{36}$' and (value->>'created_by')::uuid = any(allowed_users) then (value->>'created_by')::uuid else auth.uid() end,
      coalesce(nullif(value->>'created_at', '')::timestamptz, now()), coalesce(nullif(value->>'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'invoices', '[]'::jsonb)) value
    on conflict (id) do nothing returning 1
  ) select count(*) into restored_invoices from inserted;

  with inserted as (
    insert into public.invoice_items (id, invoice_id, title, quantity, unit_price, amount, major, tags, handled_by, classification_confirmed, created_at)
    select
      (value->>'id')::uuid, (value->>'invoice_id')::uuid, coalesce(value->>'title', ''),
      coalesce((value->>'quantity')::numeric, 1), coalesce((value->>'unit_price')::numeric, 0), coalesce((value->>'amount')::numeric, 0),
      nullif(value->>'major', '')::public.ledger_major, coalesce(array(select jsonb_array_elements_text(coalesce(value->'tags', '[]'::jsonb))), '{}'::text[]),
      case when value->>'handled_by' ~* '^[0-9a-f-]{36}$' and (value->>'handled_by')::uuid = any(allowed_users) then (value->>'handled_by')::uuid else null end,
      coalesce((value->>'classification_confirmed')::boolean, false), coalesce(nullif(value->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'invoice_items', '[]'::jsonb)) value
    join public.invoices i on i.id = (value->>'invoice_id')::uuid and i.household_id = shared_household
    on conflict (id) do nothing returning 1
  ) select count(*) into restored_items from inserted;

  with revived as (
    update public.ledger_entries current_entry
    set deleted_at = null
    from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value
    where current_entry.household_id = shared_household
      and current_entry.id = (value->>'id')::uuid
      and current_entry.deleted_at is not null
      and nullif(value->>'deleted_at', '') is null
    returning 1
  ) select count(*) into revived_entries from revived;

  with inserted as (
    insert into public.ledger_entries (id, household_id, direction, major, title, amount, occurred_on, tags, note, handled_by, created_by, updated_by, updated_at_ms, device_id, deleted_at, source_invoice_item_id, created_at, updated_at)
    select
      (value->>'id')::uuid, shared_household, (value->>'direction')::public.ledger_direction, (value->>'major')::public.ledger_major,
      coalesce(value->>'title', ''), (value->>'amount')::numeric, (value->>'occurred_on')::date,
      coalesce(array(select jsonb_array_elements_text(coalesce(value->'tags', '[]'::jsonb))), '{}'::text[]), coalesce(value->>'note', ''),
      case when value->>'handled_by' ~* '^[0-9a-f-]{36}$' and (value->>'handled_by')::uuid = any(allowed_users) then (value->>'handled_by')::uuid else auth.uid() end,
      case when value->>'created_by' ~* '^[0-9a-f-]{36}$' and (value->>'created_by')::uuid = any(allowed_users) then (value->>'created_by')::uuid else auth.uid() end,
      case when value->>'updated_by' ~* '^[0-9a-f-]{36}$' and (value->>'updated_by')::uuid = any(allowed_users) then (value->>'updated_by')::uuid else auth.uid() end,
      (value->>'updated_at_ms')::bigint, coalesce(nullif(value->>'device_id', ''), 'backup-restore'), nullif(value->>'deleted_at', '')::timestamptz,
      case when value->>'source_invoice_item_id' ~* '^[0-9a-f-]{36}$' and not exists (select 1 from public.ledger_entries current_entry where current_entry.source_invoice_item_id = (value->>'source_invoice_item_id')::uuid) then (value->>'source_invoice_item_id')::uuid else null end,
      coalesce(nullif(value->>'created_at', '')::timestamptz, now()), coalesce(nullif(value->>'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value
    on conflict (id) do nothing returning 1
  ) select count(*) into restored_entries from inserted;

  with inserted as (
    insert into public.keyword_rules (id, household_id, keyword, major, suggested_tags, priority, active, created_at)
    select
      (value->>'id')::uuid, shared_household, value->>'keyword', (value->>'major')::public.ledger_major,
      coalesce(array(select jsonb_array_elements_text(coalesce(value->'suggested_tags', '[]'::jsonb))), '{}'::text[]),
      coalesce((value->>'priority')::integer, 0), coalesce((value->>'active')::boolean, true), coalesce(nullif(value->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'keyword_rules', '[]'::jsonb)) value
    on conflict do nothing returning 1
  ) select count(*) into restored_rules from inserted;

  return jsonb_build_object(
    'accepted', true,
    'restored_invoices', restored_invoices,
    'restored_items', restored_items,
    'restored_entries', restored_entries,
    'revived_entries', revived_entries,
    'restored_rules', restored_rules,
    'message', '備份已安全補入帳本；有效既有資料未覆寫，已收起且存在於備份的帳頁會重新啟用。'
  );
end;
$$;

grant execute on function public.ledger_browse_summary(uuid, date, date, public.ledger_direction, public.ledger_major, text, uuid) to authenticated;
grant execute on function public.ledger_browse_page(uuid, date, date, public.ledger_direction, public.ledger_major, text, uuid, integer, integer) to authenticated;
grant execute on function public.ledger_tag_index(uuid) to authenticated;
grant execute on function public.export_ledger_backup(uuid) to authenticated;
grant execute on function public.restore_ledger_backup(jsonb) to authenticated;

-- 安全補入補充：僅在備份包含有效帳頁、而現行同識別碼帳頁已被收起時，重新啟用該帳頁。
-- 仍有效的同識別碼帳頁完全不覆寫，故保留「安全補入」的原則。
create or replace function public.restore_ledger_backup_safe(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  base_result jsonb;
  shared_household uuid;
  allowed_users uuid[] := array[
    'f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid,
    '9108138a-e103-435b-a0c0-643e3af400ec'::uuid
  ];
  revived_entries integer := 0;
begin
  base_result := public.restore_ledger_backup(p_payload);
  if coalesce((base_result->>'accepted')::boolean, false) is not true then
    return base_result;
  end if;

  select hm.household_id into shared_household
  from public.household_members hm
  where hm.user_id = any(allowed_users)
  group by hm.household_id
  having count(distinct hm.user_id) = 2
  order by min(hm.joined_at)
  limit 1;

  update public.ledger_entries current_entry
  set deleted_at = null
  from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value
  where current_entry.household_id = shared_household
    and current_entry.id = (value->>'id')::uuid
    and current_entry.deleted_at is not null
    and nullif(value->>'deleted_at', '') is null;
  get diagnostics revived_entries = row_count;

  return base_result || jsonb_build_object(
    'accepted', true,
    'revived_entries', revived_entries,
    'message', '備份已安全補入帳本；有效既有資料未覆寫，已收起且存在於備份的帳頁會重新啟用。'
  );
end;
$$;

grant execute on function public.restore_ledger_backup_safe(jsonb) to authenticated;

-- 唯讀核對：成功後應顯示 5 個函式，皆已授予 authenticated 執行權。
select p.proname as "函式", has_function_privilege('authenticated', p.oid, 'execute') as "authenticated 可執行"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ledger_browse_summary', 'ledger_browse_page', 'ledger_tag_index', 'export_ledger_backup', 'restore_ledger_backup', 'restore_ledger_backup_safe')
order by p.proname;

commit;
