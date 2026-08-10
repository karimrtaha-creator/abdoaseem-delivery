-- Wires up the "المندوب قريب منك" cron job, same pattern as 0022's
-- check-sla-breaches job - reuses the same 'cron_secret' already in
-- Vault, no new secret needed. A minute is frequent enough to feel
-- "live" to the customer without hammering the driver-location table on
-- every single delivery.
select cron.schedule(
  'check-driver-proximity-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://jugaubxwmlszkfqlnzul.supabase.co/functions/v1/check-driver-proximity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
