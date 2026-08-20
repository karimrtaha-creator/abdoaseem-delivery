import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

export interface Profile {
  id: string;
  name: string;
  role: string;
  branch_id: number | null;
  region_id: number | null;
  is_active: boolean;
}

// Loads the caller's own public.users row (allowed by the users_select_self
// RLS policy) once a Supabase Auth session exists.
//
// Keyed on the user id, not the Session object - Supabase fires
// onAuthStateChange (handing App.tsx a brand-new session object, same
// user) on every routine token refresh, which happens on its own periodic
// schedule and commonly again whenever the browser tab regains focus. A
// plain `useEffect(..., [session])` re-triggered a full
// loading=true -> refetch -> loading=false cycle on that reference change
// alone, even though nothing about the signed-in user actually changed.
// App.tsx's top-level "جاري التحميل..." gate reads straight off this
// hook's `loading`, so that flash unmounted the entire app (including
// every "always mounted" tab panel) and remounted it a moment later,
// wiping any in-progress typing (e.g. a half-filled "add employee" form).
// Tracking the last-loaded user id in a ref lets a same-user token refresh
// skip the fetch (and the loading flash) entirely.
export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedForUserId = useRef<string | null>(null);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      loadedForUserId.current = null;
      setProfile(null);
      setLoading(false);
      return;
    }
    if (loadedForUserId.current === userId) return; // same user as already loaded - a token refresh, not a real change

    setLoading(true);
    let cancelled = false;
    supabase
      .from("users")
      .select("id, name, role, branch_id, region_id, is_active")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        loadedForUserId.current = userId;
        setProfile(data as Profile | null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { profile, loading };
}
