-- branches currently has no address field at all (only areas_covered,
-- which is null on every row and was never populated). Adds address +
-- photo_url so customer-web can show a real branches page. photo_url stays
-- null for now - Karim hasn't sent the 13 branch photos yet; whoever fills
-- it in later just needs general_manager access, already covered by the
-- existing branches_write_general_manager policy from 0001 (no new RLS
-- needed).
--
-- address is seeded below straight from Karim's message - matched to the
-- existing 13 branch rows by exact name. Idempotent: re-running just
-- overwrites with the same values.

alter table public.branches
  add column if not exists address text,
  add column if not exists photo_url text;

update public.branches set address = 'الأوتوستراد تقاطع أحمد فخري - أمام دار الحرب الإلكترونية' where name = 'أحمد فخري';
update public.branches set address = 'مكرم عبيد المتفرع تقاطع مصطفى النحاس - أمام محجوب' where name = 'مكرم';
update public.branches set address = 'شارع الخمسين - أمام بنزينة وطنية' where name = 'زهراء المعادي';
update public.branches set address = 'شارع 7 - أمام مترو المعادي' where name = 'شارع 7';
update public.branches set address = 'شارع 9 - أمام مترو المعادي' where name = 'شارع 9';
update public.branches set address = 'بنزينة A1 على الدائري - مدخل الهضبة الوسطى' where name = 'الهضبة الوسطى';
update public.branches set address = 'شارع حيدر فرع المروة - أمام عمارات المروة' where name = 'المروة';
update public.branches set address = 'شارع حيدر - بجوار مول القصر' where name = 'حيدر';
update public.branches set address = 'شارع شريف - أمام مسجد شاهين' where name = 'شريف';
update public.branches set address = '25 شارع المراغي تقاطع شارع حيدر' where name = 'المراغي';
update public.branches set address = 'قريبًا' where name = 'مايو';
update public.branches set address = '100 زهراء عين شمس - بجوار مسجد الغباشي' where name = 'زهراء عين شمس';
update public.branches set address = '120 جسر السويس - ميدان الألف مسكن - أمام محطة المترو' where name = 'الألف مسكن';
