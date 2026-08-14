-- Security audit finding H-02 (2026-08-14): audit_log_select_general_manager
-- (0033) was created after 0021_backfill_is_active_checks.sql (which
-- retrofitted current_user_is_active() onto the tables that were missing
-- it at the time) and was never included in that or any later backfill.
-- Live-confirmed: a DB-deactivated GM's still-valid JWT could read
-- audit_log directly via PostgREST (a control request with the same
-- token against `orders`, whose policy already checks is_active,
-- correctly returned empty - proving the gap was audit_log-specific).
-- Matches the same pattern used by every other post-0006 staff policy.
drop policy if exists "audit_log_select_general_manager" on public.audit_log;
create policy "audit_log_select_general_manager"
  on public.audit_log for select
  to authenticated
  using (current_user_role()::text = 'general_manager' and current_user_is_active());
