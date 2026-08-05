import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function Settings() {
  const { session, profile, loading: authLoading, completeProfile } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) navigate("/login");
  }, [authLoading, session, navigate]);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setPhone(profile.phone ?? "");
    }
  }, [profile]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!name.trim()) return setError("اكتب اسمك");
    if (!/^01[0-9]{9}$/.test(phone.replace(/\D/g, ""))) {
      return setError("اكتب رقم موبايل مصري صحيح (01xxxxxxxxx)");
    }
    setSaving(true);
    try {
      // Reuses the same completeProfile that already handles the Google
      // signup "no phone yet" flow (AuthContext) - it's just "update my
      // own name/phone" either way, no separate path needed.
      await completeProfile(name.trim(), phone);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ، جرب تاني");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !profile) {
    return (
      <div className="wrap section">
        <p className="muted">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" style={{ textDecoration: "none" }}>
            كشري الغباشي
          </Link>
          <Link to="/menu" className="btn btn-ghost">
            المنيو
          </Link>
        </div>
      </header>

      <div className="wrap section">
        <div className="auth-card" style={{ margin: "0 auto" }}>
          <h1>بياناتي</h1>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="settings-name">الاسم</label>
              <input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="settings-phone">رقم الموبايل</label>
              <input
                id="settings-phone"
                type="tel"
                inputMode="numeric"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
              />
            </div>
            {error && <span className="error-text">{error}</span>}
            {success && <p className="muted" style={{ textAlign: "center" }}>اتحفظ بنجاح</p>}
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
