import { FormEvent, useState } from "react";
import { useAuth } from "../lib/AuthContext";

export function CompleteProfile() {
  const { session, needsPhone, completeProfile } = useAuth();
  const googleName = (session?.user.user_metadata?.full_name as string | undefined) ?? (session?.user.user_metadata?.name as string | undefined) ?? "";
  const [name, setName] = useState(googleName);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!needsPhone) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("اكتب اسمك");
      return;
    }
    if (!/^01[0-9]{9}$/.test(phone.replace(/\D/g, ""))) {
      setError("اكتب رقم موبايل مصري صحيح (01xxxxxxxxx)");
      return;
    }
    setSaving(true);
    try {
      await completeProfile(name.trim(), phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ، جرب تاني");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="auth-card">
        <h1>خطوة أخيرة</h1>
        <p className="muted">محتاجين اسمك ورقم موبايلك عشان نقدر نوصلك أوردرك</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="cp-name">الاسم</label>
            <input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك بالكامل" />
          </div>
          <div className="field">
            <label htmlFor="cp-phone">رقم الموبايل</label>
            <input
              id="cp-phone"
              type="tel"
              inputMode="numeric"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
            />
          </div>
          {error && <span className="error-text">{error}</span>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "لحظة..." : "تأكيد"}
          </button>
        </form>
      </div>
    </div>
  );
}
