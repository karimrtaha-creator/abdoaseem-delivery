import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useProfile, Profile } from "./lib/useProfile";
import { Login } from "./pages/Login";
import { Dispatch } from "./pages/Dispatch";
import { CallCenter } from "./pages/CallCenter";
import { AcceptanceLobby } from "./pages/AcceptanceLobby";
import { UserManagement } from "./pages/UserManagement";
import { Dashboard } from "./pages/Dashboard";
import { DriverPerformance } from "./pages/DriverPerformance";
import { Complaints } from "./pages/Complaints";
import { BranchManagement } from "./pages/BranchManagement";

type TabKey =
  | "dispatch"
  | "call_center"
  | "acceptance"
  | "users"
  | "dashboard"
  | "performance"
  | "complaints"
  | "branches";

const ROLE_TITLES: Record<string, string> = {
  dispatcher: "ديسباتشر",
  call_center: "كول سنتر",
  team_leader: "تيم ليدر",
  general_manager: "مدير عام",
  regional_manager: "مدير منطقة",
  branch_manager: "مدير فرع",
};

// Which tabs each role gets, in order. Purely a navigation/UX list - every
// screen behind these tabs still enforces its own scope via RLS/edge
// function checks regardless of what's offered here.
const TABS_BY_ROLE: Record<string, { key: TabKey; label: string }[]> = {
  dispatcher: [{ key: "dispatch", label: "الأوردرات" }],
  call_center: [{ key: "call_center", label: "أوردر جديد" }],
  team_leader: [{ key: "acceptance", label: "قبول الأوردرات" }],
  general_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "acceptance", label: "قبول الأوردرات" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "users", label: "إدارة المستخدمين" },
    { key: "branches", label: "الفروع والمناطق" },
  ],
  regional_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "users", label: "إدارة المستخدمين" },
  ],
  branch_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "users", label: "إدارة المستخدمين" },
  ],
};

function ScreenFor({ tab, profile }: { tab: TabKey; profile: Profile }) {
  switch (tab) {
    case "dispatch":
      return <Dispatch profile={profile} />;
    case "call_center":
      return <CallCenter />;
    case "acceptance":
      return <AcceptanceLobby />;
    case "users":
      return <UserManagement profile={profile} />;
    case "dashboard":
      return <Dashboard profile={profile} />;
    case "performance":
      return <DriverPerformance profile={profile} />;
    case "complaints":
      return <Complaints />;
    case "branches":
      return <BranchManagement />;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);

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

  const tabs = TABS_BY_ROLE[profile.role] ?? [];
  if (tabs.length === 0) {
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

  const currentTab = activeTab && tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0].key;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          {ROLE_TITLES[profile.role] ?? profile.role} - {profile.name}
        </h1>
        <button className="btn-link" onClick={() => supabase.auth.signOut()}>
          تسجيل خروج
        </button>
      </header>
      {tabs.length > 1 && (
        <nav className="tab-bar">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`tab-btn${t.key === currentTab ? " tab-btn-active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
      <main>
        <ScreenFor tab={currentTab} profile={profile} />
      </main>
    </div>
  );
}
