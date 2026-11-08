import React, { useEffect, useState, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Linking,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "@/constants/colors";
import { useAppPopup } from "@/components/AppPopupProvider";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { GlassButton } from "@/components/GlassButton";
import {
  analyticsSnapshot,
  loadAnalyticsPreferences,
  PRIVACY_NOTICE_VERSION,
  saveAnalyticsPreferences,
  subscribeAnalytics,
} from "@/lib/analytics";

function openPrivacyPolicy(onError: () => void) {
  void Linking.openURL("https://sweetmate.info/privacy").catch(() => {
    onError();
  });
}

export function useAnalyticsPreferences(userId: string | null) {
  const snapshot = useSyncExternalStore(
    subscribeAnalytics,
    () => analyticsSnapshot(userId),
    () => analyticsSnapshot(userId),
  );
  return { ...snapshot, ready: snapshot.loaded && snapshot.preferences.noticeVersion === PRIVACY_NOTICE_VERSION };
}

export function AnalyticsPreferencesPanel({ userId }: { userId: string }) {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const openPolicy = () => openPrivacyPolicy(() => showPopup({ title: "Privacy Policy unavailable", message: "Check your connection and try again, or visit sweetmate.info/privacy in a browser.", actions: [{ label: "Got it", primary: true }] }));
  const { preferences } = useAnalyticsPreferences(userId);
  const rows = [
    {
      key: "productAnalyticsEnabled" as const,
      title: "Product analytics",
      description:
        "Share app opens, screens visited, active time, setup progress, and feature-use events with PostHog using a random identifier. SweetMate never sends chore titles, shopping items, expense notes, names, email addresses, or invite codes.",
    },
    {
      key: "crashReportingEnabled" as const,
      title: "Crash reporting",
      description:
        "Share sanitized crash details with Sentry to help us diagnose failures. Session replay, request data, and personal content are disabled.",
    },
  ];
  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        <View
          key={row.key}
          style={[
            styles.row,
            index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
          ]}
        >
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>{row.title}</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {row.description}
            </Text>
          </View>
          <Switch
            value={preferences[row.key]}
            onValueChange={(value) =>
              void saveAnalyticsPreferences(userId, {
                [row.key]: value,
                ...(row.key === "productAnalyticsEnabled" ? { noticeVersion: PRIVACY_NOTICE_VERSION } : {}),
              }).catch(() => showPopup({ title: "Choice couldn't be saved", message: "Please try again.", actions: [{ label: "Got it", primary: true }] }))
            }
            accessibilityLabel={`${row.title}: ${preferences[row.key] ? "on" : "off"}`}
          />
        </View>
      ))}
      <TouchableOpacity
        accessibilityRole="link"
        onPress={openPolicy}
        style={styles.policyLink}
      >
        <Text style={[styles.policyText, { color: colors.primary }]}>Read the Privacy Policy</Text>
      </TouchableOpacity>
    </View>
  );
}

export function AnalyticsConsentManager({ session }: { session: Session | null }) {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const openPolicy = () => openPrivacyPolicy(() => showPopup({ title: "Privacy Policy unavailable", message: "Check your connection and try again, or visit sweetmate.info/privacy in a browser.", actions: [{ label: "Got it", primary: true }] }));
  const userId = session?.user.id ?? null;
  const { loaded, preferences } = useAnalyticsPreferences(userId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadAnalyticsPreferences(userId).catch(() => {
      showPopup({ title: "Privacy choices unavailable", message: "Please reopen SweetMate to try loading your privacy choices again.", actions: [{ label: "Got it", primary: true }] });
    });
  }, [userId]);

  const choose = async (share: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      await saveAnalyticsPreferences(userId, {
        productAnalyticsEnabled: share,
        crashReportingEnabled: false,
        noticeVersion: PRIVACY_NOTICE_VERSION,
      }, userId ? "privacy_notice" : "before_auth");
    } catch {
      showPopup({ title: "Choice couldn't be saved", message: "Please try again. Optional analytics stays paused until your choice is saved.", actions: [{ label: "Got it", primary: true }] });
    } finally { setSaving(false); }
  };

  const visible =
    loaded && preferences.noticeVersion !== PRIVACY_NOTICE_VERSION;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <GlassModalBackdrop />
        <GlassModalSurface style={styles.notice}>
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
            Your privacy choices
          </Text>
          <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>
            Help improve SweetMate by sharing app opens, screens visited, active
            time, setup progress, and feature-use events with a random identifier.
            Sharing is optional and starts only if you choose it. Household content
            is excluded. Crash reporting stays off; you can change either choice
            later in Settings.
          </Text>
          <TouchableOpacity
            accessibilityRole="link"
            onPress={openPolicy}
          >
            <Text style={[styles.policyText, { color: colors.primary }]}>Review Privacy Policy</Text>
          </TouchableOpacity>
          <View style={styles.consentActions}>
            <GlassButton
              accessibilityRole="button"
              accessibilityLabel="Don't share optional analytics"
              tone="neutral"
              style={styles.consentButton}
              disabled={saving}
              onPress={() => void choose(false)}
            >
              <Text style={[styles.consentText, { color: "#fff" }]}>
                {"Don't share"}
              </Text>
            </GlassButton>
            <GlassButton
              accessibilityRole="button"
              accessibilityLabel="Share optional product analytics"
              style={styles.consentButton}
              disabled={saving}
              onPress={() => void choose(true)}
            >
              <Text style={[styles.consentText, { color: "#fff" }]}>
                Share analytics
              </Text>
            </GlassButton>
          </View>
        </GlassModalSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16, borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { minHeight: 76, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 15 },
  description: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, lineHeight: 17, marginTop: 3 },
  policyLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  policyText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notice: { width: "100%", maxWidth: 440, borderRadius: 30, padding: 22 },
  noticeTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 22 },
  noticeBody: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 14, lineHeight: 20, marginVertical: 12 },
  consentActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  consentButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 25,
  },
  consentText: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 14,
    textAlign: "center",
  },
});
