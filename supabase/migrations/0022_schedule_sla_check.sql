-- Actually wires up the SLA-breach cron job. check-sla-breaches
-- (supabase/functions/check-sla-breaches) has existed since early in this
-- project but nothing was ever scheduled to call it - found during an
-- audit that "flip an order to delayed and alert managers when it blows
-- its SLA" was silently dormant in production the whole time.
--
-- The secret this job authenticates with lives only in Vault (created
-- out-of-band, never in a migration file) under the name 'cron_secret' -
-- this migration references it by name only, so the actual value never
-- appears in the repo or in `cron.job`'s stored command text beyond a
-- lookup expression.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'check-sla-breaches-every-2-min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://jugaubxwmlszkfqlnzul.supabase.co/functions/v1/check-sla-breaches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
