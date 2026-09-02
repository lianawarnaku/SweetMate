import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  DEFAULT_ITEM_DIFFICULTY,
  DIFFICULTY_LABELS,
  type ItemCategory,
} from "@/constants/itemDifficulty";
import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import type { Difficulty } from "@/lib/itemDifficulty";
import { error as hapticError, success as hapticSuccess } from "@/lib/haptics";
import { useConfirm } from "@/hooks/useConfirm";

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  living: "Living Space",
  other: "Other",
};

export default function TaskDifficultyScreen() {
  const { confirm, info } = useConfirm();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { itemDifficulties, setItemDifficulty, resetItemDifficulties } = useAppContext();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const entries = new Map(
      DEFAULT_ITEM_DIFFICULTY.map((entry) => [`${entry.category}:${entry.item}`, entry]),
    );
    itemDifficulties.forEach((entry) => {
      entries.set(`${entry.category}:${entry.item}`, entry);
    });
    return (["kitchen", "bathroom", "living", "other"] as ItemCategory[]).map((category) => ({
      category,
      items: [...entries.values()].filter((entry) => entry.category === category),
    }));
  }, [itemDifficulties]);

  const changeDifficulty = async (
    category: ItemCategory,
    item: string,
    difficulty: Difficulty,
  ) => {
    const key = `${category}:${item}`;
    setSavingKey(key);
    try {
      await setItemDifficulty(category, item, difficulty);
    } catch {
      hapticError();
      info("difficulty_save_error", "Couldn’t save", "The difficulty could not be updated.");
    } finally {
      setSavingKey(null);
    }
  };

  const reset = () => {
    confirm("reset_difficulties", "Reset difficulties?", "Restore every item to its household default?", () => {
        void (async () => {
          try {
            await resetItemDifficulties();
            hapticSuccess();
          } catch {
            hapticError();
            info("difficulty_reset_error", "Couldn’t reset", "Please try again.");
          }
        })();
      }, { confirmText: "Reset", destructive: true });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.iconButton, { backgroundColor: colors.muted }]}>
          <Feather name="chevron-left" size={21} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>Task Difficulty</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Shared by your whole household</Text>
        </View>
        <TouchableOpacity onPress={reset}>
          <Text style={[styles.reset, { color: colors.primary }]}>Reset</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        {grouped.map(({ category, items }) => (
          <View key={category}>
            <Text style={[styles.category, { color: colors.mutedForeground }]}>
              {CATEGORY_LABELS[category].toUpperCase()}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {items.map((entry, index) => {
                const override = itemDifficulties.find(
                  (value) => value.category === category && value.item === entry.item,
                );
                const difficulty = override?.difficulty ?? entry.difficulty;
                const key = `${category}:${entry.item}`;
                return (
                  <View
                    key={entry.item}
                    style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                  >
                    <View style={styles.itemCopy}>
                      <Text style={[styles.itemName, { color: colors.foreground }]}>{entry.item}</Text>
                      <Text style={[styles.value, { color: colors.primary }]}>
                        {difficulty}/5{DIFFICULTY_LABELS[difficulty] ? ` · ${DIFFICULTY_LABELS[difficulty]}` : ""}
                      </Text>
                    </View>
                    <View style={styles.segments}>
                      {([1, 2, 3, 4, 5] as Difficulty[]).map((level) => (
                        <TouchableOpacity
                          key={level}
                          disabled={savingKey === key}
                          onPress={() => changeDifficulty(category, entry.item, level)}
                          style={[
                            styles.segment,
                            {
                              backgroundColor: level === difficulty ? colors.action : colors.muted,
                              borderColor: level === difficulty ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.segmentText, { color: level === difficulty ? colors.actionForeground : colors.mutedForeground }]}>
                            {level}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 82, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 25 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13 },
  reset: { fontFamily: "Inter_700Bold", fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 18 },
  category: { fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 1.2, marginBottom: 7, marginLeft: 4 },
  card: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  row: { padding: 14, gap: 10 },
  itemCopy: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemName: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  value: { fontFamily: "Inter_700Bold", fontSize: 14 },
  segments: { flexDirection: "row", gap: 7 },
  segment: { flex: 1, height: 34, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: "Inter_700Bold", fontSize: 13 },
});
