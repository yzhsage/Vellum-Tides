-- 歲時錄 V2｜固定共用帳本修復
-- 目的：玉瑟與石琴登入後一律讀寫同一個帳本，不再需要建立帳本、邀請碼或加入流程。
-- 安全原則：若已存在兩本各自含有資料的帳本，腳本會停止並回報，不會自動搬移或刪除任何帳頁／發票。
-- 執行位置：Supabase Dashboard → SQL Editor → New query → 貼上全部內容後 Run。

begin;

do $$
declare
  jade uuid := 'f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid;
  stone uuid := '9108138a-e103-435b-a0c0-643e3af400ec'::uuid;
  shared_household uuid;
  other_household uuid;
  other_has_data boolean;
begin
  if not exists (select 1 from auth.users where id = jade) or not exists (select 1 from auth.users where id = stone) then
    raise exception '找不到玉瑟或石琴的固定登入帳號；請先在 Authentication → Users 建立兩個帳號。';
  end if;

  -- 優先沿用已同時包含玉瑟與石琴的帳本；這正是既有共同資料所在，完全不搬動資料。
  select hm.household_id into shared_household
  from public.household_members hm
  where hm.user_id in (jade, stone)
  group by hm.household_id
  having count(distinct hm.user_id) = 2
  order by min(hm.joined_at)
  limit 1;

  -- 若尚未形成雙人成員帳本，只在「另一個帳本沒有帳頁或發票」時安全補成同一冊。
  if shared_household is null then
    select hm.household_id into shared_household
    from public.household_members hm
    where hm.user_id = jade
    order by hm.joined_at
    limit 1;

    if shared_household is null then
      select hm.household_id into shared_household
      from public.household_members hm
      where hm.user_id = stone
      order by hm.joined_at
      limit 1;
    end if;

    if shared_household is null then
      insert into public.households (title, owner_id)
      values ('歲時錄 · Vellum Tides', jade)
      returning id into shared_household;
    end if;

    select hm.household_id into other_household
    from public.household_members hm
    where hm.user_id in (jade, stone) and hm.household_id <> shared_household
    order by hm.joined_at
    limit 1;

    if other_household is not null then
      select exists(
        select 1 from public.ledger_entries where household_id = other_household
        union all
        select 1 from public.invoices where household_id = other_household
      ) into other_has_data;
      if other_has_data then
        raise exception '偵測到另一冊已有帳頁或憑據，為避免誤搬資料而未變更。請先回報此訊息，再決定合併方式。';
      end if;
    end if;

    insert into public.household_members (household_id, user_id, display_name, role)
    values
      (shared_household, jade, '玉瑟', 'keeper'),
      (shared_household, stone, '石琴', 'companion')
    on conflict (household_id, user_id) do update set
      display_name = excluded.display_name,
      role = excluded.role;
  end if;

  update public.households set title = '歲時錄 · Vellum Tides' where id = shared_household;
  update public.household_members set display_name = case user_id when jade then '玉瑟' when stone then '石琴' end
  where household_id = shared_household and user_id in (jade, stone);
end;
$$;

create or replace function public.ensure_personal_household(p_title text default '歲時錄 · Vellum Tides')
returns uuid language plpgsql security definer set search_path = public as $$
declare shared_household uuid;
begin
  if auth.uid() not in ('f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid) then
    raise exception '此帳頁僅限玉瑟與石琴登入。';
  end if;
  select hm.household_id into shared_household
  from public.household_members hm
  where hm.user_id in ('f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid)
  group by hm.household_id
  having count(distinct hm.user_id) = 2
  order by min(hm.joined_at)
  limit 1;
  if shared_household is null then
    raise exception '固定共用帳本尚未完成設定；請在 SQL Editor 執行 歲時錄-v2-固定共用帳本.sql。';
  end if;
  return shared_household;
end;
$$;

grant usage on schema public to authenticated;
grant execute on function public.ensure_personal_household(text) to authenticated;
grant select on table public.households, public.household_members, public.ledger_entries, public.invoices, public.invoice_items, public.keyword_rules, public.sync_events to authenticated;
grant insert on table public.invoices to authenticated;
grant insert, update on table public.invoice_items to authenticated;

-- 唯讀核對結果：應只有一列，且兩位成員與所有帳頁、待確認憑據都會指向同一個 household_id。
select
  h.id as "共用帳本 ID",
  h.title as "帳本名稱",
  array_agg(hm.display_name order by hm.display_name) filter (where hm.user_id in ('f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid)) as "成員",
  (select count(*) from public.ledger_entries le where le.household_id = h.id and le.deleted_at is null) as "現有帳頁",
  (select count(*) from public.invoices i where i.household_id = h.id and i.state = 'awaiting_confirmation') as "待確認憑據"
from public.households h
join public.household_members hm on hm.household_id = h.id
where h.id in (
  select household_id from public.household_members where user_id in ('f4eadea9-c5d4-476a-9996-cc9591a6d43e'::uuid, '9108138a-e103-435b-a0c0-643e3af400ec'::uuid)
  group by household_id having count(distinct user_id) = 2
)
group by h.id, h.title;

commit;
