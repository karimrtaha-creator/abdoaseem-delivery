import { FormEvent, useState } from "react";
import { supabase } from "../supabaseClient";
import { phoneToStaffEmail } from "../lib/phoneAuth";

export function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // Routed through the login edge function (security audit finding
    // M-01) instead of calling signInWithPassword directly, so a
    // server-side per-account attempt limit can actually apply - nothing
    // else about this flow changed, same synthetic email, same generic
    // error message on any failure.
    const { data, error: fnError } = await supabase.functions.invoke("login", {
      body: { email: phoneToStaffEmail(phone), password },
    });
    if (fnError) {
      setSubmitting(false);
      setError("رقم التليفون أو الباسورد غلط");
      return;
    }
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    setSubmitting(false);
    if (error) setError("رقم التليفون أو الباسورد غلط");
  }

  // Staff Registration feature (2026-08-11) - a new employee applying for
  // an account, not an existing staff member logging in. Same Google
  // provider already configured for customer-web (project-wide, not
  // per-app) - App.tsx's post-login gate routes a fresh role='customer'
  // session here into the registration form.
  async function handleGoogleSignUp() {
    setError(null);
    setGoogleBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setGoogleBusy(false);
    }
    // On success the browser redirects to Google - no further code runs here.
  }

  return (
    <div className="centered-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>تسجيل دخول الموظفين</h1>
        <label>
          رقم التليفون
          <input
            type="tel"
            inputMode="numeric"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01xxxxxxxxx"
            autoFocus
          />
        </label>
        <label>
          الباسورد
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary btn-large">
          {submitting ? "جاري الدخول..." : "دخول"}
        </button>
        <div className="inline-row" style={{ justifyContent: "center", margin: "12px 0" }}>
          <span className="muted">أو</span>
        </div>
        <button
          type="button"
          className="btn-link btn-large"
          disabled={googleBusy}
          onClick={handleGoogleSignUp}
        >
          {googleBusy ? "جاري التحويل لجوجل..." : "موظف جديد؟ سجّل بحساب جوجل"}
        </button>
      </form>
    </div>
  );
}
