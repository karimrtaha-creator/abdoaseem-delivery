import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import { phoneToCustomerEmail } from "./phoneAuth";

export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  is_active: boolean;
}

interface AuthContextValue {
  session: Session | null;
  profile: CustomerProfile | null;
  loading: boolean;
  needsPhone: boolean;
  signUp: (phone: string, password: string, name: string) => Promise<void>;
  signIn: (phone: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  completeProfile: (name: string, phone: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data } = await supabase.from("users").select("id, name, phone, is_active").eq("id", userId).maybeSingle();
    setProfile(data as CustomerProfile | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadProfile(newSession.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signUp(phone: string, password: string, name: string) {
    const email = phoneToCustomerEmail(phone);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        throw new Error("رقم التليفون ده مسجل بالفعل - سجّل دخول بدل ما تعمل حساب جديد");
      }
      throw new Error(error.message);
    }
    if (!data.user) throw new Error("فشل إنشاء الحساب");
    // The auth.users -> public.users trigger already created a blank row
    // defaulted to role='customer' - fill in the real name/phone. Allowed
    // by users_update_self RLS; the privilege-escalation trigger only
    // blocks role/branch_id/region_id/is_active on self-updates, not these.
    const { error: updateError } = await supabase
      .from("users")
      .update({ name, phone: phone.replace(/\D/g, "") })
      .eq("id", data.user.id);
    if (updateError) throw new Error(updateError.message);
    await loadProfile(data.user.id);
  }

  async function signIn(phone: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToCustomerEmail(phone),
      password,
    });
    if (error) throw new Error("رقم التليفون أو الباسورد غلط");
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  }

  async function completeProfile(name: string, phone: string) {
    if (!session) throw new Error("لازم تكون مسجل دخول");
    const { error: updateError } = await supabase
      .from("users")
      .update({ name, phone: phone.replace(/\D/g, "") })
      .eq("id", session.user.id);
    if (updateError) throw new Error(updateError.message);
    await loadProfile(session.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const needsPhone = Boolean(session && profile && !profile.phone);

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, needsPhone, signUp, signIn, signInWithGoogle, completeProfile, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
