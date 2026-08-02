-- Additive column needed by verify-otp to enforce the 3-attempt lockout
-- from spec section 5 (no schema in section 3 tracked attempts). Safe:
-- adds a column with a default, nothing existing is renamed or removed.
alter table public.otp_codes
  add column if not exists attempts int not null default 0;
