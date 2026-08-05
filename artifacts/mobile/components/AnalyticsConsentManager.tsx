import React, { useEffect, useSyncExternalStore } from "react";
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
import {
  analyticsSnapshot,
  loadAnalyticsPreferences,
  PRIVACY_NOTICE_VERSION,
  resetAnalyticsIdentity,
  saveAnalyticsPreferences,
  subscribeAnalytics,
} from "@/lib/analytics";

function openPrivacyPolicy(onError: () => void) {
  void Linking.openURL("https://sweetmate.info/privacy").catch(() => {
    onError();
  });
}

export function useAnalyticsPreferences(userId: string | null) {
  return useSyncExternalStore(
    subscribeAnalytics,
    () => analyticsSnapshot(userId),
    () => analyticsSnapshot(userId),
  );
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
        "Share anonymous feature-use events with PostHog. SweetMate never sends chore titles, shopping items, expense notes, names, email addresses, or invite codes.",
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
              void saveAnalyticsPreferences(userId, { [row.key]: value })
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

  useEffect(() => {
    if (userId) void loadAnalyticsPreferences(userId);
    else void resetAnalyticsIdentity();
  }, [userId]);

  const visible =
    Boolean(userId) && loaded && preferences.noticeVersion !== PRIVACY_NOTICE_VERSION;
  if (!userId) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.notice, { backgroundColor: colors.card }]}>
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
            Your privacy choices
          </Text>
          <Text style={[styles.noticeBody, { color: colors.mutedForeground }]}>
            SweetMate now offers optional product analytics and crash reporting.
            Both are off unless you enable them, and household content is excluded.
            You can change either choice anytime in Settings.
          </Text>
          <TouchableOpacity
            accessibilityRole="link"
            onPress={openPolicy}
          >
            <Text style={[styles.policyText, { color: colors.primary }]}>Review Privacy Policy</Text>
          </TouchableOpacity>
          <View style={styles.consentActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Don't share optional analytics"
              style={[
                styles.consentButton,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
              onPress={() =>
                void saveAnalyticsPreferences(userId, {
                  productAnalyticsEnabled: false,
                  crashReportingEnabled: false,
                  noticeVersion: PRIVACY_NOTICE_VERSION,
                })
              }
            >
              <Text style={[styles.consentText, { color: colors.foreground }]}>
                {"Don't share"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Share optional product analytics"
              style={[
                styles.consentButton,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
              onPress={() =>
                void saveAnalyticsPreferences(userId, {
                  productAnalyticsEnabled: true,
                  crashReportingEnabled: false,
                  noticeVersion: PRIVACY_NOTICE_VERSION,
                })
              }
            >
              <Text style={[styles.consentText, { color: colors.primary }]}>
                Share analytics
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16, borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { minHeight: 76, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  description: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  policyLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  policyText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notice: { width: "100%", maxWidth: 440, borderRadius: 20, padding: 22 },
  noticeTitle: { fontFamily: "Inter_700Bold", fontSize: 22 },
  noticeBody: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, marginVertical: 12 },
  consentActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  consentButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  consentText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    textAlign: "center",
  },
});
