import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ExpoLinking from "expo-linking";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandMark } from "@/components/BrandMark";
import { GlassButton } from "@/components/GlassButton";
import { HouseTransition } from "@/components/HouseTransition";
import { useTheme } from "@/constants/colors";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { supabase } from "@/lib/supabase";
import { signOutWithPushCleanup } from "@/lib/pushRegistration";
import {
  PasswordFlowError,
  PasswordRecoveryController,
  passwordFlowError,
  passwordServices,
  passwordValidation,
  recoveryLink,
  type RecoverySnapshot,
} from "@/lib/passwordRecovery";

export function passwordRecoveryRedirect() {
  return ExpoLinking.createURL("auth/reset-password");
}
export const passwordRecovery = new PasswordRecoveryController(
  supabase.auth,
  signOutWithPushCleanup,
);

function Feedback({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  const colors = useTheme();
  return (
    <Text
      accessibilityRole={error ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      style={[
        styles.feedback,
        { color: error ? colors.destructive : colors.mutedForeground },
      ]}
    >
      {message}
    </Text>
  );
}
function Button({
  label,
  onPress,
  disabled,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const colors = useTheme();
  return (
    <GlassButton
      accessibilityLabel={label}
      disabled={disabled}
      tone={secondary ? "neutral" : "primary"}
      onPress={onPress}
      style={styles.button}
    >
      <Text
        style={[
          styles.buttonText,
          { color: secondary ? colors.foreground : colors.actionForeground },
        ]}
      >
        {label}
      </Text>
    </GlassButton>
  );
}
function Frame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useTheme(),
    insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={KEYBOARD_BEHAVIOR}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.frame}>
          <View style={styles.brand}>
            <BrandMark transition size={64} color={colors.primary} />
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.foreground }]}
          >
            {title}
          </Text>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function RecoveryEmailForm({
  initialEmail = "",
  onClose,
}: {
  initialEmail?: string;
  onClose: () => void;
}) {
  const colors = useTheme();
  const [email, setEmail] = useState(initialEmail),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await passwordServices.request(email, passwordRecoveryRedirect());
      if (mounted.current) setSent(true);
    } catch (failure) {
      if (mounted.current) setError(passwordFlowError(failure).message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <Feedback message="Enter your account email. The reset link will open SweetMate so you can choose a new password." />
      <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
      <TextInput
        accessibilityLabel="Recovery email"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setSent(false);
        }}
        editable={!busy}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
        returnKeyType="send"
        onSubmitEditing={() => void send()}
      />
      {error ? <Feedback error message={error} /> : null}
      {sent ? (
        <Feedback message="If an account with this email can be recovered, a reset email is on its way. Check your inbox and spam folder. Use the newest email; older or used links may no longer work." />
      ) : null}
      <Button
        label={
          busy
            ? "Sending reset email…"
            : sent
              ? "Send another reset email"
              : "Send reset email"
        }
        disabled={busy || !email.trim()}
        onPress={() => void send()}
      />
      <Button label="Back" secondary disabled={busy} onPress={onClose} />
    </>
  );
}
export function RecoveryEmailScreen(props: {
  initialEmail?: string;
  onClose: () => void;
}) {
  return (
    <Frame title="Reset your password">
      <RecoveryEmailForm {...props} />
    </Frame>
  );
}
export function PasswordForm({
  currentRequired,
  onSave,
  onCancel,
  onReauthenticate,
  onRecover,
}: {
  currentRequired: boolean;
  onSave: (
    password: string,
    confirmation: string,
    current?: string,
    nonce?: string,
  ) => Promise<void>;
  onCancel: () => void;
  onReauthenticate: () => Promise<void>;
  onRecover?: () => void;
}) {
  const colors = useTheme();
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [nonce, setNonce] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [needsCode, setNeedsCode] = useState(false),
    [codeSent, setCodeSent] = useState(false);
  const pending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requestCode = async () => {
    await onReauthenticate();
    if (mounted.current) setCodeSent(true);
  };
  const submit = async () => {
    if (pending.current) return;
    const validation = passwordValidation(password, confirmation);
    if (currentRequired && !current) {
      setError("Enter your current password, or use email recovery.");
      return;
    }
    if (validation) {
      setError(validation);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(
        password,
        confirmation,
        currentRequired ? current : undefined,
        nonce || undefined,
      );
    } catch (failure) {
      if (!mounted.current) return;
      const safe = passwordFlowError(failure);
      setError(safe.message);
      if (safe.code === "reauthentication") {
        setNeedsCode(true);
        try {
          await requestCode();
        } catch (sendError) {
          if (mounted.current) setError(passwordFlowError(sendError).message);
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const inputStyle = [
    styles.input,
    {
      color: colors.foreground,
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
  ];
  return (
    <>
      {currentRequired ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Current password
          </Text>
          <TextInput
            accessibilityLabel="Current password"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={inputStyle}
          />
        </>
      ) : null}
      <Text style={[styles.label, { color: colors.foreground }]}>
        New password
      </Text>
      <TextInput
        accessibilityLabel="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        passwordRules="minlength: 12;"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        maxLength={128}
        style={inputStyle}
      />
      <Feedback message="Use at least 12 characters. A unique passphrase or password-manager suggestion works well." />
      <Text style={[styles.label, { color: colors.foreground }]}>
        Confirm new password
      </Text>
      <TextInput
        accessibilityLabel="Confirm new password"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        maxLength={128}
        style={inputStyle}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {needsCode ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Email security code
          </Text>
          <TextInput
            accessibilityLabel="Email security code"
            value={nonce}
            onChangeText={setNonce}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={inputStyle}
          />
          {codeSent ? (
            <Feedback message="A security code was sent to your account email." />
          ) : null}
          <Button
            label="Resend security code"
            secondary
            disabled={busy}
            onPress={() => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              void requestCode()
                .catch((failure) => {
                  if (mounted.current)
                    setError(passwordFlowError(failure).message);
                })
                .finally(() => {
                  pending.current = false;
                  if (mounted.current) setBusy(false);
                });
            }}
          />
        </>
      ) : null}
      {error ? <Feedback error message={error} /> : null}
      <Feedback message="After saving, sign in again with your new password. Your households and saved records stay in your account." />
      <Button
        label={busy ? "Saving password…" : "Save new password"}
        disabled={
          busy || !password || !confirmation || (currentRequired && !current)
        }
        onPress={() => void submit()}
      />
      <Button label="Cancel" secondary disabled={busy} onPress={onCancel} />
      {onRecover ? (
        <Button
          label="Use email recovery instead"
          secondary
          disabled={busy}
          onPress={onRecover}
        />
      ) : null}
    </>
  );
}
function RecoveryScreen({ state }: { state: RecoverySnapshot }) {
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const action = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(passwordFlowError(failure).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    void action(() => passwordRecovery.close());
  };
  if (state.phase === "ready")
    return (
      <Frame title="Choose a new password">
        <PasswordForm
          key={`${state.userId}:${state.expiresAt}`}
          currentRequired={false}
          onSave={(password, confirmation) =>
            passwordRecovery.complete(password, confirmation)
          }
          onCancel={close}
          onReauthenticate={() =>
            passwordServices.reauthenticate(state.userId!)
          }
        />
        {error ? <Feedback error message={error} /> : null}
      </Frame>
    );
  if (state.phase === "expired")
    return (
      <Frame title="Reset link unavailable">
        <Feedback
          error
          message={
            state.message ??
            "This reset link has expired or has already been used."
          }
        />
        <RecoveryEmailForm onClose={close} />
        {error ? <Feedback error message={error} /> : null}
      </Frame>
    );
  if (state.phase === "confirm-signout")
    return (
      <Frame title="Open your reset link">
        <Feedback message="You are currently signed in. Sign out before continuing so this reset link cannot switch your account unexpectedly." />
        <Button
          label={busy ? "Continuing…" : "Sign out and continue"}
          disabled={busy}
          onPress={() =>
            void action(() => passwordRecovery.continueAfterSignOut())
          }
        />
        <Button label="Cancel" secondary disabled={busy} onPress={close} />
        {error ? <Feedback error message={error} /> : null}
      </Frame>
    );
  if (state.phase === "signout-required")
    return (
      <Frame title="Password updated">
        <Feedback message={state.message!} />
        <Button
          label={busy ? "Signing out…" : "Finish signing out"}
          disabled={busy}
          onPress={() => void action(() => passwordRecovery.finishSignOut())}
        />
        {error ? <Feedback error message={error} /> : null}
      </Frame>
    );
  return (
    <Frame title="Password updated">
      <Feedback message="Your password was changed successfully. Sign in with the new password." />
      <Button label="Back to sign in" onPress={close} disabled={busy} />
    </Frame>
  );
}
export function PasswordRecoveryBoundary({
  children,
  onLaunchStateChange,
}: {
  children: React.ReactNode;
  onLaunchStateChange: (pending: boolean) => void;
}) {
  const state = useSyncExternalStore(
    passwordRecovery.subscribe,
    passwordRecovery.getSnapshot,
    passwordRecovery.getSnapshot,
  );
  useEffect(() => {
    let active = true;
    const receive = (value: string) => {
      const link = recoveryLink(value, passwordRecoveryRedirect());
      if (!active || !link) return;
      // Remove auth material from the web address before any app analytics mount.
      if (Platform.OS === "web" && typeof window !== "undefined")
        window.history.replaceState(null, "", window.location.pathname);
      void passwordRecovery.handle(link);
    };
    const listener = Linking.addEventListener("url", ({ url }) => receive(url));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) =>
      passwordRecovery.observe(event, session),
    );
    void Linking.getInitialURL()
      .then((value) => {
        if (value) receive(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active) passwordRecovery.initialized();
      });
    const foreground = AppState.addEventListener("change", (value) => {
      if (value === "active") passwordRecovery.expire();
    });
    const timer = setInterval(() => passwordRecovery.expire(), 15_000);
    return () => {
      active = false;
      listener.remove();
      subscription.unsubscribe();
      foreground.remove();
      clearInterval(timer);
    };
  }, []);
  if (state.phase === "idle") return <>{children}</>;
  return (
    <HouseTransition
      loading={state.phase === "checking"}
      onLaunchStateChange={onLaunchStateChange}
    >
      {state.phase === "checking" ? (
        <ActivityIndicator />
      ) : (
        <RecoveryScreen key={state.phase} state={state} />
      )}
    </HouseTransition>
  );
}
export function ChangePasswordSection({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const colors = useTheme();
  const [view, setView] = useState<"closed" | "change" | "recover" | "done">(
    "closed",
  );
  const [message, setMessage] = useState<string | null>(null);
  const finish = async () => {
    const current = await supabase.auth.getSession();
    if (current.data.session?.user.id !== userId)
      throw new PasswordFlowError(
        "account_changed",
        "Your account changed. Sign in again to continue.",
      );
    const { error } = await signOutWithPushCleanup();
    if (error) throw error;
  };
  const save = async (
    password: string,
    confirmation: string,
    current?: string,
    nonce?: string,
  ) => {
    if (!current)
      throw new PasswordFlowError(
        "current_password",
        "Enter your current password.",
      );
    await passwordServices.change(
      userId,
      password,
      confirmation,
      current,
      nonce,
    );
    setView("done");
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    try {
      await finish();
    } catch {
      setMessage(
        "Your password was updated. Finish signing out, then sign in with the new password.",
      );
    }
  };
  return (
    <View
      style={[
        styles.settingsCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.foreground }]}
      >
        Account security
      </Text>
      {view === "closed" ? (
        <Button
          label="Change password"
          secondary
          onPress={() => setView("change")}
        />
      ) : null}
      {view === "change" ? (
        <>
          <PasswordForm
            currentRequired
            onSave={save}
            onCancel={() => setView("closed")}
            onReauthenticate={() => passwordServices.reauthenticate(userId)}
            onRecover={() => setView("recover")}
          />
        </>
      ) : null}
      {view === "recover" ? (
        <RecoveryEmailForm
          initialEmail={email}
          onClose={() => setView("closed")}
        />
      ) : null}
      {view === "done" ? (
        <>
          <Feedback
            message={message ?? "Your password was updated. Signing out…"}
          />
          <Button
            label="Finish signing out"
            onPress={() =>
              void finish().catch(() =>
                setMessage("Check your connection and try signing out again."),
              )
            }
          />
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center" },
  frame: { width: "100%", maxWidth: 440, alignSelf: "center" },
  brand: { alignItems: "center", marginBottom: 20 },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 30,
    includeFontPadding: false,
    marginBottom: 16,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    includeFontPadding: false,
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 17,
  },
  feedback: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 22,
    includeFontPadding: false,
    marginTop: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 17,
    textAlign: "center",
  },
  settingsCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 19,
  },
});
