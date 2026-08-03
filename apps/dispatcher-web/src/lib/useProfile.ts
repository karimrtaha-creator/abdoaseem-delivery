import { useEffect, useState } from "react";
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
export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("users")
      .select("id, name, role, branch_id, region_id, is_active")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        setProfile(data as Profile | null);
        setLoading(false);
      });
  }, [session]);

  return { profile, loading };
}
