import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { GlassButton } from "@/components/GlassButton";

type FeatherIcon = keyof typeof Feather.glyphMap;

export type ActionMenuItem = {
  key: string;
  label: string;
  icon: FeatherIcon;
  onPress: () => void | Promise<void>;
  successMessage?: string;
  /** Close the native modal before presenting another modal, alert, or picker. */
  runAfterDismiss?: boolean;
  badge?: string;
  accentColor?: string;
  destructive?: boolean;
  confirmation?: {
    title: string;
    message: string;
    confirmLabel: string;
  };
};

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: ActionMenuItem[];
  onClose: () => void;
  initialConfirmationAction?: ActionMenuItem | null;
};

export function ActionMenuModal({
  visible,
  title,
  subtitle,
  actions,
  onClose,
  initialConfirmationAction = null,
}: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [confirming, setConfirming] = useState<ActionMenuItem | null>(null);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setConfirming(initialConfirmationAction);
      setRunning(false);
      setActionError(null);
      setActionSuccess(null);
      progress.setValue(0);
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 240,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }
  }, [progress, visible]);

  const dismiss = (force = false, afterDismiss?: () => void) => {
    if (running && !force) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onClose();
        if (afterDismiss) {
          // Give React Native one commit to unmount the native Modal before a
          // destination action presents the next modal/alert.
          setTimeout(afterDismiss, 0);
        }
      }
    });
  };

  const runAction = async (action: ActionMenuItem) => {
    if (action.confirmation) {
      setConfirming(action);
      return;
    }
    if (action.runAfterDismiss) {
      setRunning(true);
      setActionError(null);
      dismiss(true, () => {
        Promise.resolve(action.onPress()).catch(() => {
          // The menu has already closed, so the destination owns any
          // action-specific failure presentation.
        });
      });
      return;
    }
    setRunning(true);
    setActionError(null);
    try {
      await action.onPress();
      if (action.successMessage) {
        setActionSuccess(action.successMessage);
        await new Promise((resolve) => setTimeout(resolve, 650));
      }
      dismiss(true);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "That action could not be completed. Please try again.",
      );
      setRunning(false);
    }
  };

  const confirmAction = async () => {
    if (!confirming) return;
    if (confirming.runAfterDismiss) {
      const confirmedAction = confirming;
      setRunning(true);
      setActionError(null);
      dismiss(true, () => {
        Promise.resolve(confirmedAction.onPress()).catch(() => {
          // The destination owns errors after this modal is gone.
        });
      });
      return;
    }
    setRunning(true);
    setActionError(null);
    try {
      await confirming.onPress();
      dismiss(true);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "That action could not be completed. Please try again.",
      );
      setRunning(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => dismiss()}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <GlassModalBackdrop />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.backdrop,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.46],
              }),
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close action menu"
          style={StyleSheet.absoluteFill}
          onPress={() => dismiss()}
        />
        <Animated.View
          style={[
            styles.sheetMotion,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [36, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <GlassModalSurface
            style={[
              styles.sheet,
              { paddingBottom: Math.max(insets.bottom, 14) + 10 },
            ]}
          >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          {confirming?.confirmation ? (
            <>
              <View
                style={[
                styles.warningIcon,
                  {
                    backgroundColor: confirming.destructive
                      ? colors.destructive + "14"
                      : colors.primary + "14",
                  },
                ]}
              >
                <Feather
                  name={confirming.destructive ? "alert-triangle" : confirming.icon}
                  size={22}
                  color={confirming.destructive ? colors.destructive : colors.primary}
                />
              </View>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {confirming.confirmation.title}
              </Text>
              <Text style={[styles.message, { color: colors.mutedForeground }]}>
                {confirming.confirmation.message}
              </Text>
              {actionError ? (
                <Text
                  accessibilityLiveRegion="assertive"
                  style={[styles.error, { color: colors.destructive }]}
                >
                  {actionError}
                </Text>
              ) : null}
              <View style={styles.confirmButtons}>
                <GlassButton
                  accessibilityRole="button"
                  tone="neutral"
                  style={styles.confirmButton}
                  onPress={() => setConfirming(null)}
                  disabled={running}
                >
                  <Text
                    style={[
                      styles.confirmButtonText,
                      { color: colors.secondaryForeground },
                    ]}
                  >
                    Cancel
                  </Text>
                </GlassButton>
                <GlassButton
                  accessibilityRole="button"
                  accessibilityLabel={confirming.confirmation.confirmLabel}
                  tone={confirming.destructive ? "destructive" : "primary"}
                  style={styles.confirmButton}
                  onPress={() => {
                    void confirmAction();
                  }}
                  disabled={running}
                >
                  <Feather
                    name={confirming.icon}
                    size={16}
                    color={confirming.destructive ? colors.destructiveForeground : "#fff"}
                  />
                  <Text
                    style={[
                      styles.confirmButtonText,
                      {
                        color: confirming.destructive
                          ? colors.destructiveForeground
                          : "#fff",
                      },
                    ]}
                  >
                    {confirming.confirmation.confirmLabel}
                  </Text>
                </GlassButton>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
                Actions
              </Text>
              <Text
                style={[styles.title, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.message, { color: colors.mutedForeground }]}>
                  {subtitle}
                </Text>
              ) : null}
              {actionError ? (
                <Text
                  accessibilityLiveRegion="assertive"
                  style={[styles.error, { color: colors.destructive }]}
                >
                  {actionError}
                </Text>
              ) : null}
              {actionSuccess ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.error, { color: colors.primary }]}
                >
                  {actionSuccess}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {actions.map((action) => (
                  <GlassButton
                    key={action.key}
                    disabled={running}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    tone={action.destructive ? "destructive" : "neutral"}
                    style={styles.action}
                    onPress={() => {
                      void runAction(action);
                    }}
                  >
                    <View
                      style={[
                        styles.actionIcon,
                        {
                        backgroundColor: action.destructive
                          ? colors.destructive + "16"
                            : (action.accentColor ?? colors.primary) + "12",
                        },
                      ]}
                    >
                      {action.badge ? (
                        <Text style={{
                          color: action.accentColor ?? colors.primary,
                          fontFamily: "Inter_700Bold",
                          fontSize: 13,
                        }}>
                          {action.badge}
                        </Text>
                      ) : (
                        <Feather
                          name={action.icon}
                          size={18}
                          color={action.destructive ? colors.destructive : action.accentColor ?? colors.primary}
                        />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.actionLabel,
                        {
                          color: action.destructive
                            ? colors.destructive
                            : colors.foreground,
                        },
                      ]}
                    >
                      {action.label}
                    </Text>
                    {action.destructive ? (
                      <Text
                        style={[
                          styles.destructiveHint,
                          { color: colors.destructive },
                        ]}
                      >
                        Permanent
                      </Text>
                    ) : (
                      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                    )}
                  </GlassButton>
                ))}
              </View>
              <GlassButton
                accessibilityRole="button"
                tone="neutral"
                style={styles.cancelButton}
                onPress={() => dismiss()}
                disabled={running}
              >
                <Text style={[styles.cancelText, { color: colors.foreground }]}>
                  Cancel
                </Text>
              </GlassButton>
            </>
          )}
          </GlassModalSurface>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#080B12",
  },
  sheetMotion: {
    marginHorizontal: 12,
    marginBottom: 10,
  },
  sheet: {
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 16,
  },
  eyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 16,
  },
  error: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 4,
  },
  actions: { gap: 8, marginTop: 16 },
  action: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  destructiveHint: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    textTransform: "uppercase",
  },
  cancelButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  cancelText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  warningIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
  confirmButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  confirmButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  confirmButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    textAlign: "center",
  },
});
