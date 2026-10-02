import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/constants/colors";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
import {
  GlassModalBackdrop,
  GlassModalSurface,
} from "@/components/GlassModalSurface";
import { GlassButton } from "@/components/GlassButton";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import {
  feedbackMetadata,
  feedbackSchema,
  FEEDBACK_LIMIT,
  FEEDBACK_SUCCESS,
  sendFeedback,
} from "@/lib/feedback";
import { SmoothPressable } from "./SmoothPressable";

type Category = "suggestion" | "bug" | "other";
const categories: Category[] = ["suggestion", "bug", "other"];

export function FeedbackSection({
  email,
  userId,
}: {
  email?: string;
  userId: string;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { reduceMotion: reducedMotion } = useAccessibilityPreferences();
  const [visible, setVisible] = useState(false);
  const [category, setCategory] = useState<Category>("suggestion");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  const request = useRef<{ key: string; payload: string } | null>(null);
  const messageInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const opener = useRef<React.ElementRef<typeof Pressable>>(null);
  const done = useRef<React.ElementRef<typeof Pressable>>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reset = () => {
    setCategory("suggestion");
    setMessage("");
    setContact(email ?? "");
    setErrors({});
    setFailure("");
    setSuccess(false);
    request.current = null;
  };
  const close = () => {
    if (lock.current) return;
    setVisible(false);
    if (Platform.OS === "web")
      requestAnimationFrame(() => opener.current?.focus());
  };
  const submit = async () => {
    if (lock.current) return;
    const body = {
      category,
      message,
      contact_email: contact,
      ...feedbackMetadata(),
    };
    const payload = JSON.stringify({ ...body, userId });
    if (!request.current || request.current.payload !== payload)
      request.current = { key: Crypto.randomUUID(), payload };
    const input = { ...body, request_id: request.current.key };
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0])] = issue.message;
      setErrors(next);
      if (next.message) messageInput.current?.focus();
      else if (next.contact_email) emailInput.current?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrors({});
    setFailure("");
    try {
      await sendFeedback(input);
      if (!alive.current) return;
      setSuccess(true);
      setMessage("");
      setContact("");
      request.current = null;
      AccessibilityInfo.announceForAccessibility(FEEDBACK_SUCCESS);
      if (Platform.OS === "web")
        requestAnimationFrame(() => done.current?.focus());
    } catch (error) {
      if (alive.current)
        setFailure(
          error instanceof Error
            ? error.message
            : "We couldn't save your feedback. Please try again.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const textColor = { color: colors.foreground };
  const inputStyle = [
    styles.input,
    {
      color: colors.foreground,
      backgroundColor: colors.background,
      borderColor: colors.border,
    },
  ];
  const errorText = (value?: string) =>
    value ? (
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.body, { color: colors.destructive }]}
      >
        {value}
      </Text>
    ) : null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.headingRow}>
        <Feather name="message-square" size={20} color={colors.primary} />
        <Text accessibilityRole="header" style={[styles.title, textColor]}>
          Suggestions &amp; Feedback
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Have an idea, suggestion, or something we could improve? Send us your
        feedback.
      </Text>
      <Pressable
        ref={opener}
        accessibilityRole="button"
        onPress={() => {
          reset();
          setVisible(true);
        }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.action, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.buttonText, { color: colors.actionForeground }]}>
          Send Feedback
        </Text>
      </Pressable>
      <Modal
        visible={visible}
        transparent
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={close}
        onShow={() => messageInput.current?.focus()}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView
          behavior={KEYBOARD_BEHAVIOR}
          style={styles.overlay}
        >
          <GlassModalBackdrop />
          <GlassModalSurface
            style={[
              styles.sheet,
              {
                maxHeight: height - insets.top - 16,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                { paddingBottom: Math.max(insets.bottom, 20) },
              ]}
            >
              <View style={styles.headingRow}>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, textColor, { flex: 1 }]}
                >
                  Suggestions &amp; Feedback
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close feedback form"
                  disabled={busy}
                  accessibilityState={{ disabled: busy }}
                  onPress={close}
                  style={styles.close}
                >
                  <Feather name="x" size={24} color={colors.foreground} />
                </Pressable>
              </View>
              {success ? (
                <>
                  <Feather
                    name="check-circle"
                    size={32}
                    color={colors.primary}
                  />
                  <Text
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.body, textColor]}
                  >
                    {FEEDBACK_SUCCESS}
                  </Text>
                  <Pressable
                    ref={done}
                    accessibilityRole="button"
                    onPress={close}
                    style={[styles.button, { backgroundColor: colors.action }]}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        { color: colors.actionForeground },
                      ]}
                    >
                      Done
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={[styles.label, textColor]}>
                    Feedback category
                  </Text>
                  <View style={styles.categories}>
                    {categories.map((value) => (
                      <SmoothPressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityLabel={
                          value[0].toUpperCase() + value.slice(1)
                        }
                        accessibilityState={{ selected: category === value }}
                        disabled={busy}
                        onPress={() => setCategory(value)}
                        style={[
                          styles.category,
                          {
                            borderColor:
                              category === value
                                ? colors.action
                                : colors.border,
                            backgroundColor:
                              category === value
                                ? colors.action
                                : colors.secondary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.buttonText,
                            {
                              color:
                                category === value
                                  ? colors.actionForeground
                                  : colors.secondaryForeground,
                            },
                          ]}
                        >
                          {category === value ? "✓ " : ""}
                          {value[0].toUpperCase() + value.slice(1)}
                        </Text>
                      </SmoothPressable>
                    ))}
                  </View>
                  <Text style={[styles.label, textColor]}>
                    Message (required)
                  </Text>
                  <TextInput
                    ref={messageInput}
                    accessibilityLabel="Feedback message, required"
                    accessibilityHint="Maximum 1,500 characters"
                    value={message}
                    onChangeText={(value) => {
                      setMessage(value);
                      setErrors((old) => ({ ...old, message: "" }));
                    }}
                    editable={!busy}
                    multiline
                    maxLength={FEEDBACK_LIMIT}
                    textAlignVertical="top"
                    placeholder="What could we improve?"
                    placeholderTextColor={colors.mutedForeground}
                    style={[...inputStyle, styles.message]}
                  />
                  <Text
                    style={[styles.count, { color: colors.mutedForeground }]}
                  >
                    {message.length} / {FEEDBACK_LIMIT}
                  </Text>
                  {errorText(errors.message)}
                  <Text style={[styles.label, textColor]}>
                    Contact email (optional)
                  </Text>
                  <Text
                    style={[styles.body, { color: colors.mutedForeground }]}
                  >
                    Only if you’d like us to reply. You can leave this blank.
                  </Text>
                  <TextInput
                    ref={emailInput}
                    accessibilityLabel="Contact email, optional"
                    value={contact}
                    onChangeText={(value) => {
                      setContact(value);
                      setErrors((old) => ({ ...old, contact_email: "" }));
                    }}
                    onBlur={() => {
                      if (
                        contact.trim() &&
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())
                      )
                        setErrors((old) => ({
                          ...old,
                          contact_email:
                            "Enter a valid email address or leave it blank.",
                        }));
                    }}
                    editable={!busy}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    maxLength={254}
                    clearButtonMode="while-editing"
                    style={inputStyle}
                  />
                  {errorText(errors.contact_email)}
                  {errorText(failure)}
                  <GlassButton
                    accessibilityRole="button"
                    accessibilityLabel={
                      busy ? "Sending feedback" : "Send Feedback"
                    }
                    accessibilityState={{ busy }}
                    disabled={busy}
                    onPress={submit}
                    style={[styles.button, { backgroundColor: colors.action }]}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.actionForeground} />
                    ) : null}
                    <Text
                      style={[
                        styles.buttonText,
                        { color: colors.actionForeground },
                      ]}
                    >
                      {busy ? "Sending…" : "Send Feedback"}
                    </Text>
                  </GlassButton>
                </>
              )}
            </ScrollView>
          </GlassModalSurface>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
  },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 17,
    flexShrink: 1,
  },
  body: {
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 15,
    marginTop: 4,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: {
    fontFamily: "Inter_600SemiBold",
    includeFontPadding: false,
    fontSize: 16,
    flexShrink: 1,
    textAlign: "center",
  },
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  content: { padding: 20, gap: 12 },
  close: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  category: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    minHeight: 48,
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 17,
  },
  message: { minHeight: 140 },
  count: {
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
    fontSize: 13,
    textAlign: "right",
  },
});
