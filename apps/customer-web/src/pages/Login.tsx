import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signUp, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [googleBusy, setGoogleBusy] = useState(false);

  async function handleGoogle() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // browser redirects away to Google here - no further code runs
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ، جرب تاني");
      setGoogleBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^01[0-9]{9}$/.test(phone.replace(/\D/g, ""))) {
      setError("اكتب رقم موبايل مصري صحيح (01xxxxxxxxx)");
      return;
    }
    if (password.length < 6) {
      setError("الباسورد لازم يكون 6 أحرف على الأقل");
      return;
    }
    if (mode === "signup" && name.trim().length < 2) {
      setError("اكتب اسمك");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUp(phone, password, name.trim());
      } else {
        await signIn(phone, password);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصل خطأ، جرب تاني");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>كشري الغباشي</h1>
        <p className="muted">{mode === "signin" ? "سجّل دخول علشان تكمّل طلبك" : "اعمل حساب جديد"}</p>

        <div className="auth-toggle">
          <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
            تسجيل الدخول
          </button>
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
            حساب جديد
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="name">الاسم</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك بالكامل" />
            </div>
          )}
          <div className="field">
            <label htmlFor="phone">رقم الموبايل</label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
            />
          </div>
          <div className="field">
            <label htmlFor="password">الباسورد</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 أحرف على الأقل"
            />
          </div>

          {error && <span className="error-text">{error}</span>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "لحظة..." : mode === "signin" ? "دخول" : "إنشاء الحساب"}
          </button>
        </form>

        <div className="auth-divider">
          <span>أو</span>
        </div>

        <button type="button" className="btn btn-google" onClick={handleGoogle} disabled={googleBusy}>
          <GoogleIcon />
          {googleBusy ? "جاري التحويل لجوجل..." : "المتابعة بحساب جوجل"}
        </button>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
