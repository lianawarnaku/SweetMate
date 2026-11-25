import React, { useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassModalBackdrop, GlassModalSurface } from "@/components/GlassModalSurface";
import { GlassButton } from "@/components/GlassButton";
import { ShoppingScheduleField } from "@/components/ShoppingScheduleField";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import type { ShoppingSchedule } from "@/lib/shoppingSchedule";

export function ShoppingEditorSheet({ visible, name, onNameChange, quantity, onQuantityChange, schedule, onScheduleChange, timezone, onSave, onClose }: {
  visible: boolean; name: string; onNameChange: (name: string) => void;
  quantity?: string; onQuantityChange?: (quantity: string) => void;
  schedule?: ShoppingSchedule; onScheduleChange: (schedule: ShoppingSchedule | undefined) => void;
  timezone: string; onSave: () => void; onClose: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useAccessibilityPreferences();
  const nameRef = useRef<TextInput>(null);
  const [editingDate, setEditingDate] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const item = onQuantityChange !== undefined;
  const close = () => { setEditingDate(false); Keyboard.dismiss(); onClose(); };
  const save = () => { if (name.trim() && !editingDate) { Keyboard.dismiss(); onSave(); } };
  const input = (field: string) => [styles.input, { backgroundColor: colors.cardElevated, color: colors.textPrimary, borderColor: focused === field ? colors.focusRing : colors.divider, borderWidth: focused === field ? 2 : 1 }];
  return <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={close}
    onShow={() => { if (!editingDate) nameRef.current?.focus(); }}>
    <View style={styles.overlay}>
      <GlassModalBackdrop onPress={close} accessibilityLabel="Close shopping editor" />
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.keyboard, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <GlassModalSurface style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{item ? "Add item" : "Create shopping list"}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close shopping editor" onPress={close} style={styles.close}><Feather name="x" size={20} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{item ? "Item or ingredient name" : "List name"}</Text>
            <TextInput ref={nameRef} accessibilityLabel={item ? "Item or ingredient name" : "Shopping list name"} value={name} onChangeText={onNameChange}
              placeholder={item ? "e.g. Tomatoes or dish soap" : "e.g. Weekly groceries"} placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.foreground} onFocus={() => setFocused("name")} onBlur={() => setFocused(null)} style={input("name")}
              returnKeyType="done" onSubmitEditing={save} />
            {item && <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Quantity</Text>
              <TextInput accessibilityLabel="Item quantity" value={quantity} onChangeText={onQuantityChange} placeholder="e.g. 2 or 1 bag" placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.foreground} onFocus={() => setFocused("quantity")} onBlur={() => setFocused(null)} style={input("quantity")} returnKeyType="done" onSubmitEditing={save} />
            </>}
            <ShoppingScheduleField key={visible ? "open" : "closed"} value={schedule} onChange={onScheduleChange} onEditingChange={setEditingDate} timezone={timezone} />
            <GlassButton disabled={!name.trim() || editingDate} onPress={save} style={styles.save}>
              <Text style={[styles.saveText, { color: colors.actionForeground }]}>{item ? "Add to list" : "Create list"}</Text>
            </GlassButton>
          </ScrollView>
        </GlassModalSurface>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 }, keyboard: { flex: 1, justifyContent: "flex-end" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "100%", alignSelf: "center", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 20 }, close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: "Inter_500Medium", fontSize: 13 },
  input: { minHeight: 50, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 17, fontFamily: "Inter_400Regular" },
  save: { borderRadius: 14, marginTop: 4 }, saveText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});
