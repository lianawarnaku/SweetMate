import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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

import { EmptyState } from "@/components/EmptyState";
import { ActionMenuModal, type ActionMenuItem } from "@/components/ActionMenuModal";
import { HeaderActions } from "@/components/HeaderActions";
import { HomePlant } from "@/components/HomePlant";
import { ManualChoreForm } from "@/components/ManualChoreForm";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import {
  useAppContextSelector,
  type ChoreAssignment,
  type Chore,
} from "@/context/AppContext";
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
import { choreLocalDateKey } from "@/lib/choreOccurrences";
import { activeChores } from "@/lib/choreLifecycle";

function isOverdue(dateStr: string) {
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
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d left`;
}

// ── Calendar / chore-chart helpers ────────────────────────────────────────
const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const SLOT_VISUAL_DEFAULT = { icon: "check-square" as keyof typeof Feather.glyphMap, color: "#8A7462" };
const SLOT_VISUAL_BY_KEY: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  bathroom_heavy: { icon: "droplet", color: "#72503A" },
  bathroom_light: { icon: "wind", color: "#A88C76" },
  bathroom: { icon: "droplet", color: "#87644B" },
  kitchen_heavy: { icon: "zap", color: "#9B623B" },
  kitchen_light: { icon: "coffee", color: "#C39870" },
  kitchen: { icon: "coffee", color: "#A7744D" },
  vacuum_mop: { icon: "layers", color: "#806B58" },
  vacuum: { icon: "layers", color: "#917661" },
  mop: { icon: "layers", color: "#A1866F" },
  laundry: { icon: "refresh-cw", color: "#B09177" },
  trash: { icon: "trash-2", color: "#65483A" },
  dishes: { icon: "circle", color: "#B98255" },
  outdoor: { icon: "sun", color: "#C19362" },
  ad_hoc: { icon: "help-circle", color: "#7B6252" },
};

function slotVisualFor(key: string) {
  return SLOT_VISUAL_BY_KEY[key] ?? SLOT_VISUAL_DEFAULT;
}

function humanizeSlotKey(k: string): string {
  return k.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function startOfWeekMonday(d: Date): Date {
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function chartWeekFor(date: Date, startedAtIso: string | null): number | null {
  if (!startedAtIso) return null;
  const start = startOfWeekMonday(new Date(startedAtIso));
  const targetMon = startOfWeekMonday(date);
  const diffDays = Math.round((targetMon.getTime() - start.getTime()) / 86400000);
  const weekIdx = Math.floor(diffDays / 7);
  if (weekIdx < 0 || weekIdx >= 12) return null;
  return weekIdx + 1;
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

const HEALTH_MESSAGES: Record<string, { title: string; subtitle: string }> = {
  blooming: {
    title: "In full bloom! 🌸",
    subtitle: "Look! Your home looks beautiful!",
  },
  thriving: {
    title: "Thriving! 🌿",
    subtitle: "Your home is in great shape",
  },
  healthy: {
    title: "Looking good",
    subtitle: "Keep the momentum going",
  },
  struggling: {
    title: "Needs attention",
    subtitle: "A few chores are overdue",
  },
  dying: {
    title: "SOS! 🚨",
    subtitle: "Your home needs help now",
  },
};

export default function GroupChoresScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { roommates, chores, currentUserId, householdId, activeSweet, setChoreCompleted, pickUpChore, sendNudge, removeNudge, nudges, roommateStatuses, setRoommateStatus, choreChart, choreChartStartedAt, pointsEnabled, plantEnabled, roommateActivityEnabled, isHost, deleteChore } =
    useAppContextSelector((context) => ({
      roommates: context.roommates,
      chores: context.chores,
      currentUserId: context.currentUserId,
      householdId: context.householdId,
      activeSweet: context.activeSweet,
      setChoreCompleted: context.setChoreCompleted,
      pickUpChore: context.pickUpChore,
      sendNudge: context.sendNudge,
      removeNudge: context.removeNudge,
      nudges: context.nudges,
      roommateStatuses: context.roommateStatuses,
      setRoommateStatus: context.setRoommateStatus,
      choreChart: context.choreChart,
      choreChartStartedAt: context.choreChartStartedAt,
      pointsEnabled: context.pointsEnabled,
      plantEnabled: context.plantEnabled,
      roommateActivityEnabled: context.roommateActivityEnabled,
      isHost: context.isHost,
      deleteChore: context.deleteChore,
    }));
  const lifecycleNow = useChoreLifecycleNow(chores);

  const { confirm, info } = useConfirm();
  const [nudgedChores, setNudgedChores] = useState<Set<string>>(new Set());
  const [pickedUpChores, setPickedUpChores] = useState<Set<string>>(new Set());
  const [viewMode] = useState<"activity" | "calendar">("activity");
  const [monthOffset, setMonthOffset] = useState(0);
  const [roommatesExpanded, setRoommatesExpanded] = useState(true);
  const [visibleChoreLimits, setVisibleChoreLimits] = useState<Record<string, number>>({});
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
    // member counts, font sizes, and whether Room Health is enabled.
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
  const [completionChoreId, setCompletionChoreId] = useState<string | null>(null);
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
        Alert.alert("Not allowed", "Only the chore creator or Sweet host can delete this chore.");
      }
    };
    if (chore.recurrenceSeriesId || chore.recurring) {
      Alert.alert(
        "Delete recurring chore?",
        "Completed history is preserved unless you delete the entire series.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "This occurrence", onPress: () => remove("occurrence") },
          { text: "This and future", onPress: () => remove("future") },
          { text: "Entire series", style: "destructive", onPress: () => remove("series") },
        ],
      );
      return;
    }
    Alert.alert(
      "Delete chore?",
      "This will remove the chore for everyone in your Sweet.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove("occurrence") },
      ],
    );
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
            Alert.alert("Couldn't save your choice", "Please check your connection and try again.");
            resolve(null);
          });
      };
      const options =
        Platform.OS === "ios"
          ? [
              { text: "Google Calendar", onPress: () => save("googleCalendar") },
              { text: "Reminders", onPress: () => save("reminders") },
              { text: "Both", onPress: () => save("both") },
            ]
          : [
              { text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) },
              { text: "Google Calendar", onPress: () => save("googleCalendar") },
            ];
      Alert.alert(
        "Where should this chore go?",
        Platform.OS === "ios"
          ? "Choose Google Calendar, Apple Reminders, or both. Your choice is saved."
          : "SweetMate can open this chore in Google Calendar.",
        options,
        { cancelable: true, onDismiss: () => resolve(null) },
      );
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

  const handleChorePress = (choreId: string, assignedTo: string, choreName: string, chorePoints: number) => {
    const chore = chores.find((c) => c.id === choreId);
    if (!chore) return;
    logChorePermissionCheck("checkbox-tap", {
      choreId,
      currentUserId,
      householdId,
      isActiveMember: isActiveSweetMember(activeSweet, householdId, currentUserId),
      isOwner: isHost,
      allowed: permissionsForChore(chore).canComplete,
    });

    // If already completed, only allow the ORIGINAL ASSIGNEE (or the current
    // user if it's their own chore) to un-complete it. Picked-up chores are
    // left alone — undoing a pickup would need to track who picked it up to
    // correctly refund the bonus points, which we don't store.
    if (chore.completed) {
      if (assignedTo === currentUserId) {
        setCompletionChoreId(choreId);
      }
      return;
    }

    setCompletionChoreId(choreId);
  };

  const completionChore = completionChoreId
    ? chores.find((entry) => entry.id === completionChoreId)
    : undefined;
  const completionAction: ActionMenuItem | null = completionChore
    ? {
        key: completionChore.completed ? "uncomplete" : "complete",
        label: completionChore.completed ? "Uncomplete" : "Done ✓",
        icon: completionChore.completed ? "rotate-ccw" : "check-circle",
        runAfterDismiss:
          !completionChore.completed && completionChore.assignedTo !== currentUserId,
        confirmation: {
          title: completionChore.completed
            ? "Uncomplete chore?"
            : completionChore.assignedTo === currentUserId
              ? "Complete chore?"
              : "Pick up this chore? 🙌",
          message: completionChore.completed
            ? `Mark "${completionChore.title}" as not done?`
            : completionChore.assignedTo === currentUserId
              ? `Mark "${completionChore.title}" as done?`
              : pointsEnabled
                ? `Complete "${completionChore.title}" for them and earn ${completionChore.points + 25} pts (${completionChore.points} + 25 bonus)!`
                : `Complete "${completionChore.title}" for them?`,
          confirmLabel: completionChore.completed
            ? "Uncomplete"
            : completionChore.assignedTo === currentUserId
              ? "Done ✓"
              : "Pick it up!",
        },
        onPress: () => {
          if (completionChore.completed) {
            setChoreCompleted(completionChore.id, false);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } else if (completionChore.assignedTo === currentUserId) {
            hapticSuccess();
            setChoreCompleted(completionChore.id, true);
          } else {
            hapticSuccess();
            pickUpChore(completionChore.id, currentUserId);
            setPickedUpChores((prev) => new Set([...prev, completionChore.id]));
            info(
              "pickup_success",
              "Nice one! 🌟",
              pointsEnabled
                ? `You earned ${completionChore.points + 25} pts — ${completionChore.points} for the chore + 25 bonus!`
                : `You completed "${completionChore.title}" for them.`,
            );
          }
        },
      }
    : null;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;

  const activeHouseholdChores = useMemo(
    () => activeChores(chores, lifecycleNow),
    [chores, lifecycleNow],
  );
  const totalChores = activeHouseholdChores.length;
  const completedChores = useMemo(
    () => activeHouseholdChores.filter((chore) => chore.completed).length,
    [activeHouseholdChores],
  );
  const healthPct = totalChores > 0 ? completedChores / totalChores : 0;

  const stage =
    healthPct >= 1
      ? "blooming"
      : healthPct >= 0.75
      ? "thriving"
      : healthPct >= 0.5
      ? "healthy"
      : healthPct >= 0.25
      ? "struggling"
      : "dying";

  const healthColor =
    healthPct >= 1
      ? "#E879A0"
      : healthPct >= 0.75
      ? colors.success
      : healthPct >= 0.5
      ? colors.primary
      : healthPct >= 0.25
      ? colors.warning
      : colors.destructive;

  const msg = HEALTH_MESSAGES[stage];

  const roommatesWithChores = useMemo(() => {
    const choresByRoommate = new Map<string, typeof activeHouseholdChores>();
    activeHouseholdChores.forEach((chore) => {
      const current = choresByRoommate.get(chore.assignedTo);
      if (current) current.push(chore);
      else choresByRoommate.set(chore.assignedTo, [chore]);
    });
    return roommates.map((roommate) => ({
      roommate,
      // Keep occurrence identity and position stable when completion changes;
      // the selected row can then visibly transition to its completed style.
      chores: (choresByRoommate.get(roommate.id) ?? []).sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
      ),
    }));
  }, [activeHouseholdChores, roommates]);

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
          Alert.alert("Couldn’t remove nudge", "Please check your connection and try again.");
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
            Alert.alert("Couldn’t send nudge", "Please check your connection and try again.");
          });
      },
      { confirmText: "Nudge 👋" }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 16,
            backgroundColor: colors.background,
          },
        ]}
      >
        <View>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Your household
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Group Chores
          </Text>
        </View>
        <HeaderActions />
      </View>


      {viewMode === "calendar" ? (
        (() => {
          const today = new Date();
          const monthAnchor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
          const grid = buildMonthGrid(monthAnchor);
          const monthLabel = `${MONTHS[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()}`;
          const todayKey = today.toDateString();
          // Weeks (Mondays) in this month, dedup, with chart-week mapping
          const monthWeeks = grid
            .map((row) => row[0].date)
            .filter((d, i, arr) => i === 0 || d.getTime() !== arr[i - 1].getTime());
          const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 90 + botPad, paddingHorizontal: 16 }}
            >
              {/* Month header */}
              <View style={[styles.monthHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  onPress={() => setMonthOffset(monthOffset - 1)}
                  style={[styles.monthNavBtn, { backgroundColor: colors.muted }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="chevron-left" size={18} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[styles.monthLabel, { color: colors.foreground }]}>{monthLabel}</Text>
                <TouchableOpacity
                  onPress={() => setMonthOffset(monthOffset + 1)}
                  style={[styles.monthNavBtn, { backgroundColor: colors.muted }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="chevron-right" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              {/* DOW row */}
              <View style={styles.dowRow}>
                {DOW_LABELS.map((d, i) => (
                  <Text key={i} style={[styles.dowText, { color: colors.mutedForeground }]}>
                    {d}
                  </Text>
                ))}
              </View>

              {/* Day grid */}
              <View style={[styles.daysGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {grid.map((row, ri) => (
                  <View key={ri} style={styles.weekRow}>
                    {row.map(({ date, inMonth }, ci) => {
                      const isToday = date.toDateString() === todayKey;
                      const cw = chartWeekFor(date, choreChartStartedAt);
                      return (
                        <View
                          key={ci}
                          style={[
                            styles.dayCell,
                            {
                              backgroundColor: isToday
                                ? colors.primary + "18"
                                : "transparent",
                              borderColor: isToday ? colors.primary + "55" : "transparent",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayNum,
                              {
                                color: !inMonth
                                  ? colors.border
                                  : isToday
                                  ? colors.primary
                                  : colors.foreground,
                                fontFamily: isToday ? "Inter_700Bold" : "Inter_500Medium",
                              },
                            ]}
                          >
                            {date.getDate()}
                          </Text>
                          {cw !== null && inMonth && (
                            <View style={[styles.chartWeekDot, { backgroundColor: colors.primary }]} />
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>

              {/* Per-week breakdown */}
              {!choreChart || !choreChartStartedAt ? (
                <View style={[styles.calEmptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="calendar" size={22} color={colors.mutedForeground} />
                  <Text style={[styles.calEmptyTitle, { color: colors.foreground }]}>No chart yet</Text>
                  <Text style={[styles.calEmptySub, { color: colors.mutedForeground }]}>
                    Generate a chore chart in Settings → Planning to see week-by-week assignments here.
                  </Text>
                </View>
              ) : (
                monthWeeks.map((mon) => {
                  const cw = chartWeekFor(mon, choreChartStartedAt);
                  const sun = new Date(mon);
                  sun.setDate(mon.getDate() + 6);
                  const weekRange = `${fmt(mon)} – ${fmt(sun)}`;
                  if (cw === null) {
                    return (
                      <View
                        key={mon.toISOString()}
                        style={[styles.weekOutCard, { backgroundColor: colors.muted, borderColor: colors.border }]}
                      >
                        <Text style={[styles.weekOutText, { color: colors.mutedForeground }]}>
                          {weekRange} · outside chart
                        </Text>
                      </View>
                    );
                  }
                  const week = choreChart.weeks.find((w) => w.week === cw);
                  if (!week) return null;
                  // Derive slots from the chart: prefer chart.slots, else infer from assignment keys
                  const slots =
                    choreChart.slots && choreChart.slots.length > 0
                      ? choreChart.slots
                      : Object.keys(week.assignments).map((k) => ({ key: k, label: humanizeSlotKey(k) }));
                  return (
                    <View
                      key={mon.toISOString()}
                      style={[styles.weekCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={styles.weekCardHeader}>
                        <View style={[styles.weekChip, { backgroundColor: colors.primary + "18" }]}>
                          <Text style={[styles.weekChipText, { color: colors.primary }]}>Week {cw}</Text>
                        </View>
                        <Text style={[styles.weekRangeText, { color: colors.mutedForeground }]}>
                          {weekRange}
                        </Text>
                      </View>
                      {slots.map((slot) => {
                        const name = week.assignments[slot.key];
                        if (!name) return null;
                        const rm = roommates.find((r) => r.name === name);
                        const visual = slotVisualFor(slot.key);
                        const dotColor = rm?.color ?? visual.color;
                        return (
                          <View key={slot.key} style={[styles.assignRow, { borderTopColor: colors.border }]}>
                            <View style={[styles.slotIconWrap, { backgroundColor: visual.color + "18" }]}>
                              <Feather name={visual.icon} size={13} color={visual.color} />
                            </View>
                            <Text style={[styles.slotLabelText, { color: colors.foreground }]}>
                              {slot.label}
                            </Text>
                            <View style={[styles.assigneeTag, { backgroundColor: dotColor + "22", borderColor: dotColor + "55" }]}>
                              <View style={[styles.assigneeDot, { backgroundColor: dotColor }]} />
                              <Text style={[styles.assigneeName, { color: dotColor }]}>
                                {rm?.id === currentUserId ? "You" : name}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </ScrollView>
          );
        })()
      ) : (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 90 + botPad }}
        onScroll={handleGroupScroll}
        scrollEventThrottle={32}
      >
        {/* The enabled plant is intentionally open and integrated into the page. */}
        {plantEnabled && <View
          style={styles.plantSection}
          accessibilityRole="summary"
          accessibilityLabel={`Room health ${Math.round(healthPct * 100)} percent. ${msg.title}. ${msg.subtitle}`}
        >
          <View style={styles.summaryHeader}>
            <View style={styles.activityHeaderIcon}>
              <Feather name="activity" size={14} color={healthColor} />
            </View>
            <Text style={[styles.activityTitle, { color: colors.foreground }]}>Room Health</Text>
          </View>

          <View style={styles.plantCardInner}>
            {/* Left: Animated plant */}
            <View style={styles.plantContainer}>
              <HomePlant health={healthPct} size={130} />
            </View>

            {/* Right: Health info */}
            <View style={styles.healthInfo}>
              <Text
                style={[
                  styles.healthRoom,
                  { color: colors.mutedForeground },
                ]}
              >
                Household overview
              </Text>

              <Text
                style={[styles.healthTitle, { color: healthColor }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {msg.title}
              </Text>

              <Text
                style={[
                  styles.healthSubtitle,
                  { color: colors.mutedForeground },
                ]}
                numberOfLines={2}
              >
                {msg.subtitle}
              </Text>

              {/* Percentage badge */}
              <View
                style={[
                  styles.pctBadge,
                  { backgroundColor: healthColor + "18" },
                ]}
              >
                <Text style={[styles.pctText, { color: healthColor }]}>
                  {Math.round(healthPct * 100)}%
                </Text>
              </View>

              {/* Progress bar */}
              <View
                style={[styles.track, { backgroundColor: colors.muted }]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: healthColor,
                      width: `${healthPct * 100}%` as `${number}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.statsRow}>
                <Text style={[styles.stat, { color: colors.mutedForeground }]}>
                  ✓ {completedChores} done
                </Text>
                <Text style={[styles.stat, { color: colors.mutedForeground }]}>
                  {totalChores - completedChores} left
                </Text>
              </View>
            </View>
          </View>
        </View>}

        {/* ── Roommates ──────────────────────────────────
            Tap a roommate's emoji to cycle through their vibe:
              😊 (chill / around)  →  😴 (sleeping)  →  🤫 (do not disturb)  →  😊
            Sleeping still auto-reverts after 9 hours via AppContext. */}
        {roommateActivityEnabled ? <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.activityHeader}
            onPress={toggleRoommates}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: roommatesExpanded }}
            accessibilityLabel={`${roommatesExpanded ? "Collapse" : "Expand"} Roommates`}
          >
            <View style={styles.activityHeaderIcon}>
              <Feather name="users" size={14} color={colors.primary} />
            </View>
            <Text style={[styles.activityTitle, { color: colors.foreground }]}>Roommates</Text>
            <Feather
              name={roommatesExpanded ? "chevron-down" : "chevron-right"}
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
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

        {/* ── Roommate chore sections ───────────────────── */}
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
              icon="users"
              title="No roommates yet"
              subtitle="Add roommates to see group chores"
            />
          ) : (
            roommatesWithChores.map(({ roommate, chores: rc }) => {
              const pending = rc.filter((c) => !c.completed);
              const done = rc.filter((c) => c.completed);
              const isExpanded = expandedChoreSections.has(roommate.id);
              const visibleLimit = visibleChoreLimits[roommate.id] ?? 50;
              const visibleChores = rc.slice(0, visibleLimit);
              return (
                <View
                  key={roommate.id}
                  style={[
                    styles.section,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {/* Roommate header — tap anywhere to expand/collapse */}
                  <TouchableOpacity
                    style={styles.sectionHeader}
                    onPress={() => toggleChoreSection(roommate.id)}
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
                      {visibleChores.map((chore) => {
                        const overdue =
                          !chore.completed && isOverdue(chore.dueDate);
                        const isPickedUp = pickedUpChores.has(chore.id);
                        const isSomeoneElse = chore.assignedTo !== currentUserId;
                        return (
                          <View
                            key={chore.id}
                            style={{ overflow: "hidden", position: "relative" }}
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
                            handleChorePress(chore.id, chore.assignedTo, chore.title, chore.points);
                          }}
                          accessibilityState={{ checked: chore.completed }}
                          accessibilityLabel={`${chore.title}. ${chore.completed ? "Completed." : "Not completed."} ${canManageChore(chore) ? "Double tap to update completion, or use the more actions button to manage." : "Double tap to update completion."}`}
                          style={[
                            styles.choreRow,
                            {
                              borderTopColor: colors.border,
                              backgroundColor: isPickedUp
                                ? colors.success + "10"
                                : overdue
                                ? colors.warning + "08"
                                : "transparent",
                            },
                          ]}
                        >
                          {/* Status icon */}
                          <View
                            style={[
                              styles.statusDot,
                              {
                                backgroundColor: chore.completed
                                  ? colors.success + "22"
                                  : overdue
                                  ? colors.warning + "22"
                                  : colors.muted,
                              },
                            ]}
                          >
                            <Feather
                              name={
                                chore.completed
                                  ? "check"
                                  : overdue
                                  ? "alert-circle"
                                  : "clock"
                              }
                              size={11}
                              color={
                                chore.completed
                                  ? colors.success
                                  : overdue
                                  ? colors.warning
                                  : colors.mutedForeground
                              }
                            />
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.choreTitle,
                                {
                                  color: chore.completed
                                    ? colors.mutedForeground
                                    : colors.foreground,
                                  textDecorationLine: chore.completed
                                    ? "line-through"
                                    : "none",
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {chore.title}
                            </Text>
                            <Text
                              style={[
                                styles.choreDate,
                                {
                                  color: overdue
                                    ? colors.warning
                                    : colors.mutedForeground,
                                },
                              ]}
                            >
                              {formatDueDate(chore.dueDate)}
                              {chore.recurring ? ` · ${chore.recurring}` : ""}
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
                          </View>
                        );
                      })}
                      {visibleChores.length < rc.length ? (
                        <TouchableOpacity
                          style={styles.loadMoreChores}
                          onPress={() =>
                            setVisibleChoreLimits((current) => ({
                              ...current,
                              [roommate.id]: visibleLimit + 50,
                            }))
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`Show 50 more chores for ${roommate.name}`}
                        >
                          <Text style={[styles.loadMoreChoresText, { color: colors.primary }]}>
                            Show more ({rc.length - visibleChores.length} remaining)
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ))}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      )}

      {/* ── Add Chore Modal (full-screen, matches New IOU) ── */}
      <ActionMenuModal
        visible={!!completionAction}
        title={completionChore?.title ?? "Chore"}
        subtitle="Confirm this chore update"
        actions={[]}
        initialConfirmationAction={completionAction}
        onClose={() => setCompletionChoreId(null)}
      />
      <ActionMenuModal
        visible={!!actionChore}
        title={actionChore?.title ?? "Chore"}
        subtitle="Manage this chore"
        onClose={() => setActionChoreId(null)}
        actions={actionChore ? [
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
            runAfterDismiss: Boolean(actionChore.recurring || actionChore.recurrenceSeriesId),
            confirmation: actionChore.recurring || actionChore.recurrenceSeriesId
              ? undefined
              : {
                  title: `Delete “${actionChore.title}”?`,
                  message: "This removes the chore for everyone in your Sweet.",
                  confirmLabel: "Delete chore",
                },
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
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <ManualChoreForm
              key={editingChore?.id ?? `${showAddChoreModal}-${addChoreTargetId ?? "self"}`}
              initialAssigneeId={addChoreTargetId ?? currentUserId}
              initialChore={editingChore}
              onCreated={closeAddChoreSheet}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>
    </View>
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
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36, marginTop: 2 },
  // Open plant summary — intentionally not enclosed in a separate card.
  plantSection: {
    marginHorizontal: 16,
    marginBottom: 18,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  plantCardInner: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 4,
    gap: 12,
  },
  plantContainer: {
    width: 134,
    minHeight: 188,
    alignItems: "center",
    justifyContent: "center",
  },
  healthInfo: {
    flex: 1,
    minWidth: 156,
    paddingVertical: 12,
    gap: 6,
  },
  healthRoom: { fontFamily: "Inter_400Regular", fontSize: 12 },
  healthTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    lineHeight: 24,
  },
  healthSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  pctBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 6,
  },
  pctText: { fontFamily: "Inter_700Bold", fontSize: 18 },
  track: { height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 4 },
  fill: { height: 7, borderRadius: 4 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  stat: { fontFamily: "Inter_400Regular", fontSize: 11 },

  // Roommate list
  listPad: { paddingHorizontal: 16, gap: 12 },
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
  roommateName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  roommateStats: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 },
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
  ptsText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  noChores: {
    fontFamily: "Inter_400Regular",
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
  loadMoreChoresText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  choreRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  choreTitle: { fontFamily: "Inter_500Medium", fontSize: 14 },
  choreDate: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 },
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
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  activityHeaderIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  activityTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },
  distBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  distText: { fontFamily: "Inter_500Medium", fontSize: 11 },
  activitySection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  activitySectionLabel: { fontFamily: "Inter_500Medium", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
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
  myStatusLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  myStatusSub: { fontFamily: "Inter_400Regular", fontSize: 11 },
  statusBtnRow: { flexDirection: "row", gap: 6 },
  statusBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  homeLocBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  homeLocText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  homeLocHint: { fontFamily: "Inter_400Regular", fontSize: 11, marginLeft: "auto" as unknown as number },
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
  activityRmName: { fontFamily: "Inter_500Medium", fontSize: 11 },
  activityRmBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  activityRmStatus: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  activityHint: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center", marginTop: 2 },

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
    fontFamily: "Inter_600SemiBold",
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
  tabSwitchText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

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
  monthLabel: { fontFamily: "Inter_700Bold", fontSize: 16 },
  monthNavBtn: {
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
    fontFamily: "Inter_500Medium",
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
  weekChipText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  weekRangeText: { fontFamily: "Inter_500Medium", fontSize: 12 },
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
  slotLabelText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13 },
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
  assigneeName: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  weekOutCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
    alignItems: "center",
  },
  weekOutText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  calEmptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 6,
  },
  calEmptyTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  calEmptySub: { fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center" },

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
  addChoreLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginBottom: 4,
    marginTop: 6,
  },
  addChoreInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: "Inter_500Medium",
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
  addChoreSubmitText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});
