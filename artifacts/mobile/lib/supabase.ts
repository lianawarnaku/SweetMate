import { createChorePolicyFetch } from "./chorePolicyFetch";
// Supabase client — the single, shared instance the rest of the app imports
// from. Do not `new SupabaseClient(...)` anywhere else; multiple clients each
// keep their own session + realtime connection and drift out of sync.
//
// URL + anon key are read from Expo's public-env system at bundle time. See
// artifacts/mobile/.env.example for what to put in your local .env file.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at boot rather than silently returning nulls from every query.
  // If you see this, your .env file is missing or the dev server wasn't
  // restarted after adding the vars — Expo bakes env vars in at bundle time.
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy artifacts/mobile/.env.example to .env and fill in the values from " +
      "your Supabase project dashboard (Settings → API), then restart Expo."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createChorePolicyFetch(supabaseUrl) },
  auth: {
    // Persist the session (access + refresh tokens) in AsyncStorage so users
    // stay signed in across app restarts.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar / OAuth redirect handler, so this must be
    // off; the JS SDK would otherwise try to parse a session out of the URL.
    detectSessionInUrl: false,
  },
});
