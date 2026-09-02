// Email/password sign-in and sign-up UI, shown by AuthGate whenever there's
// no Supabase session. Toggles between two modes:
//   - "signin" → supabase.auth.signInWithPassword
//   - "signup" → supabase.auth.signUp
// SweetMate's Supabase project auto-confirms new email/password accounts, so
// signUp normally returns a session and AuthGate opens the app immediately.
// The confirmation fallback remains only for legacy accounts created before
// auto-confirm was enabled.

import { Feather, FontAwesome } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { error as hapticError } from "@/lib/haptics";
import { BrandMark } from "./BrandMark";
import { supabase } from "@/lib/supabase";
import { reportSupabaseError, reportRuntimeError } from "@/lib/runtimeDiagnostics";
import { track } from "@/lib/analytics";
import { authCallbackValue } from "@/lib/oauthCallback";

type Mode = "signin" | "signup";
type SocialProvider = "google" | "apple";
const EMAIL_CONFIRMATION_URL = "https://sweetmate.info/auth/confirm";
const PRIVACY_POLICY_URL = "https://sweetmate.info/privacy";

WebBrowser.maybeCompleteAuthSession();

function openPrivacyPolicy(onError: () => void) {
  void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
    onError();
  });
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function SignInScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          reportSupabaseError("sign in", signInError);
          setError(
            signInError.message.toLowerCase().includes("email not confirmed")
              ? "Please confirm your email before signing in. You can resend the confirmation below."
              : signInError.message,
          );
          if (signInError.message.toLowerCase().includes("email not confirmed")) {
            setConfirmationEmail(email.trim());
          }
          hapticError();
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // AuthGate reacts to onAuthStateChange and swaps to the app.
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: EMAIL_CONFIRMATION_URL,
          },
        });
        if (signUpError) {
          reportSupabaseError("sign up", signUpError);
          setError(signUpError.message);
          hapticError();
          return;
        }
        if (data.session) {
          // Auto-confirm is enabled — the new user is signed in immediately.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          track.accountCreated();
        } else {
          // Defensive fallback for a legacy/unconfirmed account or a remote
          // configuration mismatch.
          setConfirmationEmail(email.trim());
          setInfo(
            "Your account was created, but SweetMate could not start your session. Try signing in, or resend the confirmation for this account."
          );
        }
      }
    } catch (e) {
      reportRuntimeError(mode === "signin" ? "sign in" : "sign up", e);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    const resendEmail = confirmationEmail ?? email.trim();
    if (!isValidEmail(resendEmail) || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: resendEmail,
        options: {
          emailRedirectTo: EMAIL_CONFIRMATION_URL,
        },
      });
      if (resendError) {
        reportSupabaseError("resend confirmation email", resendError);
        setError(resendError.message);
        hapticError();
        return;
      }
      setInfo("A fresh confirmation link is on its way. Check your inbox and spam folder.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      reportRuntimeError("resend confirmation email", e);
      setError(e instanceof Error ? e.message : "Could not resend the confirmation email.");
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const signInWithSocialProvider = async (provider: SocialProvider) => {
    if (loading || socialLoading) return;
    setSocialLoading(provider);
    setError(null);
    setInfo(null);

    try {
      // Expo Go receives its development URL here, while standalone builds use
      // the configured sweetmate:// scheme.
      const redirectTo = ExpoLinking.createURL("auth/callback");
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error(`Could not start ${provider} sign in.`);

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return;

      const oauthMessage = authCallbackValue(result.url, "error_description")
        ?? authCallbackValue(result.url, "error");
      if (oauthMessage) throw new Error(oauthMessage);

      const code = authCallbackValue(result.url, "code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } else {
        const accessToken = authCallbackValue(result.url, "access_token");
        const refreshToken = authCallbackValue(result.url, "refresh_token");
        if (!accessToken || !refreshToken) {
          throw new Error(`${provider === "google" ? "Google" : "Apple"} did not return a login session.`);
        }
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      reportRuntimeError(`${provider} sign in`, e);
      setError(e instanceof Error ? e.message : `Could not sign in with ${provider}.`);
      hapticError();
    } finally {
      setSocialLoading(null);
    }
  };

  const busy = loading || socialLoading !== null;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;
  const openPolicy = () => openPrivacyPolicy(() => setError("Privacy Policy unavailable. Check your connection, or visit sweetmate.info/privacy in a browser."));

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <BrandMark size={86} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>SweetMate</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {mode === "signin"
            ? "Sign in to sync with your roommates"
            : "Create an account to get started"}
        </Text>

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
          />

          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>
            Password
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === "signup" ? "newPassword" : "password"}
            editable={!busy}
          />

          {error ? (
            <View style={[styles.banner, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "44" }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.bannerText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}
          {confirmationEmail ? (
            <TouchableOpacity
              onPress={resendConfirmation}
              disabled={busy}
              style={styles.resendButton}
              activeOpacity={0.7}
            >
              <Text style={[styles.resendText, { color: colors.primary }]}>
                Resend confirmation email
              </Text>
            </TouchableOpacity>
          ) : null}
          {info ? (
            <View style={[styles.banner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "44" }]}>
              <Feather name="mail" size={14} color={colors.primary} />
              <Text style={[styles.bannerText, { color: colors.primary }]}>{info}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.submit,
              { backgroundColor: canSubmit ? colors.action : colors.muted },
            ]}
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {mode === "signin" ? "Sign In" : "Create Account"}
              </Text>
            )}
          </TouchableOpacity>
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>OR CONTINUE WITH</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[styles.socialButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => void signInWithSocialProvider("google")}
            disabled={busy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            {socialLoading === "google" ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <FontAwesome name="google" size={18} color="#4285F4" />
                <Text style={[styles.socialButtonText, { color: colors.foreground }]}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.socialButton, styles.appleButton]}
            onPress={() => void signInWithSocialProvider("apple")}
            disabled={busy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            {socialLoading === "apple" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <FontAwesome name="apple" size={21} color="#fff" />
                <Text style={[styles.socialButtonText, { color: "#fff" }]}>Continue with Apple</Text>
              </>
            )}
          </TouchableOpacity>
          {mode === "signup" ? (
            <Text style={[styles.privacyCopy, { color: colors.mutedForeground }]}>
              By creating an account, you acknowledge the{" "}
              <Text
                accessibilityRole="link"
                onPress={openPolicy}
                style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
              >
                Privacy Policy
              </Text>
              . Optional analytics and crash reporting remain off unless you enable them.
            </Text>
          ) : null}

          <TouchableOpacity
            style={styles.switchRow}
            disabled={busy}
            onPress={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
              setConfirmationEmail(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
              {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                {mode === "signin" ? "Create an account" : "Sign in"}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, alignItems: "center" },
  logoWrap: {
    width: 92,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 30,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  form: { alignSelf: "stretch", maxWidth: 420, width: "100%" },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  banner: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  resendButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  resendText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  submit: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    letterSpacing: 0.6,
  },
  socialButton: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  appleButton: { backgroundColor: "#000", borderColor: "#000" },
  socialButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  switchRow: {
    marginTop: 18,
    alignItems: "center",
  },
  switchText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  privacyCopy: {
    marginTop: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
});
