-- 執行位置：Supabase Dashboard → SQL Editor → New query → 貼上全部內容後 Run。
-- 本檔新增兩種明確操作：
-- 1. 永久清除已收起帳頁：只會刪除 deleted_at 非空的帳頁，無法復原。
-- 2. 還原至備份快照：以備份中的有效帳頁、憑據、品項與規則覆寫目前固定共用帳本。
-- 執行前請讓玉瑟與石琴兩台裝置皆完成同步，並先另外下載一份最新完整備份。

begin;

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
declare current_household public.households;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then raise exception '無帳本權限'; end if;
  select * into current_household from public.households where id = p_household_id;
  if current_household.id is null or current_household.title <> '歲時錄 · Vellum Tides' then raise exception '僅能典藏固定共用帳本'; end if;

  return jsonb_build_object(
    'format', 'vellum-tides/ledger-backup', 'version', 1, 'exported_at', now(),
    'household', jsonb_build_object('title', current_household.title),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', hm.user_id, 'display_name', hm.display_name) order by hm.display_name) from public.household_members hm where hm.household_id = p_household_id), '[]'::jsonb),
    'ledger_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', le.id, 'direction', le.direction, 'major', le.major, 'title', le.title, 'amount', le.amount,
        'occurred_on', le.occurred_on, 'tags', le.tags, 'note', le.note, 'handled_by', le.handled_by,
        'created_by', le.created_by, 'updated_by', le.updated_by, 'updated_at_ms', le.updated_at_ms,
        'device_id', le.device_id, 'deleted_at', null, 'source_invoice_item_id', le.source_invoice_item_id,
        'created_at', le.created_at, 'updated_at', le.updated_at
      ) order by le.occurred_on desc, le.updated_at_ms desc, le.id desc)
      from public.ledger_entries le where le.household_id = p_household_id and le.deleted_at is null
    ), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'random_code', i.random_code,
      'seller_name', i.seller_name, 'total_amount', i.total_amount, 'source', i.source, 'raw_payload', i.raw_payload,
      'image_storage_key', i.image_storage_key, 'state', i.state, 'created_by', i.created_by, 'created_at', i.created_at, 'updated_at', i.updated_at
    ) order by i.created_at desc, i.id desc) from public.invoices i where i.household_id = p_household_id), '[]'::jsonb),
    'invoice_items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ii.id, 'invoice_id', ii.invoice_id, 'title', ii.title, 'quantity', ii.quantity, 'unit_price', ii.unit_price,
      'amount', ii.amount, 'major', ii.major, 'tags', ii.tags, 'handled_by', ii.handled_by,
      'classification_confirmed', ii.classification_confirmed, 'created_at', ii.created_at
    ) order by ii.created_at desc, ii.id desc) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id where i.household_id = p_household_id), '[]'::jsonb),
    'keyword_rules', coalesce((select jsonb_agg(jsonb_build_object(
      'id', kr.id, 'keyword', kr.keyword, 'major', kr.major, 'suggested_tags', kr.suggested_tags,
      'priority', kr.priority, 'active', kr.active, 'created_at', kr.created_at
    ) order by kr.priority desc, kr.keyword asc) from public.keyword_rules kr where kr.household_id = p_household_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.purge_deleted_ledger_entries()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare shared_household uuid; removed_entries integer := 0;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select hm.household_id into shared_household
  from public.household_members hm
  where hm.user_id in ('f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid)
  group by hm.household_id having count(distinct hm.user_id) = 2 order by min(hm.joined_at) limit 1;
  if shared_household is null or not public.is_household_member(shared_household) then raise exception '找不到固定共用帳本'; end if;
  delete from public.ledger_entries le where le.household_id = shared_household and le.deleted_at is not null;
  get diagnostics removed_entries = row_count;
  return jsonb_build_object('accepted', true, 'purged_entries', removed_entries);
end;
$$;

-- 安全補入不覆寫仍有效帳頁；若備份內的有效帳頁目前僅被收起，則重新啟用它。
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
  if coalesce((base_result->>'accepted')::boolean, false) is not true then return base_result; end if;

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

  return base_result || jsonb_build_object('accepted', true, 'revived_entries', revived_entries, 'message', '備份已安全補入帳本；有效既有資料未覆寫，已收起且存在於備份的帳頁會重新啟用。');
end;
$$;

create or replace function public.restore_ledger_backup_snapshot(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  shared_household uuid;
  allowed_users uuid[] := array['f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid];
  removed_entries integer := 0; removed_invoices integer := 0; removed_items integer := 0; removed_rules integer := 0;
  restored_entries integer := 0; restored_invoices integer := 0; restored_items integer := 0; restored_rules integer := 0;
begin
  if auth.uid() is null or not (auth.uid() = any(allowed_users)) then raise exception '此帳頁僅限玉瑟與石琴登入'; end if;
  if p_payload->>'format' <> 'vellum-tides/ledger-backup' or (p_payload->>'version')::integer <> 1 then raise exception '備份檔格式或版本不符'; end if;
  if p_payload->'household'->>'title' <> '歲時錄 · Vellum Tides' then raise exception '備份帳本名稱不符'; end if;
  select hm.household_id into shared_household from public.household_members hm where hm.user_id = any(allowed_users) group by hm.household_id having count(distinct hm.user_id) = 2 order by min(hm.joined_at) limit 1;
  if shared_household is null or not public.is_household_member(shared_household) then raise exception '找不到固定共用帳本'; end if;

  delete from public.ledger_entries le
  where le.household_id = shared_household
    and not exists (select 1 from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value where value->>'id' = le.id::text and nullif(value->>'deleted_at', '') is null);
  get diagnostics removed_entries = row_count;
  delete from public.invoices i
  where i.household_id = shared_household
    and not exists (select 1 from jsonb_array_elements(coalesce(p_payload->'invoices', '[]'::jsonb)) value where value->>'id' = i.id::text);
  get diagnostics removed_invoices = row_count;
  delete from public.invoice_items ii
  using public.invoices i
  where ii.invoice_id = i.id and i.household_id = shared_household
    and not exists (select 1 from jsonb_array_elements(coalesce(p_payload->'invoice_items', '[]'::jsonb)) value where value->>'id' = ii.id::text);
  get diagnostics removed_items = row_count;
  delete from public.keyword_rules kr
  where kr.household_id = shared_household
    and not exists (select 1 from jsonb_array_elements(coalesce(p_payload->'keyword_rules', '[]'::jsonb)) value where value->>'id' = kr.id::text);
  get diagnostics removed_rules = row_count;

  with restored as (
    insert into public.invoices (id, household_id, invoice_number, invoice_date, random_code, seller_name, total_amount, source, raw_payload, image_storage_key, state, created_by, created_at, updated_at)
    select (value->>'id')::uuid, shared_household, nullif(value->>'invoice_number', ''), nullif(value->>'invoice_date', '')::date, nullif(value->>'random_code', ''), coalesce(value->>'seller_name', ''), coalesce((value->>'total_amount')::numeric, 0), (value->>'source')::text, coalesce(value->'raw_payload', '{}'::jsonb), nullif(value->>'image_storage_key', ''), (value->>'state')::public.invoice_state, case when value->>'created_by' ~* '^[0-9a-f-]{36}$' and (value->>'created_by')::uuid = any(allowed_users) then (value->>'created_by')::uuid else auth.uid() end, coalesce(nullif(value->>'created_at', '')::timestamptz, now()), coalesce(nullif(value->>'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'invoices', '[]'::jsonb)) value
    on conflict (id) do update set invoice_number = excluded.invoice_number, invoice_date = excluded.invoice_date, random_code = excluded.random_code, seller_name = excluded.seller_name, total_amount = excluded.total_amount, source = excluded.source, raw_payload = excluded.raw_payload, image_storage_key = excluded.image_storage_key, state = excluded.state, created_by = excluded.created_by, created_at = excluded.created_at, updated_at = excluded.updated_at
    returning 1
  ) select count(*) into restored_invoices from restored;

  with restored as (
    insert into public.invoice_items (id, invoice_id, title, quantity, unit_price, amount, major, tags, handled_by, classification_confirmed, created_at)
    select (value->>'id')::uuid, (value->>'invoice_id')::uuid, coalesce(value->>'title', ''), coalesce((value->>'quantity')::numeric, 1), coalesce((value->>'unit_price')::numeric, 0), coalesce((value->>'amount')::numeric, 0), nullif(value->>'major', '')::public.ledger_major, coalesce(array(select jsonb_array_elements_text(coalesce(value->'tags', '[]'::jsonb))), '{}'::text[]), case when value->>'handled_by' ~* '^[0-9a-f-]{36}$' and (value->>'handled_by')::uuid = any(allowed_users) then (value->>'handled_by')::uuid else null end, coalesce((value->>'classification_confirmed')::boolean, false), coalesce(nullif(value->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'invoice_items', '[]'::jsonb)) value
    join public.invoices i on i.id = (value->>'invoice_id')::uuid and i.household_id = shared_household
    on conflict (id) do update set invoice_id = excluded.invoice_id, title = excluded.title, quantity = excluded.quantity, unit_price = excluded.unit_price, amount = excluded.amount, major = excluded.major, tags = excluded.tags, handled_by = excluded.handled_by, classification_confirmed = excluded.classification_confirmed, created_at = excluded.created_at
    returning 1
  ) select count(*) into restored_items from restored;

  with restored as (
    insert into public.ledger_entries (id, household_id, direction, major, title, amount, occurred_on, tags, note, handled_by, created_by, updated_by, updated_at_ms, device_id, deleted_at, source_invoice_item_id, created_at, updated_at)
    select (value->>'id')::uuid, shared_household, (value->>'direction')::public.ledger_direction, (value->>'major')::public.ledger_major, coalesce(value->>'title', ''), (value->>'amount')::numeric, (value->>'occurred_on')::date, coalesce(array(select jsonb_array_elements_text(coalesce(value->'tags', '[]'::jsonb))), '{}'::text[]), coalesce(value->>'note', ''), case when value->>'handled_by' ~* '^[0-9a-f-]{36}$' and (value->>'handled_by')::uuid = any(allowed_users) then (value->>'handled_by')::uuid else auth.uid() end, case when value->>'created_by' ~* '^[0-9a-f-]{36}$' and (value->>'created_by')::uuid = any(allowed_users) then (value->>'created_by')::uuid else auth.uid() end, case when value->>'updated_by' ~* '^[0-9a-f-]{36}$' and (value->>'updated_by')::uuid = any(allowed_users) then (value->>'updated_by')::uuid else auth.uid() end, (value->>'updated_at_ms')::bigint, coalesce(nullif(value->>'device_id', ''), 'backup-snapshot'), null, case when value->>'source_invoice_item_id' ~* '^[0-9a-f-]{36}$' and exists (select 1 from public.invoice_items ii where ii.id = (value->>'source_invoice_item_id')::uuid) then (value->>'source_invoice_item_id')::uuid else null end, coalesce(nullif(value->>'created_at', '')::timestamptz, now()), coalesce(nullif(value->>'updated_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'ledger_entries', '[]'::jsonb)) value
    where nullif(value->>'deleted_at', '') is null
    on conflict (id) do update set direction = excluded.direction, major = excluded.major, title = excluded.title, amount = excluded.amount, occurred_on = excluded.occurred_on, tags = excluded.tags, note = excluded.note, handled_by = excluded.handled_by, created_by = excluded.created_by, updated_by = excluded.updated_by, updated_at_ms = excluded.updated_at_ms, device_id = excluded.device_id, deleted_at = null, source_invoice_item_id = excluded.source_invoice_item_id, created_at = excluded.created_at, updated_at = excluded.updated_at
    returning 1
  ) select count(*) into restored_entries from restored;

  with restored as (
    insert into public.keyword_rules (id, household_id, keyword, major, suggested_tags, priority, active, created_at)
    select (value->>'id')::uuid, shared_household, value->>'keyword', (value->>'major')::public.ledger_major, coalesce(array(select jsonb_array_elements_text(coalesce(value->'suggested_tags', '[]'::jsonb))), '{}'::text[]), coalesce((value->>'priority')::integer, 0), coalesce((value->>'active')::boolean, true), coalesce(nullif(value->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload->'keyword_rules', '[]'::jsonb)) value
    on conflict (id) do update set keyword = excluded.keyword, major = excluded.major, suggested_tags = excluded.suggested_tags, priority = excluded.priority, active = excluded.active, created_at = excluded.created_at
    returning 1
  ) select count(*) into restored_rules from restored;

  return jsonb_build_object('accepted', true, 'snapshot', true, 'restored_entries', restored_entries, 'restored_invoices', restored_invoices, 'restored_items', restored_items, 'restored_rules', restored_rules, 'removed_entries', removed_entries, 'removed_invoices', removed_invoices, 'removed_items', removed_items, 'removed_rules', removed_rules, 'message', '帳本已還原至備份快照。');
end;
$$;

grant execute on function public.ledger_tag_index(uuid) to authenticated;
grant execute on function public.export_ledger_backup(uuid) to authenticated;
grant execute on function public.purge_deleted_ledger_entries() to authenticated;
grant execute on function public.restore_ledger_backup_safe(jsonb) to authenticated;
grant execute on function public.restore_ledger_backup_snapshot(jsonb) to authenticated;

commit;
