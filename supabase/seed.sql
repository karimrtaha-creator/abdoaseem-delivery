-- Reference-data seed from spec section 10 ("جاهز ليُدخل مباشرة"). Applied
-- live via the REST API on 2026-08-03 because menu_categories/menu_items/
-- combo_offers were empty even though branches/regions/sla_tiers already
-- had data - this file exists so the same seed can be replayed (e.g. after
-- `supabase db reset` in local dev) instead of only living in the live DB.
--
-- branches/regions/sla_tiers are NOT included here - they already existed
-- before this project's migrations were written and are left untouched.

insert into public.menu_categories (name, display_order) values
  ('الكشري', 1),
  ('الطواجن', 2),
  ('الحلو', 3),
  ('المشروبات', 4),
  ('اضافات', 5)
on conflict do nothing;

insert into public.menu_items (category_id, name, price, is_available)
select c.id, v.name, v.price, true
from (values
  ('الكشري', 'علبة كشري صغيرة', 30),
  ('الكشري', 'علبة كشري وسط', 38),
  ('الكشري', 'علبة كشري كبيرة', 48),
  ('الكشري', 'علبة كشري جامبو', 60),
  ('الكشري', 'وجبة عالم سمسم (كشري + عصير)', 50),

  ('الطواجن', 'طاجن فراخ', 60),
  ('الطواجن', 'طاجن فراخ جامبو', 115),
  ('الطواجن', 'طاجن لحم', 55),
  ('الطواجن', 'طاجن لحم جامبو', 105),
  ('الطواجن', 'طاجن خضار', 35),
  ('الطواجن', 'طاجن خضار جامبو', 65),
  ('الطواجن', 'مكس لحم', 80),
  ('الطواجن', 'مكس فراخ', 85),
  ('الطواجن', 'مكس لحم وفراخ', 110),
  ('الطواجن', 'مكس خضار', 60),

  ('الحلو', 'أرز بلبن صغير', 20),
  ('الحلو', 'أرز بلبن قرن', 30),
  ('الحلو', 'أرز بلبن كبير', 25),
  ('الحلو', 'باكيت مكسرات', 15),

  ('المشروبات', 'كولا', 25),
  ('المشروبات', 'حمص الشام', 18),
  ('المشروبات', 'مياه معدنية', 8),

  ('اضافات', 'إضافة موتزريلا للطاجن', 30),
  ('اضافات', 'إضافة لحمة', 30),
  ('اضافات', 'إضافة فراخ', 35),
  ('اضافات', 'عدس/تقلية', 12),
  ('اضافات', 'حمص/صلصة', 12),
  ('اضافات', 'سلطة خضراء', 12),
  ('اضافات', 'طماطم بالثوم', 12),
  ('اضافات', 'شطة زيت بالطماطم', 12),
  ('اضافات', 'شطة زيت/عادية', 5),
  ('اضافات', 'دقة', 5),
  ('اضافات', 'خيار مخلل', 12),
  ('اضافات', 'توست', 12)
) as v(category_name, name, price)
join public.menu_categories c on c.name = v.category_name
on conflict do nothing;

-- "اتنين وواحدة ببلاش" is deliberately NOT here - per section 10 it isn't a
-- fixed-price row, it's cart logic (buy 2 same-size kosahri, 3rd free),
-- still unimplemented in apps/dispatcher-web's cart (see CallCenter.tsx).
insert into public.combo_offers (name, description, price, is_active) values
  ('كومبو الاحتفال 1', '2 علبة كشري + 10 توست + سلطة + 2 مكس كولا أو حلو', 99, true),
  ('كومبو الاحتفال 2', 'طاجن لحمة أو فراخ + 10 توست + سلطة + 2 مكس كولا', 130, true),
  ('كومبو الاحتفال 3', 'علبة كشري + طاجن لحمة أو فراخ + 10 توست + سلطة + 2 كولا أو حلو', 130, true)
on conflict do nothing;
