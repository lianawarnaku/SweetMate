import { newPasswordValidation } from "@/lib/passwordPolicy";
import { RecoveryEmailScreen } from "@/components/PasswordRecoveryScreen";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
// Email/password sign-in and sign-up UI, shown by AuthGate whenever there's
// no Supabase session. Toggles between two modes:
//   - "signin" → supabase.auth.signInWithPassword
//   - "signup" → supabase.auth.signUp
// New email accounts follow the server confirmation policy; existing sessions
// and sign-in passwords remain compatible.

import { Feather, FontAwesome } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
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
import { beginAnalyticsAuth, recordAnalyticsAuthSucceeded, saveSignupAnalyticsConsent } from "@/lib/analytics";
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
  const [recovering, setRecovering] = useState(false);
  const [shareOptionalData, setShareOptionalData] = useState(false);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const socialInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const submit = async () => {
    if (loading || socialLoading) return;
    setError(null);
    setInfo(null);
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    const passwordError = mode === "signup" ? newPasswordValidation(password) : (!password ? "Enter your password." : null);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setLoading(true);
    const analyticsAttempt = beginAnalyticsAuth({ method: "email", mode });
    try {
      if (mode === "signin") {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
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
        if (signInData.session) {
          await recordAnalyticsAuthSucceeded(signInData.session.user.id, analyticsAttempt, { method: "email", mode: "signin" });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // AuthGate reacts to onAuthStateChange and swaps to the app.
        // The session scope is restored by AnalyticsConsentManager.
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
        if (data.user?.id) {
          try { await saveSignupAnalyticsConsent(data.user.id, shareOptionalData, analyticsAttempt, Boolean(data.session)); }
          catch (consentError) { reportRuntimeError("save optional signup privacy choice", consentError); }
        }
        if (data.session) {
          // Some development servers may return a session immediately.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await recordAnalyticsAuthSucceeded(data.session.user.id, analyticsAttempt, { method: "email", mode: "signup" }, true);
        } else {
          // Production requires email ownership confirmation before first sign-in.
          setConfirmationEmail(email.trim());
          setInfo(
            "Check your email to confirm your account. Then return to SweetMate and sign in."
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
    if (loading || socialLoading || socialInFlightRef.current) return;
    socialInFlightRef.current = true;
    setSocialLoading(provider);
    const analyticsAttempt = beginAnalyticsAuth({ method: provider, mode });
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

      let authenticatedUserId: string | undefined;
      const code = authCallbackValue(result.url, "code");
      if (code) {
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
        authenticatedUserId = exchangeData.session?.user.id;
      } else {
        const accessToken = authCallbackValue(result.url, "access_token");
        const refreshToken = authCallbackValue(result.url, "refresh_token");
        if (!accessToken || !refreshToken) {
          throw new Error(`${provider === "google" ? "Google" : "Apple"} did not return a login session.`);
        }
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
        authenticatedUserId = sessionData.session?.user.id;
      }

      if (!authenticatedUserId) {
        throw new Error(`${provider === "google" ? "Google" : "Apple"} did not return a login session. Please try again.`);
      }
      if (mode === "signup") {
        try { await saveSignupAnalyticsConsent(authenticatedUserId, shareOptionalData, analyticsAttempt, true); }
        catch (consentError) { reportRuntimeError("save optional social signup privacy choice", consentError); }
      }
      await recordAnalyticsAuthSucceeded(authenticatedUserId, analyticsAttempt, { method: provider, mode });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      reportRuntimeError(`${provider} sign in`, e);
      setError(e instanceof Error ? e.message : `Could not sign in with ${provider}.`);
      hapticError();
    } finally {
      socialInFlightRef.current = false;
      setSocialLoading(null);
    }
  };

  const busy = loading || socialLoading !== null;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;
  const openPolicy = () => openPrivacyPolicy(() => setError("Privacy Policy unavailable. Check your connection, or visit sweetmate.info/privacy in a browser."));

  if (recovering) return <RecoveryEmailScreen initialEmail={email} onClose={() => setRecovering(false)} />;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_BEHAVIOR}
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
          <BrandMark transition size={86} color={colors.primary} />
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
            placeholder={mode === "signup" ? "At least 12 characters" : "Your password"}
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={mode === "signup" ? "newPassword" : "password"}
            editable={!busy}
          />

          {mode === "signin" ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Forgot password?" disabled={busy} onPress={() => { setPassword(""); setRecovering(true); }} style={styles.resendButton}>
            <Text style={[styles.resendText, { color: colors.mutedForeground, textDecorationLine: "underline" }]}>Forgot password?</Text>
          </TouchableOpacity> : null}

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
          {mode === "signup" ? (
            <View style={styles.signupConsent}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Share optional product analytics and crash reports"
                accessibilityState={{ checked: shareOptionalData, disabled: busy }}
                aria-checked={shareOptionalData}
                {...(Platform.OS === "web" ? {
                  onKeyDown: (event: { nativeEvent: { key?: string; repeat?: boolean }; preventDefault: () => void }) => {
                    if (event.nativeEvent.key === " " || event.nativeEvent.key === "Spacebar") {
                      event.preventDefault();
                      if (!busy && !event.nativeEvent.repeat) setShareOptionalData((current) => !current);
                    }
                  },
                } : {})}
                disabled={busy}
                onPress={() => setShareOptionalData((current) => !current)}
                style={styles.consentRow}
              >
                <View style={[styles.consentBox, { borderColor: colors.foreground, backgroundColor: shareOptionalData ? colors.foreground : "transparent" }]}>
                  {shareOptionalData ? <Feather name="check" size={16} color={colors.background} /> : null}
                </View>
                <Text style={[styles.consentCopy, { color: colors.foreground }]}>Help improve SweetMate by sharing product analytics and crash reports. Optional.</Text>
              </Pressable>
              <Text style={[styles.consentDetails, { color: colors.mutedForeground }]}>
                This choice excludes chore and item names. You can manage sharing in Settings. Read our{" "}
                <Text accessibilityRole="link" onPress={openPolicy} style={[styles.privacyLink, { color: colors.primary }]}>Privacy Statement</Text>.
              </Text>
            </View>
          ) : null}
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


          <TouchableOpacity
            style={styles.switchRow}
            disabled={busy}
            onPress={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setShareOptionalData(false);
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
  signupConsent: { marginTop: 12, gap: 4 },
  consentRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  consentBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  consentCopy: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
  consentDetails: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginLeft: 36 },
  privacyLink: { fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
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
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 30,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  form: { alignSelf: "stretch", maxWidth: 420, width: "100%" },
  label: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
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
    fontFamily: "Inter_700Bold", includeFontPadding: false,
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
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 15,
  },
  switchRow: {
    marginTop: 18,
    alignItems: "center",
  },
  switchText: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
  },
  privacyCopy: {
    marginTop: 14,
    textAlign: "center",
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 12,
    lineHeight: 17,
  },
});
