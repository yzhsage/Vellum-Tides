-- 歲時錄 V2 唯讀核對：此檔不會寫入、修改或刪除資料。
with checks(label, ready) as (
  values
    ('資料表 ledger_entries', to_regclass('public.ledger_entries') is not null),
    ('資料表 invoices', to_regclass('public.invoices') is not null),
    ('資料表 invoice_items', to_regclass('public.invoice_items') is not null),
    ('資料表 keyword_rules', to_regclass('public.keyword_rules') is not null),
    ('帳頁 V2 欄位 direction／major／title／occurred_on／tags／handled_by', (
      select count(*) = 6 from information_schema.columns
      where table_schema = 'public' and table_name = 'ledger_entries'
        and column_name in ('direction', 'major', 'title', 'occurred_on', 'tags', 'handled_by')
    )),
    ('發票品項名目與符契欄位', (
      select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_items'
        and column_name in ('title', 'major', 'tags', 'handled_by')
    )),
    ('符契 GIN 索引', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'ledger_entries_tags_gin')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoice_items_tags_gin')),
    ('符契正規化觸發器', exists (select 1 from pg_trigger where tgname = 'normalise_ledger_entry_tags' and not tgisinternal)
      and exists (select 1 from pg_trigger where tgname = 'normalise_invoice_item_tags' and not tgisinternal)),
    ('帳頁流向／大目相容性約束', exists (select 1 from pg_constraint where conrelid = 'public.ledger_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%direction%major%')),
    ('帳頁 RLS 規則', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ledger_entries' and policyname = '成員可管理帳頁')),
    ('函式 public.apply_ledger_mutation(jsonb)', to_regprocedure('public.apply_ledger_mutation(jsonb)') is not null),
    ('函式 public.post_invoice(uuid)', to_regprocedure('public.post_invoice(uuid)') is not null)
)
select label as "核對項目", case when ready then '已就緒' else '缺少' end as "狀態"
from checks
order by label;
