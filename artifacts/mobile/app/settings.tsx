import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { ReactNode, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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

import { RoommateAvatar } from "@/components/RoommateAvatar";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { useAppContext } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { UserPreferencesPanel } from "@/components/UserPreferencesPanel";
import { AnalyticsPreferencesPanel } from "@/components/AnalyticsConsentManager";
import { HouseholdCompletionControl } from "@/components/HouseholdCompletionControl";
import { InviteCodeCard } from "@/components/InviteCodeCard";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useConfirm } from "@/hooks/useConfirm";
import { supabase } from "@/lib/supabase";
import { error as hapticError } from "@/lib/haptics";
import {
  reportSupabaseError,
  reportRuntimeError,
} from "@/lib/runtimeDiagnostics";
import { track } from "@/lib/analytics";
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  isGoogleCalendarConnected,
} from "@/lib/googleCalendarConnection";
import {
  findRoommateIdByEmail,
  getStoredEmail,
  getStoredUsername,
  hasCredentials,
  setupCredentials,
  updatePassword,
  verifyCredentials,
} from "@/lib/auth";

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function generateResetCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function apiBaseUrl(): string {
  return (
    process.env.EXPO_PUBLIC_API_URL ??
    (process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : "")
  );
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ sent: boolean; simulated: boolean; body?: string }> {
  const url = `${apiBaseUrl()}/api/email/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, body }),
  });
  if (!res.ok) throw new Error(`Email API ${res.status}`);
  return res.json();
}

const COLOR_PALETTE = [
  "#7B563B",
  "#A66A3F",
  "#C58B57",
  "#9A7B5A",
  "#7D8B6A",
  "#B36A6A",
  "#8C6D80",
  "#6F7D78",
  "#A47C64",
  "#5F493A",
];

function CollapsibleSettingsSection({
  title,
  subtitle,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const colors = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.collapsibleSection}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${open ? "collapse" : "expand"}`}
        onPress={() => setOpen((current) => !current)}
        style={[
          styles.collapsibleHeader,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.linkIcon,
            { backgroundColor: colors.primary + "18" },
          ]}
        >
          <Feather name={icon} size={18} color={colors.primary} />
        </View>
        <View style={styles.collapsibleHeaderCopy}>
          <Text style={[styles.collapsibleTitle, { color: colors.foreground }]}>
            {title}
          </Text>
          <Text
            style={[
              styles.collapsibleSubtitle,
              { color: colors.mutedForeground },
            ]}
          >
            {subtitle}
          </Text>
        </View>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={19}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>
      {open ? <View style={styles.collapsibleContent}>{children}</View> : null}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const {
    roommates,
    currentUserId,
    updateRoommate,
    setCurrentUser,
    householdName,
    inviteCode,
    householdLoading,
    refreshHousehold,
    deleteHousehold,
    restartChartProcess,
    currentProposedChart,
    isHost,
    removeRoommate,
    deleteOwnAccount,
    openQuickGuide,
    memberships,
    activeSweetId,
    switchSweet,
    leaveSweet,
  } = useAppContext();
  const { confirm, info } = useConfirm();
  const me = roommates.find((r) => r.id === currentUserId);
  // Supabase session is guaranteed non-null here — AuthGate would have rendered
  // the sign-in screen instead of Settings otherwise.
  const { session } = useSupabaseSession();
  const [signingOut, setSigningOut] = useState(false);
  const [deletingHousehold, setDeletingHousehold] = useState(false);
  const [deleteHouseholdMenuOpen, setDeleteHouseholdMenuOpen] = useState(false);
  const [restartingChart, setRestartingChart] = useState(false);
  const [removingRoommateId, setRemovingRoommateId] = useState<string | null>(
    null,
  );
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [householdSwitcherOpen, setHouseholdSwitcherOpen] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState<boolean | null>(null);
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void isGoogleCalendarConnected()
      .then((connected) => {
        if (active) setGoogleCalendarConnected(connected);
      })
      .catch((error) => reportRuntimeError("check Google Calendar connection", error));
    return () => {
      active = false;
    };
  }, []);
  const toggleGoogleCalendar = async () => {
    if (googleCalendarBusy) return;
    setGoogleCalendarBusy(true);
    try {
      if (googleCalendarConnected) {
        await disconnectGoogleCalendar();
        setGoogleCalendarConnected(false);
      } else {
        await connectGoogleCalendar();
        setGoogleCalendarConnected(true);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      reportRuntimeError("toggle Google Calendar connection", error);
      info(
        "google-calendar-error",
        "Google Calendar",
        error instanceof Error ? error.message : "Something went wrong. Please try again.",
      );
      hapticError();
    } finally {
      setGoogleCalendarBusy(false);
    }
  };
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        reportSupabaseError("sign out from settings", error);
        info("sign_out_error", "Unable to sign out", "Please check your connection and try again.");
      }
      // AuthGate reacts to onAuthStateChange and swaps back to SignInScreen —
      // this component will unmount, so no need to reset state locally.
    } catch (error) {
      reportRuntimeError("sign out from settings", error);
      info("sign_out_error", "Unable to sign out", "Please check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const confirmDeleteHousehold = () => {
    if (!deletingHousehold) setDeleteHouseholdMenuOpen(true);
  };

  const performDeleteHousehold = async () => {
    if (deletingHousehold) return;
    setDeletingHousehold(true);
    try {
      await deleteHousehold();
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      router.replace("/");
    } catch (error) {
      hapticError();
      throw error;
    } finally {
      setDeletingHousehold(false);
    }
  };

  const confirmRestartChart = () => {
    confirm("restart_chart", "Restart chore planning?", "This cancels the current pending proposal and lets your household generate a fresh chart.", () => {
          void (async () => {
            setRestartingChart(true);
            try {
              await restartChartProcess();
              router.push("/planning");
            } catch {
              hapticError();
              info("restart_chart_error", "Could not restart", "Please check your connection and try again.");
            } finally {
              setRestartingChart(false);
            }
          })();
        }, { confirmText: "Restart", destructive: true });
  };

  const confirmRemoveRoommate = (roommateId: string, roommateName: string) => {
    confirm(
      `remove-roommate-${roommateId}`,
      `Remove ${roommateName}?`,
      `${roommateName} will lose access to this household and its shared data. Their Supabase account will remain active, so they can join or create another household.`,
      () => {
        void (async () => {
          setRemovingRoommateId(roommateId);
          try {
            await removeRoommate(roommateId);
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
          } catch (error) {
            hapticError();
            const message =
              error &&
              typeof error === "object" &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : "The roommate could not be removed.";
            info("remove_roommate_error", "Unable to remove roommate", message);
          } finally {
            setRemovingRoommateId(null);
          }
        })();
      },
      { confirmText: "Remove roommate", destructive: true },
    );
  };

  const confirmDeleteOwnAccount = () => {
    confirm(
      "delete-own-account",
      "Delete your account permanently?",
      "This erases your Supabase login and removes you from SweetMate. You can later create a brand-new account with the same email. A host must remove all other roommates first.",
      () => {
        void (async () => {
          setDeletingAccount(true);
          try {
            await deleteOwnAccount();
            await Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
            router.replace("/");
          } catch (error) {
            hapticError();
            const rawMessage =
              error &&
              typeof error === "object" &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : "";
            const message = rawMessage.includes("Remove all other roommates")
              ? "As the host, remove every other roommate before deleting your account."
              : rawMessage || "Your account could not be deleted.";
            info("delete_account_error", "Unable to delete account", message);
          } finally {
            setDeletingAccount(false);
          }
        })();
      },
      { confirmText: "Delete my account", destructive: true },
    );
  };

  const [name, setName] = useState(me?.name ?? "");
  const [color, setColor] = useState(me?.color ?? COLOR_PALETTE[0]);
  const [avatarUri, setAvatarUri] = useState(me?.avatarUri);

  // Re-sync profile editor when the active roommate changes (after switch user)
  useEffect(() => {
    setName(me?.name ?? "");
    setColor(me?.color ?? COLOR_PALETTE[0]);
    setAvatarUri(me?.avatarUri);
  }, [me?.id]);

  // ── Auth state ──
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authPhase, setAuthPhase] = useState<
    "pick" | "creds" | "forgot" | "reset"
  >("pick");
  const [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [authRoommateId, setAuthRoommateId] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Forgot-password flow state
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCodeExpected, setResetCodeExpected] = useState<string | null>(
    null,
  );
  const [resetCodeInput, setResetCodeInput] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetTargetRoommateId, setResetTargetRoommateId] = useState<
    string | null
  >(null);
  const [resetDemoCode, setResetDemoCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getStoredUsername(currentUserId),
      getStoredEmail(currentUserId),
    ])
      .then(([username, email]) => {
        if (cancelled) return;
        setCurrentUsername(username);
        setCurrentEmail(email);
      })
      .catch((error) => {
        reportRuntimeError("load local profile credentials", error, {
          currentUserId,
        });
        if (!cancelled) {
          setCurrentUsername(null);
          setCurrentEmail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const resetAuthForm = () => {
    setAuthRoommateId(null);
    setAuthUsername("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthError(null);
    setAuthInfo(null);
    setForgotEmail("");
    setResetCodeExpected(null);
    setResetCodeInput("");
    setResetNewPassword("");
    setResetTargetRoommateId(null);
    setResetDemoCode(null);
  };

  const openAuth = () => {
    setAuthPhase("pick");
    resetAuthForm();
    setAuthOpen(true);
  };

  const pickRoommateForAuth = async (id: string) => {
    setAuthRoommateId(id);
    setAuthError(null);
    setAuthInfo(null);
    setAuthUsername("");
    setAuthEmail("");
    setAuthPassword("");
    const exists = await hasCredentials(id);
    setAuthMode(exists ? "login" : "setup");
    setAuthPhase("creds");
  };

  const submitAuth = async () => {
    if (!authRoommateId) return;
    if (authMode === "setup") {
      if (!authUsername.trim() || !authEmail.trim() || !authPassword.trim()) {
        setAuthError("Username, email, and password are all required.");
        return;
      }
      if (!isValidEmail(authEmail)) {
        setAuthError("Please enter a valid email address.");
        return;
      }
      if (authPassword.length < 4) {
        setAuthError("Password must be at least 4 characters.");
        return;
      }
    } else {
      if (!authUsername.trim() || !authPassword.trim()) {
        setAuthError("Username and password are both required.");
        return;
      }
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === "login") {
        const ok = await verifyCredentials(
          authRoommateId,
          authUsername.trim(),
          authPassword,
        );
        if (!ok) {
          setAuthError("Incorrect username or password.");
          return;
        }
      } else {
        await setupCredentials(
          authRoommateId,
          authUsername.trim(),
          authEmail.trim(),
          authPassword,
        );
        // Fire-and-forget confirmation email — don't block login on this
        const roommateName =
          roommates.find((r) => r.id === authRoommateId)?.name ?? "there";
        sendEmail(
          authEmail.trim(),
          "Welcome to SweetMate",
          `Hi ${roommateName},\n\nYour SweetMate account was just set up on this device with username "${authUsername.trim()}".\n\nIf this wasn't you, sign in and change your password.\n\n— SweetMate`,
        ).catch(() => {
          // Email failure is non-blocking; user is already logged in
        });
      }
      setCurrentUser(authRoommateId);
      setCurrentUsername(authUsername.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAuthOpen(false);
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Forgot-password flow ──
  const startForgotFlow = () => {
    setAuthError(null);
    setAuthInfo(null);
    setForgotEmail("");
    setResetCodeExpected(null);
    setResetCodeInput("");
    setResetNewPassword("");
    setResetTargetRoommateId(null);
    setResetDemoCode(null);
    setAuthPhase("forgot");
  };

  const submitForgot = async () => {
    setAuthError(null);
    setAuthInfo(null);
    if (!forgotEmail.trim() || !isValidEmail(forgotEmail)) {
      setAuthError("Please enter a valid email address.");
      return;
    }
    setAuthLoading(true);
    try {
      const matchedId = await findRoommateIdByEmail(
        forgotEmail.trim(),
        roommates.map((r) => r.id),
      );
      if (!matchedId) {
        setAuthError("No account found for that email on this device.");
        return;
      }
      const code = generateResetCode();
      setResetCodeExpected(code);
      setResetTargetRoommateId(matchedId);
      const roommateName =
        roommates.find((r) => r.id === matchedId)?.name ?? "there";
      try {
        const result = await sendEmail(
          forgotEmail.trim(),
          "Your SweetMate reset code",
          `Hi ${roommateName},\n\nYour SweetMate password reset code is:\n\n${code}\n\nThis code is good for one reset. If you didn't request a reset, ignore this email.\n\n— SweetMate`,
        );
        if (result.simulated) {
          setResetDemoCode(code);
        } else {
          setResetDemoCode(null);
        }
      } catch {
        // Network/email failure — still let them proceed, show the code in-app
        setResetDemoCode(code);
      }
      setAuthPhase("reset");
    } finally {
      setAuthLoading(false);
    }
  };

  const submitReset = async () => {
    setAuthError(null);
    if (!resetCodeInput.trim() || !resetNewPassword.trim()) {
      setAuthError("Code and new password are both required.");
      return;
    }
    if (resetCodeInput.trim() !== resetCodeExpected) {
      setAuthError("That code doesn't match. Try again.");
      return;
    }
    if (resetNewPassword.length < 4) {
      setAuthError("New password must be at least 4 characters.");
      return;
    }
    if (!resetTargetRoommateId) return;
    setAuthLoading(true);
    try {
      const ok = await updatePassword(resetTargetRoommateId, resetNewPassword);
      if (!ok) {
        setAuthError("Couldn't update password — credential is missing.");
        return;
      }
      setCurrentUser(resetTargetRoommateId);
      const u = await getStoredUsername(resetTargetRoommateId);
      setCurrentUsername(u);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAuthOpen(false);
      resetAuthForm();
    } finally {
      setAuthLoading(false);
    }
  };

  const topPad = Platform.OS === "web" ? 16 : insets.top;
  const dirty =
    name.trim() !== (me?.name ?? "") ||
    color !== (me?.color ?? "") ||
    avatarUri !== me?.avatarUri;

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setAvatarUri(result.assets[0].uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const removePhoto = () => {
    setAvatarUri(undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const save = async () => {
    if (!name.trim()) return;
    try {
      await updateRoommate(currentUserId, {
        name: name.trim(),
        color,
        avatarUri,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      reportRuntimeError("save Sweetmate profile", error);
      info("profile_save_error", "Unable to save profile", "Please check your connection and try again.");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.iconBtn} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          SWEETMATE SETTINGS
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Close settings"
        >
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[styles.settingsIntro, { borderBottomColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.settingsIntroTitle,
                  { color: colors.foreground },
                ]}
              >
                MAKE SWEETMATE YOURS
              </Text>
              <Text
                style={[
                  styles.settingsIntroSub,
                  { color: colors.mutedForeground },
                ]}
              >
                Profile, household tools, and account access
              </Text>
            </View>
          </View>
          {/* Profile section */}
          {/* Account section — login / switch / logout */}
          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            YOUR HOUSEHOLD
          </Text>
          <View
            style={[
              styles.card,
              styles.householdCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.activeHouseholdRow}>
              <View
                style={[
                  styles.linkIcon,
                  { backgroundColor: colors.primary + "18" },
                ]}
              >
                <Feather name="home" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  ACTIVE HOUSEHOLD
                </Text>
                <Text
                  style={[styles.accountName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {householdName ?? "No household selected"}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Switch household"
              style={[
                styles.householdSwitchButton,
                { borderColor: colors.border },
              ]}
              onPress={() => setHouseholdSwitcherOpen(true)}
            >
              <Feather name="repeat" size={17} color={colors.primary} />
              <Text
                style={[
                  styles.householdSwitchButtonText,
                  { color: colors.foreground },
                ]}
              >
                {memberships.length > 1
                  ? "Switch household"
                  : "Manage households"}
              </Text>
              <Feather
                name="chevron-right"
                size={17}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
            <View style={styles.accountRow}>
              <RoommateAvatar
                name={me?.name ?? "?"}
                color={me?.color ?? colors.primary}
                size={48}
                imageUri={me?.avatarUri}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.accountName, { color: colors.foreground }]}
                >
                  {me?.name ?? "Unknown"}
                </Text>
                <Text
                  style={[
                    styles.accountUsername,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {householdName ?? "Your household"}
                </Text>
                <Text
                  style={[
                    styles.accountUsername,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {roommates.length}{" "}
                  {roommates.length === 1 ? "member" : "members"}
                </Text>
              </View>
              <Feather name="shield" size={16} color={colors.success} />
            </View>
            <View style={styles.householdTileGroup}>
              <InviteCodeCard
                compact
                inviteCode={inviteCode}
                loading={householdLoading}
                onRetry={refreshHousehold}
              />
            </View>
            {isHost &&
            roommates.some((roommate) => roommate.id !== currentUserId) ? (
              <View
                style={[
                  styles.memberManagement,
                  { borderTopColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.memberManagementTitle,
                    { color: colors.foreground },
                  ]}
                >
                  HOUSEHOLD MEMBERS
                </Text>
                <Text
                  style={[
                    styles.memberManagementHint,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Removing someone only revokes household access. It does not
                  delete their account.
                </Text>
                {roommates
                  .filter((roommate) => roommate.id !== currentUserId)
                  .map((roommate) => (
                    <View key={roommate.id} style={styles.memberManagementRow}>
                      <RoommateAvatar
                        name={roommate.name}
                        color={roommate.color}
                        size={36}
                        imageUri={roommate.avatarUri}
                      />
                      <Text
                        style={[
                          styles.memberManagementName,
                          { color: colors.foreground },
                        ]}
                      >
                        {roommate.name}
                      </Text>
                      <TouchableOpacity
                        onPress={() =>
                          confirmRemoveRoommate(roommate.id, roommate.name)
                        }
                        disabled={removingRoommateId !== null}
                        style={[
                          styles.memberRemoveBtn,
                          {
                            borderColor: colors.destructive,
                            opacity: removingRoommateId !== null ? 0.55 : 1,
                          },
                        ]}
                      >
                        <Feather
                          name="user-minus"
                          size={13}
                          color={colors.destructive}
                        />
                        <Text
                          style={[
                            styles.memberRemoveText,
                            { color: colors.destructive },
                          ]}
                        >
                          {removingRoommateId === roommate.id
                            ? "Removing…"
                            : "Remove"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
              </View>
            ) : null}
            <TouchableOpacity
              disabled={deletingHousehold}
              onPress={confirmDeleteHousehold}
              style={[
                styles.switchUserBtn,
                {
                  backgroundColor: colors.destructive,
                  opacity: deletingHousehold ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="trash-2" size={15} color="#fff" />
              <Text style={styles.switchUserBtnText}>
                {deletingHousehold ? "Deleting household…" : "Delete household"}
              </Text>
            </TouchableOpacity>
          </View>

          <Modal
            visible={householdSwitcherOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setHouseholdSwitcherOpen(false)}
          >
            <Pressable
              style={styles.switcherBackdrop}
              onPress={() => setHouseholdSwitcherOpen(false)}
            />
            <View
              style={[
                styles.switcherSheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  paddingBottom: insets.bottom + 18,
                },
              ]}
            >
              <View
                style={[
                  styles.switcherHandle,
                  { backgroundColor: colors.border },
                ]}
              />
              <View style={styles.switcherHeader}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.switcherTitle, { color: colors.foreground }]}
                  >
                    Manage Households
                  </Text>
                  <Text
                    style={[
                      styles.switcherSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    View, switch, create, or join your households
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setHouseholdSwitcherOpen(false)}
                  style={[
                    styles.switcherCloseButton,
                    { backgroundColor: colors.muted },
                  ]}
                  accessibilityLabel="Close household selector"
                >
                  <Feather name="x" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.membershipListViewport}
                contentContainerStyle={styles.membershipList}
                showsVerticalScrollIndicator={false}
              >
                {householdLoading ? (
                  <View style={styles.membershipLoading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={[styles.emptyMembershipText, { color: colors.mutedForeground }]}>Loading your households…</Text>
                  </View>
                ) : memberships.length === 0 ? (
                  <Text
                    style={[
                      styles.emptyMembershipText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    You do not belong to a household yet.
                  </Text>
                ) : (
                  memberships.map((membership) => {
                    const selected = membership.sweetId === activeSweetId;
                    return (
                      <TouchableOpacity
                        key={membership.id}
                        style={[
                          styles.membershipRow,
                          {
                            borderColor: selected
                              ? colors.primary
                              : colors.border,
                            backgroundColor: selected
                              ? colors.primary + "0F"
                              : colors.background,
                          },
                        ]}
                        onPress={() => {
                          if (!selected) switchSweet(membership.sweetId);
                          setHouseholdSwitcherOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${membership.name}, ${membership.role}, ${membership.memberCount ?? 1} members${selected ? ", selected" : ""}`}
                      >
                        <View
                          style={[
                            styles.sweetIcon,
                            { backgroundColor: colors.secondary },
                          ]}
                        >
                          <Feather
                            name="home"
                            size={17}
                            color={colors.primary}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={[
                              styles.sweetName,
                              { color: colors.foreground },
                            ]}
                            numberOfLines={1}
                          >
                            {membership.name}
                          </Text>
                          <Text
                            style={[
                              styles.sweetMeta,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {membership.role === "owner" ? "Host" : "Member"} ·{" "}
                            {membership.memberCount ?? 1}{" "}
                            {(membership.memberCount ?? 1) === 1
                              ? "member"
                              : "members"}
                          </Text>
                        </View>
                        {selected && (
                          <Feather
                            name="check-circle"
                            size={20}
                            color={colors.primary}
                          />
                        )}
                        {membership.role !== "owner" ? <TouchableOpacity
                          onPress={(event) => {
                            event.stopPropagation();
                            confirm("leave_household", `Leave ${membership.name}?`, "You will lose access to this household’s shared data. Your other households are not affected.", () =>
                              leaveSweet(membership.sweetId), { confirmText: "Leave", destructive: true });
                          }}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Leave ${membership.name}`}
                        >
                          <Feather
                            name="log-out"
                            size={17}
                            color={colors.mutedForeground}
                          />
                        </TouchableOpacity> : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
              <View style={styles.switcherActionRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Create a household"
                style={[
                  styles.switcherActionButton,
                  { borderColor: colors.border },
                ]}
                onPress={() => {
                  setHouseholdSwitcherOpen(false);
                  router.push("/sweet-setup?mode=create&additional=1" as never);
                }}
              >
                <Feather name="plus-circle" size={18} color={colors.primary} />
                <Text
                  style={[
                    styles.switcherActionText,
                    { color: colors.foreground },
                  ]}
                >
                  Create Household
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Join a household"
                style={[styles.switcherActionButton, { borderColor: colors.border }]}
                onPress={() => {
                  setHouseholdSwitcherOpen(false);
                  router.push("/sweet-setup?mode=join&additional=1" as never);
                }}
              >
                <Feather name="user-plus" size={18} color={colors.primary} />
                <Text style={[styles.switcherActionText, { color: colors.foreground }]}>Join Household</Text>
              </TouchableOpacity>
              </View>
            </View>
          </Modal>

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            GOOGLE CALENDAR
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.activeHouseholdRow}>
              <View
                style={[
                  styles.linkIcon,
                  { backgroundColor: colors.primary + "18" },
                ]}
              >
                <Feather name="calendar" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  ADD TO CALENDAR
                </Text>
                <Text
                  style={[styles.accountName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {googleCalendarConnected === null
                    ? "Checking connection…"
                    : googleCalendarConnected
                      ? "Connected to your Google Calendar"
                      : "Not connected"}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              disabled={googleCalendarBusy || googleCalendarConnected === null}
              accessibilityRole="button"
              accessibilityLabel={googleCalendarConnected ? "Disconnect Google Calendar" : "Connect Google Calendar"}
              style={[
                styles.householdSwitchButton,
                { borderColor: colors.border, opacity: googleCalendarBusy ? 0.6 : 1 },
              ]}
              onPress={toggleGoogleCalendar}
            >
              <Feather
                name={googleCalendarConnected ? "x-circle" : "link"}
                size={17}
                color={colors.primary}
              />
              <Text
                style={[
                  styles.householdSwitchButtonText,
                  { color: colors.foreground },
                ]}
              >
                {googleCalendarBusy
                  ? "Working…"
                  : googleCalendarConnected
                    ? "Disconnect Google Calendar"
                    : "Connect Google Calendar"}
              </Text>
              {!googleCalendarBusy && (
                <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          </View>

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            YOUR PROFILE
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {/* Avatar preview + photo controls */}
            <View style={styles.avatarRow}>
              <RoommateAvatar
                name={name || "?"}
                color={color}
                size={84}
                imageUri={avatarUri}
              />
              <View style={{ flex: 1, gap: 8 }}>
                <TouchableOpacity
                  style={[styles.photoBtn, { backgroundColor: colors.primary }]}
                  onPress={pickImage}
                >
                  <Feather name="camera" size={14} color="#fff" />
                  <Text style={styles.photoBtnText}>
                    {avatarUri ? "Change Photo" : "Choose Photo"}
                  </Text>
                </TouchableOpacity>
                {avatarUri ? (
                  <TouchableOpacity
                    style={[
                      styles.photoSecondaryBtn,
                      { borderColor: colors.border },
                    ]}
                    onPress={removePhoto}
                  >
                    <Feather
                      name="x"
                      size={13}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.photoSecondaryText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Remove
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Name input */}
            <Text
              style={[styles.fieldLabel, { color: colors.mutedForeground }]}
            >
              DISPLAY NAME
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.muted,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
              maxLength={32}
            />

            {/* Color picker */}
            <Text
              style={[styles.fieldLabel, { color: colors.mutedForeground }]}
            >
              PROFILE COLOR
            </Text>
            <View style={styles.colorRow}>
              {COLOR_PALETTE.map((c) => {
                const selected = color === c;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => {
                      setColor(c);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={[
                      styles.colorSwatch,
                      {
                        backgroundColor: c,
                        borderColor: selected
                          ? colors.foreground
                          : "transparent",
                        borderWidth: selected ? 3 : 0,
                      },
                    ]}
                  >
                    {selected && (
                      <Feather name="check" size={16} color="#fff" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Planning section */}
          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            HOUSEHOLD TOOLS
          </Text>
          <HouseholdCompletionControl />
          <TouchableOpacity
            style={[
              styles.linkRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push("/task-difficulty")}
          >
            <View
              style={[
                styles.linkIcon,
                { backgroundColor: colors.accent + "18" },
              ]}
            >
              <Feather name="bar-chart-2" size={19} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                TASK DIFFICULTY
              </Text>
              <Text style={[styles.linkSub, { color: colors.mutedForeground }]}>
                Review and edit shared difficulty levels
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Chore Chart planning"
            style={[
              styles.linkRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push("/planning?type=chore-chart" as never)}
          >
            <View
              style={[
                styles.linkIcon,
                { backgroundColor: colors.primary + "18" },
              ]}
            >
              <Feather name="calendar" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                CHORE CHART
              </Text>
              <Text style={[styles.linkSub, { color: colors.mutedForeground }]}>
                Build a fair shared schedule for household chores
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Sweet Essentials"
            style={[
              styles.linkRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push("/planning?type=home-checklist" as never)}
          >
            <View
              style={[
                styles.linkIcon,
                { backgroundColor: colors.accent + "18" },
              ]}
            >
              <Feather name="shopping-bag" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                SWEET ESSENTIALS
              </Text>
              <Text style={[styles.linkSub, { color: colors.mutedForeground }]}>
                Browse the optional checklist for setting up your Sweet
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.linkRow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: restartingChart ? 0.6 : 1,
              },
            ]}
            onPress={confirmRestartChart}
            disabled={restartingChart}
          >
            <View
              style={[
                styles.linkIcon,
                { backgroundColor: colors.warning + "18" },
              ]}
            >
              <Feather name="rotate-ccw" size={18} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                RESTART CHART PROCESS
              </Text>
              <Text style={[styles.linkSub, { color: colors.mutedForeground }]}>
                {currentProposedChart?.status === "pending"
                  ? "Cancel the pending proposal and generate a new one"
                  : "Return to planning and generate a fresh proposal"}
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>

          <CollapsibleSettingsSection
            title="APP PREFERENCES"
            subtitle="Appearance, features, and behavior"
            icon="sliders"
          >
            <UserPreferencesPanel />
          </CollapsibleSettingsSection>

          {session?.user.id ? (
            <CollapsibleSettingsSection
              title="PRIVACY & DIAGNOSTICS"
              subtitle="Analytics and diagnostic sharing"
              icon="shield"
            >
              <AnalyticsPreferencesPanel userId={session.user.id} />
            </CollapsibleSettingsSection>
          ) : null}

          <Text
            style={[styles.sectionLabel, { color: colors.mutedForeground }]}
          >
            HELP
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Quick guide"
            style={[
              styles.linkRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              track.quickGuideOpened({ source: "settings" });
              openQuickGuide();
            }}
          >
            <View
              style={[
                styles.linkIcon,
                { backgroundColor: colors.primary + "18" },
              ]}
            >
              <Feather name="info" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.linkTitle, { color: colors.foreground }]}>
                QUICK GUIDE
              </Text>
              <Text style={[styles.linkSub, { color: colors.mutedForeground }]}>
                Revisit a few helpful SweetMate features
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>

          <CollapsibleSettingsSection
            title="ACCOUNT"
            subtitle={session?.user.email ?? "Sign-in and account controls"}
            icon="user"
          >
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.accountRow}>
                <View
                  style={[
                    styles.accountIcon,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Feather name="cloud" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[styles.accountName, { color: colors.foreground }]}
                  >
                    Signed in
                  </Text>
                  <Text
                    style={[
                      styles.accountUsername,
                      { color: colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {session?.user.email ?? "—"}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.switchUserBtn,
                  {
                    backgroundColor: colors.destructive,
                    opacity: signingOut ? 0.6 : 1,
                  },
                ]}
                onPress={handleSignOut}
                disabled={signingOut}
              >
                <Feather name="log-out" size={14} color="#fff" />
                <Text style={styles.switchUserBtnText}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.outlineDangerBtn,
                  {
                    borderColor: colors.destructive,
                    opacity: deletingAccount ? 0.6 : 1,
                  },
                ]}
                onPress={confirmDeleteOwnAccount}
                disabled={deletingAccount}
              >
                <Feather name="user-x" size={14} color={colors.destructive} />
                <Text
                  style={[
                    styles.outlineDangerBtnText,
                    { color: colors.destructive },
                  ]}
                >
                  {deletingAccount
                    ? "Deleting account…"
                    : "Delete my account"}
                </Text>
              </TouchableOpacity>
              <Text
                style={[styles.accountHint, { color: colors.mutedForeground }]}
              >
                Permanently deletes your login. This is separate from leaving
                or removing someone from a household.
              </Text>
            </View>
          </CollapsibleSettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky save button */}
      {dirty && (
        <View
          style={[
            styles.stickyBottom,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.saveBtn,
              { backgroundColor: name.trim() ? colors.primary : colors.muted },
            ]}
            disabled={!name.trim()}
            onPress={save}
          >
            <Text style={styles.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      )}

      <ActionMenuModal
        visible={deleteHouseholdMenuOpen}
        title={householdName ?? "This household"}
        subtitle="Deleting this household permanently removes its chores, expenses, shopping lists, borrowing records, and memberships."
        onClose={() => setDeleteHouseholdMenuOpen(false)}
        actions={[
          {
            key: "delete-household",
            label: deletingHousehold
              ? "Deleting household…"
              : "Delete household",
            icon: "trash-2",
            destructive: true,
            confirmation: {
              title: `Delete ${householdName ?? "this household"}?`,
              message:
                "This cannot be undone. Your other households are not affected.",
              confirmLabel: "Delete permanently",
            },
            onPress: performDeleteHousehold,
          },
        ]}
      />

      {/* ── Auth modal: pick roommate, then enter credentials ── */}
      <Modal
        visible={authOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAuthOpen(false)}
      >
        <Pressable
          style={styles.authOverlay}
          onPress={() => setAuthOpen(false)}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.authSheet,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 24,
              },
            ]}
          >
            <View
              style={[styles.authHandle, { backgroundColor: colors.border }]}
            />

            {authPhase === "pick" ? (
              <>
                <Text style={[styles.authTitle, { color: colors.foreground }]}>
                  Choose roommate
                </Text>
                <Text
                  style={[styles.authSub, { color: colors.mutedForeground }]}
                >
                  Pick a roommate to log in as. You'll need their password.
                </Text>
                {roommates.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      styles.roommateRow,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.muted,
                      },
                    ]}
                    onPress={() => pickRoommateForAuth(r.id)}
                  >
                    <RoommateAvatar
                      name={r.name}
                      color={r.color}
                      size={36}
                      imageUri={r.avatarUri}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.roommateRowName,
                          { color: colors.foreground },
                        ]}
                      >
                        {r.name}
                        {r.id === currentUserId && (
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontFamily: "Inter_400Regular",
                            }}
                          >
                            {"  · current"}
                          </Text>
                        )}
                      </Text>
                    </View>
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                ))}
              </>
            ) : authPhase === "creds" ? (
              <>
                <Text style={[styles.authTitle, { color: colors.foreground }]}>
                  {authMode === "setup"
                    ? `Set up ${roommates.find((r) => r.id === authRoommateId)?.name}'s account`
                    : `Log in as ${roommates.find((r) => r.id === authRoommateId)?.name}`}
                </Text>
                <Text
                  style={[styles.authSub, { color: colors.mutedForeground }]}
                >
                  {authMode === "setup"
                    ? "Choose a username, email, and password — they'll be encrypted on the device."
                    : "Enter the username and password for this roommate."}
                </Text>
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  Username
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Username"
                  placeholderTextColor={colors.mutedForeground}
                  value={authUsername}
                  onChangeText={setAuthUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                {authMode === "setup" && (
                  <>
                    <Text
                      style={[
                        styles.fieldLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Email
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.muted,
                          color: colors.foreground,
                          borderColor: colors.border,
                        },
                      ]}
                      placeholder="you@example.com"
                      placeholderTextColor={colors.mutedForeground}
                      value={authEmail}
                      onChangeText={setAuthEmail}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </>
                )}
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  Password
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={colors.mutedForeground}
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {authMode === "login" && (
                  <TouchableOpacity
                    onPress={startForgotFlow}
                    style={{ alignSelf: "flex-end" }}
                  >
                    <Text style={[styles.linkText, { color: colors.primary }]}>
                      Forgot password?
                    </Text>
                  </TouchableOpacity>
                )}
                {authError && (
                  <Text
                    style={[
                      styles.authErrorText,
                      { color: colors.destructive },
                    ]}
                  >
                    {authError}
                  </Text>
                )}
                <View style={styles.authBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.authBackBtn,
                      { backgroundColor: colors.muted },
                    ]}
                    onPress={() => setAuthPhase("pick")}
                  >
                    <Text
                      style={[styles.authBtnText, { color: colors.foreground }]}
                    >
                      Back
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.authPrimaryBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: authLoading ? 0.6 : 1,
                      },
                    ]}
                    disabled={authLoading}
                    onPress={submitAuth}
                  >
                    <Text style={[styles.authBtnText, { color: "#fff" }]}>
                      {authLoading
                        ? "..."
                        : authMode === "setup"
                          ? "Save & Log In"
                          : "Log In"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : authPhase === "forgot" ? (
              <>
                <Text style={[styles.authTitle, { color: colors.foreground }]}>
                  Forgot password
                </Text>
                <Text
                  style={[styles.authSub, { color: colors.mutedForeground }]}
                >
                  Enter the email you used when setting up the account. We'll
                  send a 6-digit reset code there.
                </Text>
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  Email
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoFocus
                />
                {authError && (
                  <Text
                    style={[
                      styles.authErrorText,
                      { color: colors.destructive },
                    ]}
                  >
                    {authError}
                  </Text>
                )}
                <View style={styles.authBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.authBackBtn,
                      { backgroundColor: colors.muted },
                    ]}
                    onPress={() => setAuthPhase("creds")}
                  >
                    <Text
                      style={[styles.authBtnText, { color: colors.foreground }]}
                    >
                      Back
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.authPrimaryBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: authLoading ? 0.6 : 1,
                      },
                    ]}
                    disabled={authLoading}
                    onPress={submitForgot}
                  >
                    <Text style={[styles.authBtnText, { color: "#fff" }]}>
                      {authLoading ? "Sending..." : "Send reset code"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.authTitle, { color: colors.foreground }]}>
                  Reset password
                </Text>
                <Text
                  style={[styles.authSub, { color: colors.mutedForeground }]}
                >
                  Enter the 6-digit code from your email and choose a new
                  password.
                </Text>
                {resetDemoCode && (
                  <View
                    style={[
                      styles.demoCodeBox,
                      {
                        backgroundColor: colors.warning + "15",
                        borderColor: colors.warning + "55",
                      },
                    ]}
                  >
                    <Feather
                      name="alert-circle"
                      size={14}
                      color={colors.warning}
                    />
                    <Text
                      style={[styles.demoCodeText, { color: colors.warning }]}
                    >
                      Demo mode (no email service configured). Your code:{" "}
                      <Text style={{ fontFamily: "Inter_700Bold" }}>
                        {resetDemoCode}
                      </Text>
                    </Text>
                  </View>
                )}
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  Reset code
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  value={resetCodeInput}
                  onChangeText={setResetCodeInput}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <Text
                  style={[styles.fieldLabel, { color: colors.mutedForeground }]}
                >
                  New password
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="At least 4 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={resetNewPassword}
                  onChangeText={setResetNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {authError && (
                  <Text
                    style={[
                      styles.authErrorText,
                      { color: colors.destructive },
                    ]}
                  >
                    {authError}
                  </Text>
                )}
                <View style={styles.authBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.authBackBtn,
                      { backgroundColor: colors.muted },
                    ]}
                    onPress={() => setAuthPhase("forgot")}
                  >
                    <Text
                      style={[styles.authBtnText, { color: colors.foreground }]}
                    >
                      Back
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.authPrimaryBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: authLoading ? 0.6 : 1,
                      },
                    ]}
                    disabled={authLoading}
                    onPress={submitReset}
                  >
                    <Text style={[styles.authBtnText, { color: "#fff" }]}>
                      {authLoading ? "..." : "Reset & Log In"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 2,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 23, letterSpacing: 1.8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 10,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    shadowColor: "#4A3426",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  householdCard: {
    gap: 18,
  },
  householdTileGroup: {
    gap: 8,
  },
  activeHouseholdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  householdSwitchButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  householdSwitchButtonText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  switcherBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  switcherSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    padding: 18,
  },
  switcherHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  switcherHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  switcherTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  switcherSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  switcherCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  membershipList: { gap: 9 },
  membershipListViewport: { maxHeight: 330 },
  membershipLoading: { alignItems: "center", paddingVertical: 14 },
  membershipRow: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sweetIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sweetName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  sweetMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  emptyMembershipText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    paddingVertical: 16,
    textAlign: "center",
  },
  switcherActionButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  switcherActionRow: { gap: 9 },
  switcherActionText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  settingsIntro: {
    marginHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsIntroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 19,
    letterSpacing: 1.4,
  },
  settingsIntroSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    marginTop: 2,
  },
  collapsibleSection: {
    marginTop: 20,
  },
  collapsibleHeader: {
    minHeight: 72,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  collapsibleHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  collapsibleTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    letterSpacing: 1,
  },
  collapsibleSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  collapsibleContent: {
    gap: 10,
    paddingTop: 10,
  },
  accountIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 4,
  },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  photoBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  photoSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  photoSecondaryText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  fieldLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 17,
  },
  linkIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  linkTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    letterSpacing: 1.1,
  },
  linkSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  stickyBottom: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },

  // ── Account section ──
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accountName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    letterSpacing: 0.5,
  },
  accountUsername: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 2,
  },
  switchUserBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 10,
  },
  switchUserBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  outlineDangerBtn: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  outlineDangerBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  accountHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  memberManagement: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    gap: 10,
  },
  memberManagementTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    letterSpacing: 1.1,
  },
  memberManagementHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 15,
  },
  memberManagementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberManagementName: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  memberRemoveBtn: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberRemoveText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },

  // ── Auth modal ──
  authOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  authSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
  },
  authHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 6,
  },
  authTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  authSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 8 },
  roommateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  roommateRowName: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  authErrorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginTop: 2,
  },
  authBtnRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  authBackBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  authPrimaryBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  authBtnText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  linkText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginTop: 2,
    textDecorationLine: "underline",
  },
  demoCodeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  demoCodeText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 17,
  },
});
