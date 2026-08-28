import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";
import { tapLight } from "@/lib/haptics";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";

const GUIDE_ITEMS = [
  {
    icon: "clipboard" as const,
    title: "Chore planner",
    description:
      "Choose what is in your Sweet, and SweetMate builds a predictable recurring plan using preset household rules.",
  },
  {
    icon: "award" as const,
    title: "Difficulty and points",
    description:
      "Difficulty reflects typical effort. Completing harder chores can earn more points, so ranks reflect effort as well as task count.",
  },
  {
    icon: "repeat" as const,
    title: "Schedules and assignments",
    description:
      "Cleaning chores repeat automatically. Fixed balancing rules spread automatic assignments among active Sweetmates.",
  },
  {
    icon: "eye-off" as const,
    title: "Anonymous nudges",
    description:
      "Send a private reminder to a suitemate. They will not see who sent it.",
  },
  {
    icon: "calendar" as const,
    title: "Add to Calendar",
    description:
      "Saves your assigned tasks and due dates to your chosen calendar or reminders app.",
  },
  {
    icon: "bell" as const,
    title: "Alerts",
    description:
      "Workload warnings, overdue reminders, and other important updates appear in Alerts instead of interrupting you.",
  },
];

export function QuickGuideModal() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { quickGuideOpen, dismissQuickGuide } = useAppContextSelector(
    (context) => ({
      quickGuideOpen: context.quickGuideOpen,
      dismissQuickGuide: context.dismissQuickGuide,
    }),
  );

  const close = () => {
    tapLight();
    dismissQuickGuide();
  };

  return (
    <Modal
      visible={quickGuideOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
      accessibilityViewIsModal
    >
      <View
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(insets.top, 20),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
      >
        <GlassModalBackdrop onPress={close} accessibilityLabel="Close Quick guide" />
        <GlassModalSurface style={styles.card}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[styles.titleIcon, { backgroundColor: colors.primary + "12" }]}
            >
              <Feather name="info" size={20} color={colors.primary} />
            </View>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              QUICK GUIDE
            </Text>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>
              Six helpful things to know about SweetMate.
            </Text>

            <View style={styles.items}>
              {GUIDE_ITEMS.map((item) => (
                <View key={item.title} style={styles.item}>
                  <View
                    style={[
                      styles.itemIcon,
                      { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                  >
                    <Feather
                      name={item.icon}
                      size={17}
                      color={colors.foreground}
                    />
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={[styles.itemTitle, { color: colors.foreground }]}>
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.itemDescription,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {item.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Got it, close Quick guide"
              onPress={close}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                GOT IT
              </Text>
            </Pressable>
          </View>
        </GlassModalSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 430,
    maxHeight: "88%",
    borderRadius: 30,
    overflow: "hidden",
  },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 20 },
  titleIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: 0.8,
  },
  intro: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 21,
    marginTop: 4,
  },
  items: { marginTop: 22, gap: 20 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 13 },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCopy: { flex: 1 },
  itemTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    lineHeight: 21,
  },
  itemDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  footer: { borderTopWidth: 1, padding: 16 },
  button: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    letterSpacing: 0.6,
  },
});
