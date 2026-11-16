-- Read-only checks of the notification pipeline. Run in the SQL Editor; changes nothing.
-- Each row says what is missing. Setup: docs/notifications.md.
select check_name, ok, detail from (
  select 1 as step, 'Extensão pg_net' as check_name,
    exists(select 1 from pg_extension where extname = 'pg_net') as ok,
    'Execute supabase/notifications.sql' as detail
  union all
  select 2, 'Extensão pg_cron', exists(select 1 from pg_extension where extname = 'pg_cron'),
    'Execute supabase/notifications.sql'
  union all
  select 3, 'Tabela push_subscriptions', to_regclass('public.push_subscriptions') is not null,
    'Execute supabase/notifications.sql'
  union all
  select 4, 'Gatilho em split_entries',
    exists(select 1 from pg_trigger where tgname = 'split_entries_push' and not tgisinternal),
    'Execute supabase/notifications.sql (depois de splits.sql)'
  union all
  select 5, 'Segredo push_function_url no Vault',
    exists(select 1 from vault.decrypted_secrets where name = 'push_function_url'),
    coalesce((select 'Valor: ' || decrypted_secret from vault.decrypted_secrets where name = 'push_function_url'),
      'Crie com vault.create_secret (passo 4)')
  union all
  select 6, 'Segredo push_secret no Vault',
    exists(select 1 from vault.decrypted_secrets where name = 'push_secret'),
    'Deve ser igual ao PUSH_SECRET da Edge Function'
) checks order by step;

-- Devices (needs the table from step 3). Nobody with Divisões on = nobody to notify.
select count(*) filter (where splits) as dispositivos_com_divisoes,
       count(distinct user_id) filter (where splits) as contas_com_divisoes,
       count(*) as dispositivos_no_total,
       max(updated_at) as ultima_atualizacao
  from public.push_subscriptions;

-- Last calls from the database to the function (status 200 = ok, 401 = PUSH_SECRET differs
-- from the Vault, 404 = function not deployed, 500 = see the function's logs).
select id, status_code, left(coalesce(error_msg, content::text), 200) as resposta, created
  from net._http_response order by id desc limit 10;
