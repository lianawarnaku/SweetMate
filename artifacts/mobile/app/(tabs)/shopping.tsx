import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
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
import type { RenderItemParams } from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Surface } from "@/components/Surface";
import { GlassCheckCircle } from "@/components/GlassCheckCircle";
import { ActionMenuModal } from "@/components/ActionMenuModal";
import { FloatingActionButton, useFloatingActionMetrics } from "@/components/FloatingActionButton";
import {
  DraggableListCompat,
  DraggableScrollContainerCompat,
  ScaleDecoratorCompat,
} from "@/components/DraggableListCompat";
import { ScreenHeader } from "@/components/ScreenHeader";
import { RoommateAvatar } from "@/components/RoommateAvatar";
import {
  useAppContextSelector,
  type ShoppingItem,
  type ShoppingList,
} from "@/context/AppContext";

// Normalize the possibly-legacy `assignedTo` field on a shopping item to an
// array. Old data may have stored a single string; new data uses string[].
function normalizeAssignees(item: ShoppingItem): string[] {
  const a = item.assignedTo;
  if (Array.isArray(a)) return a;
  if (typeof a === "string") return [a];
  return [];
}
import { useTheme } from "@/constants/colors";
import { tapLight } from "@/lib/haptics";
import { localDateKey } from "@/lib/calendarItems";
import { buildEvenSplitCents, centsToDollars } from "@/lib/money";
import {
  linkedItemAllocations,
  pricedListTotalCents,
  remainingListExpenseCents,
} from "@/lib/shoppingExpense";

export default function ShoppingScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { scrollBottomPadding } = useFloatingActionMetrics();
  const {
    roommates,
    shoppingLists,
    shoppingItems,
    addShoppingList,
    deleteShoppingList,
    reorderShoppingLists,
    pinShoppingList,
    addShoppingItem,
    toggleShoppingItem,
    deleteShoppingItem,
    reorderShoppingItems,
    assignShoppingList,
    expenses,
    setPendingIouDraft,
    currentUserId,
    householdId,
  } = useAppContextSelector((context) => ({
    roommates: context.roommates,
    shoppingLists: context.shoppingLists,
    shoppingItems: context.shoppingItems,
    addShoppingList: context.addShoppingList,
    deleteShoppingList: context.deleteShoppingList,
    reorderShoppingLists: context.reorderShoppingLists,
    pinShoppingList: context.pinShoppingList,
    addShoppingItem: context.addShoppingItem,
    toggleShoppingItem: context.toggleShoppingItem,
    deleteShoppingItem: context.deleteShoppingItem,
    reorderShoppingItems: context.reorderShoppingItems,
    assignShoppingList: context.assignShoppingList,
    expenses: context.expenses,
    setPendingIouDraft: context.setPendingIouDraft,
    currentUserId: context.currentUserId,
    householdId: context.householdId,
  }));

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;

  const [shopName, setShopName] = useState("");
  const [shopQty, setShopQty] = useState("1");
  const [shopNeededBy, setShopNeededBy] = useState("");
  const [targetListId, setTargetListId] = useState<string | null>(null);
  const [showShoppingModal, setShowShoppingModal] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListDate, setNewListDate] = useState("");
  const [collapsedLists, setCollapsedLists] = useState<Set<string>>(new Set());
  const [assignPickerListId, setAssignPickerListId] = useState<string | null>(null);
  const [actionListId, setActionListId] = useState<string | null>(null);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const completedLongPressRef = useRef<string | null>(null);

  const inputStyle = (field: string) => [
    styles.input,
    {
      backgroundColor: colors.muted,
      color: colors.foreground,
      borderColor: focusedInput === field ? colors.primary : colors.border,
      borderWidth: focusedInput === field ? 2 : 1,
    },
  ];

  const toggleListCollapse = (id: string) => {
    setCollapsedLists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddShopItem = () => {
    if (!shopName.trim() || !targetListId) return;
    addShoppingItem({
      name: shopName.trim(),
      quantity: shopQty.trim() || "1",
      addedBy: currentUserId,
      completed: false,
      listId: targetListId,
      neededByDate: /^\d{4}-\d{2}-\d{2}$/.test(shopNeededBy.trim()) ? shopNeededBy.trim() : undefined,
    });
    setShopName("");
    setShopQty("1");
    setShopNeededBy("");
    setShowShoppingModal(false);
    setTargetListId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddList = () => {
    if (!newListName.trim()) return;
    addShoppingList(
      newListName.trim(),
      /^\d{4}-\d{2}-\d{2}$/.test(newListDate.trim()) ? newListDate.trim() : undefined,
    );
    setNewListName("");
    setNewListDate("");
    setShowNewListModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const pickerList = assignPickerListId
    ? shoppingLists.find((l) => l.id === assignPickerListId)
    : null;
  const actionList = actionListId
    ? shoppingLists.find((list) => list.id === actionListId)
    : null;
  const actionItem = actionItemId
    ? shoppingItems.find((item) => item.id === actionItemId)
    : null;

  const openListActions = (listId: string) => {
    completedLongPressRef.current = listId;
    setActionListId(listId);
    tapLight();
    setTimeout(() => {
      if (completedLongPressRef.current === listId) {
        completedLongPressRef.current = null;
      }
    }, 700);
  };

  const handleListHeaderPress = (listId: string) => {
    if (completedLongPressRef.current === listId) {
      completedLongPressRef.current = null;
      return;
    }
    toggleListCollapse(listId);
  };

  const openItemActions = (itemId: string) => {
    setActionListId(null);
    setActionItemId(itemId);
    tapLight();
  };

  // `shoppingLists` is already in display order — pinned first, then unpinned,
  // maintained by the mutators in AppContext. No per-render sort so the array
  // reference passed to DraggableFlatList stays stable outside of explicit
  // user actions.

  const handleDragEnd = ({ data }: { data: ShoppingList[] }) => {
    reorderShoppingLists(data.map((l) => l.id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleItemDragEnd = (listId: string, data: ShoppingItem[]) => {
    reorderShoppingItems(listId, data.map((i) => i.id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // Sort a list's items so checked items float to the bottom while preserving
  // the user-defined order within each partition. Displayed order is stored
  // order after any drag (`reorderShoppingItems` enforces the same invariant).
  const sortItemsCheckedLast = (items: ShoppingItem[]): ShoppingItem[] => {
    const unchecked: ShoppingItem[] = [];
    const checked: ShoppingItem[] = [];
    items.forEach((s) => (s.completed ? checked.push(s) : unchecked.push(s)));
    return [...unchecked, ...checked];
  };

  const activeMemberIds = useMemo(
    () => roommates.map((roommate) => roommate.id),
    [roommates],
  );

  const shoppingProgress = useMemo(() => {
    const completed = shoppingItems.filter((item) => item.completed).length;
    const total = shoppingItems.length;
    return {
      completed,
      remaining: total - completed,
      total,
      percent: total > 0 ? completed / total : 0,
    };
  }, [shoppingItems]);

  const openExpenseDraft = (draft: Parameters<typeof setPendingIouDraft>[0]) => {
    if (!draft) return;
    setPendingIouDraft(draft);
    setActionListId(null);
    setActionItemId(null);
    router.navigate("/(tabs)/expenses");
  };

  const createItemExpenseDraft = (itemId: string) => {
    if (!householdId) throw new Error("Your Sweet is still loading.");
    const item = shoppingItems.find((entry) => entry.id === itemId);
    if (!item) throw new Error("This Shopping item is no longer available.");
    if (
      item.convertedExpenseId &&
      expenses.some(
        (expense) =>
          expense.id === item.convertedExpenseId && !expense.settled,
      )
    ) {
      throw new Error("This item already has an expense.");
    }
    const list = shoppingLists.find((entry) => entry.id === item.listId);
    if (!list) throw new Error("This Shopping list is no longer available.");
    const participantIds = normalizeAssignees(item).filter((id) =>
      activeMemberIds.includes(id),
    );
    const participants = participantIds.length ? participantIds : activeMemberIds;
    const priceCents =
      item.price === undefined ? null : Math.round(item.price * 100);
    const splitCents =
      priceCents && participants.length
        ? buildEvenSplitCents(priceCents, participants)
        : {};
    openExpenseDraft({
      title: `Shopping: ${item.name}`,
      category: "groceries",
      paidBy: currentUserId,
      totalAmount: priceCents ? centsToDollars(priceCents).toFixed(2) : "",
      participants,
      splits: Object.fromEntries(
        Object.entries(splitCents).map(([id, cents]) => [
          id,
          centsToDollars(cents).toFixed(2),
        ]),
      ),
      notes: `Created from “${list.name}” in Shopping.`,
      date: localDateKey(new Date()),
      source: {
        type: "shopping-item",
        householdId,
        shoppingListId: list.id,
        shoppingListName: list.name,
        shoppingItemIds: [item.id],
        shoppingItemName: item.name,
      },
    });
  };

  const createListExpenseDraft = (listId: string) => {
    if (!householdId) throw new Error("Your Sweet is still loading.");
    const list = shoppingLists.find((entry) => entry.id === listId);
    if (!list) throw new Error("This Shopping list is no longer available.");
    const allocations = linkedItemAllocations(listId, shoppingItems, expenses);
    const allocatedCents = allocations.reduce(
      (total, allocation) => total + allocation.amountCents,
      0,
    );
    const knownListTotalCents = pricedListTotalCents(listId, shoppingItems);
    const remainingCents = remainingListExpenseCents(
      knownListTotalCents,
      allocations,
    );
    const participants = activeMemberIds;
    const splitCents =
      remainingCents && participants.length
        ? buildEvenSplitCents(remainingCents, participants)
        : {};
    openExpenseDraft({
      title: `Shopping: ${list.name}`,
      category: "groceries",
      paidBy:
        list.assignedTo && activeMemberIds.includes(list.assignedTo)
          ? list.assignedTo
          : currentUserId,
      totalAmount:
        knownListTotalCents > 0
          ? centsToDollars(knownListTotalCents).toFixed(2)
          : "",
      participants,
      splits: Object.fromEntries(
        Object.entries(splitCents).map(([id, cents]) => [
          id,
          centsToDollars(cents).toFixed(2),
        ]),
      ),
      notes:
        "This expense covers the remaining Shopping-list total after individual item expenses were accounted for.",
      date: localDateKey(new Date()),
      source: {
        type: "shopping-list",
        householdId,
        shoppingListId: list.id,
        shoppingListName: list.name,
        shoppingItemIds: shoppingItems
          .filter((item) => item.listId === list.id)
          .map((item) => item.id),
        listTotalCents: knownListTotalCents || undefined,
        individuallyAllocatedCents: allocatedCents,
        individualAllocations: allocations,
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Shopping"
        subtitle="See what your household still needs"
        topPadding={topPad + 16}
      />

      {/* At-a-glance progress */}
      {shoppingLists.length > 0 && (
        <View style={styles.summaryRow}>
          <Surface style={[styles.summaryCard, { borderColor: colors.border }]}>
            <View style={styles.summaryTopRow}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="shopping-cart" size={15} color={colors.primary} />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
                  {shoppingProgress.remaining === 0 ? "You’re all caught up" : `${shoppingProgress.remaining} still needed`}
                </Text>
                <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
                  {shoppingProgress.completed} of {shoppingProgress.total} items picked up · {shoppingLists.length} {shoppingLists.length === 1 ? "list" : "lists"}
                </Text>
              </View>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.border + "70" }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.round(shoppingProgress.percent * 100)}%`,
                  },
                ]}
              />
            </View>
          </Surface>
        </View>
      )}

      {/* Shopping lists */}
      {shoppingLists.length === 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 40, paddingBottom: scrollBottomPadding }}>
          <EmptyState
            icon="shopping-cart"
            title="No lists yet"
            subtitle="Tap + to create your first shopping list"
          />
        </View>
      ) : (
        <DraggableScrollContainerCompat
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(scrollBottomPadding, 90 + botPad) },
          ]}
        >
        <DraggableListCompat
          data={shoppingLists}
          keyExtractor={(l) => l.id}
          onDragEnd={handleDragEnd}
          activationDistance={14}
          renderItem={({ item: list, drag, isActive }: RenderItemParams<ShoppingList>) => {
            const items = sortItemsCheckedLast(shoppingItems.filter((s) => s.listId === list.id));
            const collapsed = collapsedLists.has(list.id);
            const doneCount = items.filter((i) => i.completed).length;
            const listAssignee = list.assignedTo
              ? roommates.find((r) => r.id === list.assignedTo)
              : null;
            return (
              <ScaleDecoratorCompat>
                <Surface
                  style={[
                    styles.listSection,
                    {
                      borderColor: list.pinned ? colors.warning + "55" : colors.border,
                      opacity: isActive ? 0.9 : 1,
                    },
                  ]}
                >
                  {/* Tap to collapse; hold to reveal list actions. */}
                  <TouchableOpacity
                    style={styles.listHeader}
                    onPress={() => handleListHeaderPress(list.id)}
                    onLongPress={() => openListActions(list.id)}
                    delayLongPress={450}
                    activeOpacity={0.7}
                    disabled={isActive}
                    accessibilityRole="button"
                    accessibilityLabel={`${list.name}, ${items.length - doneCount} items remaining`}
                    accessibilityState={{ expanded: !collapsed }}
                    accessibilityHint="Tap to expand or collapse. Press and hold for pin and delete actions."
                  >
                    <TouchableOpacity
                      onLongPress={drag}
                      delayLongPress={220}
                      disabled={isActive}
                      accessibilityRole="button"
                      accessibilityLabel={`Reorder ${list.name}`}
                      accessibilityHint="Press and hold, then drag to reorder this list"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.dragHandle}
                    >
                      <Feather name="menu" size={17} color={colors.mutedForeground} />
                    </TouchableOpacity>
                    <Feather
                      name={collapsed ? "chevron-right" : "chevron-down"}
                      size={18}
                      color={colors.mutedForeground}
                    />
                    <Text style={[styles.listName, { color: colors.foreground }]} numberOfLines={1}>
                      {list.name}
                    </Text>
                  <Text style={[styles.listCount, { color: colors.mutedForeground }]}>
                    {items.length - doneCount}/{items.length}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setAssignPickerListId(list.id)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={styles.assignBtn}
                    accessibilityRole="button"
                    accessibilityLabel={listAssignee ? `Assigned to ${listAssignee.id === currentUserId ? "you" : listAssignee.name}` : `Assign ${list.name}`}
                    accessibilityHint="Choose who is responsible for this list"
                  >
                    {listAssignee ? (
                      listAssignee.id === currentUserId ? (
                        <Text style={[styles.inlineYou, { color: colors.foreground }]}>You</Text>
                      ) : (
                        <View style={[styles.assignedPill, { backgroundColor: listAssignee.color + "22", borderColor: listAssignee.color + "55" }]}>
                          <View style={[styles.pillDot, { backgroundColor: listAssignee.color }]} />
                          <Text style={[styles.pillText, { color: listAssignee.color }]}>
                            {listAssignee.name}
                          </Text>
                        </View>
                      )
                    ) : (
                      <View style={[styles.assignGhost, { borderColor: colors.border }]}>
                        <Feather name="user-plus" size={12} color={colors.mutedForeground} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.listAddBtn, { backgroundColor: colors.primary + "18" }]}
                    onPress={() => {
                      setTargetListId(list.id);
                      setShowShoppingModal(true);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add item to ${list.name}`}
                  >
                    <Feather name="plus" size={15} color={colors.primary} />
                  </TouchableOpacity>
                  {list.pinned ? (
                    <Ionicons
                      name="pin"
                      size={16}
                      color={colors.warning}
                      accessibilityLabel="Pinned list"
                    />
                  ) : null}
                </TouchableOpacity>

                {/* Items — long-press to drag within the list. Checked items
                    are always sorted to the bottom (enforced by the reorder
                    mutator, so within-partition drag orders are preserved). */}
                {!collapsed && (
                  <View style={styles.listItems}>
                    {items.length === 0 ? (
                      <Text style={[styles.listEmpty, { color: colors.mutedForeground }]}>
                        No items yet — tap + to add
                      </Text>
                    ) : (
                      <DraggableListCompat
                        data={items}
                        keyExtractor={(item) => item.id}
                        onDragEnd={({ data }) => handleItemDragEnd(list.id, data)}
                        activationDistance={14}
                        renderItem={({ item, drag, isActive }: RenderItemParams<ShoppingItem>) => {
                          const assigneeIds = normalizeAssignees(item);
                          const itemAssignees = assigneeIds
                            .map((id) => roommates.find((r) => r.id === id))
                            .filter((r): r is NonNullable<typeof r> => !!r);
                          const primaryColor = itemAssignees[0]?.color;
                          const assigneeLabel =
                            itemAssignees.length === 0
                              ? ""
                              : itemAssignees.length === 1
                              ? itemAssignees[0].id === currentUserId
                                ? "you"
                                : itemAssignees[0].name
                              : `${itemAssignees.length} people`;
                          return (
                            <ScaleDecoratorCompat>
                              <TouchableOpacity
                                activeOpacity={1}
                                onLongPress={() => openItemActions(item.id)}
                                delayLongPress={450}
                                disabled={isActive}
                                accessibilityRole="button"
                                accessibilityLabel={item.name}
                                accessibilityHint="Press and hold for Shopping item actions"
                                style={[
                                  styles.shopItem,
                                  {
                                    borderTopColor: colors.border,
                                    opacity: item.completed ? 0.55 : isActive ? 0.9 : 1,
                                    backgroundColor: isActive ? colors.muted : "transparent",
                                  },
                                ]}
                              >
                                <TouchableOpacity
                                  onLongPress={drag}
                                  delayLongPress={220}
                                  disabled={isActive}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Reorder ${item.name}`}
                                  style={styles.dragHandle}
                                >
                                  <Feather name="menu" size={15} color={colors.mutedForeground} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.shopCheck}
                                  onPress={() => {
                                    toggleShoppingItem(item.id);
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                  }}
                                  accessibilityRole="checkbox"
                                  accessibilityState={{ checked: item.completed }}
                                  accessibilityLabel={`${item.completed ? "Mark needed" : "Mark purchased"}: ${item.name}`}
                                >
                                  <GlassCheckCircle state={item.completed ? "checked" : "idle"} />
                                </TouchableOpacity>

                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={[
                                      styles.shopName,
                                      {
                                        color: colors.foreground,
                                        textDecorationLine: item.completed ? "line-through" : "none",
                                      },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {item.name}
                                  </Text>
                                  <Text style={[styles.shopMeta, { color: colors.mutedForeground }]}>
                                    {item.quantity}
                                    {assigneeLabel ? ` · ${assigneeLabel}` : ""}
                                    {item.price != null ? ` · $${item.price.toFixed(2)}` : ""}
                                    {item.neededByDate ? ` · Needed ${item.neededByDate}` : ""}
                                  </Text>
                                </View>

                                <TouchableOpacity
                                  onPress={() => deleteShoppingItem(item.id)}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Delete ${item.name}`}
                                >
                                  <Feather name="x" size={15} color={colors.mutedForeground} />
                                </TouchableOpacity>
                              </TouchableOpacity>
                            </ScaleDecoratorCompat>
                          );
                        }}
                      />
                    )}
                  </View>
                )}
                </Surface>
              </ScaleDecoratorCompat>
            );
          }}
        />
        </DraggableScrollContainerCompat>
      )}

      <FloatingActionButton
        accessibilityLabel="Add shopping list"
        onPress={() => setShowNewListModal(true)}
      />

      <ActionMenuModal
        visible={!!actionList || !!actionItem}
        title={actionList?.name ?? actionItem?.name ?? "Shopping"}
        subtitle={
          actionList
            ? "Choose what you’d like to do with this list."
            : "Choose what you’d like to do with this item."
        }
        onClose={() => {
          setActionListId(null);
          setActionItemId(null);
        }}
        actions={
          actionList
            ? [
                {
                  key: "expense",
                  label: "Create expense from list",
                  icon: "dollar-sign",
                  badge: "$$$",
                  accentColor: colors.success,
                  onPress: () => createListExpenseDraft(actionList.id),
                },
                {
                  key: "pin",
                  label: actionList.pinned ? "Unpin list" : "Pin list",
                  icon: "bookmark",
                  onPress: () => {
                    pinShoppingList(actionList.id, !actionList.pinned);
                    tapLight();
                  },
                },
                {
                  key: "delete",
                  label: "Delete list",
                  icon: "trash-2",
                  destructive: true,
                  confirmation: {
                    title: `Delete “${actionList.name}”?`,
                    message: "This permanently removes the list and every item in it.",
                    confirmLabel: "Delete list",
                  },
                  onPress: () => deleteShoppingList(actionList.id),
                },
              ]
            : actionItem
              ? [
                  {
                    key: "expense",
                    label: actionItem.convertedExpenseId
                      ? "Item expense already created"
                      : "Create item expense",
                    icon: "dollar-sign",
                    accentColor: colors.success,
                    onPress: () => createItemExpenseDraft(actionItem.id),
                  },
                ]
            : []
        }
      />

      {/* ── Assignee Picker Modal ── */}
      <Modal
        visible={!!assignPickerListId}
        transparent
        animationType="slide"
        onRequestClose={() => setAssignPickerListId(null)}
      >
        <Pressable style={styles.overlay} onPress={() => setAssignPickerListId(null)} />
        <Surface style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Assign list to</Text>
          {pickerList && (
            <Text style={[styles.assignPickerItemName, { color: colors.mutedForeground }]}>
              {pickerList.name}
            </Text>
          )}
          <View style={styles.assignAvatarGrid}>
            {roommates.map((r) => {
              const selected = pickerList?.assignedTo === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.assignAvatarCell,
                    {
                      backgroundColor: selected ? r.color + "22" : colors.muted,
                      borderColor: selected ? r.color : colors.border,
                      borderWidth: selected ? 2 : 1,
                    },
                  ]}
                  onPress={() => {
                    assignShoppingList(
                      assignPickerListId!,
                      selected ? null : r.id
                    );
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setAssignPickerListId(null);
                  }}
                >
                  <RoommateAvatar name={r.name} color={r.color} size={40} imageUri={r.avatarUri} />
                  <Text
                    style={[
                      styles.assignAvatarName,
                      { color: selected ? r.color : colors.foreground, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" },
                    ]}
                    numberOfLines={1}
                  >
                    {r.id === currentUserId ? "You" : r.name}
                  </Text>
                  {selected && (
                    <View style={[styles.assignSelectedCheck, { backgroundColor: r.color }]}>
                      <Feather name="check" size={9} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {pickerList?.assignedTo && (
            <TouchableOpacity
              style={[styles.clearAssignBtn, { borderColor: colors.border }]}
              onPress={() => {
                assignShoppingList(assignPickerListId!, null);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setAssignPickerListId(null);
              }}
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
              <Text style={[styles.clearAssignText, { color: colors.mutedForeground }]}>Clear assignment</Text>
            </TouchableOpacity>
          )}
        </Surface>
      </Modal>

      {/* ── Add Item Modal ── */}
      <Modal visible={showShoppingModal} transparent animationType="slide">
        <Pressable
          style={styles.overlay}
          onPress={() => { setShowShoppingModal(false); setTargetListId(null); }}
        />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
          <Surface
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              Add item
              {targetListId ? (
                <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
                  {" "}· {shoppingLists.find((l) => l.id === targetListId)?.name}
                </Text>
              ) : null}
            </Text>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Item name</Text>
            <TextInput
              style={inputStyle("item-name")}
              placeholder="e.g. Dish soap"
              placeholderTextColor={colors.mutedForeground}
              value={shopName}
              onChangeText={setShopName}
              onFocus={() => setFocusedInput("item-name")}
              onBlur={() => setFocusedInput(null)}
              autoFocus
            />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Quantity</Text>
            <TextInput
              style={inputStyle("item-quantity")}
              placeholder="e.g. 2 or 1 bag"
              placeholderTextColor={colors.mutedForeground}
              value={shopQty}
              onChangeText={setShopQty}
              onFocus={() => setFocusedInput("item-quantity")}
              onBlur={() => setFocusedInput(null)}
            />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Needed by (optional)</Text>
            <TextInput
              style={inputStyle("item-date")}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              value={shopNeededBy}
              onChangeText={setShopNeededBy}
              onFocus={() => setFocusedInput("item-date")}
              onBlur={() => setFocusedInput(null)}
              keyboardType="numbers-and-punctuation"
              accessibilityHint="Dated items appear on the in-app calendar"
            />
            <TouchableOpacity
              style={[
                styles.addBtn,
                {
                  backgroundColor: shopName.trim() ? colors.action : colors.muted,
                  borderColor: shopName.trim() ? colors.primary : colors.border,
                  marginTop: 8,
                },
              ]}
              disabled={!shopName.trim()}
              onPress={handleAddShopItem}
            >
              <Text style={[styles.addBtnText, { color: shopName.trim() ? colors.actionForeground : colors.mutedForeground }]}>
                Add to list
              </Text>
            </TouchableOpacity>
          </Surface>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── New List Modal ── */}
      <Modal visible={showNewListModal} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setShowNewListModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
          <Surface
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New list</Text>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>List name</Text>
            <TextInput
              style={inputStyle("list-name")}
              placeholder="e.g. Farmers Market"
              placeholderTextColor={colors.mutedForeground}
              value={newListName}
              onChangeText={setNewListName}
              onFocus={() => setFocusedInput("list-name")}
              onBlur={() => setFocusedInput(null)}
              autoFocus
            />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Planned date (optional)</Text>
            <TextInput
              style={inputStyle("list-date")}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              value={newListDate}
              onChangeText={setNewListDate}
              onFocus={() => setFocusedInput("list-date")}
              onBlur={() => setFocusedInput(null)}
              keyboardType="numbers-and-punctuation"
              accessibilityHint="Dated lists appear on the in-app calendar"
            />
            <TouchableOpacity
              style={[
                styles.addBtn,
                {
                  backgroundColor: newListName.trim() ? colors.action : colors.muted,
                  borderColor: newListName.trim() ? colors.primary : colors.border,
                  marginTop: 8,
                },
              ]}
              disabled={!newListName.trim()}
              onPress={handleAddList}
            >
              <Text style={[styles.addBtnText, { color: newListName.trim() ? colors.actionForeground : colors.mutedForeground }]}>
                Create list
              </Text>
            </TouchableOpacity>
          </Surface>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  addHeaderBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryRow: { paddingHorizontal: 16, marginBottom: 12 },
  summaryCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12 },
  summaryTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  summaryCopy: { flex: 1 },
  summaryTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  summaryText: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  listSection: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    // Buffer between each list so tiles never visually touch — matters most
    // during drag-reorder when neighbours could otherwise "stick" together.
    marginBottom: 16,
    shadowColor: "#4A3426",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 15,
    gap: 8,
  },
  dragHandle: {
    width: 24,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  listName: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  listCount: { fontFamily: "Inter_400Regular", fontSize: 12 },
  listAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  itemMoneyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  priceInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  priceDollar: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  priceInput: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, paddingVertical: 4 },
  promptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  promptItemName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  promptItemOwner: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  pickerHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  listItems: { paddingBottom: 4 },
  listEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  shopItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  shopCheck: {
    alignItems: "center",
    justifyContent: "center",
  },
  shopName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  shopMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 },
  assignBtn: { minHeight: 32, alignItems: "center", justifyContent: "center" },
  inlineYou: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  assignedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  assignGhost: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 6,
  },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 20, marginBottom: 4 },
  sheetSubtitle: { fontFamily: "Inter_400Regular", fontSize: 16 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 4 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  addBtn: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
  assignPickerItemName: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    marginTop: -6,
    marginBottom: 4,
  },
  assignAvatarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  assignAvatarCell: {
    width: "30%",
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 14,
    gap: 6,
    position: "relative",
  },
  assignAvatarName: {
    fontSize: 13,
    textAlign: "center",
  },
  assignSelectedCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  clearAssignBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  clearAssignText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
