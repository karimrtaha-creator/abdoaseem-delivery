import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useProfile } from "./lib/useProfile";
import { Login } from "./pages/Login";
import { Dispatch } from "./pages/Dispatch";
import { CallCenter } from "./pages/CallCenter";
import { AcceptanceLobby } from "./pages/AcceptanceLobby";

const ROLE_TITLES: Record<string, string> = {
  dispatcher: "ديسباتشر",
  call_center: "كول سنتر",
  team_leader: "قبول الأوردرات - تيم ليدر",
  general_manager: "قبول الأوردرات - مدير عام",
};

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

  const roleTitle = ROLE_TITLES[profile.role];
  if (!roleTitle) {
    return (
      <div className="centered-page">
        <div className="card">
          <p className="error-text">
            الشاشة دي مش متاحة للدور ده. الدور الحالي: {profile.role}
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
        <h1>
          {roleTitle} - {profile.name}
        </h1>
        <button className="btn-link" onClick={() => supabase.auth.signOut()}>
          تسجيل خروج
        </button>
      </header>
      <main>
        {profile.role === "dispatcher" && <Dispatch profile={profile} />}
        {profile.role === "call_center" && <CallCenter />}
        {(profile.role === "team_leader" || profile.role === "general_manager") && <AcceptanceLobby />}
      </main>
    </div>
  );
}
