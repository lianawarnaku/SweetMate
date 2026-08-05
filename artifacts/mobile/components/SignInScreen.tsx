// Email/password sign-in and sign-up UI, shown by AuthGate whenever there's
// no Supabase session. Toggles between two modes:
//   - "signin" → supabase.auth.signInWithPassword
//   - "signup" → supabase.auth.signUp
// SweetMate's Supabase project auto-confirms new email/password accounts, so
// signUp normally returns a session and AuthGate opens the app immediately.
// The confirmation fallback remains only for legacy accounts created before
// auto-confirm was enabled.

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

type Mode = "signin" | "signup";
const EMAIL_CONFIRMATION_URL = "https://sweetmate.info/auth/confirm";
const PRIVACY_POLICY_URL = "https://sweetmate.info/privacy";

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

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;
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
            editable={!loading}
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
            editable={!loading}
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
              disabled={loading}
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
              { backgroundColor: canSubmit ? colors.primary : colors.muted },
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
