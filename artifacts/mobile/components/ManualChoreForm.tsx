import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  type AssignmentMode,
  type Chore,
  type ChoreCategory,
  type ChoreRecurrence,
  useAppContextSelector,
} from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import {
  dateInput,
  parseDueDate,
  todayDateInput,
  tomorrowDateInput,
} from "@/lib/choreForm";
import {
  removeMappedReminderIfPresent,
  updateMappedReminderIfPresent,
} from "@/lib/externalTasks";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

const CATEGORIES: {
  key: ChoreCategory;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { key: "cleaning", label: "Cleaning", icon: "wind" },
  { key: "kitchen", label: "Kitchen", icon: "coffee" },
  { key: "bathroom", label: "Bathroom", icon: "droplet" },
  { key: "laundry", label: "Laundry", icon: "refresh-cw" },
  { key: "outdoor", label: "Outdoor", icon: "sun" },
  { key: "other", label: "Other", icon: "package" },
];

const RECURRENCES: { value: ChoreRecurrence | null; label: string }[] = [
  { value: null, label: "One-time" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
];

export function ManualChoreForm({
  initialAssigneeId,
  initialChore,
  onCreated,
}: {
  initialAssigneeId?: string;
  initialChore?: Chore;
  onCreated: () => void;
}) {
  const colors = useTheme();
  const {
    addChore,
    updateChore,
    currentUserId,
    householdId,
    pointsEnabled,
    roommates,
  } = useAppContextSelector((context) => ({
    addChore: context.addChore,
    updateChore: context.updateChore,
    currentUserId: context.currentUserId,
    householdId: context.householdId,
    pointsEnabled: context.pointsEnabled,
    roommates: context.roommates,
  }));
  const defaultAssignee =
    roommates.some((member) => member.id === initialAssigneeId)
      ? initialAssigneeId!
      : currentUserId;
  const [title, setTitle] = useState(initialChore?.title ?? "");
  const [notes, setNotes] = useState(initialChore?.description ?? "");
  const [assignmentMode, setAssignmentMode] =
    useState<Exclude<AssignmentMode, "unassigned">>(
      initialChore?.assignmentMode === "round-robin"
        ? "round-robin"
        : "specific-person",
    );
  const [assigneeId, setAssigneeId] = useState(
    initialChore?.assignedTo || defaultAssignee,
  );
  const [allMembers, setAllMembers] = useState(
    initialChore?.roundRobinAllMembers ?? true,
  );
  const [participants, setParticipants] = useState<string[]>(
    initialChore?.roundRobinParticipantIds ?? roommates.map((member) => member.id),
  );
  const [recurrence, setRecurrence] = useState<ChoreRecurrence | null>(
    initialChore?.recurring ?? null,
  );
  const [dueDateInput, setDueDateInput] = useState(() =>
    initialChore
      ? dateInput(new Date(initialChore.dueDate))
      : todayDateInput(),
  );
  const [category, setCategory] = useState<ChoreCategory>(
    initialChore?.category ?? "cleaning",
  );
  const [points, setPoints] = useState(String(initialChore?.points ?? 20));
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const selectedParticipants = useMemo(
    () =>
      (allMembers ? roommates.map((member) => member.id) : participants).filter(
        (id) => roommates.some((member) => member.id === id),
      ),
    [allMembers, participants, roommates],
  );

  const toggleParticipant = (id: string) => {
    setParticipants((current) =>
      current.includes(id)
        ? current.filter((participantId) => participantId !== id)
        : [...current, id],
    );
  };

  const submit = () => {
    if (submittingRef.current) return;
    const dueDate = parseDueDate(dueDateInput);
    if (!title.trim()) {
      setError("Enter a chore title.");
      return;
    }
    if (!dueDate) {
      setError("Enter a valid first due date as YYYY-MM-DD.");
      return;
    }
    if (assignmentMode === "round-robin" && !selectedParticipants.length) {
      setError("Select at least one person for the rotation.");
      return;
    }
    const initialRoundRobinAssignee = selectedParticipants[0];
    submittingRef.current = true;
    const draft = {
      householdId: householdId ?? undefined,
      title: title.trim(),
      description: notes.trim() || undefined,
      creatorId: currentUserId,
      assignedTo:
        assignmentMode === "round-robin"
          ? initialRoundRobinAssignee
          : assigneeId,
      assignmentMode,
      roundRobinParticipantIds:
        assignmentMode === "round-robin" ? selectedParticipants : undefined,
      roundRobinAllMembers:
        assignmentMode === "round-robin" ? allMembers : undefined,
      roundRobinCursor: 0,
      recurring: recurrence ?? undefined,
      dueDate,
      initialDueDate: dueDate,
      nextDueDate: dueDate,
      completed: false,
      points: Number(points),
      category,
    };
    const saved = initialChore
      ? updateChore(initialChore.id, {
          ...draft,
          initialDueDate: initialChore.initialDueDate ?? dueDate,
          recurrenceSeriesId: recurrence
            ? initialChore.recurrenceSeriesId ?? initialChore.id
            : undefined,
        })
      : Boolean(addChore(draft));
    if (!saved) {
      submittingRef.current = false;
      setError("The chore could not be created. Check the assignment and try again.");
      return;
    }
    if (initialChore) {
      const syncReminder =
        draft.assignedTo === currentUserId
          ? updateMappedReminderIfPresent(currentUserId, {
              id: initialChore.id,
              title: draft.title,
              description: draft.description,
              dueDate: draft.dueDate,
              category: draft.category,
              recurrence: draft.recurring,
              assignedToName: roommates.find((member) => member.id === draft.assignedTo)?.name,
              points: draft.points,
              includePoints: pointsEnabled,
            })
          : removeMappedReminderIfPresent(currentUserId, initialChore.id);
      void syncReminder.catch((syncError) => {
        reportRuntimeError("update mapped reminder after chore edit", syncError, {
          choreId: initialChore.id,
        });
      });
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCreated();
  };

  const chip = (selected: boolean) => ({
    backgroundColor: selected ? colors.primary + "20" : colors.secondary,
    borderColor: selected ? colors.primary : colors.border,
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Chore title</Text>
      <TextInput
        autoFocus
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Clean bathroom"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
      />

      <Text style={[styles.label, { color: colors.mutedForeground }]}>Assignment</Text>
      <View style={styles.wrap}>
        {(["specific-person", "round-robin"] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            onPress={() => setAssignmentMode(mode)}
            style={[styles.chip, chip(assignmentMode === mode)]}
          >
            <Text style={[styles.chipText, { color: assignmentMode === mode ? colors.primary : colors.mutedForeground }]}>
              {mode === "specific-person" ? "Specific person" : "Round Robin"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {assignmentMode === "specific-person" ? (
        <View style={styles.wrap}>
          {roommates.map((member) => (
            <TouchableOpacity
              key={member.id}
              onPress={() => setAssigneeId(member.id)}
              style={[styles.chip, chip(assigneeId === member.id)]}
            >
              <Text style={[styles.chipText, { color: assigneeId === member.id ? member.color : colors.mutedForeground }]}>
                {member.id === currentUserId ? `${member.name} (You)` : member.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <>
          <TouchableOpacity
            onPress={() => setAllMembers((current) => !current)}
            style={[styles.chip, styles.allMembersChip, chip(allMembers)]}
          >
            <Feather name={allMembers ? "check-square" : "square"} size={15} color={allMembers ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.chipText, { color: allMembers ? colors.primary : colors.mutedForeground }]}>
              All active Sweetmates
            </Text>
          </TouchableOpacity>
          {!allMembers && (
            <View style={styles.wrap}>
              {roommates.map((member) => {
                const selected = participants.includes(member.id);
                return (
                  <TouchableOpacity
                    key={member.id}
                    onPress={() => toggleParticipant(member.id)}
                    style={[styles.chip, chip(selected)]}
                  >
                    <Text style={[styles.chipText, { color: selected ? member.color : colors.mutedForeground }]}>
                      {member.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={[styles.orderText, { color: colors.mutedForeground }]}>
            Rotation: {selectedParticipants.map((id) => roommates.find((member) => member.id === id)?.name).filter(Boolean).join(" → ") || "No participants"}
          </Text>
        </>
      )}

      <Text style={[styles.label, { color: colors.mutedForeground }]}>Schedule</Text>
      <View style={styles.wrap}>
        {RECURRENCES.map((option) => (
          <TouchableOpacity
            key={option.label}
            onPress={() => setRecurrence(option.value)}
            style={[styles.chip, chip(recurrence === option.value)]}
          >
            <Text style={[styles.chipText, { color: recurrence === option.value ? colors.primary : colors.mutedForeground }]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {recurrence === "monthly" ? (
        <Text style={[styles.orderText, { color: colors.mutedForeground }]}>
          If a month is shorter than the selected date, this chore is due on
          that month’s final day. Later months return to the original date.
        </Text>
      ) : null}
      <Text style={[styles.label, { color: colors.mutedForeground }]}>First due date</Text>
      <View style={styles.wrap}>
        {[
          { label: "Today", value: todayDateInput() },
          { label: "Tomorrow", value: tomorrowDateInput() },
        ].map((option) => (
          <TouchableOpacity
            key={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected: dueDateInput === option.value }}
            onPress={() => {
              setDueDateInput(option.value);
              setError(null);
            }}
            style={[styles.chip, chip(dueDateInput === option.value)]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color:
                    dueDateInput === option.value
                      ? colors.primary
                      : colors.mutedForeground,
                },
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        value={dueDateInput}
        onChangeText={setDueDateInput}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
      />

      <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
      <View style={styles.wrap}>
        {CATEGORIES.map((option) => (
          <TouchableOpacity
            key={option.key}
            onPress={() => setCategory(option.key)}
            style={[styles.chip, chip(category === option.key)]}
          >
            <Feather name={option.icon} size={14} color={category === option.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.chipText, { color: category === option.key ? colors.primary : colors.mutedForeground }]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {pointsEnabled && (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Points</Text>
          <View style={styles.wrap}>
            {["5", "10", "15", "20", "25", "30"].map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setPoints(value)}
                style={[styles.chip, chip(points === value)]}
              >
                <Text style={[styles.chipText, { color: points === value ? colors.primary : colors.mutedForeground }]}>
                  {value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={[styles.label, { color: colors.mutedForeground }]}>Notes (optional)</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Add details or instructions"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, styles.notes, { color: colors.foreground, backgroundColor: colors.secondary, borderColor: colors.border }]}
      />

      {error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
      <TouchableOpacity
        onPress={submit}
        style={[styles.submit, { backgroundColor: title.trim() ? colors.action : colors.muted }]}
      >
        <Text style={styles.submitText}>
          {initialChore ? "Save Changes" : "Add Chore"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36, gap: 10 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 13, marginTop: 5 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: "Inter_400Regular", fontSize: 15 },
  notes: { minHeight: 82, paddingTop: 12, textAlignVertical: "top" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, borderWidth: 1, borderRadius: 19, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  allMembersChip: { alignSelf: "flex-start" },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  orderText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  error: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  submit: { minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 8 },
  submitText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
});
