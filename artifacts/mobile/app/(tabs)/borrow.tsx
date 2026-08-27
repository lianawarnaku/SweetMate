// grabbing a specific named export from a package
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { FloatingActionButton, useFloatingActionMetrics } from "@/components/FloatingActionButton";
import { HeaderActions } from "@/components/HeaderActions";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import { Surface } from "@/components/Surface";
import { useAppContextSelector, type BorrowItem } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { historyPage, isHistoricalResolution } from "@/lib/resolutionHistory";
import {
  canManageBorrowItem,
  canSaveBorrowDraft,
} from "@/lib/borrowValidation";

function daysBetween(a: string, b: string) {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / 86400000
  );
}

// Due date for borrowing function
function formatDue(dueDate: string) {
  const now = new Date().toISOString();
  const diff = daysBetween(now, dueDate);
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff === -1) return "Due yesterday";
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff}d`;
}

function dateInput(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value: string, endOfDay = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    endOfDay ? 23 : 12,
    endOfDay ? 59 : 0,
  );
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date.toISOString()
    : null;
}

// The borrow screen? How it looks?

export default function BorrowScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { scrollBottomPadding } = useFloatingActionMetrics();
  const {
    borrowItems,
    roommates,
    currentUserId,
    addBorrowItem,
    updateBorrowItem,
    returnBorrowItem,
    deleteBorrowItem,
    isHost,
  } = useAppContextSelector((context) => ({
    borrowItems: context.borrowItems,
    roommates: context.roommates,
    currentUserId: context.currentUserId,
    addBorrowItem: context.addBorrowItem,
    updateBorrowItem: context.updateBorrowItem,
    returnBorrowItem: context.returnBorrowItem,
    deleteBorrowItem: context.deleteBorrowItem,
    isHost: context.isHost,
  }));

  const [showModal, setShowModal] = useState(false);
  // `editingId` = null → modal is in ADD mode. Otherwise the id of the borrow
  // being edited; the same modal UI is reused for both flows.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const [borrowedFrom, setBorrowedFrom] = useState("");
  const [borrowedBy, setBorrowedBy] = useState(currentUserId);
  const [borrowedDate, setBorrowedDate] = useState(() => dateInput());
  const [dueDate, setDueDate] = useState(() => dateInput(7));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savePendingRef = useRef(false);
  const [notes, setNotes] = useState("");
  const [privateEntry, setPrivateEntry] = useState(false);
  // Collapse the "Returned" section into a single tile when there are more
  // than 3 returned items. Tap the tile to expand.
  const [showAllReturned, setShowAllReturned] = useState(false);
  const [historyPages, setHistoryPages] = useState(1);
  const [actionBorrowId, setActionBorrowId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const deletePendingRef = useRef(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;

  const { activeBorrows, returnedBorrows, overdue } = useMemo(() => {
    const history = borrowItems.filter(
      (borrow) =>
        borrow.returned &&
        isHistoricalResolution(borrow.returnedAt),
    );
    const active = borrowItems.filter(
      (borrow) =>
        !borrow.returned ||
        !isHistoricalResolution(borrow.returnedAt),
    );
    return {
      activeBorrows: active,
      returnedBorrows: history,
      overdue: active.filter((borrow) => !borrow.returned && new Date(borrow.dueDate) < new Date()),
    };
  }, [borrowItems]);
  const visibleReturnedBorrows = useMemo(
    () =>
      showAllReturned
        ? historyPage(returnedBorrows, (borrow) => borrow.returnedAt, historyPages)
        : [],
    [historyPages, returnedBorrows, showAllReturned],
  );
  const actionBorrow = actionBorrowId
    ? borrowItems.find((borrow) => borrow.id === actionBorrowId)
    : undefined;
  const canManageActionBorrow = actionBorrow
    ? canManageBorrowItem(actionBorrow, currentUserId, isHost)
    : false;

  const resetForm = () => {
    setItem("");
    setNotes("");
    setBorrowedFrom("");
    setBorrowedBy(currentUserId);
    setBorrowedDate(dateInput());
    setDueDate(dateInput(7));
    setPrivateEntry(false);
    setFormError(null);
    setEditingId(null);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const openEdit = (b: BorrowItem) => {
    setEditingId(b.id);
    setItem(b.item);
    setBorrowedFrom(b.borrowedFrom);
    setBorrowedBy(b.borrowedBy ?? currentUserId);
    setBorrowedDate(new Date(b.borrowedAt).toISOString().slice(0, 10));
    setDueDate(new Date(b.dueDate).toISOString().slice(0, 10));
    setNotes(b.notes ?? "");
    setPrivateEntry(b.visibility === "private");
    setShowModal(true);
  };

  const openBorrowActions = (borrowId: string) => {
    if (
      actionBorrowId &&
      borrowItems.some((entry) => entry.id === actionBorrowId)
    ) return;
    const borrow = borrowItems.find((entry) => entry.id === borrowId);
    if (!borrow || !canManageBorrowItem(borrow, currentUserId, isHost)) return;
    setActionError(null);
    setActionBorrowId(borrowId);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDeleteBorrow = async (borrowId: string) => {
    if (deletePendingRef.current) return;
    deletePendingRef.current = true;
    try {
      const deleted = await deleteBorrowItem(borrowId);
      if (deleted) return;
      setActionError("This borrowing record could not be deleted.");
    } catch {
      setActionError("This borrowing record could not be deleted.");
    } finally {
      deletePendingRef.current = false;
    }
  };

  const handleSave = () => {
    if (savePendingRef.current) return;
    savePendingRef.current = true;
    setSaving(true);
    const borrowedAt = parseDateInput(borrowedDate);
    const due = parseDateInput(dueDate, true);
    if (!item.trim() || !borrowedFrom || !borrowedBy) {
      setFormError("Choose an owner, borrower, and item.");
      savePendingRef.current = false;
      setSaving(false);
      return;
    }
    if (
      !roommates.some((member) => member.id === borrowedFrom) ||
      !roommates.some((member) => member.id === borrowedBy) ||
      !borrowedAt ||
      !due ||
      new Date(due) < new Date(borrowedAt)
    ) {
      setFormError("Enter valid dates and active Sweetmates.");
      savePendingRef.current = false;
      setSaving(false);
      return;
    }
    let saved: boolean;
    if (editingId) {
      saved = updateBorrowItem(editingId, {
        item: item.trim(),
        borrowedFrom,
        borrowedBy,
        borrowedAt,
        dueDate: due,
        notes: notes.trim() || undefined,
        visibility: privateEntry ? "private" : "shared",
      });
    } else {
      saved = Boolean(addBorrowItem({
        item: item.trim(),
        borrowedBy,
        borrowedFrom,
        borrowedAt,
        dueDate: due,
        returned: false,
        notes: notes.trim() || undefined,
        visibility: privateEntry ? "private" : "shared",
      }));
    }
    if (!saved) {
      setFormError("This borrowing record could not be saved.");
      savePendingRef.current = false;
      setSaving(false);
      return;
    }
    closeModal();
    savePendingRef.current = false;
    setSaving(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleReturn = (id: string) => {
    returnBorrowItem(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
          <Text style={[styles.title, { color: colors.foreground }]}>
            Borrowing
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Track shared items between Sweetmates
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <HeaderActions />
        </View>
      </View>

      {overdue.length > 0 ? (
        <View
          style={[
            styles.overdueAlert,
            {
              backgroundColor: colors.warning + "12",
              borderColor: colors.warning + "44",
            },
          ]}
        >
          <Feather name="alert-circle" size={16} color={colors.warning} />
          <Text style={[styles.overdueText, { color: colors.warning }]}>
            {overdue.length} item{overdue.length > 1 ? "s" : ""} overdue — time to return!
          </Text>
        </View>
      ) : null}
      {actionError ? (
        <View
          accessibilityLiveRegion="assertive"
          style={[
            styles.actionError,
            {
              backgroundColor: colors.destructive + "12",
              borderColor: colors.destructive + "44",
            },
          ]}
        >
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text style={[styles.overdueText, { color: colors.destructive }]}>
            {actionError}
          </Text>
        </View>
      ) : null}

      <FlatList
        // When there are >3 returned items and the section is collapsed, hide
        // the returned items from the list — the ListFooterComponent below
        // renders a single "Returned (N)" tile instead.
        data={[
          ...activeBorrows,
          ...visibleReturnedBorrows,
        ]}
        keyExtractor={(b) => b.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Math.max(scrollBottomPadding, 90 + botPad) },
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          returnedBorrows.length > 0 && !showAllReturned && activeBorrows.length === 0 ? null : (
            <EmptyState
              icon="repeat"
            title="Nothing borrowed"
            subtitle="Track an item between any two Sweetmates"
            />
          )
        }
        ListHeaderComponent={
          activeBorrows.length > 0 ? (
            <Text
              style={[
                styles.sectionHeader,
                { color: colors.mutedForeground },
              ]}
            >
              Active ({activeBorrows.length})
            </Text>
          ) : null
        }
        ListFooterComponent={
          !showAllReturned ? (
            <TouchableOpacity
              style={[
                styles.returnedTile,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              accessibilityRole="button"
              accessibilityState={{ expanded: false }}
              accessibilityLabel={`History, ${returnedBorrows.length} records`}
              onPress={() => {
                setHistoryPages(1);
                setShowAllReturned(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.returnedTileIcon, { backgroundColor: colors.success + "18" }]}>
                <Feather name="check-circle" size={16} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.returnedTileTitle, { color: colors.foreground }]}>
                  History ({returnedBorrows.length})
                </Text>
                <Text style={[styles.returnedTileSub, { color: colors.mutedForeground }]}>
                  Tap to expand
                </Text>
              </View>
              <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : (
            <View style={styles.historyFooter}>
              {returnedBorrows.length === 0 ? (
                <EmptyState
                  icon="archive"
                  title="No borrowing history"
                  subtitle="Returned items move here after seven days"
                />
              ) : null}
              {visibleReturnedBorrows.length < returnedBorrows.length ? (
                <TouchableOpacity
                  style={[styles.hideReturnedBtn, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Load more borrowing history"
                  onPress={() => setHistoryPages((page) => page + 1)}
                  activeOpacity={0.7}
                >
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={[styles.hideReturnedText, { color: colors.primary }]}>
                    Load more
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.hideReturnedBtn, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: true }}
                accessibilityLabel={`History, ${returnedBorrows.length} records`}
                onPress={() => setShowAllReturned(false)}
                activeOpacity={0.7}
              >
                <Feather name="chevron-up" size={14} color={colors.mutedForeground} />
                <Text style={[styles.hideReturnedText, { color: colors.mutedForeground }]}>
                  Hide history
                </Text>
              </TouchableOpacity>
            </View>
          )
        }
        renderItem={({ item: borrow, index }) => {
          const showReturnedHeader =
            returnedBorrows.length > 0 &&
            index === activeBorrows.length &&
            returnedBorrows.length > 0;
          const owner = roommates.find((r) => r.id === borrow.borrowedFrom);
          const borrower = roommates.find((r) => r.id === borrow.borrowedBy);
          const ownerName = owner?.name ?? borrow.ownerName ?? "Former Sweetmate";
          const borrowerName = borrower?.name ?? borrow.borrowerName ?? "Former Sweetmate";
          const isSelfBorrow = borrow.borrowedFrom === borrow.borrowedBy;
          const isOverdueItem =
            !borrow.returned && new Date(borrow.dueDate) < new Date();
          const dueText = borrow.returned
            ? `Returned ${new Date(borrow.returnedAt ?? "").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : formatDue(borrow.dueDate);
          const isOwner = borrow.borrowedFrom === currentUserId;
          const isBorrower = borrow.borrowedBy === currentUserId;
          const isPrivate = borrow.visibility === "private";
          const canManage = canManageBorrowItem(
            borrow,
            currentUserId,
            isHost,
          );
          const canUndoReturn = borrow.returned && (isPrivate || isOwner || isHost);
          const canConfirmReturn =
            !borrow.returned &&
            Boolean(borrow.returnRequestedAt) &&
            (isPrivate || isOwner || isHost);
          const canRequestReturn =
            !borrow.returned &&
            !borrow.returnRequestedAt &&
            (isPrivate || isBorrower || isOwner || isHost);
          const showReturnAction =
            canUndoReturn || canConfirmReturn || canRequestReturn || (isBorrower && Boolean(borrow.returnRequestedAt));
          const returnActionDisabled =
            !isPrivate &&
            isBorrower &&
            !isOwner &&
            !isHost &&
            Boolean(borrow.returnRequestedAt);
          const returnLabel = borrow.returned
            ? "Undo"
            : canConfirmReturn
              ? "Confirm"
              : borrow.returnRequestedAt
                ? "Awaiting owner"
                : isPrivate || isOwner || isHost
                  ? "Mark returned"
                  : "Request return";

          return (
            <>
              {showReturnedHeader ? (
                <Text
                  style={[
                    styles.sectionHeader,
                    {
                      color: colors.mutedForeground,
                      marginTop: 16,
                    },
                  ]}
                >
                  History ({returnedBorrows.length})
                </Text>
              ) : null}
              <Surface
                style={[
                  styles.borrowCard,
                  {
                    borderColor: isOverdueItem
                      ? colors.warning + "55"
                      : borrow.returned
                      ? colors.border
                      : colors.border,
                    opacity: borrow.returned ? 0.65 : 1,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.cardContent}
                  activeOpacity={canManage ? 0.7 : 1}
                  delayLongPress={450}
                  onLongPress={
                    canManage
                      ? () => openBorrowActions(borrow.id)
                      : undefined
                  }
                  accessible
                  accessibilityRole={canManage ? "button" : undefined}
                  accessibilityLabel={`${borrow.item}. ${borrowerName} borrowed from ${ownerName}. ${dueText}`}
                  accessibilityHint={
                    canManage
                      ? "Long press for Edit and Delete actions"
                      : undefined
                  }
                  accessibilityActions={
                    canManage
                      ? [{ name: "activate", label: "More actions" }]
                      : undefined
                  }
                  onAccessibilityAction={
                    canManage
                      ? (event) => {
                          if (event.nativeEvent.actionName === "activate") {
                            openBorrowActions(borrow.id);
                          }
                        }
                      : undefined
                  }
                >
                  <Text
                    style={[
                      styles.borrowItemName,
                      {
                        color: borrow.returned
                          ? colors.mutedForeground
                          : colors.foreground,
                        textDecorationLine: borrow.returned
                          ? "line-through"
                          : "none",
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {borrow.item}
                  </Text>
                  {isPrivate ? (
                    <View
                      style={[styles.privateBadge, { backgroundColor: colors.primary + "12" }]}
                      accessibilityLabel="Private entry. Only you can see this record."
                    >
                      <Feather name="lock" size={11} color={colors.primary} />
                      <Text style={[styles.privateBadgeText, { color: colors.primary }]}>
                        Private
                      </Text>
                    </View>
                  ) : null}
                  {isSelfBorrow ? (
                    <Text
                      style={[styles.ownerText, { color: colors.mutedForeground }]}
                      accessibilityLabel={`Owner and borrower: ${isOwner ? "You" : ownerName}`}
                    >
                      {isOwner ? "Borrowing from yourself" : `Self-borrow · ${ownerName}`}
                    </Text>
                  ) : owner ? (
                    <View style={styles.ownerRow}>
                      <RoommateAvatar
                        name={owner.name}
                        color={owner.color}
                        size={18}
                        imageUri={owner.avatarUri}
                      />
                      <Text
                        style={[
                          styles.ownerText,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {borrowerName} borrowed from {ownerName}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.ownerText, { color: colors.mutedForeground }]}>
                      {borrowerName} borrowed from {ownerName}
                    </Text>
                  )}
                  {borrow.notes ? (
                    <Text
                      style={[styles.notesText, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {borrow.notes}
                    </Text>
                  ) : null}
                  <Text
                    style={[
                      styles.dueText,
                      {
                        color: borrow.returned
                          ? colors.success
                          : isOverdueItem
                          ? colors.warning
                          : colors.mutedForeground,
                        fontFamily: isOverdueItem
                          ? "Inter_600SemiBold"
                          : "Inter_400Regular",
                      },
                    ]}
                  >
                    {dueText}
                  </Text>
                </TouchableOpacity>

                {showReturnAction ? (
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[
                      styles.returnBtn,
                      borrow.returned
                        ? { backgroundColor: colors.muted, borderColor: colors.border }
                        : { backgroundColor: colors.success + "18", borderColor: colors.success + "44" },
                    ]}
                    onPress={() => handleReturn(borrow.id)}
                    disabled={returnActionDisabled}
                  >
                    <Feather
                      name={borrow.returned ? "rotate-ccw" : "check"}
                      size={14}
                      color={borrow.returned ? colors.mutedForeground : colors.success}
                    />
                    <Text
                      style={[
                        styles.returnBtnText,
                        { color: borrow.returned ? colors.mutedForeground : colors.success },
                      ]}
                    >
                      {returnLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
                ) : null}
              </Surface>
            </>
          );
        }}
      />

      <FloatingActionButton
        accessibilityLabel="Add borrowed item"
        onPress={() => setShowModal(true)}
      />

      <ActionMenuModal
        visible={Boolean(actionBorrow && canManageActionBorrow)}
        title={actionBorrow?.item ?? "Borrowing record"}
        subtitle="Manage this borrowing record"
        onClose={() => setActionBorrowId(null)}
        actions={
          actionBorrow && canManageActionBorrow
            ? [
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit-2",
                  onPress: () => openEdit(actionBorrow),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "trash-2",
                  destructive: true,
                  confirmation: {
                    title: `Delete “${actionBorrow.item}”?`,
                    message: "This permanently removes the borrowing record.",
                    confirmLabel: "Delete",
                  },
                  onPress: () => {
                    void handleDeleteBorrow(actionBorrow.id);
                  },
                },
              ]
            : []
        }
      />

      <Modal visible={showModal} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setShowModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
        <Surface
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetContent}
          >
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            {editingId ? "Edit Borrowing Record" : "Log Borrowing Transaction"}
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Item
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.secondary,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            placeholder="e.g. Phone charger"
            placeholderTextColor={colors.mutedForeground}
            value={item}
            onChangeText={setItem}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Owner
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {roommates.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.roommateChip,
                    {
                      backgroundColor:
                        borrowedFrom === r.id ? r.color + "22" : colors.secondary,
                      borderColor:
                        borrowedFrom === r.id ? r.color : colors.border,
                    },
                  ]}
                  onPress={() => setBorrowedFrom(r.id)}
                >
                  <RoommateAvatar name={r.name} color={r.color} size={22} imageUri={r.avatarUri} />
                  <Text
                    style={{
                      color:
                        borrowedFrom === r.id ? r.color : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {r.name}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Borrower
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {roommates.map((r) => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.roommateChip,
                  {
                    backgroundColor:
                      borrowedBy === r.id ? r.color + "22" : colors.secondary,
                    borderColor:
                      borrowedBy === r.id ? r.color : colors.border,
                  },
                ]}
                onPress={() => setBorrowedBy(r.id)}
              >
                <RoommateAvatar name={r.name} color={r.color} size={22} imageUri={r.avatarUri} />
                <Text
                  style={{
                    color: borrowedBy === r.id ? r.color : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {r.id === currentUserId ? `${r.name} (You)` : r.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Borrowed date</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
                value={borrowedDate}
                onChangeText={setBorrowedDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Due date</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Notes (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.secondary,
                color: colors.foreground,
                borderColor: colors.border,
              },
            ]}
            placeholder="Any details..."
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
          />

          <View
            style={[
              styles.privacyRow,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <View style={[styles.privacyIcon, { backgroundColor: colors.primary + "14" }]}>
              <Feather name="lock" size={17} color={colors.primary} />
            </View>
            <View style={styles.privacyCopy}>
              <Text style={[styles.privacyTitle, { color: colors.foreground }]}>
                Private entry
              </Text>
              <Text style={[styles.privacyDescription, { color: colors.mutedForeground }]}>
                {editingId
                  ? "Visibility is fixed after an entry is created."
                  : "Only you can see this in your personal borrowing log."}
              </Text>
            </View>
            <Switch
              value={privateEntry}
              onValueChange={setPrivateEntry}
              disabled={editingId !== null}
              trackColor={{ false: colors.border, true: colors.primary }}
              accessibilityLabel="Private entry"
              accessibilityHint="When enabled, only you can retrieve and view this borrowing entry"
            />
          </View>

          {formError && (
            <Text style={[styles.notesText, { color: colors.destructive }]}>
              {formError}
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.saveBtn,
              {
                backgroundColor: canSaveBorrowDraft({
                  item,
                  ownerId: borrowedFrom,
                  borrowerId: borrowedBy,
                  householdMemberIds: roommates.map((member) => member.id),
                }) && !saving
                  ? colors.primary
                  : colors.muted,
              },
            ]}
            disabled={
              saving ||
              !canSaveBorrowDraft({
                item,
                ownerId: borrowedFrom,
                borrowerId: borrowedBy,
                householdMemberIds: roommates.map((member) => member.id),
              })
            }
            onPress={handleSave}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
          </ScrollView>
        </Surface>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dateRow: { flexDirection: "row", gap: 10 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  overdueAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  overdueText: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
  actionError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  list: { paddingHorizontal: 16, gap: 12 },
  sectionHeader: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  borrowCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
  },
  cardContent: { flex: 1, gap: 3 },
  borrowItemName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  privateBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  privateBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  ownerText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  notesText: { fontFamily: "Inter_400Regular", fontSize: 12, fontStyle: "italic" },
  dueText: { fontSize: 12, marginTop: 2 },
  cardActions: { alignItems: "flex-end", gap: 8 },
  returnBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  returnBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingTop: 12,
    gap: 4,
    maxHeight: "92%",
  },
  sheetContent: { paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 20, marginBottom: 12 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 8, marginBottom: 6 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  roommateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  privacyRow: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  privacyIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyCopy: { flex: 1, minWidth: 0 },
  privacyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  privacyDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  dueChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  saveBtn: { marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },

  // ── Collapsed "Returned" section ──
  returnedTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  returnedTileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  returnedTileTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  returnedTileSub: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  historyFooter: { gap: 8 },
  hideReturnedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    marginTop: 12,
  },
  hideReturnedText: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
