// Tracks the current Supabase auth session and re-renders consumers whenever
// it changes. Wraps `onAuthStateChange` — the callback fires on sign-in,
// sign-out, token refresh, and initial session recovery from AsyncStorage.
//
// `loading` is true only for the very first tick while we retrieve the
// persisted session from AsyncStorage. After that it's false forever and
// `session` swaps between a Session object and null as the user signs in/out.

import { type Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { reportSupabaseError } from "@/lib/runtimeDiagnostics";

// Preview-only auto sign-in: when these are set (e.g. for a demo tunnel
// link), a fresh device with no session signs into the shared demo account
// instead of showing SignInScreen. Never set these for a real deployment.
const DEMO_EMAIL = process.env.EXPO_PUBLIC_DEMO_EMAIL;
const DEMO_PASSWORD = process.env.EXPO_PUBLIC_DEMO_PASSWORD;

export function useSupabaseSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Kick off the initial session lookup. AsyncStorage read is quick but
    // async, so we hold `loading` true until it resolves.
    let active = true;
    supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (error) reportSupabaseError("restore auth session", error);
        if (!active) return;
        if (!data.session && DEMO_EMAIL && DEMO_PASSWORD) {
          const { data: signInData, error: signInError } =
            await supabase.auth.signInWithPassword({
              email: DEMO_EMAIL,
              password: DEMO_PASSWORD,
            });
          if (signInError) reportSupabaseError("demo auto sign-in", signInError);
          if (!active) return;
          setSession(signInData?.session ?? null);
          return;
        }
        setSession(data.session);
      })
      .catch((error) => reportSupabaseError("restore auth session", error))
      .finally(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
