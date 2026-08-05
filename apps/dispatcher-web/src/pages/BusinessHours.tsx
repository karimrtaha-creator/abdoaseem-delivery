import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import type { Profile } from "../lib/useProfile";

interface BusinessHoursRow {
  opens_at: string;
  closes_at: string;
}

export function BusinessHours({ profile }: { profile: Profile }) {
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
