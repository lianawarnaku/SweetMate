import { AppSwitch } from "@/components/AppSwitch";
import React, { useEffect, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Linking,
  StyleSheet,
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
  ITEM_NAME_NOTICE_VERSION,
  ITEM_NAME_ANALYTICS_AVAILABLE,
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
  const { preferences, loaded } = useAnalyticsPreferences(userId);
  const productAllowed = preferences.productAnalyticsEnabled && preferences.noticeVersion === PRIVACY_NOTICE_VERSION;
  const isChoiceEnabled = (key: "productAnalyticsEnabled" | "crashReportingEnabled" | "itemNamesEnabled") =>
    key === "itemNamesEnabled" ? productAllowed && preferences.itemNamesEnabled && preferences.itemNamesNoticeVersion === ITEM_NAME_NOTICE_VERSION
      : preferences.noticeVersion === PRIVACY_NOTICE_VERSION && preferences[key];
  const changeChoice = (key: "productAnalyticsEnabled" | "crashReportingEnabled" | "itemNamesEnabled", value: boolean) => {
    const stale = preferences.noticeVersion !== PRIVACY_NOTICE_VERSION;
    return saveAnalyticsPreferences(userId, key === "itemNamesEnabled" ? {
      itemNamesEnabled: value, itemNamesNoticeVersion: ITEM_NAME_NOTICE_VERSION,
    } : {
      ...(stale ? { productAnalyticsEnabled: false, crashReportingEnabled: false, itemNamesEnabled: false, itemNamesNoticeVersion: null } : {}),
      [key]: value, noticeVersion: PRIVACY_NOTICE_VERSION,
    }).catch(() => showPopup({ title: "Choice couldn't be saved", message: "Please try again.", actions: [{ label: "Got it", primary: true }] }));
  };
  const rows = [
    {
      key: "productAnalyticsEnabled" as const,
      title: "Product analytics",
      description:
        "Share app opens, screens visited, active time, setup progress, and feature-use events with PostHog using a random identifier. This choice excludes chore and item names. Expense notes, account names, email addresses, and invite codes are excluded.",
    },
    {
      key: "crashReportingEnabled" as const,
      title: "Crash reporting",
      description:
        "Share sanitized crash details with Sentry to help us diagnose failures. Session replay, request data, and personal content are disabled.",
    },
    ...(ITEM_NAME_ANALYTICS_AVAILABLE ? [{
      key: "itemNamesEnabled" as const,
      title: "Share chore and item names",
      description: "Separately allow PostHog to receive names you add in SweetMate, including chores, shopping items and expense titles, to improve task suggestions and product features. Shared with a random identifier; names can still reveal personal details. Google imports, notes, amounts and automatically copied entries from other roommates are excluded. Off by default; no past entries are uploaded. Requires Product analytics.",
    }] : []),
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
          <AppSwitch
            value={isChoiceEnabled(row.key)}
            disabled={!loaded || (row.key === "itemNamesEnabled" && !productAllowed)}
            onValueChange={(value) => { void changeChoice(row.key, value); }}
            accessibilityLabel={`${row.title}: ${isChoiceEnabled(row.key) ? "on" : "off"}`}
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

/** Restores saved consent; signup now owns the optional opt-in UI. */
export function AnalyticsConsentManager({ session }: { session: Session | null }) {
  const userId = session?.user.id ?? null;
  const { showPopup } = useAppPopup();
  useEffect(() => {
    void loadAnalyticsPreferences(userId, { resetAnonymous: !userId }).catch(() => {
      showPopup({ title: "Privacy choices unavailable", message: "Optional analytics and crash reporting remain paused. You can retry from Settings.", actions: [{ label: "Got it", primary: true }] });
    });
  }, [userId]);
  return null;
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16, borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { minHeight: 76, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 15 },
  description: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 14, lineHeight: 20, marginTop: 3 },
  policyLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  policyText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
});
