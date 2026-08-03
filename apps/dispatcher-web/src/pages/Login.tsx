import { FormEvent, useState } from "react";
import { supabase } from "../supabaseClient";
import { phoneToStaffEmail } from "../lib/phoneAuth";

export function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToStaffEmail(phone),
      password,
    });
    setSubmitting(false);
    if (error) setError("رقم التليفون أو الباسورد غلط");
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
      </form>
    </div>
  );
}
