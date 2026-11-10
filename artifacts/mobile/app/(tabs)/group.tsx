import { router, useLocalSearchParams } from "expo-router";
import { isPointsVisible } from "@/constants/featureAvailability";
import { CompletionMotion, CompletionText } from "@/components/CompletionMotion";
import { ChoreFilterButton } from "@/components/ChoreFilterButton";
import { SectionDivider } from "@/components/SectionDivider";
import { CompletionUndoMenu } from "@/components/CompletionUndoMenu";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { useIsFocused } from "@react-navigation/native";
import { houseMonitorCompletionTokens } from "@/lib/houseMonitorSeen";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SCREEN_WIDTH = Dimensions.get("window").width;

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureDetector } from "react-native-gesture-handler";

import { EmptyState } from "@/components/EmptyState";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { useAppPopup } from "@/components/AppPopupProvider";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HouseMonitor, type HouseMonitorLocalEvent } from "@/components/HouseMonitor";
import { ManualChoreForm } from "@/components/ManualChoreForm";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import { Surface } from "@/components/Surface";
import { GlassCheckCircle } from "@/components/GlassCheckCircle";
import { usePinchListView } from "@/components/PinchListView";
import {
  useAppContextSelector,
  type Chore,
} from "@/context/AppContext";
import { useTabBarLayout } from "@/hooks/useTabBarLayout";
import { useTheme } from "@/constants/colors";
import { error as hapticError, success as hapticSuccess } from "@/lib/haptics";
import { isActiveSweetMember, resolveChorePermissions } from "@/lib/chorePermissions";
import { logChorePermissionCheck } from "@/lib/choreDiagnostics";
import { useConfirm } from "@/hooks/useConfirm";
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
import { choreLocalDateKey, isBeforeLocalCalendarDay } from "@/lib/choreOccurrences";
import { activeChores, isArchivedIncomplete } from "@/lib/choreLifecycle";
import { CHORE_RECURRENCE_LABELS } from "@/lib/choreSchedule";
import { compactOverdueItems } from "@/lib/overdueDisplay";
import { groupChoreChartWeeks, projectChoreChartSchedule, selectChoreChartWeek } from "@/lib/choreChartSchedule";
import { householdDateKey } from "@/lib/choreTimezone";

function isOverdue(dateStr: string) {
  return isBeforeLocalCalendarDay(dateStr);
}

function formatDueDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (choreLocalDateKey(d) < choreLocalDateKey(now)) {
    return `Overdue · originally due ${d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`;
  }
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d left`;
}

// ── Calendar / chore-chart helpers ────────────────────────────────────────
const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SLOT_ICON_BY_KEY: Record<string, keyof typeof Feather.glyphMap> = {
  bathroom_heavy: "droplet",
  bathroom_light: "wind",
  bathroom: "droplet",
  kitchen_heavy: "zap",
  kitchen_light: "coffee",
  kitchen: "coffee",
  vacuum_mop: "layers",
  vacuum: "layers",
  mop: "layers",
  laundry: "refresh-cw",
  trash: "trash-2",
  dishes: "circle",
  outdoor: "sun",
  ad_hoc: "help-circle",
};

function slotVisualFor(key: string, color: string) {
  return { icon: SLOT_ICON_BY_KEY[key] ?? "check-square", color };
}

function startOfWeekMonday(d: Date): Date {
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function buildMonthGrid(monthAnchor: Date): { date: Date; inMonth: boolean }[][] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = startOfWeekMonday(firstOfMonth);
  const rows: { date: Date; inMonth: boolean }[][] = [];
  for (let row = 0; row < 6; row++) {
    const week: { date: Date; inMonth: boolean }[] = [];
    for (let col = 0; col < 7; col++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + row * 7 + col);
      week.push({ date: d, inMonth: d.getMonth() === month });
    }
    rows.push(week);
  }
  return rows;
}

export default function GroupChoresScreen() {
  const { showPopup } = useAppPopup();
  const colors = useTheme();
  const isFocused = useIsFocused();
  const { nudgeId } = useLocalSearchParams<{ nudgeId?: string }>();
  const insets = useSafeAreaInsets();
  const { roommates, chores, householdChoreSummary, householdLoading, currentUserId, householdId, householdTimezone, activeSweet, setChoreCompleted, pickUpChore, sendNudge, removeNudge, nudges, roommateStatuses, setRoommateStatus, pointsEnabled, plantEnabled, roommateActivityEnabled, isHost, deleteChore } =
    useAppContextSelector((context) => ({
      roommates: context.roommates,
      chores: context.chores,
      householdChoreSummary: context.householdChoreSummary,
      householdLoading: context.householdLoading,
      currentUserId: context.currentUserId,
      householdId: context.householdId,
      householdTimezone: context.householdTimezone,
      activeSweet: context.activeSweet,
      setChoreCompleted: context.setChoreCompleted,
      pickUpChore: context.pickUpChore,
      sendNudge: context.sendNudge,
      removeNudge: context.removeNudge,
      nudges: context.nudges,
      roommateStatuses: context.roommateStatuses,
      setRoommateStatus: context.setRoommateStatus,
      pointsEnabled: isPointsVisible(context.pointsEnabled),
      plantEnabled: context.plantEnabled,
      roommateActivityEnabled: context.roommateActivityEnabled,
      isHost: context.isHost,
      deleteChore: context.deleteChore,
    }));
  const monitorCompletionTokens = useMemo(() => houseMonitorCompletionTokens(chores), [chores]);
  const lifecycleNow = useChoreLifecycleNow(chores);
  const { listView, pinchGesture } =
    usePinchListView(currentUserId, "group");

  const { confirm, info } = useConfirm();
  const [nudgedChores, setNudgedChores] = useState<Set<string>>(new Set());
  const [pickedUpChores, setPickedUpChores] = useState<Set<string>>(new Set());
  const [houseMonitorEvent, setHouseMonitorEvent] = useState<HouseMonitorLocalEvent>({
    nonce: 0,
    type: "created",
  });
  const [choreView, setChoreView] = useState<"active" | "calendar" | "archived">("active");
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const calendarData = useMemo(() => {
    const todayKey = householdDateKey(lifecycleNow, householdTimezone);
    const today = new Date(`${todayKey}T12:00:00`);
    const monthAnchor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const grid = buildMonthGrid(monthAnchor);
    const occurrences = choreView === "calendar" ? projectChoreChartSchedule(
      chores.filter((chore) => !chore.householdId || chore.householdId === householdId),
      roommates.map((roommate) => roommate.id), grid[0][0].date, grid[5][6].date, todayKey,
    ) : [];
    return {
      today, monthAnchor, grid, weeks: groupChoreChartWeeks(occurrences),
      scheduledDays: new Set(occurrences.map((occurrence) => occurrence.scheduledDate)),
    };
  }, [chores, roommates, householdId, householdTimezone, lifecycleNow, monthOffset, choreView]);
  const [roommatesExpanded, setRoommatesExpanded] = useState(true);
  const [visibleChoreLimits, setVisibleChoreLimits] = useState<Record<string, number>>({});
  const [expandedOverdueSections, setExpandedOverdueSections] = useState<Set<string>>(new Set());
  const previousScrollOffsetRef = useRef(0);
  const taskListTopRef = useRef(0);
  const autoCollapseTriggeredRef = useRef(false);
  const autoCollapsedAtRef = useRef(0);

  useEffect(() => {
    if (Platform.OS === "android") {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  const animateSummaryLayout = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };
  const toggleRoommates = () => {
    animateSummaryLayout();
    setRoommatesExpanded((expanded) => !expanded);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const handleGroupScroll = (event: {
    nativeEvent: { contentOffset: { y: number } };
  }) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    const previous = previousScrollOffsetRef.current;
    previousScrollOffsetRef.current = offset;

    if (offset <= 8) {
      // Require a stable return to the top after the collapse animation. This
      // prevents the layout's own offset correction from re-arming the cycle.
      if (
        previous <= 8 &&
        Date.now() - autoCollapsedAtRef.current > 800
      ) {
        autoCollapseTriggeredRef.current = false;
      }
      return;
    }
    if (autoCollapseTriggeredRef.current || offset <= previous) return;

    // A small fraction of the measured summary height adapts across phones,
    // member counts, font sizes, and whether the House Monitor is enabled.
    const threshold = Math.max(24, Math.min(72, taskListTopRef.current * 0.12));
    if (offset < threshold) return;

    autoCollapseTriggeredRef.current = true;
    autoCollapsedAtRef.current = Date.now();
    if (roommatesExpanded) {
      animateSummaryLayout();
      if (roommatesExpanded) setRoommatesExpanded(false);
    }
  };

  useEffect(() => {
    setNudgedChores(new Set(
      nudges
        .filter((nudge) => !nudge.seen)
        .map((nudge) => `${nudge.toRoommateId}-${nudge.choreId}`)
    ));
  }, [nudges]);

  // ── Add-chore-to-any-roommate modal state ──
  const [showAddChoreModal, setShowAddChoreModal] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [actionChoreId, setActionChoreId] = useState<string | null>(null);
  const [calendarDestination, setCalendarDestinationState] =
    useState<ExternalTaskDestination | null | undefined>(undefined);
  const calendarExportsInFlight = useRef(new Set<string>());
  const longPressedChoreRef = useRef<string | null>(null);

  // Full-screen slide-up animation for the Add Chore modal (matches New IOU).
  const addChoreTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  useEffect(() => {
    if (showAddChoreModal) {
      addChoreTranslateY.setValue(SCREEN_HEIGHT);
      Animated.spring(addChoreTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 180,
        mass: 0.8,
      }).start();
    }
  }, [showAddChoreModal, addChoreTranslateY]);
  const closeAddChoreSheet = () => {
    Animated.timing(addChoreTranslateY, {
      toValue: SCREEN_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowAddChoreModal(false);
        setAddChoreTargetId(null);
        setEditingChoreId(null);
      }
    });
  };
  const addChoreDragHandlers = useDraggableSheet(addChoreTranslateY, () => {
    setShowAddChoreModal(false);
    setAddChoreTargetId(null);
    setEditingChoreId(null);
  });
  const [addChoreTargetId, setAddChoreTargetId] = useState<string | null>(null);

  // Which roommates' chore sections are expanded. By default, only the current
  // user is open — everyone else's section is collapsed and shows only the
  // header (name, progress, points). Tapping the chevron on the right expands
  // that section.
  const [expandedChoreSections, setExpandedChoreSections] = useState<Set<string>>(
    () => new Set([currentUserId])
  );
  const [undoScope, setUndoScope] = useState<{
    householdId: string | null;
    userId: string;
    roommateId: string;
  } | null>(null);
  const longPressedHeaderRef = useRef<string | null>(null);
  useEffect(() => {
    setUndoScope(null);
    longPressedHeaderRef.current = null;
  }, [householdId, currentUserId]);
  const openCompletedChores = (roommateId: string) => {
    setUndoScope({ householdId, userId: currentUserId, roommateId });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const toggleChoreSection = (roommateId: string) => {
    setExpandedChoreSections((prev) => {
      const next = new Set(prev);
      if (next.has(roommateId)) next.delete(roommateId);
      else next.add(roommateId);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const openAddChoreFor = (roommateId: string) => {
    setEditingChoreId(null);
    setAddChoreTargetId(roommateId);
    setShowAddChoreModal(true);
  };

  const permissionsForChore = (chore: Chore) => resolveChorePermissions({
    currentUserId,
    isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
    isOwner: isHost,
    chore,
  });
  const canManageChore = (chore: Chore) => permissionsForChore(chore).canEdit;
  const undoScopeIsCurrent = Boolean(
    undoScope &&
      undoScope.householdId === householdId &&
      undoScope.userId === currentUserId &&
      roommates.some((roommate) => roommate.id === undoScope.roommateId),
  );
  const completedChoresToUndo = undoScopeIsCurrent
    ? chores
        .filter((chore) =>
          chore.completed &&
          chore.assignedTo === undoScope?.roommateId &&
          (!chore.householdId || chore.householdId === householdId) &&
          permissionsForChore(chore).canComplete,
        )
        .sort((a, b) =>
          (Date.parse(b.completedAt ?? b.updatedAt ?? "") || 0) -
          (Date.parse(a.completedAt ?? a.updatedAt ?? "") || 0),
        )
    : [];
  const editingChore = editingChoreId
    ? chores.find((chore) => chore.id === editingChoreId)
    : undefined;
  const actionChore = actionChoreId
    ? chores.find((chore) => chore.id === actionChoreId)
    : undefined;
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
      showPopup({ title: "Delete recurring chore?", message: "Completed chores are preserved unless you delete the entire series.", actions: [
        { label: "Cancel" }, { label: "This occurrence", onPress: () => remove("occurrence") },
        { label: "This and future", onPress: () => remove("future") }, { label: "Entire series", destructive: true, onPress: () => remove("series") },
      ] });
      return;
    }
    showPopup({ title: "Delete chore?", message: "This will remove the chore for everyone in your Sweet.", actions: [{ label: "Cancel" }, { label: "Delete", destructive: true, onPress: () => remove("occurrence") }] });
  };
  const openChoreActions = (chore: Chore) => {
    logChorePermissionCheck("open-menu", {
      choreId: chore.id,
      currentUserId,
      householdId,
      isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
      isOwner: isHost,
      allowed: permissionsForChore(chore).canView,
    });
    setActionChoreId(chore.id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  useEffect(() => {
    let active = true;
    getExternalTaskDestination(currentUserId)
      .then((destination) => {
        if (active) setCalendarDestinationState(destination);
      })
      .catch((error) => {
        reportRuntimeError("Load calendar destination preference", error);
        if (active) setCalendarDestinationState(null);
      });
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const chooseCalendarDestination = (): Promise<ExternalTaskDestination | null> =>
    new Promise((resolve) => {
      const save = (destination: ExternalTaskDestination) => {
        setExternalTaskDestination(currentUserId, destination)
          .then(() => {
            setCalendarDestinationState(destination);
            resolve(destination);
          })
          .catch((error) => {
            reportRuntimeError("Save calendar destination preference", error);
            showPopup({ title: "Couldn't save your choice", message: "Please check your connection and try again.", actions: [{ label: "Got it", primary: true }] });
            resolve(null);
          });
      };
      const ios = Platform.OS === "ios";
      showPopup({ title: "Where should this chore go?", message: ios ? "Choose Google Calendar, Apple Reminders, or both. Your choice is saved." : "SweetMate can open this chore in Google Calendar.", dismissible: false, actions: [
        { label: "Cancel", onPress: () => resolve(null) },
        { label: "Google Calendar", primary: true, onPress: () => save("googleCalendar") },
        ...(ios ? [{ label: "Reminders", onPress: () => save("reminders") }, { label: "Both", onPress: () => save("both") }] : []),
      ] });
    });

  const addChoreToCalendar = async (choreId: string) => {
    if (calendarExportsInFlight.current.has(choreId)) return;
    calendarExportsInFlight.current.add(choreId);
    try {
      const chore = chores.find((candidate) => candidate.id === choreId);
      if (!chore) {
        throw new Error("This chore is no longer available.");
      }
      const destination =
        calendarDestination ?? (await chooseCalendarDestination());
      if (!destination) return;
      const assignedRoommate = roommates.find((roommate) => roommate.id === chore.assignedTo);
      const result = await exportChoreToDestinations(
        currentUserId,
        {
          id: chore.id,
          title: chore.title,
          dueDate: chore.dueDate,
          category: chore.category,
          description: chore.description,
          recurrence: chore.recurring,
          assignedToName: assignedRoommate?.name ?? "Roommate",
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
      reportRuntimeError("Add group chore to calendar", error, { choreId });
      hapticError();
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

  // Cycle a roommate's mood: home (😊) → asleep (😴) → away (🤫) → home
  const cycleRoommateMood = (roommateId: string) => {
    const current = roommateStatuses[roommateId] ?? "home";
    const next =
      current === "home" ? "asleep" : current === "asleep" ? "away" : "home";
    setRoommateStatus(roommateId, next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleChorePress = (choreId: string) => {
    const chore = chores.find((entry) => entry.id === choreId);
    if (!chore) return;
    const allowed = permissionsForChore(chore).canComplete;
    logChorePermissionCheck("checkbox-tap", {
      choreId,
      currentUserId,
      householdId,
      isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
      isOwner: isHost,
      allowed,
    });
    if (!allowed) return;
    // Keep the existing assignee-only tap-to-undo rule for picked-up chores.
    if (chore.completed) {
      if (chore.assignedTo !== currentUserId) return;
      setChoreCompleted(chore.id, false);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (chore.assignedTo === currentUserId) {
      setChoreCompleted(chore.id, true);
    } else {
      pickUpChore(chore.id, currentUserId);
      setPickedUpChores((previous) => new Set(previous).add(chore.id));
    }
    hapticSuccess();
    setHouseMonitorEvent((event) => ({ nonce: event.nonce + 1, type: "completed" }));
  };

  useEffect(() => {
    if (!isFocused || !nudgeId) return;
    const nudge = nudges.find(entry => entry.id === nudgeId && entry.toRoommateId === currentUserId);
    const chore = nudge && chores.find(entry => entry.id === nudge.choreId);
    if (!chore) return;
    setChoreView("active");
    setExpandedChoreSections(current => new Set([...current, chore.assignedTo]));
    setActionChoreId(chore.id);
    router.setParams({ nudgeId: undefined });
  }, [isFocused, nudgeId, nudges, chores, currentUserId]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { contentBottomPadding } = useTabBarLayout();

  const activeHouseholdChores = useMemo(
    () => activeChores(chores, lifecycleNow),
    [chores, lifecycleNow],
  );
  const archivedHouseholdChores = useMemo(
    () => chores.filter((chore) => isArchivedIncomplete(chore, lifecycleNow)),
    [chores, lifecycleNow],
  );
  const displayedHouseholdChores =
    choreView === "archived" ? archivedHouseholdChores : activeHouseholdChores;
  const roommatesWithChores = useMemo(() => {
    const choresByRoommate = new Map<string, typeof displayedHouseholdChores>();
    displayedHouseholdChores.forEach((chore) => {
      const current = choresByRoommate.get(chore.assignedTo);
      if (current) current.push(chore);
      else choresByRoommate.set(chore.assignedTo, [chore]);
    });
    const sections = roommates.map((roommate) => ({
      roommate,
      // Keep occurrence identity and position stable when completion changes;
      // the selected row can then visibly transition to its completed style.
      chores: (choresByRoommate.get(roommate.id) ?? []).sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
      ),
    }));
    return choreView === "archived"
      ? sections.filter((section) => section.chores.length > 0)
      : sections;
  }, [choreView, displayedHouseholdChores, roommates]);

  const handleNudge = (
    roommateId: string,
    choreId: string,
    choreName: string
  ) => {
    const key = `${roommateId}-${choreId}`;
    if (nudgedChores.has(key)) {
      void removeNudge(roommateId, choreId)
        .then(() => {
          setNudgedChores((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        })
        .catch(() => {
          hapticError();
          info("remove_nudge_error", "Couldn’t remove nudge", "Please check your connection and try again.");
        });
      return;
    }
    confirm(
      "send_nudge",
      "Send Anonymous Nudge",
      `Remind about "${choreName}"?`,
      () => {
        void sendNudge(roommateId, choreId)
          .then(() => {
            setNudgedChores((prev) => new Set([...prev, key]));
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            info("nudge_sent", "Nudge sent!", "Your roommate got an anonymous reminder.");
          })
          .catch(() => {
            hapticError();
            info("send_nudge_error", "Couldn’t send nudge", "Please check your connection and try again.");
          });
      },
      { confirmText: "Nudge 👋" }
    );
  };

  return (
    <GestureDetector gesture={pinchGesture}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Group Chores"
        subtitle="Your household’s shared responsibilities"
        topPadding={topPad + 16}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: contentBottomPadding }}
        onScroll={handleGroupScroll}
        scrollEventThrottle={32}
      >
        {/* Each completed chore fills a body box, then overflow fills the roof. */}
        {/* Compact chores must not override the Show House Monitor preference. */}
        {plantEnabled && <View
          style={styles.plantSection}
        >
          <View style={styles.monitorContainer}>
            <HouseMonitor
              key={currentUserId + ":" + (householdId ?? "")}
              viewerId={currentUserId}
              householdId={householdId ?? undefined}
              completionTokens={monitorCompletionTokens}
              isFocused={isFocused}
              progressReady={!householdLoading}
              totalChores={householdChoreSummary.totalChores}
              completedChores={householdChoreSummary.completedChores}
              localEvent={houseMonitorEvent}
            />
          </View>
        </View>}

        {/* ── Roommates ──────────────────────────────────
            Tap a roommate's emoji to cycle through their vibe:
              😊 (chill / around)  →  😴 (sleeping)  →  🤫 (do not disturb)  →  😊
            Sleeping still auto-reverts after 9 hours via AppContext. */}
        {!listView && roommateActivityEnabled ? <View style={styles.activityCard}>
          <SectionDivider
            title="Roommates"
            icon="users"
            expanded={roommatesExpanded}
            onToggle={toggleRoommates}
          />
          {roommatesExpanded && <View style={styles.roommatesGrid}>
            {roommates.map((rm) => {
              const status = roommateStatuses[rm.id] ?? "home";
              const emoji =
                status === "asleep" ? "😴" : status === "away" ? "🤫" : "😊";
              return (
                <View
                  key={rm.id}
                  style={[
                    styles.roommateTile,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <RoommateAvatar
                    name={rm.name}
                    color={rm.color}
                    size={44}
                    imageUri={rm.avatarUri}
                  />
                  <Text style={[styles.roommateTileName, { color: colors.foreground }]} numberOfLines={1}>
                    {rm.id === currentUserId ? "You" : rm.name.split(" ")[0]}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${rm.id === currentUserId ? "Your" : `${rm.name}'s`} status: ${status === "asleep" ? "sleeping" : status === "away" ? "do not disturb" : "home"}`}
                    accessibilityHint="Changes this roommate's status"
                    onPress={() => cycleRoommateMood(rm.id)}
                    activeOpacity={0.6}
                    style={[
                      styles.roommateEmojiBtn,
                      { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Text style={styles.roommateEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>}
        </View> : null}

        <View style={styles.choreFilterRow} accessibilityRole="tablist">
          {(["active", "calendar", "archived"] as const).map((option) => (
            <ChoreFilterButton
              key={option}
              selected={choreView === option}
              pill
              accessibilityLabel={option === "active" ? "Show active group chores" : option === "calendar" ? "Show chore calendar and weekly assignments" : `Show ${archivedHouseholdChores.length} archived group chores`}
              onPress={() => {
                setChoreView(option);
                setExpandedOverdueSections(new Set());
              }}
              icon={option === "calendar" ? "calendar" : option === "archived" ? "archive" : undefined}
              iconOnly={option !== "active"}
              label={option === "active" ? "Group" : option === "calendar" ? "Calendar" : "Archive"}
            />
          ))}
        </View>

      {choreView === "calendar" ? (
        (() => {
          const { today, monthAnchor, grid, weeks, scheduledDays } = calendarData;
          const monthLabel = `${MONTHS[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()}`;
          const todayKey = today.toDateString();
          const selectedDateKey = selectedCalendarDate ?? choreLocalDateKey(monthOffset === 0 ? today : monthAnchor);
          const week = selectChoreChartWeek(weeks, selectedDateKey);
          const fmt = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const weekRange = `${fmt(week.startsOn)} – ${fmt(week.endsOn)}`;
          const isCurrentWeek = choreLocalDateKey(today) >= week.startsOn && choreLocalDateKey(today) <= week.endsOn;
          return (
            <View style={styles.calendarContent}>
              {/* Month header */}
              <Surface style={[styles.monthHeader, { borderColor: colors.border }]}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  onPress={() => { setMonthOffset((offset) => offset - 1); setSelectedCalendarDate(null); }}
                  style={[styles.monthNavBtn, { backgroundColor: colors.muted }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="chevron-left" size={18} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[styles.monthLabel, { color: colors.foreground }]}>{monthLabel}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  onPress={() => { setMonthOffset((offset) => offset + 1); setSelectedCalendarDate(null); }}
                  style={[styles.monthNavBtn, { backgroundColor: colors.muted }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="chevron-right" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </Surface>

              {/* DOW row */}
              <View style={styles.dowRow}>
                {DOW_LABELS.map((d, i) => (
                  <Text key={i} style={[styles.dowText, { color: colors.mutedForeground }]}>
                    {d}
                  </Text>
                ))}
              </View>

              {/* Day grid */}
              <Surface style={[styles.daysGrid, { borderColor: colors.border }]}>
                {grid.map((row, ri) => (
                  <View key={ri} style={[styles.weekRow, { backgroundColor: choreLocalDateKey(row[0].date) === week.startsOn ? colors.primary + "12" : "transparent", borderRadius: 11 }]}>
                    {row.map(({ date, inMonth }, ci) => {
                      const isToday = date.toDateString() === todayKey;
                      const dateKey = choreLocalDateKey(date);
                      const isSelected = dateKey === selectedDateKey;
                      const hasChores = scheduledDays.has(dateKey);
                      return (
                        <TouchableOpacity
                          key={ci}
                          accessibilityRole="button"
                          accessibilityLabel={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${isToday ? ", today" : ""}. Show this week's chores`}
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => setSelectedCalendarDate(dateKey)}
                          style={[
                            styles.dayCell,
                            {
                              backgroundColor: isSelected
                                ? colors.primary + "24"
                                : "transparent",
                              borderColor: isSelected ? colors.primary : isToday ? colors.primary + "55" : "transparent",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayNum,
                              {
                                color: isSelected || isToday
                                  ? colors.primary
                                  : !inMonth ? colors.mutedForeground : colors.foreground,
                                fontFamily: isSelected || isToday ? "Inter_700Bold" : "Inter_500Medium",
                              },
                            ]}
                          >
                            {date.getDate()}
                          </Text>
                          {hasChores && inMonth && (
                            <View style={[styles.chartWeekDot, { backgroundColor: colors.primary }]} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </Surface>

              <Text accessibilityLiveRegion="polite" style={[styles.selectedWeekLabel, { color: colors.foreground }]}>
                Chores for {weekRange}
              </Text>
              <Text style={[styles.calendarNote, { color: colors.mutedForeground }]}>
                Tap any date to show only its week’s chores (Monday–Sunday).
              </Text>
              <Text style={[styles.calendarNote, { color: colors.mutedForeground }]}>
                Upcoming assignments follow your current rotation. Saved chores and past completions stay as assigned.
              </Text>

              {/* Only the selected week, including weeks spanning two months. */}
              {!week.rows.length ? (
                <Surface style={[styles.calEmptyCard, { borderColor: colors.border }]}>
                  <Feather name="calendar" size={22} color={colors.mutedForeground} />
                  <Text style={[styles.calEmptyTitle, { color: colors.foreground }]}>No chores this week</Text>
                  <Text style={[styles.calEmptySub, { color: colors.mutedForeground }]}>
                    Choose another date to view a different week, or add a chore in Settings → Planning.
                  </Text>
                </Surface>
              ) : (
                <Surface key={week.startsOn} style={[styles.weekCard, { borderColor: colors.border }]}>
                  <View style={styles.weekCardHeader}>
                    <View style={[styles.weekChip, { backgroundColor: colors.primary + "18" }]}>
                      <Text style={[styles.weekChipText, { color: colors.primary }]}>{isCurrentWeek ? "This week" : "Week"}</Text>
                    </View>
                    <Text style={[styles.weekRangeText, { color: colors.mutedForeground }]}>{weekRange}</Text>
                  </View>
                  {week.rows.map((row) => {
                    const visual = slotVisualFor(row.category, colors.primary);
                    return (
                      <View key={row.id} style={[styles.assignRow, styles.scheduleRow, { borderTopColor: colors.border }]}>
                        <View style={[styles.slotIconWrap, { backgroundColor: visual.color + "18" }]}>
                          <Feather name={visual.icon} size={13} color={visual.color} />
                        </View>
                        <View style={styles.scheduleRowCopy}>
                          <Text style={[styles.scheduleTitle, { color: colors.foreground }]}>{row.title}</Text>
                          <Text style={[styles.scheduleFrequency, { color: colors.mutedForeground }]}>
                            {row.recurring ? CHORE_RECURRENCE_LABELS[row.recurring] : "One time"}{row.occurrenceCount > 1 ? ` · ${row.occurrenceCount} occurrences` : ""}
                          </Text>
                          <View style={styles.scheduleAssignees}>
                            {row.assignees.map((assignee) => {
                              const roommate = roommates.find((entry) => entry.id === assignee.memberId);
                              const name = roommate?.id === currentUserId ? "You" : roommate?.name ?? (!assignee.memberId || assignee.memberId === "unassigned" ? "Unassigned" : "Former roommate");
                              const dotColor = roommate?.color ?? colors.mutedForeground;
                              const dates = assignee.dates.map((date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })).join(", ");
                              return (
                                <View key={assignee.memberId} style={styles.scheduleAssigneeLine}>
                                  <View style={[styles.assigneeTag, styles.scheduleAssigneeTag, { backgroundColor: dotColor + "22", borderColor: dotColor + "55" }]}>
                                    <View style={[styles.assigneeDot, { backgroundColor: dotColor }]} />
                                    <Text style={[styles.assigneeName, styles.scheduleAssigneeName, { color: dotColor }]}>{name}</Text>
                                  </View>
                                  <Text style={[styles.scheduleDates, { color: colors.mutedForeground }]}>{dates}</Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </Surface>
              )}
            </View>
          );
        })()
      ) : (
        <View
          style={styles.listPad}
          onLayout={(event) => {
            if (!autoCollapseTriggeredRef.current) {
              taskListTopRef.current = Math.max(
                taskListTopRef.current,
                event.nativeEvent.layout.y,
              );
            }
          }}
        >
          {roommatesWithChores.length === 0 ? (
            <EmptyState
              icon={choreView === "archived" ? "archive" : "users"}
              title={choreView === "archived" ? "No past chores" : "No roommates yet"}
              subtitle={
                choreView === "archived"
                  ? "Older incomplete household chores will appear here"
                  : "Add roommates to see group chores"
              }
            />
          ) : (
            roommatesWithChores.map(({ roommate, chores: rc }) => {
              const pending = rc.filter((c) => !c.completed);
              const done = rc.filter((c) => c.completed);
              const isExpanded = expandedChoreSections.has(roommate.id);
              const visibleLimit = visibleChoreLimits[roommate.id] ?? 8;
              const overdueDisplay = compactOverdueItems(rc, {
                expanded: choreView === "archived" || expandedOverdueSections.has(roommate.id),
                isOverdue: (chore) => !chore.completed && isOverdue(chore.dueDate),
                keyForRepeatedItem: (chore) => chore.recurring
                  ? chore.title.trim().toLocaleLowerCase()
                  : chore.id,
              });
              const visibleChores = overdueDisplay.visibleItems.slice(0, visibleLimit);
              return (
                <Surface
                  key={roommate.id}
                  style={[
                    styles.section,
                    {
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {/* Roommate header — tap anywhere to expand/collapse */}
                  <TouchableOpacity
                    style={styles.sectionHeader}
                    onPressIn={() => { longPressedHeaderRef.current = null; }}
                    onPress={() => {
                      if (longPressedHeaderRef.current === roommate.id) return;
                      toggleChoreSection(roommate.id);
                    }}
                    onLongPress={() => {
                      longPressedHeaderRef.current = roommate.id;
                      openCompletedChores(roommate.id);
                    }}
                    delayLongPress={450}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityLabel={`${roommate.name}'s chores`}
                    accessibilityHint="Tap to expand or collapse. Press and hold to undo a completed chore."
                    accessibilityActions={[{ name: "undo", label: "Undo a completed chore" }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === "undo") openCompletedChores(roommate.id);
                    }}
                    activeOpacity={0.7}
                  >
                    <RoommateAvatar
                      name={roommate.name}
                      color={roommate.color}
                      size={38}
                      imageUri={roommate.avatarUri}
                    />
                    <View style={styles.sectionInfo}>
                      <Text
                        style={[
                          styles.roommateName,
                          { color: colors.foreground },
                        ]}
                      >
                        {roommate.name}
                      </Text>
                      <Text
                        style={[
                          styles.roommateStats,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {done.length}/{rc.length} done
                      </Text>
                    </View>
                    {/* + Add a chore to this roommate's list */}
                    <TouchableOpacity
                      onPress={() => openAddChoreFor(roommate.id)}
                      style={[
                        styles.sectionAddBtn,
                        { backgroundColor: roommate.color + "18", borderColor: roommate.color + "44" },
                      ]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="plus" size={15} color={roommate.color} />
                    </TouchableOpacity>
                    {/* Mini health bar for this roommate */}
                    <View style={styles.miniBarContainer}>
                      <View
                        style={[
                          styles.miniTrack,
                          { backgroundColor: colors.muted },
                        ]}
                      >
                        <View
                          style={[
                            styles.miniFill,
                            {
                              backgroundColor: roommate.color,
                              width: `${
                                rc.length > 0
                                  ? (done.length / rc.length) * 100
                                  : 0
                              }%` as `${number}%`,
                            },
                          ]}
                        />
                      </View>
                      {pointsEnabled && <View
                        style={[
                          styles.ptsBadge,
                          { backgroundColor: roommate.color + "18" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.ptsText,
                            { color: roommate.color },
                          ]}
                        >
                          {roommate.weeklyPoints} pts
                        </Text>
                      </View>}
                    </View>
                    {/* Chevron — visual affordance for expand/collapse */}
                    <Feather
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.mutedForeground}
                      style={{ marginLeft: 4 }}
                    />
                  </TouchableOpacity>

                  {/* Chore rows (only when this section is expanded) */}
                  {isExpanded && (rc.length === 0 ? (
                    <Text
                      style={[
                        styles.noChores,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      No chores assigned
                    </Text>
                  ) : (
                    <>
                      {overdueDisplay.hiddenCount > 0 ? (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`${overdueDisplay.hiddenCount} earlier chores hidden for ${roommate.name}`}
                          accessibilityHint="Shows every overdue chore in this group section"
                          onPress={() => setExpandedOverdueSections((current) => new Set([...current, roommate.id]))}
                          style={[styles.overdueRecovery, { backgroundColor: colors.muted, borderTopColor: colors.border }]}
                        >
                          <View style={styles.overdueRecoveryCopy}>
                            <Feather name="archive" size={15} color={colors.primary} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.overdueRecoveryTitle, { color: colors.foreground }]}>
                                {overdueDisplay.hiddenCount} earlier {overdueDisplay.hiddenCount === 1 ? "chore" : "chores"} tucked away
                              </Text>
                              <Text style={[styles.overdueRecoverySubtitle, { color: colors.mutedForeground }]}>Nothing was removed.</Text>
                            </View>
                          </View>
                          <Text style={[styles.overdueRecoveryAction, { color: colors.primary }]}>Show all</Text>
                        </TouchableOpacity>
                      ) : null}
                      {visibleChores.map((chore) => {
                        const overdue =
                          !chore.completed && isOverdue(chore.dueDate);
                        const isPickedUp = pickedUpChores.has(chore.id);
                        return (
                          <CompletionMotion
                            key={chore.id}
                            completed={chore.completed}
                            style={{ position: "relative" }}
                          >
                        <TouchableOpacity
                          activeOpacity={0.7}
                          delayLongPress={450}
                          onLongPress={() => {
                            longPressedChoreRef.current = chore.id;
                            openChoreActions(chore);
                          }}
                          onPress={() => {
                            if (longPressedChoreRef.current === chore.id) {
                              longPressedChoreRef.current = null;
                              return;
                            }
                            handleChorePress(chore.id);
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: chore.completed }}
                          accessibilityLabel={`${chore.title}. ${chore.completed ? "Completed." : "Not completed."} ${canManageChore(chore) ? "Double tap to update completion, or use the more actions button to manage." : "Double tap to update completion."}`}
                          style={[
                            styles.choreRow,
                            {
                              borderTopColor: colors.border,
                              backgroundColor: isPickedUp
                                ? colors.success + "10"
                                : "transparent",
                            },
                          ]}
                        >
                          {/* Status icon */}
                          <GlassCheckCircle
                            state={chore.completed ? "checked" : overdue ? "overdue" : "idle"}
                          />

                          <View style={{ flex: 1 }}>
                            <CompletionText
                              completed={chore.completed}
                              style={[
                                styles.choreTitle,
                                {
                                  color: chore.completed
                                    ? colors.mutedForeground
                                    : colors.foreground,
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {chore.title}
                            </CompletionText>
                            <Text
                              style={[
                                styles.choreDate,
                                {
                                  color: overdue
                                    ? colors.primary
                                    : colors.mutedForeground,
                                },
                              ]}
                            >
                              {formatDueDate(chore.dueDate)}
                              {chore.recurring ? ` · ${CHORE_RECURRENCE_LABELS[chore.recurring]}` : ""}
                              {chore.assignmentMode === "round-robin" ? " · Round Robin" : ""}
                            </Text>
                          </View>

                          <TouchableOpacity
                            onPress={(event) => {
                              event.stopPropagation();
                              openChoreActions(chore);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`More actions for ${chore.title}`}
                            activeOpacity={0.55}
                            style={styles.moreActionsButton}
                          >
                            <Feather name="more-vertical" size={15} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                          </CompletionMotion>
                        );
                      })}
                      {visibleChores.length < overdueDisplay.visibleItems.length ? (
                        <TouchableOpacity
                          style={styles.loadMoreChores}
                          onPress={() =>
                            setVisibleChoreLimits((current) => ({
                              ...current,
                              [roommate.id]: visibleLimit + 20,
                            }))
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`Show more chores for ${roommate.name}`}
                        >
                          <Text style={[styles.loadMoreChoresText, { color: colors.primary }]}>
                            Show more ({overdueDisplay.visibleItems.length - visibleChores.length} remaining)
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ))}
                </Surface>
              );
            })
          )}
        </View>
      )}
      </ScrollView>

      <CompletionUndoMenu
        visible={undoScopeIsCurrent}
        title="Undo completed chore"
        items={completedChoresToUndo.map((chore) => ({
          id: chore.id,
          title: `${chore.title}${chore.completedAt ? ` · ${new Date(chore.completedAt).toLocaleDateString()}` : ""}`,
        }))}
        onUndo={(id) => {
          const chore = completedChoresToUndo.find((entry) => entry.id === id);
          if (!chore || !permissionsForChore(chore).canComplete) return;
          setChoreCompleted(chore.id, false);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        onClose={() => setUndoScope(null)}
        successMessage="Marked incomplete"
      />

      {/* ── Add Chore Modal (full-screen, matches New IOU) ── */}
      <ActionMenuModal
        visible={!!actionChore}
        title={actionChore?.title ?? "Chore"}
        subtitle="Manage this chore"
        onClose={() => setActionChoreId(null)}
        actions={actionChore ? [
          ...(actionChore.completed && permissionsForChore(actionChore).canComplete ? [{
            key: "undo-completion",
            label: "Undo check-off",
            icon: "rotate-ccw" as const,
            successMessage: "Marked incomplete",
            onPress: () => setChoreCompleted(actionChore.id, false),
          }] : []),
          ...(permissionsForChore(actionChore).canNudge ? [{
            key: "nudge",
            label: nudgedChores.has(`${actionChore.assignedTo}-${actionChore.id}`)
              ? "Remove nudge"
              : "Nudge",
            icon: nudgedChores.has(`${actionChore.assignedTo}-${actionChore.id}`)
              ? "bell-off" as const
              : "bell" as const,
            runAfterDismiss: true,
            onPress: () =>
              handleNudge(actionChore.assignedTo, actionChore.id, actionChore.title),
          }] : []),
          {
            key: "calendar",
            label: "Add to calendar",
            icon: "calendar" as const,
            successMessage: "Added to Google Calendar",
            runAfterDismiss: calendarDestination == null,
            onPress: () => {
              return addChoreToCalendar(actionChore.id);
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
              setAddChoreTargetId(actionChore.assignedTo);
              setShowAddChoreModal(true);
            },
          },
          ...(permissionsForChore(actionChore).canDelete ? [{
            key: "delete",
            label: "Delete chore",
            icon: "trash-2" as const,
            destructive: true,
            runAfterDismiss: true,
            confirmation: undefined,
            onPress: () => confirmDeleteChore(actionChore),
          }] : []),
          ] : []),
        ] : []}
      />

      <Modal visible={showAddChoreModal} transparent animationType="none" onRequestClose={closeAddChoreSheet}>
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
              styles.addChoreHeaderRow,
              { paddingTop: insets.top + 10, borderBottomColor: colors.border },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border, top: insets.top + 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.addChoreHeaderTitle, { color: colors.foreground }]}>
                {editingChore ? "Edit Chore" : "Add Chore"}
              </Text>
              <Text style={[styles.addChoreHeaderSub, { color: colors.mutedForeground }]}>
                {editingChore ? "Update assignment, schedule, or details" : "Assign to any Sweetmate — including yourself"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={closeAddChoreSheet}
              style={[styles.addChoreCloseBtn, { backgroundColor: colors.muted }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            behavior={KEYBOARD_BEHAVIOR}
            style={{ flex: 1 }}
          >
            <ManualChoreForm
              key={editingChore?.id ?? `${showAddChoreModal}-${addChoreTargetId ?? "self"}`}
              initialAssigneeId={addChoreTargetId ?? currentUserId}
              initialChore={editingChore}
              onCreated={() => {
                if (!editingChore) {
                  setHouseMonitorEvent((event) => ({ nonce: event.nonce + 1, type: "created" }));
                }
                closeAddChoreSheet();
              }}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerSub: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13 },
  headerTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 30, lineHeight: 36, marginTop: 2 },
  // Open house monitor summary — intentionally not enclosed in a separate card.
  plantSection: {
    marginHorizontal: 16,
    marginBottom: 18,
  },
  monitorContainer: { alignItems: "center", paddingVertical: 8 },

  // Roommate list
  listPad: { paddingHorizontal: 16, gap: 12 },
  calendarContent: { paddingHorizontal: 16 },
  selectedWeekLabel: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 15, marginBottom: 6 },
  calendarNote: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  scheduleRow: { alignItems: "flex-start" },
  scheduleRowCopy: { flex: 1, minWidth: 0 },
  scheduleTitle: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 13 },
  scheduleFrequency: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11, marginTop: 3 },
  scheduleAssignees: { gap: 7, marginTop: 9 },
  scheduleAssigneeLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
  scheduleAssigneeTag: { maxWidth: "100%", flexShrink: 1 },
  scheduleAssigneeName: { flexShrink: 1 },
  scheduleDates: { flexShrink: 1, fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, lineHeight: 17 },
  choreFilterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  section: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  sectionInfo: { flex: 1 },
  roommateName: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 15 },
  roommateStats: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 1 },
  miniBarContainer: { alignItems: "flex-end", gap: 4 },
  miniTrack: {
    width: 64,
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  miniFill: { height: 5, borderRadius: 3 },
  ptsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ptsText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },
  noChores: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  loadMoreChores: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  loadMoreChoresText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
  overdueRecovery: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  overdueRecoveryCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  overdueRecoveryTitle: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
  overdueRecoverySubtitle: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11, marginTop: 1 },
  overdueRecoveryAction: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 12 },
  choreRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  choreTitle: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 14 },
  choreDate: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 1 },
  moreActionsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -8,
    marginRight: -8,
  },

  // ── Roommate Activity ──
  activityCard: {
    marginHorizontal: 16,
    marginBottom: 14,
  },
  distBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  distText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 11 },
  activitySection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  activitySectionLabel: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  myStatusRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statusDotBig: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotSm: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  myStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  myStatusLabel: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },
  myStatusSub: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11 },
  statusBtnRow: { flexDirection: "row", gap: 6 },
  statusBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusBtnText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 },
  homeLocBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  homeLocText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 },
  homeLocHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11, marginLeft: "auto" as unknown as number },
  activityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  activityRmCard: {
    alignItems: "center",
    gap: 4,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 72,
  },
  activityRmName: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 11 },
  activityRmBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  activityRmStatus: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 10 },
  activityHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 11, textAlign: "center", marginTop: 2 },

  // ── Roommates ──
  roommatesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  roommateTile: {
    flexBasis: "30%",
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  roommateTileName: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 12,
    maxWidth: "100%",
  },
  roommateEmojiBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  roommateEmoji: {
    fontSize: 22,
    // Ensures the emoji centers visually in the button
    textAlign: "center",
    lineHeight: 28,
  },

  // ── Tab switch ──
  tabSwitch: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    gap: 4,
  },
  tabSwitchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabSwitchText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 },

  // ── Calendar ──
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  monthLabel: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
  monthNavBtn: {
    minWidth: 44,
    minHeight: 44,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dowRow: {
    flexDirection: "row",
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  dowText: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  daysGrid: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: { fontSize: 13 },
  chartWeekDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
  },
  weekCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  weekCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  weekChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  weekChipText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 11 },
  weekRangeText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },
  assignRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  slotIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  slotLabelText: { flex: 1, fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 13 },
  assigneeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  assigneeDot: { width: 6, height: 6, borderRadius: 3 },
  assigneeName: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 11 },
  weekOutCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
    alignItems: "center",
  },
  weekOutText: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12 },
  calEmptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 6,
  },
  calEmptyTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15 },
  calEmptySub: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, textAlign: "center" },

  // ── Section-header + button ──
  sectionAddBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  // ── Full-screen Add Chore modal (matches New IOU) ──
  addChoreContainer: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  addChoreHeaderRow: {
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
  addChoreLabel: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 13,
    marginBottom: 4,
    marginTop: 6,
  },
  addChoreInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 15,
    marginBottom: 4,
  },
  addChoreRoommateChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addChoreCatChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addChorePointsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  addChorePointsChip: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 9,
    alignItems: "center",
  },
  addChoreSubmit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  addChoreSubmitText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
});
