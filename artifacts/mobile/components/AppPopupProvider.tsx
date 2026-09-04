import { Feather } from "@expo/vector-icons";
import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { GlassButton } from "@/components/GlassButton";

export type AppPopupAction = {
  label: string;
  onPress?: () => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean;
};

type PopupRequest = {
  title: string;
  message: string;
  actions: AppPopupAction[];
  icon?: keyof typeof Feather.glyphMap;
  dismissible?: boolean;
};

type PopupApi = {
  showPopup: (request: PopupRequest) => void;
  dismissPopup: () => void;
};

const PopupContext = createContext<PopupApi | null>(null);

export function AppPopupProvider({ children }: { children: ReactNode }) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [popup, setPopup] = useState<PopupRequest | null>(null);
  const [running, setRunning] = useState(false);
  const [runningActionLabel, setRunningActionLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dismissPopup = useCallback(() => {
    if (running) return;
    setPopup(null);
    setError(null);
    setRunningActionLabel(null);
  }, [running]);
  const showPopup = useCallback((request: PopupRequest) => {
    setRunning(false);
    setRunningActionLabel(null);
    setError(null);
    setPopup(request);
  }, []);
  const api = useMemo(() => ({ showPopup, dismissPopup }), [dismissPopup, showPopup]);

  const run = async (action: AppPopupAction) => {
    if (running) return;
    setRunning(true);
    setRunningActionLabel(action.label);
    setError(null);
    try {
      await action.onPress?.();
      setPopup(null);
    } catch {
      setError("That action could not be completed. Please try again.");
    } finally {
      setRunning(false);
      setRunningActionLabel(null);
    }
  };

  return (
    <PopupContext.Provider value={api}>
      {children}
      <Modal
        visible={Boolean(popup)}
        transparent
        animationType="fade"
        onRequestClose={popup?.dismissible === false ? undefined : dismissPopup}
        statusBarTranslucent
        accessibilityViewIsModal
      >
        <View style={styles.root}>
          <GlassModalBackdrop
            onPress={popup?.dismissible === false ? undefined : dismissPopup}
          />
          <GlassModalSurface style={[styles.card, { marginBottom: Math.max(insets.bottom, 16) }]}>
            <View style={[styles.icon, { backgroundColor: colors.primary + "14" }]}>
              <Feather name={popup?.icon ?? "info"} size={22} color={colors.primary} />
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{popup?.title}</Text>
            <Text style={[styles.message, { color: colors.mutedForeground }]}>{popup?.message}</Text>
            {error ? <Text accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.actions}>
              {popup?.actions.map((action) => (
                <GlassButton
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.destructive ? `${action.label}, destructive action` : action.label}
                  accessibilityState={{ disabled: running, busy: runningActionLabel === action.label }}
                  disabled={running}
                  onPress={() => void run(action)}
                  tone={action.destructive ? "destructive" : action.primary ? "primary" : "neutral"}
                  style={styles.action}
                >
                  {runningActionLabel === action.label ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={[styles.actionText, { color: action.primary || action.destructive ? "#fff" : colors.foreground }]}>
                    {runningActionLabel === action.label ? "Working…" : action.label}
                  </Text>
                </GlassButton>
              ))}
            </View>
          </GlassModalSurface>
        </View>
      </Modal>
    </PopupContext.Provider>
  );
}

export function useAppPopup() {
  const value = useContext(PopupContext);
  if (!value) throw new Error("useAppPopup must be used inside AppPopupProvider");
  return value;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 14 },
  card: { borderRadius: 30, padding: 20, gap: 10 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 21, textAlign: "center" },
  message: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 22, textAlign: "center" },
  error: { fontFamily: "Inter_600SemiBold", fontSize: 14, textAlign: "center" },
  actions: { gap: 9, marginTop: 6 },
  action: { minHeight: 50 },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});
