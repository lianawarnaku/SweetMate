import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";

import {
  GlassModalBackdrop,
  GlassModalSurface,
} from "@/components/GlassModalSurface";
import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";

/** Prevent edits from racing the atomic chart replacement and row reload. */
export function ChoreChartApplyingOverlay() {
  const applying = useAppContextSelector(
    (context) => context.choreChartApplying,
  );
  const colors = useTheme();
  if (!applying) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={styles.container} accessibilityViewIsModal>
        <GlassModalBackdrop />
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityState={{ busy: true }}
          accessibilityLabel="Updating chore chart. Saving your approved assignments."
          accessibilityLiveRegion="polite"
          style={styles.content}
        >
          <GlassModalSurface style={styles.surface}>
            <ActivityIndicator
              size="large"
              color={colors.primary}
              accessible={false}
            />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Updating chore chart
            </Text>
            <Text
              style={[styles.description, { color: colors.mutedForeground }]}
            >
              Saving your approved assignments…
            </Text>
          </GlassModalSurface>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  content: { width: "100%", maxWidth: 340 },
  surface: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 20,
    textAlign: "center",
  },
  description: {
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
});
