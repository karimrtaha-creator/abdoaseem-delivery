-- Finding #002 (security audit, 2026-08-11): none of the 4 storage
-- buckets had file_size_limit/allowed_mime_types set - confirmed live via
-- `select * from storage.buckets` (both columns null on all 4). The
-- frontend's accept="image/*" is a UI hint only, trivially bypassed with
-- a direct API call.
--
-- Traced every upload call site in the codebase before picking these
-- values (not guessed): every single one uploads with contentType
-- image/jpeg (or whatever the browser reports for an image/* input) and
-- every read site renders the result in an <img> tag - there is no PDF,
-- no video, nothing but photos anywhere in this system's actual usage.
-- 5MB is generous headroom over a real phone photo (typically 1-3MB).
--
-- 'receipts' has zero live upload call sites right now (that step was
-- removed from dispatch-order's UI earlier in this project) but gets the
-- same constraint defensively in case it's ever revived - same shape as
-- the other 3, no reason to leave it wide open in the meantime.
update storage.buckets
set file_size_limit = 5242880, -- 5 MiB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('receipts', 'payment-proofs', 'menu-images', 'branch-images');
