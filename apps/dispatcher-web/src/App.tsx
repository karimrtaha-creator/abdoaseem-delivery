import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useProfile } from "./lib/useProfile";
import { Login } from "./pages/Login";
import { Dispatch } from "./pages/Dispatch";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { profile, loading: profileLoading } = useProfile(session);

  if (sessionLoading || (session && profileLoading)) {
    return <p className="muted centered-page">جاري التحميل...</p>;
  }

  if (!session) return <Login />;

  if (!profile || !profile.is_active) {
    return (
      <div className="centered-page">
        <div className="card">
          <p className="error-text">الحساب ده مش مفعّل أو مش موجود. كلم المدير العام.</p>
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            تسجيل خروج
          </button>
        </div>
      </div>
    );
  }

  if (profile.role !== "dispatcher") {
    return (
      <div className="centered-page">
        <div className="card">
          <p className="error-text">
            الشاشة دي مخصصة لموظف الديسباتشر فقط. الدور الحالي: {profile.role}
          </p>
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            تسجيل خروج
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ديسباتشر - {profile.name}</h1>
        <button className="btn-link" onClick={() => supabase.auth.signOut()}>
          تسجيل خروج
        </button>
      </header>
      <main>
        <Dispatch profile={profile} />
      </main>
    </div>
  );
}
