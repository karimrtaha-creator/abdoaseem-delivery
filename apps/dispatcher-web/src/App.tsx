import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { useProfile, Profile } from "./lib/useProfile";
import { Login } from "./pages/Login";
import { CompleteStaffRegistration } from "./pages/CompleteStaffRegistration";
import { PendingApprovals } from "./pages/PendingApprovals";
import { CallCenter } from "./pages/CallCenter";
import { AcceptanceLobby } from "./pages/AcceptanceLobby";
import { UserManagement } from "./pages/UserManagement";
import { Dashboard } from "./pages/Dashboard";
import { DriverPerformance } from "./pages/DriverPerformance";
import { Complaints } from "./pages/Complaints";
import { BranchManagement } from "./pages/BranchManagement";
import { MenuManagement } from "./pages/MenuManagement";
import { MenuAvailability } from "./pages/MenuAvailability";
import { BusinessHours } from "./pages/BusinessHours";
import { DriverLocations } from "./pages/DriverLocations";

type TabKey =
  | "call_center"
  | "acceptance"
  | "users"
  | "dashboard"
  | "performance"
  | "complaints"
  | "branches"
  | "menu_photos"
  | "menu_availability"
  | "business_hours"
  | "driver_map"
  | "staff_requests";

const ROLE_TITLES: Record<string, string> = {
  dispatcher: "ديسباتشر",
  call_center: "Agent", // renamed from "كول سنتر" 2026-08-11 - same role (order_source scoping unchanged), new label + widened job (see AcceptanceLobby)
  team_leader: "تيم ليدر",
  general_manager: "مدير عام",
  regional_manager: "مدير منطقة",
  branch_manager: "مدير فرع",
};

// Which tabs each role gets, in order. Purely a navigation/UX list - every
// screen behind these tabs still enforces its own scope via RLS/edge
// function checks regardless of what's offered here.
const TABS_BY_ROLE: Record<string, { key: TabKey; label: string }[]> = {
  // dispatcher gets NO tabs at all, 2026-08-11 (Karim's explicit, final
  // instruction): dispatcher's entire job - queue, camera, driver
  // assignment, fee, AND driver-locations viewing - now lives in
  // apps/driver_app's DispatcherHomeScreen. dispatcher-web is not part of
  // this role's workflow at all anymore, not even for one screen - one
  // device, one app. The empty array here hits the zero-tabs gate below,
  // which shows a dispatcher-specific message pointing to the mobile app.
  dispatcher: [],
  // call_center ("Agent") narrowed same night, twice: first gained
  // "acceptance" alongside the existing "call_center" phone-order tab,
  // then Karim corrected it further - Agent handles website orders ONLY,
  // full stop, never the phone-order screen. RLS (migration 0044) backs
  // this up too - a call_center caller can't even see call_center-sourced
  // orders anymore, not just "doesn't have the tab for it".
  call_center: [{ key: "acceptance", label: "أوردرات الموقع" }],
  // dashboard + menu_availability added 2026-08-11 (Karim's explicit
  // instruction): team_leader needs to see delayed orders and be able to
  // stop/activate a menu item, not just accept/reject + the driver map.
  team_leader: [
    { key: "acceptance", label: "قبول الأوردرات" },
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "driver_map", label: "مواقع الطيارين" },
    { key: "menu_availability", label: "إقفال الأصناف" },
    { key: "business_hours", label: "مواعيد العمل" },
  ],
  general_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "acceptance", label: "قبول الأوردرات" },
    { key: "driver_map", label: "مواقع الطيارين" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "staff_requests", label: "طلبات التسجيل" },
    { key: "users", label: "إدارة المستخدمين" },
    { key: "branches", label: "الفروع والمناطق" },
    { key: "menu_photos", label: "المنيو" },
    { key: "menu_availability", label: "إقفال الأصناف" },
    { key: "business_hours", label: "مواعيد العمل" },
  ],
  regional_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "staff_requests", label: "طلبات التسجيل" },
    { key: "users", label: "إدارة المستخدمين" },
    { key: "menu_availability", label: "إقفال الأصناف" },
  ],
  branch_manager: [
    { key: "dashboard", label: "لوحة المتابعة" },
    { key: "performance", label: "أداء الطيارين" },
    { key: "complaints", label: "الشكاوى" },
    { key: "staff_requests", label: "طلبات التسجيل" },
    { key: "users", label: "إدارة المستخدمين" },
    { key: "menu_availability", label: "إقفال الأصناف" },
  ],
};

function ScreenFor({ tab, profile }: { tab: TabKey; profile: Profile }) {
  switch (tab) {
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
    case "menu_photos":
      return <MenuManagement />;
    case "menu_availability":
      return <MenuAvailability profile={profile} />;
    case "business_hours":
      return <BusinessHours profile={profile} />;
    case "driver_map":
      return <DriverLocations profile={profile} />;
    case "staff_requests":
      return <PendingApprovals profile={profile} />;
  }
}

const TAB_TITLES: Record<TabKey, string> = {
  call_center: "أوردر جديد",
  acceptance: "قبول الأوردرات",
  users: "إدارة المستخدمين",
  dashboard: "لوحة المتابعة",
  performance: "أداء الطيارين",
  complaints: "الشكاوى",
  branches: "الفروع والمناطق",
  menu_photos: "المنيو",
  menu_availability: "إقفال الأصناف",
  business_hours: "مواعيد العمل",
  driver_map: "مواقع الطيارين",
  staff_requests: "طلبات التسجيل",
};

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

  // Staff Registration feature (2026-08-11): a Google-authenticated
  // session with no approved staff role yet is always role='customer'
  // (handle_new_user() never grants anything else at signup) - route
  // them into the registration form/pending-review screen instead of the
  // generic "role not available" message below.
  if (profile.role === "customer") {
    return <CompleteStaffRegistration userId={profile.id} />;
  }

  const tabs = TABS_BY_ROLE[profile.role] ?? [];
  if (tabs.length === 0) {
    return (
      <div className="centered-page">
        <div className="card">
          <p className="error-text">
            {profile.role === "dispatcher"
              ? "حساب الديسباتشر بيشتغل من تطبيق الموبايل بس - مفيش استخدام لهذا الموقع."
              : `الشاشة دي مش متاحة للدور ده. الدور الحالي: ${profile.role}`}
          </p>
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            تسجيل خروج
          </button>
        </div>
      </div>
    );
  }

  const currentTab = activeTab && tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0].key;
  const hasNav = tabs.length > 1;

  return (
    <div className="app-shell">
      <aside className={`sidebar${hasNav ? "" : " sidebar-no-nav"}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-name">كشري الغباشي</span>
          <span className="sidebar-brand-caption">بوابة الموظفين</span>
        </div>
        <div className="sidebar-role">
          <span className="sidebar-role-name">{profile.name}</span>
          <span className="sidebar-role-title">{ROLE_TITLES[profile.role] ?? profile.role}</span>
        </div>
        {hasNav && (
          <nav className="sidebar-nav">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`sidebar-nav-item${t.key === currentTab ? " sidebar-nav-item-active" : ""}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-footer">
          <button className="btn-link" onClick={() => supabase.auth.signOut()}>
            تسجيل خروج
          </button>
        </div>
      </aside>

      {hasNav && (
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

      <main className="content">
        <div className="content-header">
          <h1>{TAB_TITLES[currentTab]}</h1>
        </div>
        {/* Every accessible tab stays mounted and is only CSS-hidden when
            inactive, instead of being unmounted by conditional rendering -
            switching tabs used to wipe any in-progress typing (e.g. a
            half-filled "add employee" form) because React tears the
            previous screen down entirely on every switch. */}
        {tabs.map((t) => (
          <div key={t.key} className={`tab-panel${t.key === currentTab ? " tab-panel-active" : ""}`}>
            <ScreenFor tab={t.key} profile={profile} />
          </div>
        ))}
      </main>
    </div>
  );
}
