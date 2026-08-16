import { useEffect, useState } from "react";
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
  promo_video_url: string | null;
  promo_video_heading: string;
}

// Same singleton pattern as BusinessHoursCard above, targeting site_settings
// instead (migration 0063/0065) - lets Karim swap/remove the homepage promo
// video and edit its heading from here, no code change needed. Empty video
// link hides the whole section on the homepage (see customer-web Home.tsx).
function PromoVideoCard({ profile }: { profile: Profile }) {
  const [saved_, setSaved_] = useState<SiteSettingsRow | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [heading, setHeading] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function load() {
    const { data } = await supabase.from("site_settings").select("promo_video_url, promo_video_heading").eq("id", 1).maybeSingle();
    const row = data as SiteSettingsRow | null;
    setSaved_(row);
    setVideoUrl(row?.promo_video_url ?? "");
    setHeading(row?.promo_video_heading ?? "");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setError(null);
    setJustSaved(false);
    const trimmedHeading = heading.trim();
    if (!trimmedHeading) return setError("عنوان السكشن مينفعش يبقى فاضي");
    setSaving(true);
    const trimmedUrl = videoUrl.trim();
    const { error: updateError } = await supabase
      .from("site_settings")
      .update({ promo_video_url: trimmedUrl || null, promo_video_heading: trimmedHeading, updated_by: profile.id })
      .eq("id", 1);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setJustSaved(true);
    load();
  }

  if (loading) return <p className="muted">جاري التحميل...</p>;

  const dirty = videoUrl.trim() !== (saved_?.promo_video_url ?? "") || heading.trim() !== (saved_?.promo_video_heading ?? "");

  return (
    <div className="card">
      <h2>فيديو الصفحة الرئيسية</h2>
      <p className="muted">
        اللينك والعنوان اللي بيظهروا فوق فيديو الفيسبوك في صفحة الموقع الرئيسية. سيب خانة اللينك فاضية علشان تشيل
        الفيديو خالص من الموقع، أو حط لينك جديد بدل القديم عادي.
      </p>

      <label>
        عنوان السكشن
        <input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="شوفنا وإحنا بنطبخ" />
      </label>
      <label>
        لينك الفيديو (فيسبوك)
        <input
          type="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.facebook.com/.../videos/..."
        />
      </label>

      {error && <p className="error-text">{error}</p>}
      {justSaved && !dirty && <p className="muted">اتحفظ.</p>}

      <button className="btn-primary" disabled={saving || !dirty} onClick={save}>
        {saving ? "جاري الحفظ..." : "حفظ"}
      </button>
    </div>
  );
}
