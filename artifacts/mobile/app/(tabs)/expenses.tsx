import { summarizeMemberIous } from "@/lib/iouSummary";
import { KEYBOARD_BEHAVIOR } from "@/lib/keyboard";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  AppState,
  useWindowDimensions,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

const SCREEN_HEIGHT = Dimensions.get("window").height;
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { CompletionMotion, CompletionText } from "@/components/CompletionMotion";
import { Surface } from "@/components/Surface";
import { HistoryDisclosure } from "@/components/HistoryDisclosure";
import { FloatingActionButton, useFloatingActionMetrics } from "@/components/FloatingActionButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineFeedback } from "@/components/InlineFeedback";
import { GlassButton } from "@/components/GlassButton";
import { ExpensePendingError } from "@/lib/expenseSync";
import { hasExpensePayments } from "@/lib/expensePolicy";
import { formatExpenseDate, normalizeExpenseDate, expenseDateInputValue } from "@/lib/expenseDate";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import { useTheme } from "@/constants/colors";
import { useDraggableSheet } from "@/hooks/useDraggableSheet";
import { success as hapticSuccess } from "@/lib/haptics";
import { tapLight } from "@/lib/haptics";
import {
  allocationsToDollarSplits,
  buildEvenSplitCents,
  buildStoredExpenseAllocations,
  centsToDollars,
  parseAllocationToCents,
  parseMoneyToCents,
  validateExpenseAllocation,
  type ExpenseSplitMode,
} from "@/lib/money";
import { becomesHistoricalAt, historyPage, isHistoricalResolution } from "@/lib/resolutionHistory";
import {
  type ExpenseCategory,
  type Expense,
  type PendingIouDraft,
  useAppContextSelector,
} from "@/context/AppContext";

const EXPENSE_CATEGORIES: {
  key: ExpenseCategory;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { key: "groceries", label: "Groceries", icon: "shopping-cart" },
  { key: "utilities", label: "Utilities", icon: "zap" },
  { key: "rent", label: "Rent", icon: "home" },
  { key: "entertainment", label: "Fun", icon: "music" },
  { key: "other", label: "Other", icon: "package" },
];

const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList<Expense>);

const formatDate = formatExpenseDate;
const todayInputValue = expenseDateInputValue;

function expenseShares(expense: Expense): Record<string, number> {
  return expense.allocations?.length
    ? allocationsToDollarSplits(expense.allocations)
    : expense.splits ?? {};
}

type ExpenseAction = "repay" | "undo" | "settle" | "reopen" | "delete";
type ExpenseConfirmation = {
  expenseId: string;
  action: ExpenseAction;
  title: string;
  message: string;
  label: string;
};

function buildEvenSplits(
  totalCents: number,
  participants: string[]
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(buildEvenSplitCents(totalCents, participants)).map(([id, cents]) => [
      id,
      centsToDollars(cents).toFixed(2),
    ]),
  );
}

export default function ExpensesScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { scrollBottomPadding } = useFloatingActionMetrics();
  const {
    roommates,
    expenses,
    addExpense,
    updateExpense,
    settleExpense,
    deleteExpense,
    markPersonPaid,
    undoPersonPaid,
    reopenExpense,
    expenseSync,
    pendingExpenseIds,
    currentUserId,
    pendingIouDraft,
    setPendingIouDraft,
    linkShoppingItemsToExpense,
    canEditExpense,
    canManageExpense,
  } = useAppContextSelector((context) => ({
    roommates: context.roommates,
    expenses: context.expenses,
    addExpense: context.addExpense,
    updateExpense: context.updateExpense,
    settleExpense: context.settleExpense,
    deleteExpense: context.deleteExpense,
    markPersonPaid: context.markPersonPaid,
    undoPersonPaid: context.undoPersonPaid,
    reopenExpense: context.reopenExpense,
    expenseSync: context.expenseSync,
    pendingExpenseIds: context.pendingExpenseIds,
    currentUserId: context.currentUserId,
    pendingIouDraft: context.pendingIouDraft,
    setPendingIouDraft: context.setPendingIouDraft,
    linkShoppingItemsToExpense: context.linkShoppingItemsToExpense,
    canEditExpense: context.canEditExpense,
    canManageExpense: context.canManageExpense,
  }));

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailConfirmation, setDetailConfirmation] = useState<ExpenseConfirmation | null>(null);
  const pendingEditRef = useRef<Expense | null>(null);
  const detailScrollRef = useRef<ScrollView>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningExpenseIds, setRunningExpenseIds] = useState<Set<string>>(new Set());
  const runningExpenseIdsRef = useRef(new Set<string>());
  const [retryingExpenses, setRetryingExpenses] = useState(false);
  const [queuedIou, setQueuedIou] = useState(false);
  const [historyNow, setHistoryNow] = useState(() => new Date());
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyPages, setHistoryPages] = useState(1);
  const [submittingIou, setSubmittingIou] = useState(false);
  const [iouSubmitError, setIouSubmitError] = useState<string | null>(null);
  const submittingIouRef = useRef(false);
  const [expenseDraftId, setExpenseDraftId] = useState(() => Crypto.randomUUID());
  const draftSavedRef = useRef(false);

  // ── IOU builder state ──────────────────────────────────────────────────────
  const [expTitle, setExpTitle] = useState("");
  const [expCategory, setExpCategory] = useState<ExpenseCategory>("groceries");
  const [expPaidBy, setExpPaidBy] = useState(currentUserId);
  const [expTotalAmount, setExpTotalAmount] = useState("");
  // participants = everyone whose share is part of the expense (payer allowed)
  const [expParticipants, setExpParticipants] = useState<string[]>(
    roommates.filter((r) => r.id !== currentUserId).map((r) => r.id)
  );
  // splits: person id → dollar string they owe
  const [expSplits, setExpSplits] = useState<Record<string, string>>({});
  const [allocationMode, setAllocationMode] = useState<ExpenseSplitMode>("equal");
  const [expenseSource, setExpenseSource] = useState<PendingIouDraft["source"]>();
  const [expNotes, setExpNotes] = useState("");
  const [expDate, setExpDate] = useState(todayInputValue);

  // Consume a pre-filled IOU draft handed off from the Shopping tab. When
  // present, populate the builder state and pop the modal, then clear the
  // draft so we don't re-open on subsequent renders.
  useEffect(() => {
    if (!pendingIouDraft) return;
    setEditingExpenseId(null);
    setExpenseDraftId(Crypto.randomUUID());
    draftSavedRef.current = false;
    setQueuedIou(false);
    setIouSubmitError(null);
    setExpTitle(pendingIouDraft.title);
    setExpCategory(pendingIouDraft.category);
    setExpPaidBy(pendingIouDraft.paidBy);
    setExpTotalAmount(pendingIouDraft.totalAmount);
    setExpParticipants(pendingIouDraft.participants);
    setExpSplits(pendingIouDraft.splits);
    setAllocationMode("exact");
    setExpenseSource(pendingIouDraft.source);
    setExpNotes(pendingIouDraft.notes ?? "");
    setExpDate(normalizeExpenseDate(pendingIouDraft.date) ?? todayInputValue());
    setShowExpenseModal(true);
    setPendingIouDraft(null);
  }, [pendingIouDraft, setPendingIouDraft]);

  const flatListRef = useRef<FlatList>(null);
  const expenseScrollY = useSharedValue(0);
  const expenseScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      expenseScrollY.value = Math.max(0, event.contentOffset.y);
    },
  });
  const balanceCardStyle = useAnimatedStyle(() => ({
    height: interpolate(
      expenseScrollY.value,
      [0, 120],
      [112, 64],
      Extrapolation.CLAMP,
    ),
  }));
  const balanceCardContentStyle = useAnimatedStyle(() => ({
    paddingVertical: interpolate(
      expenseScrollY.value,
      [0, 120],
      [14, 6],
      Extrapolation.CLAMP,
    ),
  }));
  const balanceAmountStyle = useAnimatedStyle(() => ({
    fontSize: interpolate(
      expenseScrollY.value,
      [0, 120],
      [34, 22],
      Extrapolation.CLAMP,
    ),
    marginTop: interpolate(
      expenseScrollY.value,
      [0, 120],
      [4, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const balanceHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      expenseScrollY.value,
      [0, 72],
      [1, 0],
      Extrapolation.CLAMP,
    ),
    height: interpolate(
      expenseScrollY.value,
      [0, 100],
      [18, 0],
      Extrapolation.CLAMP,
    ),
    marginTop: interpolate(
      expenseScrollY.value,
      [0, 100],
      [2, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;

  const {
    activeExpenses,
    historicalExpenses,
    firstIOweIndex,
    firstOwedToMeIndex,
    iOwe,
    owedToMe,
  } = useMemo(() => {
    const historical = expenses.filter(
      (expense) =>
        expense.settled &&
        isHistoricalResolution(expense.resolvedAt, historyNow),
    );
    const active = expenses.filter(
      (expense) =>
        !expense.settled ||
        !isHistoricalResolution(expense.resolvedAt, historyNow),
    );
    const unresolved = active.filter((expense) => !expense.settled);

    // Gross amounts in each direction — exclude entries already paid back.
    let nextOwedToMe = 0;
    let nextIOwe = 0;
    unresolved.forEach((expense) => {
      if (expense.paidBy === currentUserId) {
        Object.entries(expenseShares(expense)).forEach(([id, amount]) => {
          if (id !== expense.paidBy && !(expense.paidBack ?? {})[id]) {
            nextOwedToMe += amount as number;
          }
        });
      } else if (!(expense.paidBack ?? {})[currentUserId]) {
        nextIOwe += expenseShares(expense)[currentUserId] as number || 0;
      }
    });

    return {
      activeExpenses: active,
      historicalExpenses: historical,
      firstIOweIndex: active.findIndex(
        (expense) =>
          !expense.settled &&
          expense.paidBy !== currentUserId &&
          !expense.paidBack?.[currentUserId] &&
          (expenseShares(expense)[currentUserId] as number || 0) > 0,
      ),
      firstOwedToMeIndex: active.findIndex(
        (expense) => !expense.settled && expense.paidBy === currentUserId &&
          Object.entries(expenseShares(expense)).some(([personId, amount]) =>
            personId !== expense.paidBy && amount > 0 && !expense.paidBack?.[personId]),
      ),
      iOwe: nextIOwe,
      owedToMe: nextOwedToMe,
    };
  }, [currentUserId, expenses, historyNow]);
  const iouSummary = useMemo(
    () => summarizeMemberIous(expenses, currentUserId),
    [expenses, currentUserId],
  );
  const visibleHistory = useMemo(
    () =>
      historyExpanded
        ? historyPage(
            historicalExpenses,
            (expense) => expense.resolvedAt,
            historyPages,
          )
        : [],
    [historicalExpenses, historyExpanded, historyPages],
  );
  const pendingExpenseSet = useMemo(() => new Set(pendingExpenseIds), [pendingExpenseIds]);
  const editingExpense = editingExpenseId ? expenses.find((expense) => expense.id === editingExpenseId) : undefined;
  const financialFieldsLocked = Boolean(editingExpense && hasExpensePayments(editingExpense));
  const purchaseTotalLocked = financialFieldsLocked || Boolean(editingExpense?.shoppingSource);
  const formBusy = submittingIou || queuedIou || pendingExpenseSet.has(editingExpenseId ?? expenseDraftId);

  useEffect(() => {
    const refresh = () => setHistoryNow(new Date());
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    const boundaries = expenses.map((expense) => becomesHistoricalAt(expense.resolvedAt)).filter((time): time is number => time !== null && time > historyNow.getTime());
    const nextBoundary = boundaries.length ? Math.min(...boundaries) : Number.POSITIVE_INFINITY;
    const timer = setTimeout(refresh, Math.max(1, Math.min(60_000, nextBoundary - historyNow.getTime() + 1)));
    return () => { subscription.remove(); clearTimeout(timer); };
  }, [expenses, historyNow]);

  const openDetails = (expenseId: string, confirmation: ExpenseConfirmation | null = null) => {
    setActionError(null);
    setDetailConfirmation(confirmation);
    setDetailExpenseId(expenseId);
    setDetailVisible(true);
  };
  const closeDetails = () => {
    setDetailVisible(false);
    setDetailConfirmation(null);
  };
  const finishDetailDismiss = () => {
    const editing = pendingEditRef.current;
    pendingEditRef.current = null;
    setDetailExpenseId(null);
    if (editing) {
      const fresh = expenses.find((expense) => expense.id === editing.id);
      if (fresh) openEditModal(fresh);
      else setActionError("This expense is no longer available.");
    }
  };
  useEffect(() => {
    // Android/web remove the non-animated modal in this commit. iOS hands off
    // only after its native slide dismissal reports completion.
    if (!detailVisible && Platform.OS !== "ios") finishDetailDismiss();
  }, [detailVisible]);

  const requestExpenseAction = (expense: Expense, action: ExpenseAction) => {
    const copy = {
      repay: ["Record your repayment?", "Confirm that you have paid your outstanding share back to the payer.", "Yes, I paid"],
      undo: ["Undo your repayment?", "Your share will become outstanding again. Other people's recorded repayments stay unchanged.", "Undo my repayment"],
      settle: ["Settle this IOU?", "This marks the entire IOU as settled. Only confirm when no further repayment is needed.", "Settle IOU"],
      reopen: ["Reopen this IOU?", "The manual settlement will be removed. All recorded repayments are kept.", "Reopen IOU"],
      delete: ["Delete this expense?", "This permanently removes the expense and its repayment history.", "Delete expense"],
    }[action];
    openDetails(expense.id, { expenseId: expense.id, action, title: copy[0], message: copy[1], label: copy[2] });
  };
  useEffect(() => {
    if (detailVisible && detailConfirmation) detailScrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [detailVisible, detailConfirmation]);
  const performExpenseAction = async (directAction?: ExpenseConfirmation) => {
    const confirmation = directAction ?? detailConfirmation;
    if (!confirmation || runningExpenseIdsRef.current.has(confirmation.expenseId) || pendingExpenseSet.has(confirmation.expenseId)) return;
    if (!expenseSync.ready) { setActionError("Expenses are still loading. Please try again shortly."); return; }
    const { expenseId, action } = confirmation;
    runningExpenseIdsRef.current.add(expenseId);
    setRunningExpenseIds(new Set(runningExpenseIdsRef.current));
    setActionError(null);
    try {
      const changed = action === "repay" ? await markPersonPaid(expenseId, currentUserId)
        : action === "undo" ? await undoPersonPaid(expenseId)
        : action === "settle" ? await settleExpense(expenseId)
        : action === "reopen" ? await reopenExpense(expenseId)
        : await deleteExpense(expenseId);
      if (!changed) throw new Error("This expense changed or the action is no longer available. Review its details and try again.");
      setDetailConfirmation(null);
      hapticSuccess();
      if (action === "delete") closeDetails();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save this change. Please try again.");
    } finally {
      runningExpenseIdsRef.current.delete(expenseId);
      setRunningExpenseIds(new Set(runningExpenseIdsRef.current));
    }
  };
  const retryExpenseSync = async () => {
    if (retryingExpenses) return;
    setRetryingExpenses(true);
    setActionError(null);
    try { await expenseSync.retry(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not sync. Please try again."); }
    finally { setRetryingExpenses(false); }
  };

  const scrollToExpense = (index: number) => {
    if (index < 0) return;
    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ── Recalculate even split when total or participants change ───────────────
  const sourceAllocatedCents =
    expenseSource?.type === "shopping-list"
      ? expenseSource.individuallyAllocatedCents ?? 0
      : 0;
  const enteredTotalCents = parseMoneyToCents(expTotalAmount);
  const allocatableTotalCents =
    enteredTotalCents === null || enteredTotalCents < sourceAllocatedCents
      ? null
      : enteredTotalCents - sourceAllocatedCents;

  const recalcEvenSplit = useCallback(() => {
    const totalCents = allocatableTotalCents;
    if (totalCents === null || !expParticipants.length) {
      setExpSplits({});
      return;
    }
    setExpSplits(buildEvenSplits(totalCents, expParticipants));
    setAllocationMode("equal");
  }, [allocatableTotalCents, expParticipants]);

  // Equal shares derive from the current total and participants immediately,
  // including while the amount field still has keyboard focus.
  const displayedSplits = allocationMode === "equal" && allocatableTotalCents !== null
    ? buildEvenSplits(allocatableTotalCents, expParticipants) : expSplits;
  // ── Derived: sum of splits, remainder ─────────────────────────────────────
  const totalCents = allocatableTotalCents;
  const activeMemberIds = new Set(roommates.map((member) => member.id));
  const baseAllocationValidation = validateExpenseAllocation({
    total: totalCents === null ? "" : centsToDollars(totalCents).toFixed(2),
    payerId: expPaidBy,
    participantIds: expParticipants,
    allocations: displayedSplits,
    activeMemberIds,
  });
  const allocationValidation =
    enteredTotalCents !== null && enteredTotalCents < sourceAllocatedCents
      ? {
          valid: false as const,
          reason: "List total cannot be less than its individual item expenses.",
          remainingCents: enteredTotalCents - sourceAllocatedCents,
        }
      : baseAllocationValidation;
  const totalParsed = totalCents === null ? 0 : centsToDollars(totalCents);
  const remainingCents = allocationValidation.valid ? 0 : allocationValidation.remainingCents;
  const splitsValid = allocationValidation.valid;
  const validExpenseDate = normalizeExpenseDate(expDate);
  const formValidationMessage = !expenseSync.ready ? "Expenses are still loading. You can fill in the details while you wait."
    : editingExpenseId && !editingExpense ? "This expense is no longer available."
    : editingExpense && !canEditExpense(editingExpense) ? "You no longer have permission to edit this IOU."
    : financialFieldsLocked ? null
    : !validExpenseDate ? "Enter a valid date as YYYY-MM-DD."
    : !allocationValidation.valid ? allocationValidation.reason : null;
  const canSubmit = !formBusy && !formValidationMessage;


  // ── Toggle participant ─────────────────────────────────────────────────────
  const toggleParticipant = (id: string) => {
    const next = expParticipants.includes(id)
      ? expParticipants.filter((value) => value !== id)
      : [...expParticipants, id];
    setExpParticipants(next);
    if (allocationMode === "equal" && totalCents !== null && next.length) {
      setExpSplits(buildEvenSplits(totalCents, next));
    } else {
      setExpSplits((current) => {
        const updated = Object.fromEntries(Object.entries(current).filter(([memberId]) => next.includes(memberId)));
        if (next.includes(id) && !(id in updated)) updated[id] = "";
        return updated;
      });
    }
  };

  // ── Update individual split ────────────────────────────────────────────────
  const updateSplit = (id: string, val: string) => {
    setAllocationMode("exact");
    setExpSplits((prev) => ({ ...prev, [id]: val }));
  };

  const assignRemainder = (id: string) => {
    if (remainingCents <= 0) return;
    const currentCents = parseAllocationToCents(displayedSplits[id] ?? "") ?? 0;
    setAllocationMode("exact");
    setExpSplits((current) => ({
      ...current,
      [id]: centsToDollars(currentCents + remainingCents).toFixed(2),
    }));
  };

  // ── Reset modal ────────────────────────────────────────────────────────────
  const resetModal = () => {
    setExpenseDraftId(Crypto.randomUUID());
    draftSavedRef.current = false;
    setExpTitle("");
    setExpCategory("groceries");
    setExpPaidBy(currentUserId);
    setExpTotalAmount("");
    setExpParticipants(
      roommates.filter((r) => r.id !== currentUserId).map((r) => r.id)
    );
    setExpSplits({});
    setAllocationMode("equal");
    setEditingExpenseId(null);
    setExpenseSource(undefined);
    setExpNotes("");
    setExpDate(todayInputValue());
    setIouSubmitError(null);
    setQueuedIou(false);
  };

  // ── Open / close animation for the New IOU sheet ───────────────────────────
  // The sheet is a full-screen overlay driven entirely by a single translateY
  // value. On open: spring up from below with a subtle overshoot. On close (via
  // the top-right X button or after sending): timed slide back down off-screen,
  // then dismiss the modal and reset form state.
  const iouTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (showExpenseModal) {
      iouTranslateY.setValue(SCREEN_HEIGHT);
      Animated.spring(iouTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 180,
        mass: 0.8,
      }).start();
    }
  }, [showExpenseModal, iouTranslateY]);

  const closeIou = useCallback(() => {
    if (submittingIouRef.current) return;
    Animated.timing(iouTranslateY, {
      toValue: SCREEN_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setShowExpenseModal(false);
      resetModal();
      submittingIouRef.current = false;
      setSubmittingIou(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iouTranslateY]);
  const iouDragHandlers = useDraggableSheet(iouTranslateY, () => {
    if (submittingIouRef.current) { Animated.spring(iouTranslateY, { toValue: 0, useNativeDriver: true }).start(); return; }
    setShowExpenseModal(false);
    resetModal();
    submittingIouRef.current = false;
    setSubmittingIou(false);
  });

  const openEditModal = (item: (typeof expenses)[number]) => {
    if (!canEditExpense(item)) {
      setActionError("Only the IOU creator can edit this expense.");
      return;
    }
    setEditingExpenseId(item.id);
    setExpTitle(item.title);
    setExpCategory(item.category);
    setExpPaidBy(item.paidBy);
    setExpTotalAmount(
      item.shoppingSource?.type === "shopping-list"
        ? centsToDollars(item.shoppingSource.listTotalCents ?? ((item.amountCents ?? Math.round(item.amount * 100)) + (item.shoppingSource.individuallyAllocatedCents ?? 0))).toFixed(2)
        : item.amount.toFixed(2),
    );
    setExpParticipants(item.sharedWith);
    setExpSplits(
      Object.fromEntries(
        Object.entries(expenseShares(item)).map(([id, amt]) => [id, (amt as number).toFixed(2)])
      )
    );
    setAllocationMode(item.splitMode ?? "exact");
    setExpNotes(item.notes ?? "");
    setExpDate(normalizeExpenseDate(item.date) ?? todayInputValue());
    setExpenseSource(item.shoppingSource);
    setIouSubmitError(null);
    setQueuedIou(false);
    setShowExpenseModal(true);
  };

  // ── Submit IOU ─────────────────────────────────────────────────────────────
  const doSendIOU = async () => {
    if (submittingIouRef.current || !canSubmit) return;
    if (!financialFieldsLocked && (!allocationValidation.valid || !validExpenseDate)) return;
    submittingIouRef.current = true;
    setSubmittingIou(true);
    setIouSubmitError(null);
    try {
      const description = { title: expTitle.trim() || "IOU", category: expCategory, notes: expNotes.trim() || undefined };
      if (editingExpenseId && financialFieldsLocked) {
        // Do not reconstruct financial data from a form or the current roster:
        // former participants and recorded payments must be preserved exactly.
        if (!await updateExpense(editingExpenseId, description)) throw new Error("This IOU could not be updated. Review its current details.");
      } else {
        if (!allocationValidation.valid || !validExpenseDate) return;
        const allocations = buildStoredExpenseAllocations(expParticipants, allocationValidation.allocationCents);
        const payload = {
          ...description,
          amount: centsToDollars(allocationValidation.totalCents), amountCents: allocationValidation.totalCents,
          paidBy: expPaidBy, sharedWith: expParticipants, splits: allocationsToDollarSplits(allocations), splitMode: allocationMode, allocations,
          // New recurring IOUs are unavailable until independent occurrences are
          // supported. Editing an older IOU preserves its existing label.
          recurring: editingExpense?.recurring, recurringCustom: editingExpense?.recurringCustom,
          shoppingSource: editingExpense?.shoppingSource ?? (expenseSource ? { ...expenseSource, listTotalCents: expenseSource.type === "shopping-list" ? enteredTotalCents ?? expenseSource.listTotalCents : undefined } : undefined),
          date: validExpenseDate,
        };
        if (editingExpenseId) {
          if (!await updateExpense(editingExpenseId, payload)) throw new Error("This IOU could not be updated. Review its current details.");
        } else {
          const expenseId = await addExpense({ ...payload, settled: false }, expenseDraftId);
          if (expenseSource?.type === "shopping-item") linkShoppingItemsToExpense(expenseSource.shoppingItemIds, expenseId);
        }
      }
      submittingIouRef.current = false;
      setSubmittingIou(false);
      draftSavedRef.current = true;
      hapticSuccess();
      closeIou();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save this IOU. Please try again.";
      setIouSubmitError(message);
      if (error instanceof ExpensePendingError) setQueuedIou(true);
    } finally {
      submittingIouRef.current = false;
      setSubmittingIou(false);
    }
  };
  useEffect(() => {
    const savedDraft = !editingExpenseId && expenses.some((expense) => expense.id === expenseDraftId) && !pendingExpenseSet.has(expenseDraftId);
    const savedEdit = editingExpenseId && queuedIou && !pendingExpenseSet.has(editingExpenseId) && expenseSync.pending === 0 && !expenseSync.error;
    if (showExpenseModal && !submittingIou && !draftSavedRef.current && expenseSync.ready && (savedDraft || savedEdit)) {
      draftSavedRef.current = true;
      setQueuedIou(false);
      hapticSuccess();
      closeIou();
    }
  }, [editingExpenseId, expenseDraftId, expenses, pendingExpenseSet, showExpenseModal, submittingIou, queuedIou, expenseSync.ready, expenseSync.pending, expenseSync.error, closeIou]);
  useEffect(() => {
    if (queuedIou && expenseSync.ready && !pendingExpenseSet.has(editingExpenseId ?? expenseDraftId) && expenseSync.error) {
      setQueuedIou(false);
      setIouSubmitError(expenseSync.error);
    }
  }, [queuedIou, expenseSync.ready, expenseSync.error, pendingExpenseSet, editingExpenseId, expenseDraftId]);
  const handleSendIOU = () => { void doSendIOU(); };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Expenses"
        subtitle="Shared costs and repayments"
        topPadding={topPad + 16}
      />

      <>
          {(!expenseSync.ready || expenseSync.pending > 0 || expenseSync.error || actionError) ? (
            <View style={styles.syncBanner}>
              <InlineFeedback
                message={actionError ?? expenseSync.error ?? (!expenseSync.ready
                  ? "Loading your expenses…"
                  : `${expenseSync.pending} expense ${expenseSync.pending === 1 ? "change is" : "changes are"} saved on this device and waiting to sync.`)}
                tone={actionError || expenseSync.error ? "error" : "info"}
              />
              {(expenseSync.error || expenseSync.pending > 0) ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry saving expense changes"
                  style={[styles.retryButton, { borderColor: colors.border }]} disabled={retryingExpenses}
                  onPress={() => void retryExpenseSync()}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>{retryingExpenses ? "Retrying…" : "Retry sync"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {/* Balance cards — You owe on top, Owed to you below */}
          <View style={styles.balanceRow}>
            {iOwe > 0 && (
              <Reanimated.View
                style={[
                  styles.balanceCard,
                  balanceCardStyle,
                  { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "40" },
                ]}
              >
                <TouchableOpacity
                  style={styles.balanceCardPressable}
                  onPress={() => scrollToExpense(firstIOweIndex)}
                  activeOpacity={0.75}
                >
                  <Reanimated.View style={[styles.balanceCardContent, balanceCardContentStyle]}>
                    <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>You owe</Text>
                    <Reanimated.Text style={[styles.balanceAmount, balanceAmountStyle, { color: colors.destructive }]}>
                      -${iOwe.toFixed(2)}
                    </Reanimated.Text>
                    <Reanimated.Text style={[styles.balanceHint, balanceHintStyle, { color: colors.mutedForeground }]}>
                      Tap to view
                    </Reanimated.Text>
                  </Reanimated.View>
                </TouchableOpacity>
              </Reanimated.View>
            )}
            {owedToMe > 0 && (
              <Reanimated.View
                style={[
                  styles.balanceCard,
                  balanceCardStyle,
                  { backgroundColor: colors.success + "14", borderColor: colors.success + "40" },
                ]}
              >
                <TouchableOpacity
                  style={styles.balanceCardPressable}
                  onPress={() => scrollToExpense(firstOwedToMeIndex)}
                  activeOpacity={0.75}
                >
                  <Reanimated.View style={[styles.balanceCardContent, balanceCardContentStyle]}>
                    <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>Owed to you</Text>
                    <Reanimated.Text style={[styles.balanceAmount, balanceAmountStyle, { color: colors.success }]}>
                      +${owedToMe.toFixed(2)}
                    </Reanimated.Text>
                    <Reanimated.Text style={[styles.balanceHint, balanceHintStyle, { color: colors.mutedForeground }]}>
                      Tap to view
                    </Reanimated.Text>
                  </Reanimated.View>
                </TouchableOpacity>
              </Reanimated.View>
            )}
            {owedToMe === 0 && iOwe === 0 && (
              <Reanimated.View
                style={[
                  styles.balanceCard,
                  balanceCardStyle,
                  { backgroundColor: colors.success + "14", borderColor: colors.success + "40" },
                ]}
              >
                <Reanimated.View style={[styles.balanceCardContent, balanceCardContentStyle]}>
                  <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>Balance</Text>
                  <Reanimated.Text style={[styles.balanceAmount, balanceAmountStyle, { color: colors.success }]}>
                    $0.00
                  </Reanimated.Text>
                  <Reanimated.Text style={[styles.balanceHint, balanceHintStyle, { color: colors.mutedForeground }]}>
                    All settled up
                  </Reanimated.Text>
                </Reanimated.View>
              </Reanimated.View>
            )}
          </View>

          {/* A net position is informational, not a repayment or settlement. */}
          <View style={[styles.netSummary, { borderColor: colors.divider }]}>
            <Text style={[styles.netSummaryTitle, { color: colors.foreground }]}>
              Net IOU balance: {iouSummary.netCents < 0 ? "−" : iouSummary.netCents > 0 ? "+" : ""}${(Math.abs(iouSummary.netCents) / 100).toFixed(2)}
            </Text>
            <Text style={[styles.netSummaryHint, { color: colors.mutedForeground }]}>
              {iouSummary.hasOutstandingDebts
                ? iouSummary.netCents === 0
                  ? "Your unpaid IOUs offset each other. Individual repayments are still outstanding."
                  : iouSummary.netCents > 0
                    ? "Overall, you’re owed more than you owe. Individual repayments stay the same."
                    : "Overall, you owe more than you’re owed. Individual repayments stay the same."
                : "No outstanding repayments for you."}
            </Text>
          </View>

          {/* Expense list */}
          <AnimatedFlatList
            ref={flatListRef}
            data={activeExpenses}
            keyExtractor={(e) => e.id}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              flatListRef.current?.scrollToOffset({
                offset: index * averageItemLength,
                animated: true,
              });
            }}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(scrollBottomPadding, 90 + botPad) },
            ]}
            showsVerticalScrollIndicator={false}
            onScroll={expenseScrollHandler}
            scrollEventThrottle={16}
            ListEmptyComponent={
              <EmptyState
                icon="dollar-sign"
                title="No IOUs yet"
                subtitle="Tap + to log a shared expense"
              />
            }
            renderItem={({ item }) => {
              const payer = roommates.find((r) => r.id === item.paidBy);
              const cat =
                EXPENSE_CATEGORIES.find((c) => c.key === item.category) ??
                EXPENSE_CATEGORIES[4];
              const myShare = expenseShares(item)[currentUserId] ?? 0;
              const mySharePaid = item.paidBy !== currentUserId && myShare > 0 &&
                !!(item.paidBack ?? {})[currentUserId];
              const relevantToMe = item.paidBy === currentUserId || myShare > 0;
              const completeForMe = relevantToMe && (item.settled || mySharePaid);
              return (
                <CompletionMotion completed={completeForMe} subtle>
                <TouchableOpacity
                  activeOpacity={0.8}
                  delayLongPress={450}
                  onLongPress={() => { openDetails(item.id); tapLight(); }}
                  onPress={() => openDetails(item.id)}
                  accessibilityRole="button"
                  accessibilityHint={
                    !item.settled
                      ? "Tap for details. Press and hold for expense actions."
                      : "Tap for details."
                  }
                >
                  <Surface
                    style={[
                      styles.expenseCard,
                      {
                        borderColor: colors.border,
                      },
                    ]}
                  >
                  {/* Top row */}
                  <View style={styles.expenseCardTop}>
                    <View style={styles.expCatIcon}>
                      <Feather
                        name={cat.icon}
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <CompletionText
                        completed={item.settled}
                        style={[
                          styles.expTitle,
                          { color: item.settled ? colors.mutedForeground : colors.foreground },
                        ]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </CompletionText>
                      <View style={styles.expMetaRow}>
                        <Text
                          style={[
                            styles.expMeta,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          Paid by {payer?.name ?? "Former Sweetmate"} · {formatDate(item.date)}
                        </Text>

                      </View>
                    </View>
                    <View style={styles.expRight}>
                      <CompletionText
                        completed={item.settled}
                        containerStyle={{ alignSelf: "flex-end" }}
                        style={[
                          styles.expAmount,
                          { color: item.settled ? colors.mutedForeground : colors.foreground },
                        ]}
                      >
                        ${item.amount.toFixed(2)}
                      </CompletionText>
                      {canManageExpense(item) && !item.settled ? (
                        <View style={styles.expActions}>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`Settle ${item.title}`}
                            accessibilityState={{ disabled: !expenseSync.ready || pendingExpenseSet.has(item.id) || runningExpenseIds.has(item.id) }}
                            style={styles.expenseSettleButton}
                            disabled={!expenseSync.ready || pendingExpenseSet.has(item.id) || runningExpenseIds.has(item.id)}
                            onPress={(event) => { event.stopPropagation(); void performExpenseAction({ expenseId: item.id, action: "settle", title: "Settle IOU", message: "", label: "Settle" }); }}
                          >
                            {runningExpenseIds.has(item.id) || pendingExpenseSet.has(item.id)
                              ? <ActivityIndicator size="small" color={colors.success} />
                              : <Feather name="check-circle" size={15} color={colors.success} />}

                          </TouchableOpacity>
                        </View>
                      ) : (
                        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                      )}
                    </View>
                  </View>

                  {pendingExpenseSet.has(item.id) || runningExpenseIds.has(item.id) ? (
                    <Text style={[styles.pendingText, { color: colors.mutedForeground }]}>Saving this change…</Text>
                  ) : null}
                  {/* IOU breakdown chips */}
                  <View style={styles.iouChips}>
                    {Object.entries(expenseShares(item)).map(([personId, amount]) => {
                      const person = roommates.find((r) => r.id === personId) ?? {
                        id: personId,
                        name: "Former Sweetmate",
                        color: colors.mutedForeground,
                        points: 0,
                        weeklyPoints: 0,
                      };
                      const isMe = personId === currentUserId;
                      const isOwer = personId !== item.paidBy;
                      const hasPaidBack = !!(item.paidBack ?? {})[personId];
                      const shareResolved = item.settled || hasPaidBack;
                      return (
                        <View
                          key={personId}
                          style={[
                            styles.iouChip,
                            {
                              backgroundColor: shareResolved
                                ? colors.success + "14"
                                : isOwer
                                ? isMe
                                  ? colors.destructive + "14"
                                  : colors.muted
                                : colors.success + "14",
                              borderColor: shareResolved
                                ? colors.success + "50"
                                : isOwer
                                ? isMe
                                  ? colors.destructive + "50"
                                  : colors.border
                                : colors.success + "50",
                            },
                          ]}
                        >
                          {shareResolved ? (
                            <Feather name="check" size={10} color={colors.success} style={{ marginRight: 3 }} />
                          ) : (
                            <View
                              style={[
                                styles.iouDot,
                                { backgroundColor: person.color },
                              ]}
                            />
                          )}
                          <CompletionText
                            completed={isOwer && shareResolved}
                            containerStyle={{ alignSelf: "center" }}
                            style={[
                              styles.iouChipText,
                              {
                                color: shareResolved
                                  ? colors.success
                                  : isOwer
                                  ? isMe
                                    ? colors.destructive
                                    : colors.foreground
                                  : colors.success,
                              },
                            ]}
                          >
                            {isMe ? "You" : person.name}{!isOwer ? ` covered $${amount.toFixed(2)}` : amount <= 0 ? " · no repayment due" : hasPaidBack ? " paid" : item.settled ? " settled" : ` ${isMe ? "owe" : "owes"} $${amount.toFixed(2)}`}
                          </CompletionText>
                        </View>
                      );
                    })}
                  </View>
                  </Surface>
                </TouchableOpacity>
                </CompletionMotion>
              );
            }}
            ListFooterComponent={
              <HistoryDisclosure
                count={historicalExpenses.length}
                expanded={historyExpanded}
                onToggle={() => {
                  setHistoryExpanded((value) => !value);
                  setHistoryPages(1);
                }}
              >
                <View style={{ gap: 10 }}>
                  {visibleHistory.length === 0 ? (
                    <EmptyState
                      icon="archive"
                      title="No past expenses"
                      subtitle="Resolved expenses will appear here after seven days"
                    />
                  ) : (
                    visibleHistory.map((expense) => (
                      <TouchableOpacity
                        key={expense.id}
                        onPress={() => openDetails(expense.id)}
                      >
                        <Surface
                          style={[
                            styles.expenseCard,
                            { borderColor: colors.border },
                          ]}
                        >
                          <View style={styles.expenseCardTop}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.expTitle, { color: colors.foreground }]}>
                                {expense.title}
                              </Text>
                              <Text style={[styles.expMeta, { color: colors.mutedForeground }]}>
                                Resolved {formatDate(expense.resolvedAt ?? expense.date)}
                              </Text>
                            </View>
                            <Text style={[styles.expAmount, { color: colors.foreground }]}>
                              ${expense.amount.toFixed(2)}
                            </Text>
                          </View>
                        </Surface>
                      </TouchableOpacity>
                    ))
                  )}
                  {visibleHistory.length < historicalExpenses.length ? (
                    <TouchableOpacity
                      style={[styles.detailCloseBtn, { backgroundColor: colors.muted }]}
                      onPress={() => setHistoryPages((page) => page + 1)}
                    >
                      <Text style={[styles.detailCloseBtnText, { color: colors.foreground }]}>
                        Load more
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </HistoryDisclosure>
            }
          />
          {/* Details and confirmations share one native modal. */}
          {(() => {
            const detailExp = expenses.find((expense) => expense.id === detailExpenseId);
            if (!detailExp) return null;
            const payer = roommates.find((roommate) => roommate.id === detailExp.paidBy);
            const cat = EXPENSE_CATEGORIES.find((category) => category.key === detailExp.category) ?? EXPENSE_CATEGORIES[4];
            const shares = expenseShares(detailExp);
            const myShare = shares[currentUserId] ?? 0;
            const iAmOwer = detailExp.paidBy !== currentUserId && myShare > 0;
            const alreadyPaidBack = Boolean(detailExp.paidBack?.[currentUserId]);
            const busy = runningExpenseIds.has(detailExp.id) || pendingExpenseSet.has(detailExp.id);
            const disabled = !expenseSync.ready || busy;
            return (
              <Modal visible={detailVisible} transparent animationType={Platform.OS === "ios" ? "slide" : "none"}
                onRequestClose={closeDetails} onDismiss={finishDetailDismiss}>
                <Pressable style={styles.detailOverlay} onPress={closeDetails} accessibilityRole="button" accessibilityLabel="Close expense details" />
                <Surface level="modal" style={[styles.detailSheet, { maxHeight: windowHeight * 0.88, borderColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
                  <View style={[styles.detailHandle, { backgroundColor: colors.border }]} />
                  <ScrollView ref={detailScrollRef} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                    <View style={styles.detailHeader}>
                      <View style={styles.expCatIcon}><Feather name={cat.icon} size={18} color={colors.primary} /></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <CompletionText completed={detailExp.settled} style={[styles.detailTitle, { color: detailExp.settled ? colors.mutedForeground : colors.foreground }]}>{detailExp.title}</CompletionText>
                        <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>Paid by {payer?.name ?? "Former Sweetmate"} · {formatDate(detailExp.date)}</Text>
                      </View>
                      <CompletionText completed={detailExp.settled} style={[styles.detailAmount, { color: detailExp.settled ? colors.mutedForeground : colors.foreground }]}>${detailExp.amount.toFixed(2)}</CompletionText>
                    </View>
                    {!expenseSync.ready ? <InlineFeedback message="Expenses are still loading. Please wait before making changes." /> : null}
                    {busy ? <InlineFeedback message="This change is waiting to finish saving. You can retry it below if needed." /> : null}
                    {actionError ? <InlineFeedback message={actionError} tone="error" /> : null}
                    {(pendingExpenseSet.has(detailExp.id) || expenseSync.error) ? (
                      <TouchableOpacity style={[styles.retryButton, { borderColor: colors.border }]} disabled={retryingExpenses} onPress={() => void retryExpenseSync()} accessibilityRole="button">
                        <Text style={[styles.retryText, { color: colors.primary }]}>{retryingExpenses ? "Retrying…" : "Retry saving"}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {detailConfirmation?.expenseId === detailExp.id ? (
                      <View accessibilityLiveRegion="polite" style={[styles.confirmationPanel, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <Text accessibilityRole="header" style={[styles.detailTitle, { color: colors.foreground }]}>{detailConfirmation.title}</Text>
                        <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>{detailConfirmation.message}</Text>
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          <GlassButton tone="neutral" style={{ flex: 1, minWidth: 100 }} disabled={busy} onPress={() => setDetailConfirmation(null)}><Text style={{ color: colors.foreground }}>Cancel</Text></GlassButton>
                          <GlassButton tone={detailConfirmation.action === "delete" ? "destructive" : "primary"} style={{ flex: 1, minWidth: 130 }} disabled={disabled} onPress={() => void performExpenseAction()}>
                            <Text style={{ color: "#fff" }}>{busy ? "Saving…" : detailConfirmation.label}</Text>
                          </GlassButton>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.detailPayerActions}>
                        {canEditExpense(detailExp) ? (
                          <TouchableOpacity disabled={disabled} accessibilityRole="button" style={[styles.detailActionBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "30", opacity: disabled ? 0.45 : 1 }]}
                            onPress={() => { pendingEditRef.current = detailExp; closeDetails(); }}>
                            <Feather name="edit-2" size={14} color={colors.primary} /><Text style={[styles.detailActionBtnText, { color: colors.primary }]}>Edit</Text>
                          </TouchableOpacity>
                        ) : null}
                        {iAmOwer && alreadyPaidBack && !detailExp.manuallySettled ? (
                          <TouchableOpacity disabled={disabled} accessibilityRole="button" style={[styles.detailActionBtn, { borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]} onPress={() => requestExpenseAction(detailExp, "undo")}>
                            <Feather name="rotate-ccw" size={14} color={colors.primary} /><Text style={[styles.detailActionBtnText, { color: colors.primary }]}>Undo my repayment</Text>
                          </TouchableOpacity>
                        ) : null}
                        {canManageExpense(detailExp) ? <>
                          {!detailExp.settled ? (
                            <TouchableOpacity disabled={disabled} accessibilityRole="button" style={[styles.detailActionBtn, { backgroundColor: colors.success + "14", borderColor: colors.success + "30", opacity: disabled ? 0.45 : 1 }]} onPress={() => requestExpenseAction(detailExp, "settle")}>
                              <Feather name="check-circle" size={14} color={colors.success} /><Text style={[styles.detailActionBtnText, { color: colors.success }]}>Settle all</Text>
                            </TouchableOpacity>
                          ) : detailExp.manuallySettled ? (
                            <TouchableOpacity disabled={disabled} accessibilityRole="button" style={[styles.detailActionBtn, { borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]} onPress={() => requestExpenseAction(detailExp, "reopen")}>
                              <Feather name="rotate-ccw" size={14} color={colors.primary} /><Text style={[styles.detailActionBtnText, { color: colors.primary }]}>Reopen IOU</Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity disabled={disabled} accessibilityRole="button" style={[styles.detailActionBtn, { backgroundColor: colors.destructive + "10", borderColor: colors.destructive + "20", opacity: disabled ? 0.45 : 1 }]} onPress={() => requestExpenseAction(detailExp, "delete")}>
                            <Feather name="trash-2" size={14} color={colors.destructive} /><Text style={[styles.detailActionBtnText, { color: colors.destructive }]}>Delete</Text>
                          </TouchableOpacity>
                        </> : null}
                      </View>
                    )}
                    <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                    {detailExp.shoppingSource ? <Surface style={[styles.detailPersonRow, { borderColor: colors.border }]}>
                      <Feather name="shopping-cart" size={16} color={colors.primary} /><View style={{ flex: 1 }}>
                        <Text style={[styles.detailPersonName, { color: colors.foreground }]}>From Shopping: {detailExp.shoppingSource.shoppingListName}</Text>
                        <Text style={[styles.detailPersonAmount, { color: colors.mutedForeground }]}>{detailExp.shoppingSource.type === "shopping-list" ? `Group split: $${detailExp.amount.toFixed(2)}` : detailExp.shoppingSource.shoppingItemName}</Text>
                      </View>
                    </Surface> : null}
                    {detailExp.notes ? <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>{detailExp.notes}</Text> : null}
                    <Text style={[styles.detailSectionLabel, { color: colors.mutedForeground }]}>Shares and repayments</Text>
                    <View style={{ gap: 8 }}>
                      {Object.entries(shares).map(([personId, amount]) => {
                        const person = roommates.find((roommate) => roommate.id === personId) ?? { id: personId, name: "Former Sweetmate", color: colors.mutedForeground, avatarUri: undefined };
                        const isOwer = personId !== detailExp.paidBy && amount > 0;
                        const hasPaid = Boolean(detailExp.paidBack?.[personId]);
                        const resolved = detailExp.settled || hasPaid;
                        const isMe = personId === currentUserId;
                        return <CompletionMotion key={personId} completed={isMe && isOwer && resolved} subtle style={[styles.detailPersonRow, { backgroundColor: resolved ? colors.success + "0C" : colors.card, borderColor: resolved ? colors.success + "40" : colors.border }]}>
                          <RoommateAvatar name={person.name} color={person.color} size={32} imageUri={person.avatarUri} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.detailPersonName, { color: colors.foreground }]}>{isMe ? "You" : person.name}</Text>
                            <CompletionText completed={isOwer && resolved} style={[styles.detailPersonAmount, { color: resolved || !isOwer ? colors.success : isMe ? colors.destructive : colors.mutedForeground }]}>
                              {personId === detailExp.paidBy ? `Covered $${amount.toFixed(2)}` : amount <= 0 ? "No repayment due" : hasPaid ? `Paid back $${amount.toFixed(2)}` : detailExp.settled ? `Settled $${amount.toFixed(2)}` : `Owes $${amount.toFixed(2)}`}
                            </CompletionText>
                          </View>
                          {isOwer && !resolved && isMe ? (
                            <TouchableOpacity disabled={disabled} accessibilityRole="button" accessibilityLabel={`Record your repayment of $${amount.toFixed(2)}`} style={[styles.detailMarkPaidBtn, { backgroundColor: colors.action, opacity: disabled ? 0.45 : 1 }]} onPress={() => requestExpenseAction(detailExp, "repay")}>
                              <Feather name="check" size={13} color="#fff" /><Text style={styles.detailMarkPaidText}>I paid</Text>
                            </TouchableOpacity>
                          ) : isOwer ? <Text style={[styles.detailPendingText, { color: resolved ? colors.success : colors.mutedForeground }]}>{resolved ? hasPaid ? "Paid" : "Settled" : "Pending"}</Text> : null}
                        </CompletionMotion>;
                      })}
                    </View>
                    {iAmOwer ? <InlineFeedback tone={alreadyPaidBack || detailExp.settled ? "success" : "info"} message={alreadyPaidBack ? "Your repayment is recorded." : detailExp.settled ? "This IOU is settled." : `You owe ${payer?.name ?? "the payer"} $${myShare.toFixed(2)}.`} /> : null}
                  </ScrollView>
                  <TouchableOpacity style={[styles.detailCloseBtn, { backgroundColor: colors.muted }]} onPress={closeDetails} accessibilityRole="button" accessibilityLabel="Close expense details">
                    <Text style={[styles.detailCloseBtnText, { color: colors.foreground }]}>Close</Text>
                  </TouchableOpacity>
                </Surface>
              </Modal>
            );
          })()}
        </>

      <FloatingActionButton
        accessibilityLabel="Add expense"
        onPress={() => {
          resetModal();
          setShowExpenseModal(true);
        }}
      />

      {/* ── New IOU Modal (full-screen; custom spring slide-up, X-button close) ── */}
      <Modal visible={showExpenseModal} transparent animationType="none" onRequestClose={closeIou}>
        <Animated.View
          style={[
            styles.iouContainer,
            {
              backgroundColor: colors.background,
              transform: [{ translateY: iouTranslateY }],
            },
          ]}
        >
          {/* Header: title left, X close button right */}
          <View
            {...iouDragHandlers}
            style={[
              styles.iouHeader,
              { paddingTop: insets.top + 10, borderBottomColor: colors.border },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border, top: insets.top + 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.iouHeaderTitle, { color: colors.foreground }]}>
                {editingExpenseId ? "Edit IOU" : "New IOU"}
              </Text>
              <Text style={[styles.iouHeaderSub, { color: colors.mutedForeground }]}>
                {editingExpenseId ? "Update the details" : "Log a shared expense"}
              </Text>
            </View>
            <TouchableOpacity
              disabled={submittingIou}
              accessibilityRole="button"
              accessibilityLabel="Close expense editor"
              onPress={closeIou}
              style={[styles.iouCloseBtn, { backgroundColor: colors.muted }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Body — keyboard-avoiding scroll with sticky footer */}
          <KeyboardAvoidingView
            behavior={KEYBOARD_BEHAVIOR}
            style={{ flex: 1 }}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.iouBody}
            >
              {financialFieldsLocked ? <InlineFeedback message="A repayment or settlement has been recorded. Amounts, payer, participants, splits, and date are locked. You can still update the title, category, and notes." /> : null}
              {!financialFieldsLocked && editingExpense?.shoppingSource ? <InlineFeedback message="The purchase total is linked to Shopping. The payer and shares can be edited until a repayment is recorded." /> : null}
              {/* Title */}
              <View>
                <Text
                  style={[styles.label, { color: colors.mutedForeground }]}
                >
                  What for?
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="e.g. Groceries run"
                  placeholderTextColor={colors.mutedForeground}
                  editable={!formBusy}
                  value={expTitle}
                  onChangeText={setExpTitle}
                />
              </View>

              {/* Category */}
              <View>
                <Text
                  style={[styles.label, { color: colors.mutedForeground }]}
                >
                  Category
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {EXPENSE_CATEGORIES.map((cat) => {
                    const selected = expCategory === cat.key;
                    return (
                      <TouchableOpacity
                        key={cat.key}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected
                              ? colors.primary + "22"
                              : colors.muted,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                        ]}
                        disabled={formBusy}
                        onPress={() => setExpCategory(cat.key)}
                      >
                        <Feather
                          name={cat.icon}
                          size={12}
                          color={selected ? colors.primary : colors.mutedForeground}
                        />
                        <Text
                          style={{
                            color: selected ? colors.primary : colors.mutedForeground,
                            fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                            fontSize: 12,
                            marginLeft: 4,
                          }}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Paid by */}
              <View>
                <Text
                  style={[styles.label, { color: colors.mutedForeground }]}
                >
                  Who paid?
                </Text>
                <View style={styles.roommateRow}>
                  {roommates.map((r) => (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.roommateChip,
                        {
                          backgroundColor:
                            expPaidBy === r.id ? r.color + "22" : colors.muted,
                          borderColor:
                            expPaidBy === r.id ? r.color : colors.border,
                        },
                      ]}
                      disabled={financialFieldsLocked || formBusy}
                      onPress={() => setExpPaidBy(r.id)}
                    >
                      <RoommateAvatar
                        name={r.name}
                        color={r.color}
                        size={20}
                        imageUri={r.avatarUri}
                      />
                      <Text
                        style={{
                          color:
                            expPaidBy === r.id ? r.color : colors.mutedForeground,
                          fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                          fontSize: 12,
                          marginLeft: 6,
                        }}
                      >
                        {r.id === currentUserId ? "You" : r.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Total amount */}
              <View>
                <Text
                  style={[styles.label, { color: colors.mutedForeground }]}
                >
                  {expenseSource?.type === "shopping-list"
                    ? "Shopping list total"
                    : "Total amount"}
                </Text>
                <View
                  style={[
                    styles.amountInputRow,
                    {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.dollarSign, { color: colors.mutedForeground }]}
                  >
                    $
                  </Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.foreground }]}
                    placeholder="0.00"
                    placeholderTextColor={colors.mutedForeground}
                    editable={!purchaseTotalLocked && !formBusy}
                    value={expTotalAmount}
                    onChangeText={(v) => setExpTotalAmount(v)}
                    keyboardType="decimal-pad"
                  />
                  {totalParsed > 0 && expParticipants.length > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.evenSplitBtn,
                        { backgroundColor: colors.primary + "18" },
                      ]}
                      disabled={financialFieldsLocked || formBusy}
                      onPress={recalcEvenSplit}
                    >
                      <Text
                        style={{
                          color: colors.primary,
                          fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                          fontSize: 12,
                        }}
                      >
                        Split evenly
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {expenseSource ? (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 12,
                      borderRadius: 12,
                      backgroundColor: colors.primary + "0D",
                      borderWidth: 1,
                      borderColor: colors.primary + "25",
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13 }}>
                      From Shopping: {expenseSource.shoppingListName}
                    </Text>
                    {expenseSource.type === "shopping-list" ? (
                      <>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12 }}>
                          Individually allocated: ${centsToDollars(sourceAllocatedCents).toFixed(2)}
                        </Text>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 12 }}>
                          Remaining group split: ${centsToDollars(Math.max(0, allocatableTotalCents ?? 0)).toFixed(2)}
                        </Text>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Notes
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: colors.border,
                      minHeight: 72,
                      textAlignVertical: "top",
                    },
                  ]}
                  multiline
                  placeholder="Add a note"
                  placeholderTextColor={colors.mutedForeground}
                  editable={!formBusy}
                  value={expNotes}
                  onChangeText={setExpNotes}
                />
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Date
                </Text>
                <TextInput
                  accessibilityLabel="Expense date"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.muted,
                      color: colors.foreground,
                      borderColor: validExpenseDate
                        ? colors.border
                        : colors.destructive,
                    },
                  ]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  editable={!financialFieldsLocked && !formBusy}
                  value={expDate}
                  onChangeText={setExpDate}
                  autoCapitalize="none"
                />
                {!validExpenseDate ? (
                  <Text style={{ color: colors.destructive, fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 }}>
                    Enter a valid date as YYYY-MM-DD.
                  </Text>
                ) : null}
              </View>

              {/* Split between */}
              <View>
                <Text
                  style={[styles.label, { color: colors.mutedForeground }]}
                >
                  Split between
                </Text>
                <View style={styles.roommateRow}>
                  {roommates.map((r) => {
                      const selected = expParticipants.includes(r.id);
                      return (
                        <TouchableOpacity
                          key={r.id}
                          style={[
                            styles.roommateChip,
                            {
                              backgroundColor: selected
                                ? r.color + "22"
                                : colors.muted,
                              borderColor: selected ? r.color : colors.border,
                            },
                          ]}
                          disabled={financialFieldsLocked || formBusy}
                          onPress={() => toggleParticipant(r.id)}
                        >
                          <RoommateAvatar
                            name={r.name}
                            color={r.color}
                            size={20}
                            imageUri={r.avatarUri}
                          />
                          <Text
                            style={{
                              color: selected ? r.color : colors.mutedForeground,
                              fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                              fontSize: 12,
                              marginLeft: 6,
                            }}
                          >
                            {r.id === currentUserId ? "You" : r.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </View>

              {editingExpense?.recurring ? <InlineFeedback message="This older IOU keeps its recurring label. Automatic repeat expenses are currently unavailable." /> : null}

              {/* Allocation mode */}
              {expParticipants.length > 0 && totalCents !== null ? (
                <View>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>
                    Split method
                  </Text>
                  <View style={styles.recurringOptions}>
                    {([
                      { value: "equal" as const, label: "Equal" },
                      { value: "exact" as const, label: "Custom amounts" },
                    ]).map((option) => {
                      const selected = allocationMode === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          style={[
                            styles.recurringChip,
                            {
                              backgroundColor: selected ? colors.primary + "22" : colors.muted,
                              borderColor: selected ? colors.primary : colors.border,
                              flex: 1,
                            },
                          ]}
                          disabled={financialFieldsLocked || formBusy}
                          onPress={() => {
                            if (option.value === "equal") recalcEvenSplit();
                            else { setExpSplits(displayedSplits); setAllocationMode("exact"); }
                          }}
                        >
                          <Text style={{
                            color: selected ? colors.primary : colors.mutedForeground,
                            fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                            fontSize: 13,
                          }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Per-person allocation */}
              {expParticipants.length > 0 && (
                <View>
                  <View style={styles.splitHeaderRow}>
                    <Text
                      style={[styles.label, { color: colors.mutedForeground }]}
                    >
                      {allocationMode === "equal" ? "Equal allocation" : "Custom allocation"}
                    </Text>
                    {remainingCents !== 0 && totalParsed > 0 && (
                      <Text
                        style={{
                          color:
                            remainingCents > 0
                              ? colors.warning
                              : colors.destructive,
                          fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                          fontSize: 12,
                        }}
                      >
                        {remainingCents > 0
                          ? `$${centsToDollars(remainingCents).toFixed(2)} left to assign`
                          : `$${centsToDollars(Math.abs(remainingCents)).toFixed(2)} over the expense total`}
                      </Text>
                    )}
                    {splitsValid && (
                      <Text
                        style={{
                          color: colors.success,
                          fontFamily: "Inter_600SemiBold", includeFontPadding: false,
                          fontSize: 12,
                        }}
                      >
                        ✓ Fully allocated
                      </Text>
                    )}
                  </View>

                  <View style={{ gap: 8, marginTop: 4 }}>
                    {expParticipants.map((id) => {
                      const person = roommates.find((r) => r.id === id) ?? { id, name: "Former Sweetmate", color: colors.mutedForeground, avatarUri: undefined };
                      return (
                        <View
                          key={id}
                          style={[
                            styles.splitRow,
                            {
                              backgroundColor: colors.muted,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <RoommateAvatar
                            name={person.name}
                            color={person.color}
                            size={28}
                            imageUri={person.avatarUri}
                          />
                          <Text
                            style={[
                              styles.splitName,
                              { color: colors.foreground },
                            ]}
                            numberOfLines={1}
                          >
                            {id === currentUserId ? "You" : person.name}
                          </Text>
                          <View
                            style={[
                              styles.splitAmountBox,
                              { borderColor: colors.border },
                            ]}
                          >
                            <Text
                              style={[
                                styles.splitDollar,
                                { color: colors.mutedForeground },
                              ]}
                            >
                              $
                            </Text>
                            <TextInput
                              style={[
                                styles.splitInput,
                                { color: colors.foreground },
                              ]}
                              value={displayedSplits[id] ?? ""}
                              onChangeText={(v) => updateSplit(id, v)}
                              editable={allocationMode === "exact" && !financialFieldsLocked && !formBusy}
                              keyboardType="decimal-pad"
                              placeholder="0.00"
                              placeholderTextColor={colors.mutedForeground}
                            />
                          </View>
                          {allocationMode === "exact" && remainingCents > 0 ? (
                            <TouchableOpacity
                              disabled={financialFieldsLocked || formBusy}
                              style={{ minHeight: 44, justifyContent: "center" }}
                              onPress={() => assignRemainder(id)}
                              accessibilityRole="button"
                              accessibilityLabel={`Assign remaining amount to ${person.name}`}
                            >
                              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 11 }}>
                                Remainder
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {!financialFieldsLocked && !allocationValidation.valid ? (
                <InlineFeedback message={allocationValidation.reason ?? "Check the split amounts."} tone="warning" />
              ) : null}
              {iouSubmitError ? <InlineFeedback message={iouSubmitError} tone="error" /> : null}
              {queuedIou || (editingExpenseId && pendingExpenseSet.has(editingExpenseId)) ? (
                <TouchableOpacity accessibilityRole="button" style={[styles.retryButton, { borderColor: colors.border }]} disabled={retryingExpenses} onPress={() => void retryExpenseSync()}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>{retryingExpenses ? "Retrying…" : "Retry saving"}</Text>
                </TouchableOpacity>
              ) : null}

            </ScrollView>

            {/* Sticky footer with the primary action */}
            <View
              style={[
                styles.iouFooter,
                {
                  backgroundColor: colors.background,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 12) + 4,
                },
              ]}
            >
              {formValidationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.validationHint, { color: colors.mutedForeground }]}>{formValidationMessage}</Text> : null}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit, busy: submittingIou }}
                style={[
                  styles.iouSendBtn,
                  { backgroundColor: canSubmit ? colors.action : colors.muted },
                ]}
                disabled={!canSubmit || submittingIou}
                onPress={handleSendIOU}
              >
                <Feather
                  name="send"
                  size={16}
                  color={canSubmit ? "#fff" : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.iouSendBtnText,
                    { color: canSubmit ? "#fff" : colors.mutedForeground },
                  ]}
                >
                  {submittingIou ? "Saving…" : queuedIou || pendingExpenseSet.has(expenseDraftId) ? "Waiting to sync" : editingExpenseId ? "Save Changes" : "Send IOU"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  syncBanner: { marginHorizontal: 16, gap: 8, marginBottom: 10 },
  retryButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 12 },
  retryText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 14 },
  pendingText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12, marginTop: 8 },
  expenseSettleButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  confirmationPanel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  validationHint: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  netSummary: { marginHorizontal: 20, marginBottom: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  netSummaryTitle: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 17 },
  netSummaryHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 14, lineHeight: 18 },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 30, lineHeight: 36 },
  subtitle: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, marginTop: 2 },
  addHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  balanceRow: {
    flexDirection: "column",
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  balanceCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  balanceCardPressable: { flex: 1 },
  balanceCardContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  balanceLabel: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13 },
  balanceAmount: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 34, marginTop: 4 },
  balanceHint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12, marginTop: 2 },
  listContent: { paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  expenseCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  expenseCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  expCatIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  expTitle: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 14, marginBottom: 2 },
  expMeta: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 12 },
  expRight: { alignItems: "flex-end", gap: 6 },
  expAmount: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
  expActions: { flexDirection: "row", gap: 12 },
  iouChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  iouChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    gap: 5,
  },
  iouDot: { width: 7, height: 7, borderRadius: 4 },
  iouChipText: { fontFamily: "Inter_500Medium", includeFontPadding: false, fontSize: 12 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  kvContainer: { justifyContent: "flex-end" },
  // Full-screen variant: KAV fills the screen so the sheet can take the entire viewport.
  kvContainerFull: { flex: 1 },
  iouFullScreen: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
  },
  // Full-screen sheet: no rounded corners (it's the whole page), fills the screen.
  sheetFull: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sheetTall: { maxHeight: "90%" },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
  },
  handleHitArea: {
    paddingTop: 6,
    paddingBottom: 14,
    alignItems: "center",
  },
  sheetTitle: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 20,
    marginBottom: 14,
  },
  label: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular", includeFontPadding: false,
  },
  amountInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  dollarSign: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 22,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    paddingVertical: 8,
  },
  evenSplitBtn: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  chip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  roommateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roommateChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  splitHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 10,
  },
  splitName: {
    flex: 1,
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 14,
  },
  splitAmountBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 90,
  },
  splitDollar: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 14,
    marginRight: 2,
  },
  splitInput: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 15,
    minWidth: 60,
    padding: 0,
  },
  addBtn: {
    borderRadius: 14,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  addBtnText: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 16,
    color: "#fff",
  },
  recurringToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  recurringCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  recurringOptions: {
    flexDirection: "row",
    gap: 8,
  },
  recurringChip: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  expMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  recurringBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recurringBadgeText: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 10,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  detailSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: 20,
    gap: 12,
  },
  detailHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  detailTitle: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 17,
  },
  detailMeta: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
    marginTop: 2,
  },
  detailAmount: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 20,
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  detailSectionLabel: {
    fontFamily: "Inter_500Medium", includeFontPadding: false,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  detailPersonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  detailPersonName: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 14,
  },
  detailPersonAmount: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
    marginTop: 1,
  },
  detailPaidBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailPaidBadgeText: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 12,
  },
  detailMarkPaidBtn: {
    minHeight: 44,
    minWidth: 66,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  detailMarkPaidText: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 12,
    color: "#fff",
  },
  detailPendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  detailPendingText: {
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 12,
  },
  detailMyOweBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  detailMyOweText: {
    flex: 1,
    fontFamily: "Inter_400Regular", includeFontPadding: false,
    fontSize: 13,
    lineHeight: 18,
  },
  detailPayerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  detailActionBtn: {
    flex: 1,
    minWidth: 96,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  detailActionBtnText: {
    fontFamily: "Inter_600SemiBold", includeFontPadding: false,
    fontSize: 13,
  },
  detailCloseBtn: {
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: "center",
    marginTop: 10,
    marginHorizontal: 4,
  },
  detailCloseBtnText: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    fontSize: 18,
    letterSpacing: 0.3,
  },

  // ── New IOU full-screen modal (custom slide-up + X close) ──
  iouContainer: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  iouHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  iouHeaderTitle: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 26 },
  iouHeaderSub: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, marginTop: 2 },
  iouCloseBtn: {
    minWidth: 44,
    minHeight: 44,
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
  iouBody: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 18,
  },
  iouFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iouSendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  iouSendBtnText: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 16 },
});
