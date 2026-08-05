import { Feather } from "@expo/vector-icons";
import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";

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
  const [error, setError] = useState<string | null>(null);

  const dismissPopup = useCallback(() => {
    if (running) return;
    setPopup(null);
    setError(null);
  }, [running]);
  const showPopup = useCallback((request: PopupRequest) => {
    setRunning(false);
    setError(null);
    setPopup(request);
  }, []);
  const api = useMemo(() => ({ showPopup, dismissPopup }), [dismissPopup, showPopup]);

  const run = async (action: AppPopupAction) => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      await action.onPress?.();
      setPopup(null);
    } catch {
      setError("That action could not be completed. Please try again.");
    } finally {
      setRunning(false);
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
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close popup"
            onPress={popup?.dismissible === false ? undefined : dismissPopup}
          />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: Math.max(insets.bottom, 16) }]}>
            <View style={[styles.icon, { backgroundColor: colors.primary + "14" }]}>
              <Feather name={popup?.icon ?? "info"} size={22} color={colors.primary} />
            </View>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{popup?.title}</Text>
            <Text style={[styles.message, { color: colors.mutedForeground }]}>{popup?.message}</Text>
            {error ? <Text accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.actions}>
              {popup?.actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.destructive ? `${action.label}, destructive action` : action.label}
                  disabled={running}
                  onPress={() => void run(action)}
                  style={[styles.action, { borderColor: colors.border, backgroundColor: action.destructive ? colors.destructive : action.primary ? colors.primary : colors.secondary }]}
                >
                  {running && action.primary ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
                  <Text style={[styles.actionText, { color: action.destructive ? "#fff" : action.primary ? colors.primaryForeground : colors.secondaryForeground }]}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
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
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.46)", justifyContent: "flex-end", paddingHorizontal: 14 },
  card: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 10 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 21, textAlign: "center" },
  message: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 22, textAlign: "center" },
  error: { fontFamily: "Inter_600SemiBold", fontSize: 14, textAlign: "center" },
  actions: { gap: 9, marginTop: 6 },
  action: { minHeight: 48, borderWidth: 1, borderRadius: 15, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});
