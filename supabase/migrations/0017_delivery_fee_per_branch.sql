-- Delivery fee, per Karim's choice: a price table keyed by branch (not a
-- flat site-wide number, not distance-calculated) - general_manager sets
-- it per branch from the existing branch management screen, defaults to 0
-- so nothing breaks/over-charges before he's filled real numbers in.

alter table public.branches
  add column if not exists delivery_fee numeric not null default 0;
