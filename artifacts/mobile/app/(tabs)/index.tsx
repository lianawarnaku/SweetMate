import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SCREEN_WIDTH = Dimensions.get("window").width;
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Surface } from "@/components/Surface";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { useAppPopup } from "@/components/AppPopupProvider";
import { FloatingActionButton, useFloatingActionMetrics } from "@/components/FloatingActionButton";
import { HeaderActions } from "@/components/HeaderActions";
import { ManualChoreForm } from "@/components/ManualChoreForm";
import {
  type ChoreCategory,
  type Chore,
  useAppContextSelector,
} from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { success as hapticSuccess } from "@/lib/haptics";
import { useDraggableSheet } from "@/hooks/useDraggableSheet";
import { useChoreLifecycleNow } from "@/hooks/useChoreLifecycleNow";
import {
  exportChoreToDestinations,
  getExternalTaskDestination,
  removeMappedReminderIfPresent,
  setExternalTaskDestination,
  type ExternalTaskDestination,
} from "@/lib/externalTasks";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";
import { isActiveSweetMember, resolveChorePermissions } from "@/lib/chorePermissions";
import { logChorePermissionCheck } from "@/lib/choreDiagnostics";
import { CHORE_RECURRENCE_LABELS } from "@/lib/choreSchedule";
import {
  deriveCalendarItems,
  groupCalendarItemsByDate,
  localDateKey,
  type CalendarItem,
  type CalendarItemType,
} from "@/lib/calendarItems";
import {
  choreLocalDateKey,
  isChoreActiveOnDay,
} from "@/lib/choreOccurrences";
import {
  activeChores,
  isArchivedIncomplete,
  isChoreInCurrentWeek,
  isRecentlyCompleted,
} from "@/lib/choreLifecycle";

const CATEGORIES: { key: ChoreCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "cleaning", label: "Cleaning", icon: "wind" },
  { key: "kitchen", label: "Kitchen", icon: "coffee" },
  { key: "bathroom", label: "Bathroom", icon: "droplet" },
  { key: "laundry", label: "Laundry", icon: "refresh-cw" },
  { key: "outdoor", label: "Outdoor", icon: "sun" },
  { key: "other", label: "Other", icon: "package" },
];

type Filter = "week" | "today" | "done" | "archived" | "day";
type HomeSectionId = "my-chores" | "shopping";

function CollapsibleSectionHeader({
  title,
  count,
  icon,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  icon: keyof typeof Feather.glyphMap;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = useTheme();
  return (
    <TouchableOpacity
      style={styles.sectionTitleRow}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}, ${count} ${count === 1 ? "item" : "items"}`}
    >
      <View style={[styles.sectionDividerLine, { backgroundColor: colors.border }]} />
      <View style={styles.sectionDividerLabel}>
        <Feather name={icon} size={14} color={colors.mutedForeground} />
        <Text style={[styles.sectionTitleText, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.sectionTitleCount, { color: colors.mutedForeground }]}>
          {count}
        </Text>
        <Feather name={expanded ? "chevron-down" : "chevron-right"} size={16} color={colors.mutedForeground} />
      </View>
      <View style={[styles.sectionDividerLine, { backgroundColor: colors.border }]} />
    </TouchableOpacity>
  );
}

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isSameDay(left: Date | string, right: Date | string) {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isOverdue(dateStr: string, completed: boolean) {
  if (completed) return false;
  return new Date(dateStr) < new Date();
}

function formatDueDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (choreLocalDateKey(d) < choreLocalDateKey(now)) {
    return `Carried over · originally due ${d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`;
  }
  if (isToday(dateStr)) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d left`;
}

interface ChoreRowProps {
  chore: {
    id: string;
    title: string;
    dueDate: string;
    completed: boolean;
    points: number;
    category: ChoreCategory;
    recurring?: "daily" | "everyOtherDay" | "weekly" | "biweekly" | "monthly";
    assignmentMode?: "specific-person" | "round-robin" | "unassigned";
  };
  onSetCompleted: (id: string, completed: boolean) => void;
  onManage: () => void;
}

function ChoreRow({
  chore,
  onSetCompleted,
  onManage,
}: ChoreRowProps) {
  const colors = useTheme();
  const pointsEnabled = useAppContextSelector(
    (context) => context.pointsEnabled,
  );
  const cat = CATEGORIES.find((c) => c.key === chore.category) ?? CATEGORIES[5];
  const overdue = isOverdue(chore.dueDate, chore.completed);
  const handleCheckPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSetCompleted(chore.id, !chore.completed);
    if (!chore.completed) hapticSuccess();
  };

  const dueDateColor = chore.completed
    ? colors.mutedForeground
    : overdue
    ? colors.warning
    : isToday(chore.dueDate)
    ? colors.primary
    : colors.mutedForeground;

  return (
    <View style={{ borderRadius: 12, overflow: "hidden", position: "relative" }}>
      <Surface
        style={[
          styles.choreRow,
          {
            borderColor: overdue ? colors.warning + "44" : colors.border,
            overflow: "hidden",
          },
        ]}
      >
      <TouchableOpacity
        style={[
          styles.checkBox,
          {
            borderColor: chore.completed ? colors.success : overdue ? colors.warning : colors.border,
            backgroundColor: chore.completed ? colors.success + "22" : "transparent",
          },
        ]}
        onPress={handleCheckPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: chore.completed }}
        accessibilityLabel={`${chore.completed ? "Mark incomplete" : "Mark complete"}: ${chore.title}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {chore.completed ? (
          <Feather name="check" size={14} color={colors.success} />
        ) : null}
      </TouchableOpacity>

      {pointsEnabled ? (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${chore.points} points`}
          style={[styles.pointsVisual, { backgroundColor: colors.secondary }]}
        >
          <Text style={[styles.leftPointsText, { color: colors.primary }]}>{chore.points} pts</Text>
        </View>
      ) : (
        <View style={styles.categoryVisual}>
          <Feather name={cat.icon} size={14} color={colors.primary} />
        </View>
      )}

      <TouchableOpacity
        style={styles.choreInfo}
        activeOpacity={0.65}
        delayLongPress={450}
        onLongPress={onManage}
        accessibilityRole="button"
        accessibilityLabel={`Manage ${chore.title}`}
      >
        <Text
          style={[
            styles.choreTitle,
            {
              color: chore.completed ? colors.mutedForeground : colors.foreground,
              textDecorationLine: chore.completed ? "line-through" : "none",
            },
          ]}
          numberOfLines={1}
        >
          {chore.title}
        </Text>
        <View style={styles.choreMeta}>
          <Text style={[styles.dueDateText, { color: dueDateColor }]}>
            {formatDueDate(chore.dueDate)}
            {chore.recurring ? ` · ${CHORE_RECURRENCE_LABELS[chore.recurring]}` : ""}
            {chore.assignmentMode === "round-robin" ? " · Round Robin" : ""}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.trailingActions}>
        <TouchableOpacity
          onPress={onManage}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Task actions"
          accessibilityHint={`Opens actions for ${chore.title}`}
          style={styles.taskActionsButton}
        >
          <Feather name="more-vertical" size={19} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
      </Surface>
    </View>
  );
}

function CalendarDayDetails({
  visible,
  date,
  items,
  onClose,
  onItemPress,
}: {
  visible: boolean;
  date: Date;
  items: CalendarItem[];
  onClose: () => void;
  onItemPress: (item: CalendarItem) => void;
}) {
  const colors = useTheme();
  const groups: { type: CalendarItemType; title: string; items: CalendarItem[] }[] = [
    { type: "chore", title: "Chores", items: items.filter((item) => item.type === "chore") },
    { type: "shopping-item", title: "Shopping", items: items.filter((item) => item.type === "shopping-item" || item.type === "shopping-list") },
    { type: "expense", title: "Expenses", items: items.filter((item) => item.type === "expense") },
  ];
  const icon = (type: CalendarItemType) =>
    type === "chore" ? "check-square" : type === "expense" ? "dollar-sign" : "shopping-bag";
  const formatAmount = (cents?: number) =>
    cents === undefined ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.dayModalBackdrop} activeOpacity={1} onPress={onClose} accessibilityLabel="Close scheduled items" />
      <Surface style={[styles.dayModalSheet, { borderColor: colors.border }]}>
        <View style={styles.dayModalHandle} />
        <View style={styles.dayModalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.dayModalTitle, { color: colors.foreground }]}>
              {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </Text>
            <Text style={[styles.dayModalSubtitle, { color: colors.mutedForeground }]}>
              {items.length === 0 ? "Nothing scheduled" : `${items.length} scheduled ${items.length === 1 ? "item" : "items"}`}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.dayModalClose, { backgroundColor: colors.muted }]} accessibilityLabel="Close">
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={styles.dayModalContent}>
          {items.length === 0 ? (
            <View style={styles.dayEmpty}>
              <Feather name="calendar" size={28} color={colors.mutedForeground} />
              <Text style={[styles.previewEmpty, { color: colors.mutedForeground }]}>Nothing scheduled</Text>
            </View>
          ) : groups.filter((group) => group.items.length > 0).map((group) => (
            <View key={group.type} style={styles.dayGroup}>
              <Text style={[styles.dayGroupTitle, { color: colors.mutedForeground }]}>{group.title}</Text>
              {group.items.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.dayItem, { borderColor: colors.border, backgroundColor: colors.background }]}
                  onPress={() => onItemPress(item)}
                  accessibilityLabel={`${group.title}: ${item.title}${item.completed ? ", completed" : ""}`}
                >
                  <View style={[styles.dayItemIcon, { backgroundColor: colors.secondary }]}>
                    <Feather name={icon(item.type)} size={15} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dayItemTitle, { color: colors.foreground, textDecorationLine: item.completed ? "line-through" : "none" }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.dayItemDescription, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {[item.description, item.recurrenceLabel ? `Repeats ${item.recurrenceLabel}` : null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {item.amountCents !== undefined && (
                    <Text style={[styles.dayItemAmount, { color: colors.foreground }]}>{formatAmount(item.amountCents)}</Text>
                  )}
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </Surface>
    </Modal>
  );
}

export default function MyChoresScreen() {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const insets = useSafeAreaInsets();
  const { scrollBottomPadding } = useFloatingActionMetrics();
  const { currentUserId, householdId, activeSweet, chores, roommates, expenses, setChoreCompleted, deleteChore, shoppingLists, shoppingItems, toggleShoppingItem, pointsEnabled, isHost } =
    useAppContextSelector((context) => ({
      currentUserId: context.currentUserId,
      householdId: context.householdId,
      activeSweet: context.activeSweet,
      chores: context.chores,
      roommates: context.roommates,
      expenses: context.expenses,
      setChoreCompleted: context.setChoreCompleted,
      deleteChore: context.deleteChore,
      shoppingLists: context.shoppingLists,
      shoppingItems: context.shoppingItems,
      toggleShoppingItem: context.toggleShoppingItem,
      pointsEnabled: context.pointsEnabled,
      isHost: context.isHost,
    }));

  const currentUser = roommates.find((r) => r.id === currentUserId);
  const lifecycleNow = useChoreLifecycleNow(chores);
  const [filter, setFilter] = useState<Filter>("today");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false);
  const [expandedHomeSections, setExpandedHomeSections] = useState<
    Record<HomeSectionId, boolean>
  >({ "my-chores": true, shopping: true });
  const [showModal, setShowModal] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [actionChoreId, setActionChoreId] = useState<string | null>(null);
  const calendarExportsInFlight = useRef(new Set<string>());

  // Full-screen slide-up animation for the Add Chore modal (matches New IOU).
  const addChoreTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  useEffect(() => {
    if (showModal) {
      addChoreTranslateY.setValue(SCREEN_HEIGHT);
      Animated.spring(addChoreTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 180,
        mass: 0.8,
      }).start();
    }
  }, [showModal, addChoreTranslateY]);
  const closeAddChore = () => {
    Animated.timing(addChoreTranslateY, {
      toValue: SCREEN_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowModal(false);
        setEditingChoreId(null);
      }
    });
  };
  const addChoreDragHandlers = useDraggableSheet(addChoreTranslateY, () => {
    setShowModal(false);
    setEditingChoreId(null);
  });
  const [calendarDestination, setCalendarDestinationState] =
    useState<ExternalTaskDestination | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    getExternalTaskDestination(currentUserId)
      .then((destination) => {
        if (active) setCalendarDestinationState(destination);
      })
      .catch((error) =>
        reportRuntimeError("Load calendar destination preference", error),
      );
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const shoppingListsById = useMemo(
    () => new Map(shoppingLists.map((list) => [list.id, list])),
    [shoppingLists],
  );
  const myShoppingItems = useMemo(
    () =>
      shoppingItems.flatMap((item) => {
        if (item.completed) return [];
        const list = shoppingListsById.get(item.listId);
        const itemAssignees = Array.isArray(item.assignedTo)
          ? item.assignedTo
          : item.assignedTo
            ? [item.assignedTo]
            : [];
        if (
          !itemAssignees.includes(currentUserId) &&
          item.addedBy !== currentUserId &&
          list?.assignedTo !== currentUserId
        ) {
          return [];
        }
        return [{ ...item, listName: list?.name ?? "" }];
      }),
    [currentUserId, shoppingItems, shoppingListsById],
  );

  const myChores = useMemo(
    () => {
      const personalChores = chores.filter(
        (chore) =>
          chore.assignedTo === currentUserId &&
          (!householdId ||
            !chore.householdId ||
            chore.householdId === householdId),
      );
      return Array.from(
        new Map(personalChores.map((chore) => [chore.id, chore])).values(),
      );
    },
    [chores, currentUserId, householdId],
  );
  const activePersonalChores = useMemo(
    () => activeChores(myChores, lifecycleNow),
    [lifecycleNow, myChores],
  );
  const activePersonalChoreCount = useMemo(
    () => activePersonalChores.reduce((count, chore) => count + (chore.completed ? 0 : 1), 0),
    [activePersonalChores],
  );
  const archivedPersonalChoreCount = useMemo(
    () => myChores.filter((chore) => isArchivedIncomplete(chore, lifecycleNow)).length,
    [lifecycleNow, myChores],
  );
  const displayedPersonalChoreCount =
    activePersonalChoreCount > 99 ? "99+" : String(activePersonalChoreCount);
  const personalChoreCountAccessibilityLabel =
    activePersonalChoreCount === 0
      ? "No incomplete chores in My Chart"
      : `${activePersonalChoreCount} incomplete ${
          activePersonalChoreCount === 1 ? "chore" : "chores"
        } in My Chart`;
  const chooseCalendarDestination = (
    showSavedConfirmation = false,
  ): Promise<ExternalTaskDestination | null> =>
    new Promise((resolve) => {
      const save = (destination: ExternalTaskDestination) => {
        setExternalTaskDestination(currentUserId, destination)
          .then(() => {
            setCalendarDestinationState(destination);
            if (showSavedConfirmation) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            resolve(destination);
          })
          .catch((error) => {
            reportRuntimeError("Save calendar destination preference", error);
            resolve(null);
          });
      };

      const ios = Platform.OS === "ios";
      showPopup({
        title: "Where should this chore go?",
        message: ios ? "Choose Google Calendar, Apple Reminders, or both. Your choice is saved." : "SweetMate can open this chore in Google Calendar.",
        dismissible: false,
        actions: [
          { label: "Cancel", onPress: () => resolve(null) },
          { label: "Google Calendar", primary: true, onPress: () => save("googleCalendar") },
          ...(ios ? [
            { label: "Reminders", onPress: () => save("reminders") },
            { label: "Both", onPress: () => save("both") },
          ] : []),
        ],
      });
    });

  const calendarDestinationLabel =
    calendarDestination === "both"
      ? "Google Calendar and Apple Reminders"
      : calendarDestination === "reminders"
        ? "Apple Reminders"
        : "Google Calendar";
  const addChoreToCalendar = async (choreId: string) => {
    if (calendarExportsInFlight.current.has(choreId)) return;
    calendarExportsInFlight.current.add(choreId);
    try {
      const chore = chores.find((candidate) => candidate.id === choreId);
      if (!chore) {
        throw new Error("This chore is no longer available.");
      }
      const savedDestination =
        calendarDestination === undefined
          ? await getExternalTaskDestination(currentUserId)
          : calendarDestination;
      if (calendarDestination === undefined) {
        setCalendarDestinationState(savedDestination);
      }
      const destination =
        savedDestination ?? (await chooseCalendarDestination());
      if (!destination) return;
      const result = await exportChoreToDestinations(
        currentUserId,
        {
          id: chore.id,
          title: chore.title,
          dueDate: chore.dueDate,
          category: chore.category,
          description: chore.description,
          recurrence: chore.recurring,
          assignedToName: currentUser?.name ?? "You",
          points: chore.points,
          includePoints: pointsEnabled,
        },
        destination,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.googleAlreadyAdded) {
        throw new Error("Already added to Google Calendar.");
      }
    } catch (error) {
      reportRuntimeError(`Add chore to ${calendarDestinationLabel}`, error, {
        choreId,
      });
      if (calendarDestination == null) {
        showPopup({
          title: "Couldn't add to calendar",
          message: error instanceof Error
            ? error.message
            : "Google Calendar could not create the event. Please try again.",
          actions: [{ label: "Got it", primary: true }],
        });
      }
      throw error;
    } finally {
      calendarExportsInFlight.current.delete(choreId);
    }
  };
  const weekDays = useMemo(() => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [weekOffset]);
  const monthDays = useMemo(() => {
    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [selectedDate]);
  const calendarRange = useMemo(() => {
    const dates = [...weekDays, ...monthDays];
    return {
      start: new Date(Math.min(...dates.map((date) => date.getTime()))),
      end: new Date(Math.max(...dates.map((date) => date.getTime()))),
    };
  }, [monthDays, weekDays]);
  const calendarItems = useMemo(
    () =>
      deriveCalendarItems(
        { chores, shoppingItems, shoppingLists, expenses, roommates, currentUserId, householdId },
        calendarRange.start,
        calendarRange.end,
      ),
    [calendarRange, chores, currentUserId, expenses, householdId, roommates, shoppingItems, shoppingLists],
  );
  const calendarItemsByDate = useMemo(
    () => groupCalendarItemsByDate(calendarItems),
    [calendarItems],
  );
  const selectedCalendarItems = calendarItemsByDate.get(localDateKey(selectedDate)) ?? [];
  const selectCalendarDate = (date: Date) => {
    setSelectedDate(date);
    setFilter("day");
    setDayDetailsOpen(true);
    Haptics.selectionAsync();
  };
  const markerColor = (type: CalendarItemType, selected: boolean) => {
    if (selected) return colors.primaryForeground;
    if (type === "chore") return colors.warning;
    if (type === "expense") return colors.destructive;
    return colors.success;
  };
  const toggleHomeSection = (sectionId: HomeSectionId) => {
    setExpandedHomeSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
    Haptics.selectionAsync();
  };
  const filtered = useMemo(
    () => {
      const now = lifecycleNow;
      const candidates = filter === "archived" ? myChores : activePersonalChores;
      return candidates
        .filter((chore) => {
          if (filter === "archived") return isArchivedIncomplete(chore, now);
          if (filter === "today") return isChoreActiveOnDay(chore, now);
          if (filter === "done") return isRecentlyCompleted(chore, now);
          if (filter === "week") return isChoreInCurrentWeek(chore, now);
          if (filter === "day") return isChoreActiveOnDay(chore, selectedDate);
          return false;
        })
        // Completed chores auto-move to the bottom of the visible list.
        .sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));
    },
    [activePersonalChores, filter, lifecycleNow, myChores, selectedDate],
  );

  const completedCount = useMemo(
    () => activePersonalChores.filter((chore) => chore.completed).length,
    [activePersonalChores],
  );
  const totalCount = activePersonalChores.length;
  const healthPct = totalCount > 0 ? completedCount / totalCount : 0;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;
  const editingChore = editingChoreId
    ? chores.find((chore) => chore.id === editingChoreId)
    : undefined;
  const actionChore = actionChoreId
    ? chores.find((chore) => chore.id === actionChoreId)
    : undefined;
  const permissionsForChore = (chore: Chore) => resolveChorePermissions({
    currentUserId,
    isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
    isOwner: isHost,
    chore,
  });
  const canManageChore = (chore: Chore) => permissionsForChore(chore).canEdit;
  const confirmDeleteChore = (chore: Chore) => {
    const remove = (scope: "occurrence" | "future" | "series") => {
      if (deleteChore(chore.id, scope)) {
        void removeMappedReminderIfPresent(currentUserId, chore.id).catch((error) =>
          reportRuntimeError("remove mapped reminder after chore deletion", error, {
            choreId: chore.id,
          }),
        );
      } else {
        showPopup({ title: "Not allowed", message: "Only the chore creator or Sweet host can delete this chore.", actions: [{ label: "Got it", primary: true }] });
      }
    };
    if (chore.recurrenceSeriesId || chore.recurring) {
      showPopup({ title: "Delete recurring chore?", message: "Choose how much to remove. Completed history is preserved unless you delete the entire series.", actions: [
        { label: "Cancel" }, { label: "This occurrence", onPress: () => remove("occurrence") },
        { label: "This and future", onPress: () => remove("future") }, { label: "Entire series", destructive: true, onPress: () => remove("series") },
      ] });
      return;
    }
    showPopup({ title: "Delete chore?", message: "This will remove the chore for everyone in your Sweet.", actions: [{ label: "Cancel" }, { label: "Delete", destructive: true, onPress: () => remove("occurrence") }] });
  };
  const openChoreActions = (chore: Chore) => {
    const allowed = permissionsForChore(chore).canView;
    logChorePermissionCheck("open-menu", {
      choreId: chore.id,
      currentUserId,
      householdId,
      isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
      isOwner: isHost,
      allowed,
    });
    if (!allowed) return;
    setActionChoreId(chore.id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={expandedHomeSections["my-chores"] ? filtered : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(scrollBottomPadding, 100 + botPad) },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <View
              style={[
                styles.header,
                { paddingTop: topPad + 16, backgroundColor: colors.background },
              ]}
            >
              <View style={styles.headerTopRow}>
                {pointsEnabled && <View
                  style={[
                    styles.totalPoints,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Feather name="star" size={14} color={colors.primary} />
                  <Text style={[styles.totalPointsText, { color: colors.primary }]}>
                    {currentUser?.points ?? 0} pts
                  </Text>
                </View>}
                <HeaderActions />
              </View>
              <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
                Welcome home,
              </Text>
              <Text style={[styles.username, { color: colors.foreground }]}>
                {currentUser?.name ?? "You"}
              </Text>
            </View>


            <Surface style={[styles.calendarCard, { borderColor: colors.border }]}>
              <View style={styles.calendarTopRow}>
                <TouchableOpacity
                  style={[styles.calendarNavButton, { backgroundColor: colors.muted }]}
                  onPress={() => {
                    if (calendarExpanded) {
                      setSelectedDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1, 12));
                    } else {
                      setWeekOffset((value) => value - 1);
                    }
                  }}
                  accessibilityLabel="Previous week"
                >
                  <Feather name="chevron-left" size={18} color={colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.calendarMonthButton}
                  onPress={() => {
                    setCalendarExpanded((value) => !value);
                  }}
                >
                  <Text style={[styles.calendarMonth, { color: colors.foreground }]}>
                    {(calendarExpanded ? selectedDate : weekDays[3]).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </Text>
                  <View style={styles.calendarExpandHint}>
                    <Text style={[styles.calendarTodayHint, { color: colors.mutedForeground }]}>
                      {calendarExpanded ? "Tap for week" : "Tap for month"}
                    </Text>
                    <Feather name={calendarExpanded ? "chevron-up" : "chevron-down"} size={11} color={colors.mutedForeground} />
                  </View>
                </TouchableOpacity>
                <View
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={personalChoreCountAccessibilityLabel}
                  style={[styles.todoBadge, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "35" }]}
                >
                  <Feather name="check-circle" size={16} color={colors.primary} />
                  <Text style={[styles.todoBadgeText, { color: colors.primary }]}>
                    {displayedPersonalChoreCount} to-do
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.calendarNavButton, { backgroundColor: colors.muted }]}
                  onPress={() => {
                    if (calendarExpanded) {
                      setSelectedDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1, 12));
                    } else {
                      setWeekOffset((value) => value + 1);
                    }
                  }}
                  accessibilityLabel="Next week"
                >
                  <Feather name="chevron-right" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              {!calendarExpanded ? (
                <View style={styles.calendarDays}>
                  {weekDays.map((date) => {
                  const selected = isSameDay(date, selectedDate);
                  const today = isSameDay(date, new Date());
                  const dayItems = calendarItemsByDate.get(localDateKey(date)) ?? [];
                  return (
                    <TouchableOpacity
                      key={date.toISOString()}
                      style={[
                        styles.calendarDay,
                        selected && { backgroundColor: colors.primary },
                        !selected && today && { backgroundColor: colors.secondary },
                      ]}
                      onPress={() => selectCalendarDate(date)}
                      accessibilityLabel={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, ${dayItems.length} scheduled ${dayItems.length === 1 ? "item" : "items"}`}
                    >
                      <Text style={[styles.calendarWeekday, { color: selected ? "#fff" : colors.mutedForeground }]}>
                        {date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}
                      </Text>
                      <Text style={[styles.calendarDate, { color: selected ? "#fff" : colors.foreground }]}>{date.getDate()}</Text>
                      <View style={styles.calendarMarkers}>
                        {dayItems.slice(0, 3).map((item) => (
                          <View
                            key={item.id}
                            accessibilityLabel={`${item.type}: ${item.title}`}
                            style={[
                              styles.calendarDot,
                              {
                                backgroundColor: markerColor(item.type, selected),
                                opacity: item.completed ? 0.42 : 1,
                                borderWidth: item.completed ? 1 : 0,
                                borderColor: selected ? colors.primary : colors.mutedForeground,
                              },
                            ]}
                          />
                        ))}
                        {dayItems.length > 3 && (
                          <Text style={[styles.markerMore, { color: selected ? colors.primaryForeground : colors.mutedForeground }]}>
                            +{dayItems.length - 3}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                  })}
                </View>
              ) : (
                <View style={styles.monthView}>
                  <View style={styles.monthWeekdays}>
                    {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                      <Text key={`${day}-${index}`} style={[styles.monthWeekday, { color: colors.mutedForeground }]}>{day}</Text>
                    ))}
                  </View>
                  <View style={styles.monthGrid}>
                    {monthDays.map((date) => {
                      const selected = isSameDay(date, selectedDate);
                      const inMonth = date.getMonth() === selectedDate.getMonth();
                      const dayItems = calendarItemsByDate.get(localDateKey(date)) ?? [];
                      return (
                        <TouchableOpacity
                          key={date.toISOString()}
                          style={[styles.monthDay, selected && { backgroundColor: colors.primary }]}
                          onPress={() => selectCalendarDate(date)}
                          accessibilityLabel={`${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${dayItems.length} scheduled items`}
                        >
                          <Text style={{
                            color: selected ? "#fff" : inMonth ? colors.foreground : colors.mutedForeground,
                            opacity: inMonth || selected ? 1 : 0.45,
                            fontFamily: selected ? "Inter_700Bold" : "Inter_500Medium",
                            fontSize: 13,
                          }}>
                            {date.getDate()}
                          </Text>
                          <View style={styles.monthDots}>
                            {dayItems.slice(0, 3).map((item) => (
                              <View key={item.id} style={[styles.monthDot, { backgroundColor: markerColor(item.type, selected), opacity: item.completed ? 0.42 : 1 }]} />
                            ))}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={[styles.householdPreview, { borderTopColor: colors.border }]}>
                    <Text style={[styles.previewTitle, { color: colors.foreground }]}>Scheduled</Text>
                    {selectedCalendarItems.length === 0 ? (
                      <Text style={[styles.previewEmpty, { color: colors.mutedForeground }]}>Nothing scheduled</Text>
                    ) : (
                      selectedCalendarItems.slice(0, 5).map((item) => {
                        return (
                          <View key={item.id} style={styles.previewRow}>
                            <Feather name={item.type === "chore" ? "check-square" : item.type === "expense" ? "dollar-sign" : "shopping-bag"} size={13} color={markerColor(item.type, false)} />
                            <Text style={[styles.previewChore, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                            <Text style={[styles.previewOwner, { color: colors.mutedForeground }]} numberOfLines={1}>
                              {item.type.replace("-", " ")}
                            </Text>
                            <Feather name={item.completed ? "check-circle" : "circle"} size={14} color={item.completed ? colors.success : colors.mutedForeground} />
                          </View>
                        );
                      })
                    )}
                    {selectedCalendarItems.length > 5 && (
                      <Text style={[styles.previewMore, { color: colors.primary }]}>+{selectedCalendarItems.length - 5} more</Text>
                    )}
                  </View>
                </View>
              )}

              <Text style={[styles.selectedDateLabel, { color: colors.foreground }]}>
                {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </Text>
            </Surface>

            <CalendarDayDetails
              visible={dayDetailsOpen}
              date={selectedDate}
              items={selectedCalendarItems}
              onClose={() => setDayDetailsOpen(false)}
              onItemPress={(item) => {
                setDayDetailsOpen(false);
                if (item.type === "chore") {
                  const chore = chores.find((candidate) => candidate.id === item.sourceId);
                  if (chore) openChoreActions(chore);
                } else if (item.type === "expense") {
                  router.push("/(tabs)/expenses");
                } else {
                  router.push("/(tabs)/shopping");
                }
              }}
            />

            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressLabel, { color: colors.foreground }]}>
                  My Progress
                </Text>
                <Text style={[styles.progressCount, { color: colors.mutedForeground }]}>
                  {completedCount}/{totalCount} done
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.success,
                      width: `${healthPct * 100}%` as `${number}%`,
                    },
                  ]}
                />
              </View>
            </View>

            <CollapsibleSectionHeader
              title="My Chores"
              count={filtered.length}
              icon="check-square"
              expanded={expandedHomeSections["my-chores"]}
              onToggle={() => toggleHomeSection("my-chores")}
            />

            {expandedHomeSections["my-chores"] && <View style={styles.filterRow}>
              {(["today", "done", "week", "archived"] as Filter[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterBtn,
                    {
                      backgroundColor:
                        filter === f ? colors.primary : colors.secondary,
                    },
                  ]}
                  onPress={() => setFilter(f)}
                  accessibilityLabel={
                    f === "today"
                      ? "Show today's chores"
                      : f === "done"
                        ? "Show chores completed in the last 7 days"
                        : f === "archived"
                          ? `Show ${archivedPersonalChoreCount} archived chores`
                          : "Show this week's chores"
                  }
                >
                  {f === "week" || f === "archived" ? (
                    <Feather
                      name={f === "archived" ? "archive" : "calendar"}
                      size={13}
                      color={filter === f ? "#fff" : colors.mutedForeground}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.filterText,
                      {
                        color: filter === f ? "#fff" : colors.mutedForeground,
                      },
                    ]}
                  >
                    {f === "today"
                      ? "Today"
                      : f === "done"
                        ? "Done"
                        : f === "archived"
                          ? `Archived ${archivedPersonalChoreCount}`
                          : "Week"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>}
            {expandedHomeSections["my-chores"] && filter === "done" ? (
              <Text style={[styles.doneRetentionHint, { color: colors.mutedForeground }]}>
                Completed chores stay here for 7 days. Older activity is available in Calendar.
              </Text>
            ) : null}
          </>
        }
        ListEmptyComponent={expandedHomeSections["my-chores"] ? (
          <EmptyState
            icon="check-circle"
            title={
              filter === "done"
                ? "No completed chores yet"
                : filter === "archived"
                  ? "No archived chores"
                  : "No chores here"
            }
            subtitle={
              filter === "done"
                ? "Complete some chores to see them here"
                : filter === "archived"
                  ? "Older incomplete chores will appear here"
                  : "Tap + to add your first chore"
            }
          />
        ) : null}
        renderItem={({ item }) => (
          <ChoreRow
            chore={item}
            onSetCompleted={setChoreCompleted}
            onManage={() => openChoreActions(item)}
          />
        )}
        ListFooterComponent={
          <>
            <>
                <CollapsibleSectionHeader
                  title="Shopping"
                  count={myShoppingItems.length}
                  icon="shopping-cart"
                  expanded={expandedHomeSections.shopping}
                  onToggle={() => toggleHomeSection("shopping")}
                />
                {expandedHomeSections.shopping && (myShoppingItems.length === 0 ? (
                  <Text style={[styles.sectionEmpty, { color: colors.mutedForeground }]}>No active shopping items</Text>
                ) : (
                <Surface
                  style={[
                    styles.toBuyCard,
                    { borderColor: colors.border, marginBottom: 12 },
                  ]}
                >
                  {myShoppingItems.map((item, idx) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.toBuyRow,
                        idx > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        toggleShoppingItem(item.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.toBuyCheck, { borderColor: colors.border }]} />
                      <Text style={[styles.toBuyItem, { color: colors.foreground }]} numberOfLines={1}>
                        {item.name}
                        {item.quantity ? (
                          <Text style={{ color: colors.mutedForeground }}> · {item.quantity}</Text>
                        ) : null}
                      </Text>
                      <Text style={[styles.toBuySection, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.listName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </Surface>
                ))}
              </>
          </>
        }
      />

      <FloatingActionButton
        accessibilityLabel="Add chore"
        onPress={() => {
          setEditingChoreId(null);
          setShowModal(true);
        }}
      />

      <ActionMenuModal
        visible={!!actionChore}
        title={actionChore?.title ?? "Chore"}
        subtitle="Manage this chore"
        onClose={() => setActionChoreId(null)}
        actions={actionChore ? [
          ...(permissionsForChore(actionChore).canComplete ? [{
            key: actionChore.completed ? "uncomplete" : "complete",
            label: actionChore.completed ? "Mark incomplete" : "Mark as done",
            icon: actionChore.completed ? "rotate-ccw" as const : "check-circle" as const,
            onPress: () => setChoreCompleted(actionChore.id, !actionChore.completed),
          }] : []),
          {
            key: "calendar",
            label: `Add to ${calendarDestinationLabel}`,
            icon: "calendar" as const,
            successMessage: "Added to Google Calendar",
            runAfterDismiss: calendarDestination == null,
            onPress: () => {
              return addChoreToCalendar(actionChore.id);
            },
          },
          {
            key: "calendar-destination",
            label: "Change calendar destination",
            icon: "settings" as const,
            runAfterDismiss: true,
            onPress: () => {
              return chooseCalendarDestination(true).then(() => undefined);
            },
          },
          ...(permissionsForChore(actionChore).canEdit ? [
          {
            key: "edit",
            label: "Edit or reassign",
            icon: "edit-2" as const,
            runAfterDismiss: true,
            onPress: () => {
              setEditingChoreId(actionChore.id);
              setShowModal(true);
            },
          },
          ...(permissionsForChore(actionChore).canDelete ? [{
            key: "delete",
            label: "Delete chore",
            icon: "trash-2" as const,
            destructive: true,
            // confirmDeleteChore owns the only confirmation flow. Layering an
            // ActionMenu confirmation here caused its follow-up popup to be
            // lost while the action sheet was dismissing on web.
            runAfterDismiss: true,
            confirmation: undefined,
            onPress: () => confirmDeleteChore(actionChore),
          }] : []),
          ] : []),
        ] : []}
      />

      <Modal visible={showModal} transparent animationType="none" onRequestClose={closeAddChore}>
        <Animated.View
          style={[
            styles.addChoreContainer,
            { backgroundColor: colors.background, transform: [{ translateY: addChoreTranslateY }] },
          ]}
        >
          {/* Header: title + X close button */}
          <View
            {...addChoreDragHandlers}
            style={[
              styles.addChoreHeader,
              { paddingTop: insets.top + 10, borderBottomColor: colors.border },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border, top: insets.top + 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.addChoreHeaderTitle, { color: colors.foreground }]}>
                {editingChore ? "Edit Chore" : "Add Chore"}
              </Text>
              <Text style={[styles.addChoreHeaderSub, { color: colors.mutedForeground }]}>
                {editingChore ? "Update assignment, schedule, or details" : "Assign it to yourself or a Sweetmate"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={closeAddChore}
              style={[styles.addChoreCloseBtn, { backgroundColor: colors.muted }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <ManualChoreForm
              key={editingChore?.id ?? (showModal ? "new-open" : "new-closed")}
              initialAssigneeId={editingChore?.assignedTo ?? currentUserId}
              initialChore={editingChore}
              onCreated={closeAddChore}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>
    </View>
  );
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  username: { fontSize: 30, lineHeight: 36, fontFamily: "Inter_700Bold", marginTop: 2 },
  totalPoints: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  totalPointsText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  progressSection: {
    paddingHorizontal: 2,
    paddingVertical: 4,
    marginBottom: 10,
  },
  calendarCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  calendarTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  calendarNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarMonthButton: { flex: 1 },
  calendarMonth: { fontFamily: "Inter_700Bold", fontSize: 16 },
  calendarExpandHint: { flexDirection: "row", alignItems: "center", gap: 2 },
  calendarTodayHint: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 1 },
  todoBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 9,
    minWidth: 78,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  todoBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  calendarDays: { flexDirection: "row", gap: 4, marginTop: 12 },
  calendarDay: {
    flex: 1,
    minHeight: 62,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  calendarWeekday: { fontFamily: "Inter_500Medium", fontSize: 10, textTransform: "uppercase" },
  calendarDate: { fontFamily: "Inter_700Bold", fontSize: 18, marginTop: 2 },
  calendarMarkers: { height: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, marginTop: 2 },
  calendarDot: { width: 5, height: 5, borderRadius: 3 },
  markerMore: { fontFamily: "Inter_600SemiBold", fontSize: 7, lineHeight: 9 },
  selectedDateLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginTop: 11 },
  monthView: { marginTop: 10 },
  monthWeekdays: { flexDirection: "row" },
  monthWeekday: { width: "14.2857%", textAlign: "center", fontFamily: "Inter_600SemiBold", fontSize: 10 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 5 },
  monthDay: { width: "14.2857%", height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  monthDots: { height: 5, flexDirection: "row", alignItems: "center", gap: 2, marginTop: 3 },
  monthDot: { width: 4, height: 4, borderRadius: 2 },
  householdPreview: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 7 },
  previewTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  previewEmpty: { fontFamily: "Inter_400Regular", fontSize: 12, paddingVertical: 4 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  previewOwnerDot: { width: 8, height: 8, borderRadius: 4 },
  previewChore: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12 },
  previewOwner: { maxWidth: 72, fontFamily: "Inter_400Regular", fontSize: 11 },
  previewMore: { fontFamily: "Inter_600SemiBold", fontSize: 11, marginLeft: 16 },
  dayModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  dayModalSheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingBottom: Platform.OS === "ios" ? 28 : 16 },
  dayModalHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "#9CA3AF", opacity: 0.55, alignSelf: "center", marginTop: 9 },
  dayModalHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  dayModalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  dayModalSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  dayModalClose: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dayModalContent: { paddingHorizontal: 18, paddingBottom: 12, gap: 16 },
  dayEmpty: { alignItems: "center", gap: 8, paddingVertical: 32 },
  dayGroup: { gap: 7 },
  dayGroupTitle: { fontFamily: "Inter_700Bold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  dayItem: { minHeight: 62, borderRadius: 14, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  dayItemIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayItemTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  dayItemDescription: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15, marginTop: 2 },
  dayItemAmount: { fontFamily: "Inter_700Bold", fontSize: 12 },
  progressHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  progressLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, flexShrink: 1, paddingRight: 4 },
  progressCount: { fontFamily: "Inter_400Regular", fontSize: 13, flexShrink: 0 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 3 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 36,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionDividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  sectionDividerLabel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexShrink: 0,
  },
  sectionTitleText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    flexShrink: 1,
  },
  sectionTitleCount: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flexShrink: 1,
  },
  sectionEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  filterText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  doneRetentionHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  listContent: { paddingHorizontal: 16, gap: 12 },
  choreRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryVisual: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pointsVisual: {
    minWidth: 42,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  leftPointsText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  choreInfo: { flex: 1, minWidth: 0 },
  choreTitle: { fontFamily: "Inter_500Medium", fontSize: 15 },
  choreMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dueDateText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  pointsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pointsText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  trailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  taskActionsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  // ── Full-screen Add Chore modal (matches New IOU) ──
  addChoreContainer: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  addChoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  addChoreHeaderTitle: { fontFamily: "Inter_700Bold", fontSize: 26 },
  addChoreHeaderSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  addChoreCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHandle: {
    position: "absolute",
    left: "50%",
    marginLeft: -20,
    width: 40,
    height: 5,
    borderRadius: 3,
  },
  addChoreBody: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 4,
  },
  addChoreFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addChoreSubmit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 22,
  },
  addChoreSubmitText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  fieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  categoryScroll: { marginBottom: 4 },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  catChipText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  pointsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  pointsChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  addBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  addBtnText: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  toBuyCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#4A3426",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 1,
  },
  toBuyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  toBuyCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
  },
  toBuyItem: { fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 },
  toBuySection: { fontFamily: "Inter_400Regular", fontSize: 11 },
});
