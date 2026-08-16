-- Karim wants an "upload a video file" fallback for the homepage promo
-- video list (0067) alongside pasting a Facebook link, same idea as
-- branch-images (0027) - public bucket, upload only through a server-side
-- edge function that validates real file bytes (see upload-video, mirrors
-- upload-image's 0060 lockdown from day one rather than opening a direct
-- client write policy and closing it later). 25MB covers a short promo
-- clip; kept well below Facebook-link territory on purpose since every
-- uploaded byte is real paid storage, unlike an embedded link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('promo-videos', 'promo-videos', true, 26214400, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
