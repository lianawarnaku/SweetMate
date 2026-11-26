import { choreDueLabel } from "@/lib/choreDueLabel";
import { useModalDismissal } from "@/hooks/useModalDismissal";
import { formatShoppingTime } from "@/lib/shoppingSchedule";
import { UpcomingChores } from "@/components/UpcomingChores";
import { upcomingHouseholdChores } from "@/lib/upcomingChores";
import { PersonalAgenda } from "@/components/PersonalAgenda";
import { GoogleScheduleControls } from "@/components/GoogleScheduleControls";
import { scheduleDateKey, scheduleItemsForDay } from "@/lib/personalSchedule";
import { useFloatingWeekCalendar } from "@/hooks/useFloatingWeekCalendar";
import { useHomeSummaryDismissal } from "@/hooks/useHomeSummaryDismissal";
import { HomeCalendarBody, HomeCalendarSection } from "@/components/HomeCalendarPresentation";
import { householdDateKey } from "@/lib/choreTimezone";
import { isPointsVisible } from "@/constants/featureAvailability";
import { GlassFilterGroup } from "@/components/GlassFilterGroup";
import { ChoreFilterButton } from "@/components/ChoreFilterButton";
import { CompletionUndoMenu } from "@/components/CompletionUndoMenu";
import { CompletionMotion, CompletionText } from "@/components/CompletionMotion";
import { MyDayRow, myDayRowStyles } from "@/components/MyDayRow";
import { useCompletionFeedback } from "@/hooks/useCompletionFeedback";
import { useHomeSections, type HomeSectionId } from "@/hooks/useHomeSections";
import { SectionDivider as CollapsibleSectionHeader } from "@/components/SectionDivider";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  type FlatList,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SCREEN_WIDTH = Dimensions.get("window").width;
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { Easing as ReanimatedEasing, FadeIn, Keyframe, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";

import { EmptyState } from "@/components/EmptyState";
import { Surface } from "@/components/Surface";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { useAppPopup } from "@/components/AppPopupProvider";
import { FloatingActionButton, useFloatingActionMetrics } from "@/components/FloatingActionButton";
import { HeaderActions } from "@/components/HeaderActions";
import { MiniHouseMark } from "@/components/BrandMark";
import { ManualChoreForm } from "@/components/ManualChoreForm";
import { GlassCheckCircle } from "@/components/GlassCheckCircle";
import { usePinchListView } from "@/components/PinchListView";
import {
  type ChoreCategory,
  type Chore,
  useAppContextSelector,
} from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { motion, radii, spacing, typography } from "@/constants/designTokens";
import { success as hapticSuccess, tapLight } from "@/lib/haptics";
import { clampTabIndicatorX, resolveDraggedTabIndex } from "@/lib/tabBarGesture";
import { useDraggableSheet } from "@/hooks/useDraggableSheet";
import { useChoreLifecycleNow } from "@/hooks/useChoreLifecycleNow";
import { useAccessibilityPreferences } from "@/hooks/useAccessibilityPreferences";
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
import { isHomeCaughtUp, selectUpNextChore } from "@/lib/homeFocus";
import { compactOverdueItems } from "@/lib/overdueDisplay";
import { CHORE_RECURRENCE_LABELS } from "@/lib/choreSchedule";
import {
  deriveCalendarItems,
  groupCalendarItemsByDate,
  localDateKey,
  type CalendarItemType,
} from "@/lib/calendarItems";
import {
  choreLocalDateKey,
  choreScheduledDate,
  isBeforeLocalCalendarDay,
  isChoreActiveOnDay,
} from "@/lib/choreOccurrences";
import {
  activeChores,
  choresActiveOnSelectedDay,
  isArchivedIncomplete,
  isRecentlyCompleted,
} from "@/lib/choreLifecycle";

const CALENDAR_GESTURE_HOLD_MS = 260;
const CALENDAR_DAY_GAP = 4;
const HOME_COMPLETION_LAYOUT = LinearTransition.duration(240).easing(
  ReanimatedEasing.out(ReanimatedEasing.cubic),
);

// Exit motion is visual only: the X commits the calendar layout first, even
// if iOS interrupts or never reports the animation's completion.
const SUMMARY_DISMISS_EXIT = new Keyframe({
  0: { opacity: 1, transform: [{ rotate: "0deg" }] },
  14: { transform: [{ rotate: "-1deg" }] },
  34: { transform: [{ rotate: "1deg" }] },
  50: { transform: [{ rotate: "-0.5deg" }] },
  64: { opacity: 1, transform: [{ rotate: "0deg" }] },
  100: { opacity: 0, transform: [{ rotate: "0deg" }] },
}).duration(330).reduceMotion(ReduceMotion.System);
const ATTACHED_CALENDAR_ENTER = FadeIn.delay(210).duration(120).reduceMotion(ReduceMotion.System);

const CATEGORIES: { key: ChoreCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "cleaning", label: "Cleaning", icon: "wind" },
  { key: "kitchen", label: "Kitchen", icon: "coffee" },
  { key: "bathroom", label: "Bathroom", icon: "droplet" },
  { key: "laundry", label: "Laundry", icon: "refresh-cw" },
  { key: "outdoor", label: "Outdoor", icon: "sun" },
  { key: "other", label: "Other", icon: "package" },
];

type Filter = "today" | "done" | "archived" | "day";

function TodayFocusCard({
  chore,
  remainingCount,
  completedCount,
  totalCount,
  shoppingCount,
  reduceMotion,
  onOpenChore,
  onDismiss,
}: {
  chore?: Chore;
  remainingCount: number;
  completedCount: number;
  totalCount: number;
  shoppingCount: number;
  reduceMotion: boolean;
  onOpenChore: (chore: Chore) => void;
  onDismiss: () => void;
}) {
  const colors = useTheme();
  const progress = totalCount > 0 ? completedCount / totalCount : 1;
  const progressAnimation = useRef(new Animated.Value(progress)).current;
  const allDone = remainingCount === 0;
  const dismissingRef = useRef(false);
  const [dismissing, setDismissing] = useState(false);
  const dismiss = () => {
    if (!allDone || dismissingRef.current) return;
    dismissingRef.current = true;
    setDismissing(true);
    onDismiss();
    tapLight();
  };

  useEffect(() => {
    if (reduceMotion) {
      progressAnimation.setValue(progress);
      return;
    }
    Animated.timing(progressAnimation, {
      toValue: progress,
      duration: motion.standard,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnimation, reduceMotion]);

  return (
    <Reanimated.View exiting={reduceMotion ? undefined : SUMMARY_DISMISS_EXIT}>
      <Surface level="elevated" style={[styles.todayFocusCard, { borderColor: colors.border }]}>
        {allDone && <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Dismiss caught-up summary"
          accessibilityHint="Shows the calendar directly above your chores"
          accessibilityState={{ disabled: dismissing }}
          disabled={dismissing}
          onPress={dismiss}
          activeOpacity={0.65}
          style={styles.todayDismissButton}
        >
          <Feather name="x" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>}
        <View style={[styles.todayFocusHeader, allDone && styles.todayDismissibleHeader]}>
          <View style={[styles.todayIcon, { backgroundColor: colors.secondary }]}>
            <Feather
              name={allDone ? "check" : "sun"}
              size={18}
              color={allDone ? colors.success : colors.foreground}
            />
          </View>
          <View style={styles.todayHeadingGroup}>
            <Text style={[styles.todayEyebrow, { color: colors.mutedForeground }]}>TODAY</Text>
            <Text style={[styles.todayTitle, { color: colors.foreground }]}>
              {allDone
                ? "You're all caught up"
                : `${remainingCount} ${remainingCount === 1 ? "chore" : "chores"} need attention`}
            </Text>
          </View>
          <Text style={[styles.todayProgressCount, { color: colors.mutedForeground }]}>
            {completedCount}/{totalCount}
          </Text>
        </View>

        <View style={styles.progressSection}>
          <View style={styles.todayProgressLabelRow}>
            <Text style={[styles.todayProgressLabel, { color: colors.mutedForeground }]}>My Progress</Text>
            <Text style={[styles.todayProgressValue, { color: colors.mutedForeground }]}>
              {completedCount}/{totalCount} done
            </Text>
          </View>
          <View style={[styles.todayProgressTrack, { backgroundColor: colors.muted }]}>
            <Animated.View
              style={[
                styles.todayProgressFill,
                {
                  backgroundColor: colors.success,
                  width: progressAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </View>

        {chore ? (
          <TouchableOpacity
            style={[styles.upNextRow, { backgroundColor: colors.muted }]}
            onPress={() => onOpenChore(chore)}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Up next: ${chore.title}`}
            accessibilityHint="Opens chore actions"
          >
            <View style={styles.upNextCopy}>
              <Text style={[styles.upNextLabel, { color: colors.mutedForeground }]}>UP NEXT</Text>
              <Text style={[styles.upNextTitle, { color: colors.foreground }]} numberOfLines={1}>
                {chore.title}
              </Text>
              <Text style={[styles.upNextMeta, { color: colors.mutedForeground }]}>
                {formatDueDate(chore.dueDate)}
              </Text>
            </View>
            <View style={[styles.upNextAction, { borderColor: colors.border }]}>
              <Feather name="arrow-up-right" size={17} color={colors.foreground} />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.todayQuietState}>
            <Text style={[styles.todayQuietCopy, { color: colors.mutedForeground }]}>
              {shoppingCount > 0
                ? `${shoppingCount} shopping ${shoppingCount === 1 ? "item is" : "items are"} still waiting`
                : "Nothing else needs your attention right now"}
            </Text>
          </View>
        )}
      </Surface>
    </Reanimated.View>
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
  return isBeforeLocalCalendarDay(dateStr);
}

const formatDueDate = choreDueLabel;

interface ChoreRowProps {
  chore: {
    id: string;
    title: string;
    dueDate: string;
    completed: boolean;
    points: number;
    category: ChoreCategory;
    recurring?: "daily" | "everyOtherDay" | "everyThreeDays" | "weekly" | "biweekly" | "monthly";
    assignmentMode?: "specific-person" | "round-robin" | "unassigned";
  };
  onSetCompleted: (id: string, completed: boolean) => void;
  onManage: () => void;
  departing?: boolean;
}

function ChoreRow({
  chore,
  onSetCompleted,
  onManage,
  departing = false,
}: ChoreRowProps) {
  const colors = useTheme();
  const pointsEnabled = useAppContextSelector(
    (context) => isPointsVisible(context.pointsEnabled),
  );
  const overdue = isOverdue(chore.dueDate, chore.completed);
  const handleCheckPress = () => {
    onSetCompleted(chore.id, !chore.completed);
  };

  const dueDateColor = chore.completed
    ? colors.mutedForeground
    : overdue
    ? colors.primary
    : isToday(chore.dueDate)
    ? colors.primary
    : colors.mutedForeground;


  return (
    <MyDayRow completed={chore.completed} departing={departing}>
      <TouchableOpacity
        style={styles.checkBox}
        onPress={handleCheckPress}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: chore.completed }}
        aria-checked={chore.completed}
        accessibilityLabel={`${chore.completed ? "Mark incomplete" : "Mark complete"}: ${chore.title}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <GlassCheckCircle state={chore.completed ? "checked" : overdue ? "overdue" : "idle"} />
      </TouchableOpacity>

      {pointsEnabled && (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${chore.points} points`}
          style={[styles.pointsVisual, { backgroundColor: colors.secondary }]}
        >
          <Text style={[styles.leftPointsText, { color: colors.primary }]}>{chore.points} pts</Text>
        </View>
      )}

      <View
        style={styles.choreInfo}
      >
        <CompletionText
          completed={chore.completed}
          style={[
            styles.choreTitle,
            { color: chore.completed ? colors.mutedForeground : colors.foreground },
          ]}
          numberOfLines={1}
        >
          {chore.title}
        </CompletionText>
        <View style={styles.choreMeta}>
          <View
            style={[
              styles.dueStatus,
              { backgroundColor: overdue ? colors.primary + "16" : colors.muted },
            ]}
          >
            <Text style={[styles.dueDateText, { color: dueDateColor }]} numberOfLines={1}>
            {formatDueDate(chore.dueDate)}
            </Text>
          </View>
          {chore.recurring ? (
            <Text style={[styles.choreDetailText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {CHORE_RECURRENCE_LABELS[chore.recurring]}
            </Text>
          ) : null}
          {chore.assignmentMode === "round-robin" ? (
            <Text style={[styles.choreDetailText, { color: colors.mutedForeground }]} numberOfLines={1}>
              Round Robin
            </Text>
          ) : null}
        </View>
      </View>

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
    </MyDayRow>
  );
}

export default function MyChoresScreen() {
  const colors = useTheme();
  const { showPopup } = useAppPopup();
  const insets = useSafeAreaInsets();
  const { scrollBottomPadding } = useFloatingActionMetrics();
  const { personalSchedule, currentUserId, householdId, householdTimezone, activeSweet, chores, roommates, expenses, setChoreCompleted, deleteChore, shoppingLists, shoppingItems, toggleShoppingItem, setShoppingItemCompleted, pointsEnabled, isHost } =
    useAppContextSelector((context) => ({
      currentUserId: context.currentUserId,
      personalSchedule: context.personalSchedule,
      householdId: context.householdId,
      householdTimezone: context.householdTimezone,
      activeSweet: context.activeSweet,
      chores: context.chores,
      roommates: context.roommates,
      expenses: context.expenses,
      setChoreCompleted: context.setChoreCompleted,
      deleteChore: context.deleteChore,
      shoppingLists: context.shoppingLists,
      shoppingItems: context.shoppingItems,
      toggleShoppingItem: context.toggleShoppingItem,
      setShoppingItemCompleted: context.setShoppingItemCompleted,
      pointsEnabled: isPointsVisible(context.pointsEnabled),
      isHost: context.isHost,
    }));

  const currentUser = roommates.find((r) => r.id === currentUserId);
  const { reduceMotion } = useAccessibilityPreferences();
  const { listView, pinchGesture } =
    usePinchListView(currentUserId, "home");
  const lifecycleNow = useChoreLifecycleNow(chores);
  const [filter, setFilter] = useState<Filter>("today");
  const [showEarlierChores, setShowEarlierChores] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const { expandedHomeSections, toggleSection } = useHomeSections(currentUserId);
  const choreFeedback = useCompletionFeedback(
    `home-chores:${householdId ?? ""}:${currentUserId}:${filter}:${selectedDate.toDateString()}:${Boolean(expandedHomeSections["my-chores"])}`,
  );
  const shoppingFeedback = useCompletionFeedback(
    `home-shopping:${householdId ?? ""}:${currentUserId}:${Boolean(expandedHomeSections.shopping)}`,
  );
  const [showModal, setShowModal] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [actionChoreId, setActionChoreId] = useState<string | null>(null);
  const [undoSection, setUndoSection] = useState<"chores" | "shopping" | null>(null);
  const heldShoppingItem = useRef(false);
  useEffect(() => { setUndoSection(null); }, [householdId, currentUserId]);
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
  const choreDismissal = useModalDismissal(showModal, () => {
      setShowModal(false);
      setEditingChoreId(null);
  });
  const closeAddChore = () => {
    choreDismissal.dismiss(Animated.timing(addChoreTranslateY, {
      toValue: SCREEN_HEIGHT, duration: 260, useNativeDriver: true,
    }), 260);
  };
  const addChoreDragHandlers = useDraggableSheet(addChoreTranslateY, () => {
    setShowModal(false);
    setEditingChoreId(null);
  }, showModal);
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
  const personalShoppingItems = useMemo(
    () =>
      shoppingItems.flatMap((item) => {
        const list = shoppingListsById.get(item.listId);
        const itemAssignees = Array.isArray(item.assignedTo)
          ? item.assignedTo
          : item.assignedTo
            ? [item.assignedTo]
            : [];
        if (
          !itemAssignees.includes(currentUserId) &&
          list?.assignedTo !== currentUserId
        ) {
          return [];
        }
        return [{ ...item, listName: list?.name ?? "" }];
      }),
    [currentUserId, shoppingItems, shoppingListsById],
  );

  const myShoppingItems = personalShoppingItems.filter((item) => !item.completed);
  const displayedShoppingItems = personalShoppingItems.filter(
    (item) => !item.completed || shoppingFeedback.completingIds.has(item.id),
  );
  // Let the last checked-off row finish its departure before hiding the section.
  const showPersonalShopping = displayedShoppingItems.length > 0;

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
    () => activeChores(myChores, lifecycleNow, householdTimezone),
    [householdTimezone, lifecycleNow, myChores],
  );
  const upcomingPersonalChores = useMemo(
    () => upcomingHouseholdChores(myChores, householdId, lifecycleNow, householdTimezone),
    [householdId, householdTimezone, lifecycleNow, myChores],
  );
  const selectedDayChores = useMemo(
    () => choresActiveOnSelectedDay(myChores, selectedDate, lifecycleNow),
    [lifecycleNow, myChores, selectedDate],
  );
  const todayChores = useMemo(
    () =>
      activePersonalChores.filter((chore) => {
        if (chore.skippedAt) return false;
        if (isChoreActiveOnDay(chore, lifecycleNow)) return true;
        // The active-day selector intentionally excludes completed chores. Keep
        // work finished today in the progress denominator after checking it off.
        const today = householdDateKey(lifecycleNow, householdTimezone);
        return chore.completed && (chore.completedAt
          ? householdDateKey(new Date(chore.completedAt), householdTimezone) === today
          : choreScheduledDate(chore, householdTimezone) === today);
      }),
    [activePersonalChores, householdTimezone, lifecycleNow],
  );
  const todayIncompleteChores = todayChores.filter((chore) => !chore.completed);
  const upNextChore = selectUpNextChore(todayIncompleteChores);
  const archivedPersonalChoreCount = useMemo(
    () => myChores.filter((chore) => isArchivedIncomplete(chore, lifecycleNow)).length,
    [lifecycleNow, myChores],
  );
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
          scheduledDate: chore.scheduledDate ?? householdDateKey(new Date(chore.dueDate), householdTimezone),
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
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedDate(date);
    setFilter("day");
    Haptics.selectionAsync();
  };
  const selectedTint = colors.primary + "22";

  // Drag-to-select for the week strip, mirroring the bottom tab bar's
  // hold-and-slide gesture (see app/(tabs)/_layout.tsx ScrollableTabBar).
  const [calendarRowWidth, setCalendarRowWidth] = useState(0);
  const calendarIndicatorX = useRef(new Animated.Value(0)).current;
  const calendarIndicatorXValue = useRef(0);
  const calendarDragStartX = useRef(0);
  const calendarDragActive = useRef(false);
  const calendarDraggedIndex = useRef(-1);
  const calendarHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWeekIndex = Math.max(
    0,
    weekDays.findIndex((date) => isSameDay(date, selectedDate)),
  );
  const dayStride =
    calendarRowWidth > 0 ? (calendarRowWidth + CALENDAR_DAY_GAP) / 7 : 0;

  useEffect(() => {
    const listener = calendarIndicatorX.addListener(({ value }) => {
      calendarIndicatorXValue.current = value;
    });
    return () => calendarIndicatorX.removeListener(listener);
  }, [calendarIndicatorX]);

  useEffect(() => {
    if (!dayStride || calendarDragActive.current) return;
    Animated.spring(calendarIndicatorX, {
      toValue: selectedWeekIndex * dayStride,
      damping: 22,
      stiffness: 240,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [calendarIndicatorX, dayStride, selectedWeekIndex]);

  useEffect(
    () => () => {
      if (calendarHoldTimer.current) clearTimeout(calendarHoldTimer.current);
    },
    [],
  );

  const calendarPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          calendarDragStartX.current = calendarIndicatorXValue.current;
          calendarDragActive.current = false;
          calendarDraggedIndex.current = selectedWeekIndex;
          calendarHoldTimer.current = setTimeout(() => {
            calendarDragActive.current = true;
            tapLight();
          }, CALENDAR_GESTURE_HOLD_MS);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!calendarDragActive.current || !dayStride) return;
          const nextX = clampTabIndicatorX(
            calendarDragStartX.current + gesture.dx,
            dayStride,
            7,
          );
          calendarIndicatorX.setValue(nextX);
          const nextIndex = resolveDraggedTabIndex(nextX, dayStride, 7);
          if (nextIndex !== calendarDraggedIndex.current) {
            calendarDraggedIndex.current = nextIndex;
            tapLight();
          }
        },
        onPanResponderRelease: () => {
          if (calendarHoldTimer.current) clearTimeout(calendarHoldTimer.current);
          calendarHoldTimer.current = null;
          const wasDragging = calendarDragActive.current;
          calendarDragActive.current = false;
          if (wasDragging) {
            const target = weekDays[calendarDraggedIndex.current];
            if (target) selectCalendarDate(target);
          } else {
            Animated.spring(calendarIndicatorX, {
              toValue: selectedWeekIndex * dayStride,
              damping: 22,
              stiffness: 240,
              mass: 0.72,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          if (calendarHoldTimer.current) clearTimeout(calendarHoldTimer.current);
          calendarHoldTimer.current = null;
          calendarDragActive.current = false;
          Animated.spring(calendarIndicatorX, {
            toValue: selectedWeekIndex * dayStride,
            damping: 22,
            stiffness: 240,
            mass: 0.72,
            useNativeDriver: true,
          }).start();
        },
      }),
    // Recreate the responder when geometry changes so its closures match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarIndicatorX, dayStride, selectedWeekIndex, weekDays],
  );
  const markerColor = (type: CalendarItemType, selected: boolean) => {
    if (selected) return colors.primaryForeground;
    if (type === "chore") return colors.warning;
    if (type === "expense") return colors.destructive;
    return colors.success;
  };
  const toggleHomeSection = (sectionId: HomeSectionId) => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    toggleSection(sectionId);
    Haptics.selectionAsync();
  };
  const selectFilter = (nextFilter: Filter) => {
    if (nextFilter === filter) return;
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setFilter(nextFilter);
    setShowEarlierChores(false);
    Haptics.selectionAsync();
  };
  const filtered = useMemo(
    () => {
      const now = lifecycleNow;
      const candidates = filter === "archived" ? myChores : filter === "day" ? selectedDayChores : activePersonalChores;
      return candidates
        .filter((chore) => {
          if (filter === "archived") {
            return isArchivedIncomplete(chore, now) || choreFeedback.completingIds.has(chore.id);
          }
          if (filter === "today") {
            return isChoreActiveOnDay(chore, now) || choreFeedback.completingIds.has(chore.id);
          }
          if (filter === "done") return isRecentlyCompleted(chore, now);
          if (filter === "day") {
            return (!isArchivedIncomplete(chore, now) && isChoreActiveOnDay(chore, selectedDate)) || choreFeedback.completingIds.has(chore.id);
          }
          return false;
        })
        // A just-completed row keeps its place while it crosses off and exits.
        .sort((a, b) => {
          const aCompleted = a.completed && !choreFeedback.completingIds.has(a.id);
          const bCompleted = b.completed && !choreFeedback.completingIds.has(b.id);
          return aCompleted === bCompleted ? 0 : aCompleted ? 1 : -1;
        });
    },
    [activePersonalChores, choreFeedback.completingIds, filter, lifecycleNow, myChores, selectedDate, selectedDayChores],
  );
  const displayedChores = useMemo(() => {
    if (filter !== "today") return filtered;
    return compactOverdueItems(filtered, {
      expanded: showEarlierChores,
      isOverdue: (chore) => isOverdue(
        chore.dueDate,
        chore.completed && !choreFeedback.completingIds.has(chore.id),
      ),
      keyForRepeatedItem: (chore) => chore.recurring
        ? chore.title.trim().toLocaleLowerCase()
        : chore.id,
    }).visibleItems;
  }, [choreFeedback.completingIds, filter, filtered, showEarlierChores]);
  const hiddenEarlierChoreCount = filter === "today" ? filtered.length - displayedChores.length : 0;
  const agendaTimezone = personalSchedule.prefs?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? householdTimezone;
  const agendaDay = scheduleDateKey(filter === "today" ? lifecycleNow : selectedDate, agendaTimezone);
  const showPersonalAgenda = personalSchedule.prefs?.enabled === true && (filter === "today" || filter === "day");
  const requestedAgendaDay = useRef<string | null>(null);
  useEffect(() => {
    if (!showPersonalAgenda || personalSchedule.loading || requestedAgendaDay.current === `${householdId}:${currentUserId}:${agendaDay}`) return;
    requestedAgendaDay.current = `${householdId}:${currentUserId}:${agendaDay}`;
    void personalSchedule.sync(agendaDay).catch(() => {});
  }, [showPersonalAgenda, personalSchedule.loading, personalSchedule.sync, agendaDay, currentUserId, householdId]);


  const focusKey = JSON.stringify([householdId, currentUserId, choreLocalDateKey(lifecycleNow)]);
  const todayFocusDay = householdDateKey(lifecycleNow, householdTimezone);
  const selectedFocusDay = filter === "day" ? choreLocalDateKey(selectedDate) : todayFocusDay;
  const focusThroughDay = selectedFocusDay > todayFocusDay ? selectedFocusDay : todayFocusDay;
  const focusChores = myChores.filter(chore => {
    const scheduled = choreScheduledDate(chore, householdTimezone);
    return (!chore.recurrenceEndsOn || scheduled < chore.recurrenceEndsOn)
      && (filter === "done" || filter === "archived" || Boolean(scheduled && scheduled <= focusThroughDay));
  });
  const todayScheduleDay = scheduleDateKey(lifecycleNow, agendaTimezone);
  const caughtUp = isHomeCaughtUp({
    chores: focusChores,
    shoppingItems: personalShoppingItems,
    scheduleItems: personalSchedule.prefs?.enabled ? [
      ...scheduleItemsForDay(personalSchedule.items, todayScheduleDay, agendaTimezone),
      ...(filter === "day" ? scheduleItemsForDay(personalSchedule.items, agendaDay, agendaTimezone) : []),
    ] : [],
  });
  const { dismissed: focusDismissed, dismiss: saveFocusDismissal } = useHomeSummaryDismissal({
    householdId, userId: currentUserId, day: choreLocalDateKey(lifecycleNow),
  });
  const dismissTodayFocus = () => {
    setCalendarExpanded(false);
    saveFocusDismissal();
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;
  const homeListRef = useRef<FlatList<Chore>>(null);
  const [homeHeaderHeight, setHomeHeaderHeight] = useState(0);
  const [homeListHeight, setHomeListHeight] = useState(0);
  // Compact mode also hides My Progress. Its calendar must use the same header
  // as an explicit X dismissal, including when that choice restores after mount.
  const calendarHeaderMode = focusDismissed || listView;
  const homePresentationKey = `${focusKey}:${calendarHeaderMode ? "calendar-header" : "calendar-card"}`;
  const floatingWeekCalendar = calendarHeaderMode && !calendarExpanded;
  const floatingCalendar = useFloatingWeekCalendar({
    enabled: floatingWeekCalendar, reduceMotion, resetKey: focusKey,
  });
  useEffect(() => {
    if (calendarHeaderMode) homeListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [calendarHeaderMode, focusKey]);
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
  const updateHomeChoreCompletion = (id: string, completed: boolean) => {
    const chore = myChores.find((entry) => entry.id === id);
    if (!chore || chore.completed === completed || !permissionsForChore(chore).canComplete) return;
    if (completed) hapticSuccess();
    else tapLight();
    if (completed && filter !== "done") {
      choreFeedback.holdCompletion(id);
    } else {
      choreFeedback.cancelCompletion(id);
    }
    setChoreCompleted(id, completed);
  };
  const undoShoppingItems = personalShoppingItems
    .filter((item) => item.completed)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const undoChores = myChores
    .filter((chore) => chore.completed && permissionsForChore(chore).canComplete)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const undoSnapshot = useRef({ householdId, currentUserId, undoSection, undoShoppingItems, undoChores });
  undoSnapshot.current = { householdId, currentUserId, undoSection, undoShoppingItems, undoChores };

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
      showPopup({ title: "Delete recurring chore?", message: "Choose how much to remove. Completed chores are preserved unless you delete the entire series.", actions: [
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

  const calendarContent = (
    <HomeCalendarBody attached={floatingWeekCalendar}>
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
            if (floatingWeekCalendar) homeListRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotion });
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
        <View
          style={styles.calendarDaysWrap}
          onLayout={(event) => setCalendarRowWidth(event.nativeEvent.layout.width)}
        >
          {dayStride > 0 && (
            <Animated.View
              accessibilityLabel="Drag to switch day"
              accessibilityHint="Press and hold, then slide left or right"
              style={[
                styles.calendarGestureTarget,
                {
                  width: dayStride - CALENDAR_DAY_GAP,
                  transform: [{ translateX: calendarIndicatorX }],
                },
              ]}
              {...calendarPanResponder.panHandlers}
            />
          )}
          <View style={styles.calendarDays}>
          {weekDays.map((date) => {
          const selected = isSameDay(date, selectedDate);
          const today = isSameDay(date, new Date());
          const dayItems = calendarItemsByDate.get(localDateKey(date)) ?? [];
          return (
            <TouchableOpacity
              key={date.toISOString()}
              style={styles.calendarDay}
              onPress={() => selectCalendarDate(date)}
              accessibilityLabel={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, ${dayItems.length} scheduled ${dayItems.length === 1 ? "item" : "items"}${today ? ", today" : ""}${selected ? ", selected" : ""}`}
            >
              <Text style={[styles.calendarWeekday, { color: selected ? colors.foreground : today ? colors.warning : colors.mutedForeground }]}>
                {date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}
              </Text>
              <Text style={[styles.calendarDate, { color: today && !selected ? colors.warning : colors.foreground, textDecorationLine: selected ? "underline" : "none" }]}>{date.getDate()}</Text>
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
                        borderColor: selected ? colors.foreground : colors.mutedForeground,
                      },
                    ]}
                  />
                ))}
                {dayItems.length > 3 && (
                  <Text style={[styles.markerMore, { color: selected ? colors.foreground : colors.mutedForeground }]}>
                    +{dayItems.length - 3}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
          })}
          </View>
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
              const today = isSameDay(date, new Date());
              const inMonth = date.getMonth() === selectedDate.getMonth();
              const dayItems = calendarItemsByDate.get(localDateKey(date)) ?? [];
              return (
                <TouchableOpacity
                  key={date.toISOString()}
                  style={styles.monthDay}
                  onPress={() => selectCalendarDate(date)}
                  accessibilityLabel={`${date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${dayItems.length} scheduled items${today ? ", today" : ""}${selected ? ", selected" : ""}`}
                >
                  <Text style={{
                    color: today && !selected ? colors.warning : selected || inMonth ? colors.foreground : colors.mutedForeground,
                    opacity: inMonth || selected ? 1 : 0.45,
                    fontFamily: selected || today ? "Inter_700Bold" : "Inter_500Medium",
                    fontSize: 13,
                    textDecorationLine: selected ? "underline" : "none",
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

          {selectedCalendarItems.length > 0 && <View style={[styles.householdPreview, { borderTopColor: colors.border }]}>
            <Text style={[styles.previewTitle, { color: colors.foreground }]}>Scheduled</Text>
            {selectedCalendarItems.slice(0, 5).map((item) => {
                return (
                  <View key={item.id} style={styles.previewRow}>
                    {item.type !== "chore" && <Feather name={item.type === "expense" ? "dollar-sign" : "shopping-bag"} size={13} color={markerColor(item.type, false)} />}
                    <Text style={[styles.previewChore, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.previewOwner, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.time ? `${formatShoppingTime(item.time)} · ` : ""}{item.type.replace("-", " ")}
                    </Text>
                    <Feather name={item.completed ? "check-circle" : "circle"} size={14} color={item.completed ? colors.success : colors.mutedForeground} />
                  </View>
                );
              })}
            {selectedCalendarItems.length > 5 && (
              <Text style={[styles.previewMore, { color: colors.primary }]}>+{selectedCalendarItems.length - 5} more</Text>
            )}
          </View>}
        </View>
      )}

      <Text style={[styles.selectedDateLabel, { color: colors.foreground }]}>
        {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
      </Text>
    </HomeCalendarBody>
  );

  return (
    <GestureDetector gesture={pinchGesture}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        onLayout={(event) => setHomeHeaderHeight(event.nativeEvent.layout.height)}
        style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background }]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.greetingGroup}>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]} numberOfLines={2}>
              Welcome home, <Text style={[styles.username, { color: colors.foreground }]}>{currentUser?.name ?? "You"}</Text>
            </Text>
            <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.greetingMark}>
              <MiniHouseMark size={28} color={colors.foreground} />
            </View>
          </View>
          <View style={styles.headerActions}><HeaderActions /></View>
        </View>
        {pointsEnabled && <View style={[styles.totalPoints, { backgroundColor: colors.primary + "18", alignSelf: "flex-start", marginTop: 8 }]}>
          <Feather name="star" size={14} color={colors.primary} />
          <Text style={[styles.totalPointsText, { color: colors.primary }]}>{currentUser?.points ?? 0} pts</Text>
        </View>}
      </View>
      {/* Keep browser scroll anchoring from reversing the collapsing calendar. */}
      <Reanimated.FlatList
        // Replace the native header cell as one unit. Replacing only its inner
        // calendar view leaves the virtualized/reanimated header owner alive.
        key={homePresentationKey}
        testID={calendarHeaderMode ? "home-list-calendar-header" : "home-list-calendar-card"}
        style={[{ flex: 1 }, Platform.OS === "web" && { overflowAnchor: "none" } as ViewStyle]}
        ref={homeListRef}
        onLayout={(event) => setHomeListHeight(event.nativeEvent.layout.height)}
        onScroll={floatingCalendar.onScroll}
        extraData={calendarHeaderMode}
        scrollEventThrottle={16}
        itemLayoutAnimation={reduceMotion ? undefined : HOME_COMPLETION_LAYOUT}
        data={expandedHomeSections["my-chores"] && !showPersonalAgenda ? displayedChores : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(scrollBottomPadding, 100 + botPad),
            minHeight: floatingWeekCalendar ? homeListHeight + floatingCalendar.height + 8 : undefined },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View collapsable={false}>
            {!calendarHeaderMode && (todayIncompleteChores.length > 0 || caughtUp) && (
              <TodayFocusCard
                key={`${focusKey}:${todayIncompleteChores.length === 0}`}
                chore={upNextChore}
                remainingCount={todayIncompleteChores.length}
                completedCount={todayChores.length - todayIncompleteChores.length}
                totalCount={todayChores.length}
                shoppingCount={myShoppingItems.length}
                reduceMotion={reduceMotion}
                onOpenChore={openChoreActions}
                onDismiss={dismissTodayFocus}
              />
            )}

            <HomeCalendarSection
              dismissed={calendarHeaderMode}
              expanded={expandedHomeSections.schedule}
              count={selectedCalendarItems.length}
              onToggle={() => toggleHomeSection("schedule")}
              onLayout={(event) => {
                if (!floatingWeekCalendar && !calendarExpanded) floatingCalendar.onCalendarLayout(event);
              }}
            >
              {floatingWeekCalendar ? <Reanimated.View pointerEvents="none" style={floatingCalendar.spacerStyle} /> : calendarContent}
            </HomeCalendarSection>

            <GoogleScheduleControls key={`google-schedule:${householdId}:${currentUserId}`} placement="home" schedule={personalSchedule} householdId={householdId} day={agendaDay} />

            <CollapsibleSectionHeader
              title={showPersonalAgenda ? "My Day" : "My Chores"}
              count={filtered.length + (showPersonalAgenda ? scheduleItemsForDay(personalSchedule.items, agendaDay, agendaTimezone).filter((item) => !item.app_completed_at).length : 0)}
              icon="check-square"
              expanded={expandedHomeSections["my-chores"]}
              onToggle={() => toggleHomeSection("my-chores")}
              onLongPress={() => setUndoSection("chores")}
              longPressHint="Press and hold to undo a completed chore"
            />

            {expandedHomeSections["my-chores"] && <GlassFilterGroup style={styles.filterRow}>
              {(["today", "done", "archived"] as Filter[]).map((f) => (
                <ChoreFilterButton
                  key={f}
                  selected={filter === f}
                  onPress={() => selectFilter(f)}
                  pill
                  icon={f === "archived" ? "archive" : undefined}
                  iconOnly={f === "archived"}
                  accessibilityLabel={
                    f === "today"
                      ? "Show today's chores"
                      : f === "done"
                        ? "Show chores completed in the last 7 days"
                        : `Show ${archivedPersonalChoreCount} archived chores`
                  }
                  label={f === "today" ? "Today" : f === "done" ? "Completed" : ""}
                />
              ))}
            </GlassFilterGroup>}
            {expandedHomeSections["my-chores"] && showPersonalAgenda && <PersonalAgenda
              key={`personal-agenda:${householdId}:${currentUserId}`} items={personalSchedule.items} chores={displayedChores}
              day={agendaDay} timezone={agendaTimezone} onUpdateItem={personalSchedule.updateTask}
              renderChore={(chore) => <ChoreRow chore={chore} onSetCompleted={updateHomeChoreCompletion}
                departing={choreFeedback.completingIds.has(chore.id)} onManage={() => openChoreActions(chore)} />}
            />}
            {expandedHomeSections["my-chores"] && filter === "done" ? (
              <Text style={[styles.doneRetentionHint, { color: colors.mutedForeground }]}>
                Completed chores stay here for 7 days. Older activity is available in Calendar.
              </Text>
            ) : null}
            {expandedHomeSections["my-chores"] && hiddenEarlierChoreCount > 0 ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${hiddenEarlierChoreCount} earlier chores hidden`}
                accessibilityHint="Shows every overdue chore in today's list"
                onPress={() => setShowEarlierChores(true)}
                style={[styles.earlierChoresBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}
              >
                <View style={styles.earlierChoresCopy}>
                  <Feather name="archive" size={16} color={colors.primary} />
                  <View style={styles.earlierChoresTextWrap}>
                    <Text style={[styles.earlierChoresTitle, { color: colors.foreground }]}>
                      {hiddenEarlierChoreCount} earlier {hiddenEarlierChoreCount === 1 ? "chore" : "chores"} tucked away
                    </Text>
                    <Text style={[styles.earlierChoresSubtitle, { color: colors.mutedForeground }]}>Focus on what matters now. Nothing was removed.</Text>
                  </View>
                </View>
                <Text style={[styles.earlierChoresAction, { color: colors.primary }]}>Show all</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        ListEmptyComponent={expandedHomeSections["my-chores"] && !showPersonalAgenda ? (
          <EmptyState
            compact
            icon={filter === "archived" ? "archive" : "check-circle"}
            title={
              filter === "done"
                ? "No completed chores yet"
                : filter === "archived"
                  ? "No past chores"
                  : filter === "day"
                    ? "No chores for this day"
                    : upcomingPersonalChores.length
                      ? "Nothing due today"
                      : "Nothing left for today"
            }
            subtitle={
              filter === "done"
                ? "Completed chores from the last seven days will appear here."
                : filter === "archived"
                  ? "Older incomplete chores will appear here when they need review."
                  : filter === "today" && upcomingPersonalChores.length
                    ? "Your saved assignments are listed under Upcoming."
                    : "Enjoy the breathing room, or tap + to add something new."
            }
          />
        ) : null}
        renderItem={({ item }) => (
          <ChoreRow
            chore={item}
            onSetCompleted={updateHomeChoreCompletion}
            departing={choreFeedback.completingIds.has(item.id)}
            onManage={() => openChoreActions(item)}
          />
        )}
        ListFooterComponent={
          <>
            {expandedHomeSections["my-chores"] && filter === "today" && <UpcomingChores
              key={`upcoming:${householdId}:${currentUserId}`}
              chores={upcomingPersonalChores} roommates={roommates} timezone={householdTimezone} showAssignee={false}
            />}
            {showPersonalShopping ? <>
                <CollapsibleSectionHeader
                  title="Shopping"
                  count={myShoppingItems.length}
                  icon="shopping-cart"
                  expanded={expandedHomeSections.shopping}
                  onToggle={() => toggleHomeSection("shopping")}
                  onLongPress={() => setUndoSection("shopping")}
                  longPressHint="Press and hold to undo a checked-off shopping item"
                />
                {expandedHomeSections.shopping && (
                <Surface
                  style={[
                    styles.toBuyCard,
                    { borderColor: colors.border, marginBottom: 12 },
                  ]}
                >
                  {displayedShoppingItems.map((item, idx) => (
                    <CompletionMotion
                      key={item.id}
                      completed={item.completed}
                      departing={shoppingFeedback.completingIds.has(item.id)}
                    >
                    <TouchableOpacity
                      style={[
                        styles.toBuyRow,
                        idx > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                      ]}
                      onPressIn={() => { heldShoppingItem.current = false; }}
                      onLongPress={() => {
                        heldShoppingItem.current = true;
                        setUndoSection("shopping");
                      }}
                      delayLongPress={450}
                      onPress={() => {
                        if (heldShoppingItem.current) return;
                        if (item.completed) {
                          shoppingFeedback.cancelCompletion(item.id);
                          tapLight();
                        } else {
                          shoppingFeedback.holdCompletion(item.id);
                          hapticSuccess();
                        }
                        toggleShoppingItem(item.id);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.completed }}
                      aria-checked={item.completed}
                      accessibilityLabel={`${item.completed ? "Mark needed" : "Mark purchased"}: ${item.name}`}
                      accessibilityHint="Press and hold to undo a checked-off shopping item"
                      activeOpacity={0.7}
                    >
                      <GlassCheckCircle size={20} state={item.completed ? "checked" : "idle"} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <CompletionText
                          completed={item.completed}
                          style={[styles.toBuyItem, { flex: 0, color: item.completed ? colors.mutedForeground : colors.foreground }]}
                          numberOfLines={1}
                        >
                          {item.name}
                          {item.quantity ? (
                            <Text style={{ color: colors.mutedForeground }}> · {item.quantity}</Text>
                          ) : null}
                        </CompletionText>
                      </View>
                      <Text style={[styles.toBuySection, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.listName}
                      </Text>
                    </TouchableOpacity>
                    </CompletionMotion>
                  ))}
                </Surface>
                )}
            </> : null}
          </>
        }
      />

      {floatingWeekCalendar && <View pointerEvents="box-none" style={[styles.floatingCalendarClip, { top: homeHeaderHeight }]}>
        <Reanimated.View
          testID="home-attached-week-calendar"
          collapsable={false}
          entering={reduceMotion ? undefined : ATTACHED_CALENDAR_ENTER}
          onLayout={floatingCalendar.onCalendarLayout}
          pointerEvents={floatingCalendar.hidden ? "none" : "auto"}
          accessibilityElementsHidden={floatingCalendar.hidden}
          importantForAccessibility={floatingCalendar.hidden ? "no-hide-descendants" : "auto"}
          style={[styles.floatingCalendarOverhang, floatingCalendar.floatingStyle]}
        >
          {calendarContent}
        </Reanimated.View>
      </View>}

      <CompletionUndoMenu
        visible={undoSection !== null}
        title={undoSection === "shopping" ? "Undo shopping check-off" : "Undo completed chore"}
        items={undoSection === "shopping"
          ? undoShoppingItems.map((item) => ({ id: item.id, title: `${item.name}${item.listName ? ` · ${item.listName}` : ""}` }))
          : undoChores.map((chore) => ({
              id: chore.id,
              title: `${chore.title}${chore.completedAt ? ` · ${new Date(chore.completedAt).toLocaleDateString()}` : ""}`,
            }))}
        successMessage={undoSection === "shopping" ? "Marked as needed" : "Chore marked incomplete"}
        onClose={() => setUndoSection(null)}
        onUndo={(id) => {
          const latest = undoSnapshot.current;
          if (latest.householdId !== householdId || latest.currentUserId !== currentUserId || latest.undoSection !== undoSection) return;
          if (undoSection === "shopping") {
            if (latest.undoShoppingItems.some((item) => item.id === id)) {
              shoppingFeedback.cancelCompletion(id);
              setShoppingItemCompleted(id, false);
            }
          } else if (latest.undoChores.some((chore) => chore.id === id)) {
            updateHomeChoreCompletion(id, false);
          }
        }}
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
            onPress: () => updateHomeChoreCompletion(actionChore.id, !actionChore.completed),
          }] : []),
          {
            key: "calendar",
            label: `Add to ${calendarDestinationLabel}`,
            icon: "calendar" as const,
            successMessage: "Added to Google Calendar",
            runAfterDismiss: true,
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
                {editingChore ? "Update assignment, schedule, or details" : "Type a chore to add it to your Sweet"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={closeAddChore}
              style={[styles.addChoreCloseBtn, { backgroundColor: colors.muted }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
             accessibilityRole="button" accessibilityLabel="Close chore editor">
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            behavior={KEYBOARD_BEHAVIOR}
            style={{ flex: 1 }}
          >
            <ManualChoreForm
              key={editingChore?.id ?? (showModal ? "new-open" : "new-closed")}
              initialAssigneeId={editingChore?.assignedTo ?? currentUserId}
              initialChore={editingChore}
              onCreated={(chore) => {
                if (!editingChore) {
                  const dueDay = householdDateKey(new Date(chore.dueDate), householdTimezone);
                  const today = householdDateKey(new Date(), householdTimezone);
                  setSelectedDate(new Date(`${dueDay}T12:00:00`));
                  setFilter(dueDay > today ? "day" : "today");
                  setShowEarlierChores(true);
                  if (!expandedHomeSections["my-chores"]) toggleSection("my-chores");
                }
                closeAddChore();
              }}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>
      </View>
    </GestureDetector>
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 30,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    gap: 12,
  },
  headerActions: { flexShrink: 0 },
  greetingGroup: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  greetingMark: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  greeting: { flexShrink: 1, minWidth: 0, fontSize: 22, lineHeight: 28, fontFamily: "Inter_400Regular", includeFontPadding: false },
  username: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold", includeFontPadding: false },
  totalPoints: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  totalPointsText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 14 },
  progressSection: { marginTop: spacing.lg },
  todayFocusCard: {
    borderRadius: radii.floating,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  todayDismissButton: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  todayDismissibleHeader: { paddingRight: 28 },
  todayFocusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  todayIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  todayHeadingGroup: { flex: 1, minWidth: 0 },
  todayEyebrow: { ...typography.caption, fontSize: 11, letterSpacing: 1.2 },
  todayTitle: { ...typography.heading, marginTop: spacing.hairline },
  todayProgressCount: { ...typography.caption, fontVariant: ["tabular-nums"] },
  todayProgressLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  todayProgressLabel: { ...typography.caption },
  todayProgressValue: { ...typography.caption, fontVariant: ["tabular-nums"] },
  todayProgressTrack: {
    height: 5,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  todayProgressFill: { height: "100%", borderRadius: radii.pill },
  upNextRow: {
    minHeight: 72,
    borderRadius: radii.control,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  upNextCopy: { flex: 1, minWidth: 0 },
  upNextLabel: { ...typography.caption, fontSize: 10, letterSpacing: 1 },
  upNextTitle: { ...typography.label, marginTop: spacing.hairline },
  upNextMeta: { ...typography.caption, marginTop: spacing.hairline },
  upNextAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  todayQuietState: { paddingTop: spacing.lg },
  todayQuietCopy: { ...typography.caption, textAlign: "center" },
  floatingCalendarClip: { ...StyleSheet.absoluteFill, overflow: "hidden", zIndex: 20 },
  floatingCalendarOverhang: { position: "absolute", top: 0, left: 0, right: 0 },
  calendarTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  calendarNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarMonthButton: { flex: 1 },
  calendarMonth: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
  calendarExpandHint: { flexDirection: "row", alignItems: "center", gap: 2 },
  calendarTodayHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 10, marginTop: 1 },
  calendarDaysWrap: { marginTop: 12 },
  calendarDays: { flexDirection: "row", gap: CALENDAR_DAY_GAP },
  calendarGestureTarget: {
    position: "absolute",
    zIndex: 3,
    left: 0,
    top: 0,
    height: 62,
    borderRadius: 15,
  },
  calendarDay: {
    flex: 1,
    minHeight: 62,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  calendarWeekday: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 10, textTransform: "uppercase" },
  calendarDate: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 18, marginTop: 2 },
  calendarMarkers: { height: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, marginTop: 2 },
  calendarDot: { width: 5, height: 5, borderRadius: 3 },
  markerMore: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 7, lineHeight: 9 },
  selectedDateLabel: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 14, marginTop: 11 },
  monthView: { marginTop: 10 },
  monthWeekdays: { flexDirection: "row" },
  monthWeekday: { width: "14.2857%", textAlign: "center", fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 10 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 5 },
  monthDay: { width: "14.2857%", height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  monthDots: { height: 5, flexDirection: "row", alignItems: "center", gap: 2, marginTop: 3 },
  monthDot: { width: 4, height: 4, borderRadius: 2 },
  householdPreview: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 7 },
  previewTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 13 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  previewOwnerDot: { width: 8, height: 8, borderRadius: 4 },
  previewChore: { flex: 1, fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },
  previewOwner: { maxWidth: 72, fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11 },
  previewMore: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 11, marginLeft: 16 },
  filterRow: { marginTop: 4, marginBottom: 12 },
  doneRetentionHint: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 12,
    lineHeight: 17,
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 12,
  },
  earlierChoresBanner: {
    minHeight: 58,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  earlierChoresCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  earlierChoresTextWrap: { flex: 1, minWidth: 0 },
  earlierChoresTitle: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
  earlierChoresSubtitle: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11, lineHeight: 15, marginTop: 1 },
  earlierChoresAction: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },
  listContent: { paddingHorizontal: 16, gap: 12 },
  checkBox: myDayRowStyles.check,
  pointsVisual: myDayRowStyles.visual,
  leftPointsText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 10 },
  choreInfo: myDayRowStyles.copy,
  choreTitle: myDayRowStyles.title,
  choreMeta: myDayRowStyles.meta,
  dueStatus: {
    minHeight: 24,
    maxWidth: "68%",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dueDateText: { ...typography.caption, fontFamily: "Inter_500Medium", includeFontPadding: false, flexShrink: 1 },
  choreDetailText: { ...typography.caption, fontSize: 11, flexShrink: 1 },
  pointsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pointsText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },
  trailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  taskActionsButton: {
    width: 40,
    height: 40,
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
  addChoreHeaderTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 26 },
  addChoreHeaderSub: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, marginTop: 2 },
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
  addChoreSubmitText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
  fieldLabel: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
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
    fontFamily: "Inter_400Regular", includeFontPadding: false,
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
  catChipText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },
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
    fontFamily: "Inter_700Bold", includeFontPadding: false,
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
  toBuyItem: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 14, flex: 1 },
  toBuySection: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11 },
});
