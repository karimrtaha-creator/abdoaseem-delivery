import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

export function BusinessHours({ profile }: { profile: Profile }) {
  return (
    <div>
      <BusinessHoursCard profile={profile} />
      <PromoVideoCard profile={profile} />
    </div>
  );
}

interface BusinessHoursRow {
  opens_at: string;
  closes_at: string;
}

function BusinessHoursCard({ profile }: { profile: Profile }) {
  const [hours, setHours] = useState<BusinessHoursRow | null>(null);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    const { data } = await supabase.from("business_hours").select("opens_at, closes_at").eq("id", 1).maybeSingle();
    const row = data as BusinessHoursRow | null;
    if (row) {
      setHours(row);
      setOpensAt(row.opens_at.slice(0, 5));
      setClosesAt(row.closes_at.slice(0, 5));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    const { error: updateError } = await supabase
      .from("business_hours")
      .update({ opens_at: opensAt, closes_at: closesAt, updated_by: profile.id })
      .eq("id", 1);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSaved(true);
    load();
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  const dirty = hours && (opensAt !== hours.opens_at.slice(0, 5) || closesAt !== hours.closes_at.slice(0, 5));

  return (
    <div className="card">
      <h2>مواعيد استقبال الأوردرات</h2>
      <p className="muted">
        الموقع والكول سنتر مش هيقبلوا أوردرات جديدة برا المواعيد دي. لو المواعيد بتعدي نص الليل (زي 8 الصبح لحد 3
        الفجر)، اكتب وقت القفل كوقت الصبح بعد نص الليل عادي.
      </p>

      <label>
        من الساعة
        <input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
      </label>
      <label>
        لحد الساعة
        <input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}
      {saved && !dirty && <p className="muted">اتحفظ.</p>}

      <button className="btn-primary" disabled={saving || !dirty} onClick={save}>
        {saving ? "جاري الحفظ..." : "حفظ المواعيد"}
      </button>
    </div>
  );
}

interface SiteSettingsRow {
  promo_video_heading: string;
}

interface PromoVideo {
  id: number;
  video_url: string;
  created_at: string;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as any,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  return data as T;
}

// Heading still lives on the site_settings singleton (0063); the videos
// themselves are now a list (0067) - add as many Facebook links as
// needed, or upload a video file directly (0068) when a link is awkward
// to get. Empty list hides the whole section on the homepage (see
// customer-web Home.tsx).
function PromoVideoCard({ profile }: { profile: Profile }) {
  const [videos, setVideos] = useState<PromoVideo[]>([]);
  const [savedHeading, setSavedHeading] = useState("");
  const [heading, setHeading] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingHeading, setSavingHeading] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSavedHeading, setJustSavedHeading] = useState(false);

  async function load() {
    const [{ data: settingsData }, { data: videosData }] = await Promise.all([
      supabase.from("site_settings").select("promo_video_heading").eq("id", 1).maybeSingle(),
      supabase.from("promo_videos").select("id, video_url, created_at").order("created_at"),
    ]);
    const settingsRow = settingsData as SiteSettingsRow | null;
    setSavedHeading(settingsRow?.promo_video_heading ?? "");
    setHeading(settingsRow?.promo_video_heading ?? "");
    setVideos((videosData as PromoVideo[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveHeading() {
    setError(null);
    setJustSavedHeading(false);
    const trimmedHeading = heading.trim();
    if (!trimmedHeading) return setError("عنوان السكشن مينفعش يبقى فاضي");
    setSavingHeading(true);
    const { error: updateError } = await supabase
      .from("site_settings")
      .update({ promo_video_heading: trimmedHeading, updated_by: profile.id })
      .eq("id", 1);
    setSavingHeading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setJustSavedHeading(true);
    load();
  }

  async function addLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedUrl = newVideoUrl.trim();
    if (!trimmedUrl) return setError("اكتب لينك الفيديو");
    setAddingLink(true);
    const { error: insertError } = await supabase.from("promo_videos").insert({ video_url: trimmedUrl, created_by: profile.id });
    setAddingLink(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewVideoUrl("");
    load();
  }

  async function uploadFile(file: File) {
    setError(null);
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await callFunction("upload-video", formData);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل رفع الفيديو");
    } finally {
      setUploadingFile(false);
    }
  }

  async function removeVideo(video: PromoVideo) {
    if (!confirm("متأكد إنك عايز تشيل الفيديو ده من الصفحة الرئيسية؟")) return;
    setDeletingId(video.id);
    setError(null);
    const { error: deleteError } = await supabase.from("promo_videos").delete().eq("id", video.id);
    setDeletingId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    load();
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  const headingDirty = heading.trim() !== savedHeading;

  return (
    <div className="card">
      <h2>فيديوهات الصفحة الرئيسية</h2>
      <p className="muted">
        العنوان اللي بيظهر فوق الفيديوهات في صفحة الموقع الرئيسية، وقائمة الفيديوهات نفسها - تقدر تضيف أكتر من
        لينك فيسبوك، أو ترفع فيديو من جهازك مباشرة لو اللينك صعب. امسح كل الفيديوهات علشان تشيل السكشن كله من
        الموقع.
      </p>

      <label>
        عنوان السكشن
        <input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="شوفنا وإحنا بنطبخ" />
      </label>
      {error && <p className="error-text">{error}</p>}
      {justSavedHeading && !headingDirty && <p className="muted">اتحفظ.</p>}
      <button className="btn-primary" disabled={savingHeading || !headingDirty} onClick={saveHeading}>
        {savingHeading ? "جاري الحفظ..." : "حفظ العنوان"}
      </button>

      <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
        <p className="muted" style={{ margin: "0 0 8px" }}>الفيديوهات ({videos.length})</p>
        {videos.length === 0 && <p className="muted">مفيش فيديوهات مضافة لسه.</p>}
        {videos.map((v) => (
          <div key={v.id} className="actions-cell" style={{ alignItems: "center", marginBottom: 6 }}>
            <span dir="ltr" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "360px" }}>
              {v.video_url}
            </span>
            <button className="btn-sm btn-link" style={{ color: "var(--color-alert)" }} disabled={deletingId === v.id} onClick={() => removeVideo(v)}>
              {deletingId === v.id ? "جاري الحذف..." : "حذف"}
            </button>
          </div>
        ))}

        <form onSubmit={addLink} className="actions-cell" style={{ marginTop: 8 }}>
          <input
            type="url"
            dir="ltr"
            style={{ flex: 1, minWidth: "220px" }}
            value={newVideoUrl}
            onChange={(e) => setNewVideoUrl(e.target.value)}
            placeholder="https://www.facebook.com/.../videos/..."
          />
          <button className="btn-sm btn-primary" type="submit" disabled={addingLink}>
            {addingLink ? "جاري الإضافة..." : "+ إضافة لينك"}
          </button>
        </form>

        <label className="btn-sm btn-primary" style={{ cursor: "pointer", display: "inline-block", marginTop: 8 }}>
          {uploadingFile ? "جاري الرفع..." : "أو ارفع فيديو من جهازك (حد أقصى 25 ميجا)"}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            style={{ display: "none" }}
            disabled={uploadingFile}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
