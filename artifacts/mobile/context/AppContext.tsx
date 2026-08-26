import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { AppState, InteractionManager } from "react-native";

import { supabase } from "@/lib/supabase";
import {
  type ColorScheme,
} from "@/constants/themeTokens";
import type { ItemCategory } from "@/constants/itemDifficulty";
import type { Difficulty } from "@/lib/itemDifficulty";
import { reportSupabaseError, reportRuntimeError } from "@/lib/runtimeDiagnostics";
import { findAssignedLoadDeviations } from "@/lib/chartLoadBalance";
import { deleteLocalAnalyticsIdentity, track } from "@/lib/analytics";
import {
  ESSENTIAL_CATALOG,
  migrateEssentialRecord,
} from "@/constants/essentialCatalog";
import {
  transferEssentialsToShopping,
  type EssentialShoppingTransferResult,
} from "@/lib/essentialShopping";
import {
  advanceChoreDueDate,
  advanceScheduledDate,
  resolveRoundRobinParticipants,
} from "@/lib/choreSchedule";
import {
  choreLocalDateKey,
  choreScheduledDate,
  deleteRecurringChore,
  materializeRecurringOccurrences,
  recurringOccurrenceId,
} from "@/lib/choreOccurrences";
import { choreCompletionTransition } from "@/lib/choreCompletion";
import { isActiveSweetMember, resolveChorePermissions } from "@/lib/chorePermissions";
import { logChorePermissionCheck } from "@/lib/choreDiagnostics";
import { mergeByUpdatedAt } from "@/lib/expenseMerge";
import { carryMappedReminderToNextOccurrence } from "@/lib/externalTasks";
import { choreNow } from "@/lib/choreClock";
import { recurringChoreClaims } from "@/lib/recurringChoreClaims";
import type {
  ExpenseSplitMode,
  StoredExpenseAllocation,
} from "@/lib/money";
import { storedExpenseAllocationIsValid } from "@/lib/money";
import {
  resolveDisplayPreferenceDefaults,
  USER_PREFERENCES_VERSION,
} from "@/lib/userPreferenceDefaults";
import {
  canManageBorrowItem,
  hasValidBorrowParticipants,
} from "@/lib/borrowValidation";
import {
  assignmentsFromRows,
  migrateEssentialAssignments,
  setSelfAssignment,
  type EssentialAssignments,
} from "@/lib/essentialAssignments";
import {
  shortlistFromRows,
  removedShortlistRows,
  shortlistSelectionRows,
  type EssentialShortlist,
} from "@/lib/essentialShortlist";
import {
  HOUSEHOLD_SETUP_VERSION,
  normalizeHouseholdSetupStep,
  type HouseholdSetupStep,
} from "@/lib/householdSetup";

export type RoommateStatus = "home" | "away" | "asleep" | "unknown";
export type LeaderboardPeriod = "weekly" | "alltime";

export interface HomeLocation {
  latitude: number;
  longitude: number;
  radius: number; // meters
}

export type ChoreCategory =
  | "cleaning"
  | "kitchen"
  | "bathroom"
  | "laundry"
  | "outdoor"
  | "other";

export type AssignmentMode =
  | "specific-person"
  | "round-robin"
  | "unassigned";
export type ChoreRecurrence = "daily" | "everyOtherDay" | "weekly" | "biweekly" | "monthly";
export type RecurringChoreDeleteScope = "occurrence" | "future" | "series";

export interface Roommate {
  id: string;
  name: string;
  color: string;
  role?: "owner" | "member";
  points: number;
  weeklyPoints: number;
  avatarUri?: string;
}

export interface SweetMembership {
  id: string;
  sweetId: string;
  userId: string;
  name: string;
  role: "owner" | "member";
  status: "active" | "invited" | "left" | "removed";
  joinedAt: string;
  memberCount?: number;
  inviteCode?: string;
}

export interface Chore {
  id: string;
  householdId?: string;
  title: string;
  description?: string;
  creatorId?: string;
  assignedTo: string;
  assignmentMode?: AssignmentMode;
  roundRobinParticipantIds?: string[];
  roundRobinAllMembers?: boolean;
  roundRobinCursor?: number;
  excludedParticipantIds?: string[];
  dueDate: string;
  initialDueDate?: string;
  nextDueDate?: string;
  /** Stable calendar identity; unlike dueDate it does not change across device timezones. */
  scheduledDate?: string;
  initialScheduledDate?: string;
  monthlyAnchorDay?: number;
  excludedOccurrenceDates?: string[];
  recurrenceEndsOn?: string;
  completed: boolean;
  completedAt?: string;
  completedByUserId?: string;
  points: number;
  category: ChoreCategory;
  recurring?: ChoreRecurrence;
  recurrenceSeriesId?: string;
  occurrenceIndex?: number;
  nextOccurrenceId?: string;
  sourceKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ExpenseCategory =
  | "groceries"
  | "utilities"
  | "rent"
  | "entertainment"
  | "other";

export type RecurringInterval = "daily" | "monthly" | "custom";

export interface Expense {
  id: string;
  title: string;
  amount: number;
  amountCents?: number;
  paidBy: string;
  sharedWith: string[];
  splits: Record<string, number>; // person id → amount they owe payer
  splitMode?: ExpenseSplitMode;
  allocations?: StoredExpenseAllocation[];
  date: string;
  category: ExpenseCategory;
  settled: boolean;
  recurring?: RecurringInterval;
  recurringCustom?: string;
  paidBack?: Record<string, boolean>; // person id → true if they've paid back
  creatorId?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  shoppingSource?: ShoppingExpenseSource;
  notes?: string;
}

export interface ShoppingExpenseSource {
  type: "shopping-item" | "shopping-list";
  householdId: string;
  shoppingListId: string;
  shoppingListName: string;
  shoppingItemIds: string[];
  shoppingItemName?: string;
  listTotalCents?: number;
  individuallyAllocatedCents?: number;
  individualAllocations?: Array<{
    itemId: string;
    itemName: string;
    expenseId: string;
    amountCents: number;
  }>;
}

export interface ShoppingList {
  id: string;
  name: string;
  assignedTo?: string;
  pinned?: boolean;
  /** Optional local calendar day (YYYY-MM-DD) for a planned shopping trip. */
  plannedDate?: string;
  sourceType?: "sweet_essentials";
  sourceCategoryId?: string;
  sourceCategoryName?: string;
  // NOTE: no `order` field — the array position in `shoppingLists` IS the
  // display order. Mutators below preserve the invariant "pinned lists first,
  // then unpinned lists" so consumers can render `shoppingLists` directly.
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  quantity: string;
  addedBy: string;
  completed: boolean;
  // Optional per-item owners + price used when converting the list into an IOU.
  // If set, the roommates in `assignedTo` split `price` evenly for this item.
  // Legacy: earlier versions stored `assignedTo` as a plain string; readers
  // should coerce via `normalizeAssignees()` in shopping.tsx.
  assignedTo?: string[] | string;
  price?: number;
  convertedExpenseId?: string;
  /** Optional local calendar day (YYYY-MM-DD) by which the item is needed. */
  neededByDate?: string;
  /** Historical source marker retained for Shopping records created by older releases. */
  sourceEssentialItemId?: string;
  sourceType?: "sweet_essentials";
  sourceCategoryId?: string;
}

interface ShoppingSyncMeta {
  listVersions: Record<string, string>;
  itemVersions: Record<string, string>;
  deletedLists: Record<string, string>;
  deletedItems: Record<string, string>;
}

// Pre-filled expense builder state — Shopping tab pushes one of these when the
// user turns a list into an IOU; the Expenses tab consumes it on next mount to
// pop the IOU builder pre-populated, then clears it.
export interface PendingIouDraft {
  title: string;
  category: ExpenseCategory;
  paidBy: string;
  totalAmount: string;
  participants: string[];
  splits: Record<string, string>;
  source?: ShoppingExpenseSource;
  notes?: string;
  date: string;
}

export interface BorrowItem {
  id: string;
  householdId?: string;
  creatorId?: string;
  ownerId?: string;
  visibility?: "shared" | "private";
  item: string;
  borrowedBy?: string;
  borrowedFrom: string;
  borrowerName?: string;
  ownerName?: string;
  borrowedAt: string;
  dueDate: string;
  returned: boolean;
  returnedAt?: string;
  returnRequestedAt?: string;
  returnConfirmedBy?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

function normalizeSharedBorrowItems(value: unknown): BorrowItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is BorrowItem =>
      Boolean(
        entry &&
        typeof entry === "object" &&
        typeof (entry as Partial<BorrowItem>).id === "string" &&
        typeof (entry as Partial<BorrowItem>).item === "string" &&
        typeof (entry as Partial<BorrowItem>).borrowedFrom === "string",
      ),
    )
    .map((entry) => ({
      ...entry,
      ownerId: entry.ownerId ?? entry.creatorId,
      // Historical records predate this field and were household-shared.
      visibility: "shared",
    }));
}

export interface Nudge {
  id: string;
  toRoommateId: string;
  choreId: string;
  sentAt: string;
  seen: boolean;
  seenAt?: string;
  dismissedAt?: string;
}

export type ChoreAssignment = Record<string, string>;

export interface ChoreSlot {
  key: string;
  label: string;
  category?: ChoreCategory;
}

export interface ChoreChartData {
  slots?: ChoreSlot[];
  weeks: { week: number; assignments: ChoreAssignment }[];
  fairness_note?: string;
}

export type HousingType = "traditional" | "suite" | "apartment";

export interface HomeProfile {
  housingType: HousingType;
  items: string[];
  additionalChores: string[];
  roomCounts?: Partial<Record<"kitchen" | "bathroom" | "living" | "bedroom" | "other", number>>;
}

export interface GeneratedTask {
  id: string;
  itemCategory: ItemCategory;
  item: string;
  title: string;
  frequency: "daily" | "everyOtherDay" | "weekly" | "biweekly" | "monthly";
  timeOfDay: "morning" | "night" | "any";
  keepTogetherGroup?: string;
  difficulty: Difficulty;
}

export interface CustomTask {
  id: string;
  item: string;
  title: string;
  frequency: GeneratedTask["frequency"];
  timeOfDay: GeneratedTask["timeOfDay"];
  difficulty: Difficulty;
  keepTogetherGroup?: string;
}

export interface MemberPreference {
  id?: string;
  householdId: string;
  memberId: string;
  key: string;
  value: number;
}

export interface Assignment {
  memberId: string;
  taskIds: string[];
  totalLoad: number;
}

export interface MemberLoad {
  memberId: string;
  totalLoad: number;
}

export interface ProposedChart {
  id: string;
  householdId: string;
  createdBy: string;
  status: "pending" | "approved" | "cancelled";
  payload: {
    assignments: Assignment[];
    memberLoads?: MemberLoad[];
    generatedTasks?: GeneratedTask[];
    customTasks?: CustomTask[];
  };
  createdAt: string;
}

export interface ChartApproval {
  id: string;
  proposedChartId: string;
  memberId: string;
  approved: boolean;
  approvedAt: string;
}

export interface AppAlert {
  id: string;
  type: "difficulty-imbalance" | "overdue-chore" | "expense" | "borrowing" | "membership" | "planner" | "nudge" | "general";
  title: string;
  message: string;
  createdAt: string;
  readAt?: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  deduplicationKey: string;
  recipientId?: string;
  severity: "info" | "attention" | "important";
}

export interface ItemDifficulty {
  id?: string;
  householdId: string;
  category: ItemCategory;
  item: string;
  difficulty: Difficulty;
}

interface AppContextType {
  itemDifficulties: ItemDifficulty[];
  setItemDifficulty: (category: ItemCategory, item: string, difficulty: Difficulty) => Promise<void>;
  resetItemDifficulties: () => Promise<void>;
  memberPreferences: MemberPreference[];
  setMemberPreference: (key: string, value: number) => Promise<void>;
  currentProposedChart: ProposedChart | null;
  setCurrentProposedChart: (chart: ProposedChart | null) => Promise<void>;
  liveChart: Assignment[] | null;
  setLiveChart: (assignments: Assignment[] | null) => void;
  customTasks: CustomTask[];
  addCustomTask: (task: Omit<CustomTask, "id">) => void;
  deleteCustomTask: (id: string) => void;
  chartApprovals: ChartApproval[];
  proposeChart: (payload: ProposedChart["payload"]) => Promise<void>;
  approveProposedChart: () => Promise<void>;
  forceApproveProposedChart: () => Promise<void>;
  restartChartProcess: () => Promise<void>;
  isHost: boolean;
  preferencesLoaded: boolean;
  preferencesOnboardingPending: boolean;
  finishPreferencesOnboarding: () => Promise<void>;
  householdSetupStep: HouseholdSetupStep | null;
  setHouseholdSetupStep: (step: HouseholdSetupStep | null) => Promise<void>;
  completeHouseholdSetup: () => Promise<void>;
  quickGuideOpen: boolean;
  openQuickGuide: () => void;
  dismissQuickGuide: () => void;
  appAlerts: AppAlert[];
  markAlertRead: (alertId: string) => void;
  markAllAlertsRead: () => void;
  householdComplete: boolean;
  setHouseholdComplete: (complete: boolean) => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  pointsEnabled: boolean;
  setPointsEnabled: (enabled: boolean) => void;
  plantEnabled: boolean;
  setPlantEnabled: (enabled: boolean) => void;
  roommateActivityEnabled: boolean;
  setRoommateActivityEnabled: (enabled: boolean) => void;
  leaderboardPeriod: LeaderboardPeriod;
  setLeaderboardPeriod: (period: LeaderboardPeriod) => void;
  householdId: string | null;
  memberships: SweetMembership[];
  activeSweetId: string | null;
  activeSweet: SweetMembership | null;
  householdName: string | null;
  inviteCode: string | null;
  householdLoading: boolean;
  householdError: string | null;
  membersLoading: boolean;
  currentMemberRole: "owner" | "member";
  refreshMembers: () => Promise<void>;
  refreshHousehold: () => void;
  createHousehold: (householdName: string, displayName: string, color: string, inviteCode: string, options?: { deferOnboarding?: boolean }) => Promise<string>;
  joinHousehold: (inviteCode: string, displayName: string, color: string) => Promise<void>;
  switchSweet: (sweetId: string) => void;
  leaveSweet: (sweetId: string) => Promise<void>;
  deleteHousehold: () => Promise<void>;
  removeRoommate: (roommateId: string) => Promise<void>;
  deleteOwnAccount: () => Promise<void>;
  currentUserId: string;
  setCurrentUser: (id: string) => void;
  roommates: Roommate[];
  chores: Chore[];
  expenses: Expense[];
  shoppingLists: ShoppingList[];
  shoppingItems: ShoppingItem[];
  borrowItems: BorrowItem[];
  nudges: Nudge[];
  nudgesReady: boolean;
  addChore: (chore: Omit<Chore, "id">) => string | null;
  updateChore: (id: string, updates: Partial<Omit<Chore, "id">>) => boolean;
  addChores: (chores: Omit<Chore, "id">[]) => number;
  setChoreCompleted: (id: string, completed: boolean) => void;
  completeChore: (id: string) => void;
  pickUpChore: (choreId: string, completedById: string) => void;
  deleteChore: (id: string, scope?: RecurringChoreDeleteScope) => boolean;
  addExpense: (expense: Omit<Expense, "id">) => string;
  updateExpense: (id: string, updates: Partial<Omit<Expense, "id">>) => boolean;
  settleExpense: (id: string) => boolean;
  deleteExpense: (id: string) => boolean;
  canEditExpense: (expense: Expense) => boolean;
  canManageExpense: (expense: Expense) => boolean;
  markPersonPaid: (expenseId: string, personId: string) => void;
  addShoppingList: (name: string, plannedDate?: string) => string;
  reorderShoppingLists: (newIds: string[]) => void;
  pinShoppingList: (id: string, pinned: boolean) => void;
  deleteShoppingList: (id: string) => void;
  addShoppingItem: (item: Omit<ShoppingItem, "id">) => void;
  addSelectedEssentialsToShopping: (
    selection: EssentialShortlist,
  ) => EssentialShoppingTransferResult;
  toggleShoppingItem: (id: string) => void;
  deleteShoppingItem: (id: string) => void;
  reorderShoppingItems: (listId: string, newIds: string[]) => void;
  assignShoppingList: (id: string, roommateId: string | null) => void;
  assignShoppingItem: (id: string, roommateIds: string[]) => void;
  updateShoppingItemPrice: (id: string, price: number | null) => void;
  linkShoppingItemsToExpense: (itemIds: string[], expenseId: string) => void;
  pendingIouDraft: PendingIouDraft | null;
  setPendingIouDraft: (draft: PendingIouDraft | null) => void;
  addBorrowItem: (item: Omit<BorrowItem, "id">) => string | null;
  updateBorrowItem: (id: string, updates: Partial<Omit<BorrowItem, "id">>) => boolean;
  returnBorrowItem: (id: string) => boolean;
  deleteBorrowItem: (id: string) => Promise<boolean>;
  sendNudge: (toRoommateId: string, choreId: string) => Promise<void>;
  removeNudge: (toRoommateId: string, choreId: string) => Promise<void>;
  acknowledgeNudge: (nudgeId: string) => Promise<void>;
  dismissNudge: (nudgeId: string) => Promise<void>;
  getRoommateById: (id: string) => Roommate | undefined;
  updateRoommate: (id: string, patch: Partial<Pick<Roommate, "name" | "color" | "avatarUri">>) => Promise<void>;
  getChoresByRoommate: (id: string) => Chore[];
  getBalances: () => Record<string, number>;
  essentialsAssignees: EssentialAssignments;
  setEssentialSelfAssignment: (
    sectionKey: string,
    itemId: string,
    assigned: boolean,
  ) => Promise<boolean>;
  essentialOwned: Record<string, Record<string, boolean>>;
  essentialShortlist: EssentialShortlist;
  essentialShortlistUpdatedBy: string | null;
  setEssentialOwned: (sectionKey: string, itemId: string, owned: boolean) => void;
  saveEssentialShortlist: (
    next: EssentialShortlist,
    baseline?: EssentialShortlist,
  ) => Promise<boolean>;
  suppressedAlerts: Record<string, boolean>;
  suppressAlert: (id: string) => void;
  roommateStatuses: Record<string, RoommateStatus>;
  setRoommateStatus: (id: string, status: RoommateStatus) => void;
  sleepStartedAt: Record<string, number>;
  homeLocation: HomeLocation | null;
  setHomeLocation: (loc: HomeLocation | null) => void;
  choreChart: ChoreChartData | null;
  choreChartStartedAt: string | null;
  setChoreChart: (data: ChoreChartData | null, startedAt: string | null) => void;
  homeProfile: HomeProfile | null;
  setHomeProfile: (profile: HomeProfile | null) => void;
}

const ASLEEP_AUTO_REVERT_MS = 9 * 60 * 60 * 1000;

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppContextStore {
  getSnapshot: () => AppContextType;
  setSnapshot: (value: AppContextType) => void;
  subscribe: (listener: () => void) => () => void;
}

const AppContextStoreContext = createContext<AppContextStore | undefined>(
  undefined,
);

function createAppContextStore(initialValue: AppContextType): AppContextStore {
  let snapshot = initialValue;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    setSnapshot: (value) => {
      if (Object.is(snapshot, value)) return;
      snapshot = value;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function shallowEqualSelection<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

const CURRENT_USER_ID = "current";

function makeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return randomUUID ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

const STORAGE_KEY = "homebase_data_v7";
const PREFERENCES_KEY = "homie_user_preferences_v1";
const USER_PREFERENCES_KEY_PREFIX = "sweetmate:user-preferences:v1";
const userPreferencesKey = (userId: string) =>
  `${USER_PREFERENCES_KEY_PREFIX}:${userId}`;
const activeSweetKey = (userId: string) =>
  `sweetmate:user:${userId}:active-sweet`;
const sweetStateKey = (userId: string, sweetId: string) =>
  `sweetmate:user:${userId}:sweet:${sweetId}:state`;
const privateBorrowStateKey = (userId: string, sweetId: string) =>
  `sweetmate:user:${userId}:sweet:${sweetId}:private-borrows:v1`;
const userStateKey = (userId: string) =>
  `sweetmate:user:${userId}:state`;
const QUICK_GUIDE_VERSION = 2;
const EMPTY_SHOPPING_SYNC_META: ShoppingSyncMeta = {
  listVersions: {},
  itemVersions: {},
  deletedLists: {},
  deletedItems: {},
};

function mergeVersionedShopping<T extends { id: string }>(
  local: T[],
  remote: T[],
  localVersions: Record<string, string>,
  remoteVersions: Record<string, string>,
  localDeleted: Record<string, string>,
  remoteDeleted: Record<string, string>,
): T[] {
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const remoteById = new Map(remote.map((entry) => [entry.id, entry]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const merged: T[] = [];

  ids.forEach((id) => {
    const localVersion = localVersions[id] ?? "";
    const remoteVersion = remoteVersions[id] ?? "";
    const deletedVersion = [localDeleted[id] ?? "", remoteDeleted[id] ?? ""]
      .sort()
      .at(-1) ?? "";
    const winningVersion = localVersion > remoteVersion ? localVersion : remoteVersion;
    if (deletedVersion >= winningVersion && deletedVersion) return;
    const winner = localVersion > remoteVersion ? localById.get(id) : remoteById.get(id);
    if (winner) merged.push(winner);
  });
  return merged;
}

interface SharedHouseholdState {
  roommates: Roommate[];
  chores: Chore[];
  expenses: Expense[];
  shoppingLists: ShoppingList[];
  shoppingItems: ShoppingItem[];
  shoppingSyncMeta: ShoppingSyncMeta;
  borrowItems: BorrowItem[];
  /** Legacy cache only. Cloud synchronization uses the normalized join table. */
  essentialsAssignees?: EssentialAssignments;
  essentialOwned: Record<string, Record<string, boolean>>;
  /** Legacy cache only. Cloud synchronization uses the normalized shortlist table. */
  essentialShortlist?: EssentialShortlist;
  essentialShortlistUpdatedBy: string | null;
  roommateStatuses: Record<string, RoommateStatus>;
  sleepStartedAt: Record<string, number>;
  homeLocation: HomeLocation | null;
  choreChart: ChoreChartData | null;
  choreChartStartedAt: string | null;
  homeProfile: HomeProfile | null;
  liveChart: Assignment[] | null;
  customTasks: CustomTask[];
}

export function AppProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<SweetMembership[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [householdLoading, setHouseholdLoading] = useState(true);
  const [householdError, setHouseholdError] = useState<string | null>(null);
  const [membershipVersion, setMembershipVersion] = useState(0);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const roommatesRef = useRef<Roommate[]>(roommates);
  roommatesRef.current = roommates;
  const [membersLoading, setMembersLoading] = useState(false);
  const [chores, setChores] = useState<Chore[]>([]);
  const choresRef = useRef<Chore[]>(chores);
  choresRef.current = chores;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const expensesRef = useRef<Expense[]>(expenses);
  expensesRef.current = expenses;
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [shoppingItems, setShoppingItems] =
    useState<ShoppingItem[]>([]);
  const [shoppingSyncMeta, setShoppingSyncMeta] = useState<ShoppingSyncMeta>(
    EMPTY_SHOPPING_SYNC_META,
  );
  const shoppingListsRef = useRef(shoppingLists);
  const shoppingItemsRef = useRef(shoppingItems);
  const shoppingSyncMetaRef = useRef(shoppingSyncMeta);
  shoppingListsRef.current = shoppingLists;
  shoppingItemsRef.current = shoppingItems;
  shoppingSyncMetaRef.current = shoppingSyncMeta;
  const [borrowItems, setBorrowItems] = useState<BorrowItem[]>([]);
  const [privateBorrowItems, setPrivateBorrowItems] = useState<BorrowItem[]>([]);
  const visibleBorrowItems = useMemo(
    () => [...borrowItems, ...privateBorrowItems],
    [borrowItems, privateBorrowItems],
  );
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [nudgesReady, setNudgesReady] = useState(false);
  const [essentialsAssignees, setEssentialsAssignees] =
    useState<EssentialAssignments>({});
  const [essentialOwned, setEssentialOwnedState] = useState<Record<string, Record<string, boolean>>>({});
  const [essentialShortlist, setEssentialShortlist] =
    useState<EssentialShortlist>({});
  const [essentialShortlistUpdatedBy, setEssentialShortlistUpdatedBy] = useState<string | null>(null);
  const [suppressedAlerts, setSuppressedAlerts] = useState<Record<string, boolean>>({});
  const [roommateStatuses, setRoommateStatusesState] = useState<Record<string, RoommateStatus>>({});
  const [sleepStartedAt, setSleepStartedAtState] = useState<Record<string, number>>({});
  const [homeLocation, setHomeLocationState] = useState<HomeLocation | null>(null);
  const [choreChart, setChoreChartState] = useState<ChoreChartData | null>(null);
  const [choreChartStartedAt, setChoreChartStartedAtState] = useState<string | null>(null);
  const [homeProfile, setHomeProfileState] = useState<HomeProfile | null>(null);
  const [liveChart, setLiveChartState] = useState<Assignment[] | null>(null);
  const [customTasks, setCustomTasks] = useState<CustomTask[]>([]);
  const [itemDifficulties, setItemDifficulties] = useState<ItemDifficulty[]>([]);
  const [memberPreferences, setMemberPreferences] = useState<MemberPreference[]>([]);
  const [currentProposedChart, setCurrentProposedChartState] = useState<ProposedChart | null>(null);
  const [chartApprovals, setChartApprovals] = useState<ChartApproval[]>([]);
  const [currentMemberRole, setCurrentMemberRole] = useState<"owner" | "member">("member");
  const isHost = currentMemberRole === "owner";
  const [currentUserId, setCurrentUserIdState] = useState<string>(CURRENT_USER_ID);
  const [pendingIouDraft, setPendingIouDraftState] = useState<PendingIouDraft | null>(null);
  const [colorScheme, setColorScheme] = useState<ColorScheme>("mono");
  const [pointsEnabled, setPointsEnabled] = useState(false);
  const [plantEnabled, setPlantEnabled] = useState(true);
  const [roommateActivityEnabled, setRoommateActivityEnabled] = useState(false);
  const [leaderboardPeriod, setLeaderboardPeriod] =
    useState<LeaderboardPeriod>("weekly");
  const [localPreferencesLoaded, setLocalPreferencesLoaded] = useState(false);
  const [householdPreferencesReady, setHouseholdPreferencesReady] = useState(false);
  const [preferencesOnboardingPending, setPreferencesOnboardingPending] = useState(false);
  const [householdSetupStep, setHouseholdSetupStepState] =
    useState<HouseholdSetupStep | null>(null);
  const [quickGuideVersions, setQuickGuideVersions] = useState<Record<string, number>>({});
  const [quickGuideOpen, setQuickGuideOpen] = useState(false);
  const [appAlerts, setAppAlerts] = useState<AppAlert[]>([]);
  const [householdComplete, setHouseholdCompleteState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [activeCalendarDay, setActiveCalendarDay] = useState(() =>
    choreLocalDateKey(choreNow()),
  );
  const [recurrenceRefreshTick, setRecurrenceRefreshTick] = useState(0);
  const membershipLoadGenerationRef = useRef(0);
  const sweetDataCacheRef = useRef<Record<string, SharedHouseholdState>>({});
  const applyingRemoteRef = useRef(false);
  const memberMetadataRef = useRef<Map<string, Roommate>>(new Map());
  const previousMemberIdsRef = useRef<{ householdId: string | null; ids: Set<string> }>({
    householdId: null,
    ids: new Set(),
  });
  const preferencesLoaded =
    localPreferencesLoaded && (!householdId || householdPreferencesReady);

  useEffect(() => {
    setCurrentUserIdState(session?.user.id ?? CURRENT_USER_ID);
  }, [session?.user.id]);

  useEffect(() => {
    const refreshDay = () => {
      setActiveCalendarDay(choreLocalDateKey(choreNow()));
      setRecurrenceRefreshTick((current) => current + 1);
    };
    const now = choreNow();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      25,
    );
    const timer = setTimeout(refreshDay, nextMidnight.getTime() - now.getTime());
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshDay();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [activeCalendarDay]);

  useEffect(() => {
    if (!loaded || !householdId || !activeCalendarDay) return;
    const reconciled = materializeRecurringOccurrences(
      choresRef.current,
      new Date(`${activeCalendarDay}T12:00:00`),
      choreNow().toISOString(),
    );
    if (reconciled !== choresRef.current) {
      choresRef.current = reconciled;
      setChores(reconciled);
    }
    const claims = recurringChoreClaims(reconciled, householdId);
    if (claims.length) {
      void supabase
        .from("recurring_chore_occurrence_keys")
        .upsert(claims, {
          onConflict: "household_id,recurrence_series_id,scheduled_date",
          ignoreDuplicates: true,
        })
        .then(({ error }) => {
          if (error) {
            reportSupabaseError("claim recurring chore occurrences", error, {
              householdId,
              count: claims.length,
            });
          }
        });
    }
  }, [activeCalendarDay, householdId, loaded, recurrenceRefreshTick]);

  const preferenceUserId = session?.user.id;

  // Reset before paint when accounts change so the previous user's theme is
  // never rendered while the next user's record is loading.
  useLayoutEffect(() => {
    setLocalPreferencesLoaded(false);
    setColorScheme("mono");
    setPointsEnabled(false);
    setPlantEnabled(true);
    setRoommateActivityEnabled(false);
    setLeaderboardPeriod("weekly");
    setPreferencesOnboardingPending(false);
    setHouseholdSetupStepState(null);
    setQuickGuideVersions({});
    setQuickGuideOpen(false);
  }, [preferenceUserId]);

  useEffect(() => {
    if (!preferenceUserId) return;
    let active = true;

    (async () => {
      const scopedKey = userPreferencesKey(preferenceUserId);
      const [scopedRaw, legacyRaw] = await Promise.all([
        AsyncStorage.getItem(scopedKey),
        AsyncStorage.getItem(PREFERENCES_KEY),
      ]);
      if (!active) return;

      type StoredUserPreferences = Partial<{
        colorScheme: unknown;
        pointsEnabled: boolean;
        plantEnabled: boolean;
        roommateActivityEnabled: boolean;
        preferencesVersion: number;
        leaderboardPeriod: LeaderboardPeriod;
        onboardingPending: boolean;
        householdSetupStep: unknown;
        householdSetupVersion: number;
        quickGuideVersion: number;
      }>;
      let preferences: StoredUserPreferences = {};
      let markLegacyMigrated = false;

      if (scopedRaw) {
        preferences = JSON.parse(scopedRaw) as StoredUserPreferences;
      } else if (legacyRaw) {
        // One-time, first-user migration. The legacy record remains intact so
        // unrelated settings are not deleted or copied to later accounts.
        const legacy = JSON.parse(legacyRaw) as StoredUserPreferences & {
          quickGuideVersions?: Record<string, number>;
          appearanceMigratedToUserId?: string;
        };
        if (!legacy.appearanceMigratedToUserId) {
          preferences = {
            colorScheme: legacy.colorScheme,
            pointsEnabled: legacy.pointsEnabled,
            plantEnabled: legacy.plantEnabled,
            roommateActivityEnabled: legacy.roommateActivityEnabled,
            preferencesVersion: legacy.preferencesVersion,
            onboardingPending: legacy.onboardingPending,
            householdSetupStep: legacy.householdSetupStep,
            householdSetupVersion: legacy.householdSetupVersion,
            quickGuideVersion: legacy.quickGuideVersions?.[preferenceUserId],
          };
          markLegacyMigrated = true;
        }
        await AsyncStorage.setItem(scopedKey, JSON.stringify(preferences));
        if (markLegacyMigrated) {
          await AsyncStorage.mergeItem(
            PREFERENCES_KEY,
            JSON.stringify({ appearanceMigratedToUserId: preferenceUserId }),
          );
        }
      }
      if (!active) return;

      const displayPreferences = resolveDisplayPreferenceDefaults(preferences);
      setColorScheme(displayPreferences.colorScheme);
      setPointsEnabled(displayPreferences.pointsEnabled);
      setPlantEnabled(displayPreferences.plantEnabled);
      setRoommateActivityEnabled(displayPreferences.roommateActivityEnabled);
      if (
        preferences.leaderboardPeriod === "weekly" ||
        preferences.leaderboardPeriod === "alltime"
      ) {
        setLeaderboardPeriod(preferences.leaderboardPeriod);
      }
      if (typeof preferences.onboardingPending === "boolean") {
        setPreferencesOnboardingPending(preferences.onboardingPending);
      }
      setHouseholdSetupStepState(
        normalizeHouseholdSetupStep(
          preferences.householdSetupStep,
          preferences.householdSetupVersion,
        ),
      );
      if (typeof preferences.quickGuideVersion === "number") {
        setQuickGuideVersions({
          [preferenceUserId]: preferences.quickGuideVersion,
        });
      }
    })()
      .catch((error) => {
        reportRuntimeError("hydrate personal user preferences", error, {
          userId: preferenceUserId,
        });
      })
      .finally(() => {
        if (active) setLocalPreferencesLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [preferenceUserId]);

  useEffect(() => {
    if (!localPreferencesLoaded || !preferenceUserId) return;
    const interaction = InteractionManager.runAfterInteractions(() => {
      AsyncStorage.setItem(
        userPreferencesKey(preferenceUserId),
        JSON.stringify({
          colorScheme,
          pointsEnabled,
          plantEnabled,
          roommateActivityEnabled,
          preferencesVersion: USER_PREFERENCES_VERSION,
          leaderboardPeriod,
          onboardingPending: preferencesOnboardingPending,
          householdSetupStep,
          householdSetupVersion: HOUSEHOLD_SETUP_VERSION,
          quickGuideVersion: quickGuideVersions[preferenceUserId] ?? 0,
        }),
      ).catch((error) => {
        reportRuntimeError("cache personal user preferences", error, {
          userId: preferenceUserId,
        });
      });
    });
    return () => interaction.cancel();
  }, [
    colorScheme,
    leaderboardPeriod,
    localPreferencesLoaded,
    plantEnabled,
    pointsEnabled,
    roommateActivityEnabled,
    preferenceUserId,
    preferencesOnboardingPending,
    householdSetupStep,
    quickGuideVersions,
  ]);

  const finishPreferencesOnboarding = useCallback(async () => {
    if (preferenceUserId) {
      await AsyncStorage.mergeItem(
        userPreferencesKey(preferenceUserId),
        JSON.stringify({ onboardingPending: false }),
      );
    }
    setPreferencesOnboardingPending(false);
  }, [preferenceUserId]);

  const setHouseholdSetupStep = useCallback(
    async (step: HouseholdSetupStep | null) => {
      if (preferenceUserId) {
        await AsyncStorage.mergeItem(
          userPreferencesKey(preferenceUserId),
          JSON.stringify({
            householdSetupStep: step,
            householdSetupVersion: HOUSEHOLD_SETUP_VERSION,
          }),
        );
      }
      setHouseholdSetupStepState(step);
    },
    [preferenceUserId],
  );

  const completeHouseholdSetup = useCallback(async () => {
    if (preferenceUserId) {
      await AsyncStorage.mergeItem(
        userPreferencesKey(preferenceUserId),
        JSON.stringify({
          householdSetupStep: null,
          householdSetupVersion: HOUSEHOLD_SETUP_VERSION,
          onboardingPending: true,
        }),
      );
    }
    setHouseholdSetupStepState(null);
    setPreferencesOnboardingPending(true);
  }, [preferenceUserId]);

  const currentGuideUserId = session?.user.id;
  const currentGuideVersion = currentGuideUserId
    ? quickGuideVersions[currentGuideUserId] ?? 0
    : QUICK_GUIDE_VERSION;

  useEffect(() => {
    if (
      localPreferencesLoaded &&
      householdId &&
      !householdSetupStep &&
      !preferencesOnboardingPending &&
      currentGuideVersion < QUICK_GUIDE_VERSION
    ) {
      setQuickGuideOpen(true);
    }
  }, [
    currentGuideVersion,
    householdId,
    householdSetupStep,
    localPreferencesLoaded,
    preferencesOnboardingPending,
  ]);

  const openQuickGuide = useCallback(() => {
    setQuickGuideOpen(true);
  }, []);

  const dismissQuickGuide = useCallback(() => {
    setQuickGuideOpen(false);
    if (!currentGuideUserId) return;

    setQuickGuideVersions((current) => {
      const next = {
        ...current,
        [currentGuideUserId]: QUICK_GUIDE_VERSION,
      };
      InteractionManager.runAfterInteractions(() => {
        AsyncStorage.mergeItem(
          userPreferencesKey(currentGuideUserId),
          JSON.stringify({ quickGuideVersion: QUICK_GUIDE_VERSION }),
        ).catch((error) => {
          reportRuntimeError("cache Quick guide completion", error);
        });
      });
      return next;
    });
  }, [currentGuideUserId]);

  // Only genuinely shared setup state uses the household preference row.
  // Appearance and display choices are private, user-scoped AsyncStorage data.
  useEffect(() => {
    const userId = session?.user.id;
    if (!localPreferencesLoaded || !userId || !householdId) {
      setHouseholdPreferencesReady(false);
      return;
    }

    let active = true;
    setHouseholdPreferencesReady(false);
    const channel = supabase.channel(`household-preferences:${householdId}`);

    const applyPreferences = (row: { household_complete?: boolean }) => {
      if (typeof row.household_complete === "boolean") {
        setHouseholdCompleteState(row.household_complete);
      }
    };

    async function connectPreferences() {
      const { data, error } = await supabase
        .from("household_preferences")
        .select("household_complete")
        .eq("household_id", householdId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        reportSupabaseError("load household preferences", error, { householdId });
        console.warn("SweetMate preferences sync could not start:", error.message);
        return;
      }

      if (data) {
        applyPreferences(data);
      } else {
        const { error: createError } = await supabase.from("household_preferences").insert({
          household_id: householdId,
          household_complete: householdComplete,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
        if (createError) {
          reportSupabaseError("create household preferences", createError, { householdId });
          // Another member may have won the first-row race; load that row.
          if (createError.code === "23505") {
            const { data: existing, error: reloadError } = await supabase
              .from("household_preferences")
              .select("household_complete")
              .eq("household_id", householdId)
              .maybeSingle();
            if (reloadError) {
              reportSupabaseError("reload household preferences", reloadError, { householdId });
            }
            if (existing) applyPreferences(existing);
          } else {
            console.warn("SweetMate preferences could not be created:", createError.message);
            return;
          }
        }
      }

      if (!active) return;
      setHouseholdPreferencesReady(true);
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "household_preferences",
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            const row = payload.new as {
              household_complete?: boolean;
              updated_by?: string;
            };
            if (row.updated_by === userId) return;
            applyPreferences(row);
          },
        )
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reportSupabaseError(
              "subscribe to household preferences",
              error ?? new Error(status),
              { householdId, status },
            );
          }
        });
    }

    connectPreferences().catch((error) => {
      reportRuntimeError("connect household preferences", error, { householdId });
    });
    return () => {
      active = false;
      setHouseholdPreferencesReady(false);
      supabase.removeChannel(channel);
    };
  }, [householdId, localPreferencesLoaded, session?.user.id]);

  // Coalesce updates to the shared setup-completion flag only.
  useEffect(() => {
    const userId = session?.user.id;
    if (!householdPreferencesReady || !userId || !householdId) return;

    let interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      interaction = InteractionManager.runAfterInteractions(async () => {
        const { error } = await supabase.from("household_preferences").upsert({
          household_id: householdId,
          household_complete: householdComplete,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
        if (error) {
          reportSupabaseError("save household preferences", error, { householdId });
          console.warn("SweetMate preference could not sync:", error.message);
        }
      });
    }, 220);
    return () => {
      clearTimeout(timer);
      interaction?.cancel();
    };
  }, [
    householdComplete,
    householdId,
    householdPreferencesReady,
    session?.user.id,
  ]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setMemberships([]);
      setHouseholdId(null);
      setHouseholdName(null);
      setInviteCode(null);
      setHouseholdLoading(false);
      return;
    }
    let active = true;
    const generation = ++membershipLoadGenerationRef.current;
    setHouseholdLoading(true);
    setHouseholdError(null);
    (async () => {
      const { data: membershipRows, error } = await supabase
        .from("household_members")
        .select("household_id, user_id, role, status, joined_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("joined_at", { ascending: true });
      if (!active || generation !== membershipLoadGenerationRef.current) return;
      if (error || !membershipRows?.length) {
        if (error) {
          reportSupabaseError("load Sweet memberships", error, { userId });
          setHouseholdError("We couldn't load your households. Check your connection and try again.");
        }
        setMemberships([]);
        setHouseholdId(null);
        setHouseholdName(null);
        setInviteCode(null);
        setHouseholdLoading(false);
        return;
      }
      const sweetIds = membershipRows.map((row) => row.household_id);
      const [{ data: households, error: householdError }, { data: memberRows }] = await Promise.all([
        supabase
        .from("households")
        .select("id, name, invite_code")
        .in("id", sweetIds),
        supabase
          .from("household_members")
          .select("household_id")
          .in("household_id", sweetIds)
          .eq("status", "active"),
      ]);
      if (householdError) {
        reportSupabaseError("load Sweets", householdError, { sweetIds });
        setHouseholdError("We couldn't load your household details. Please try again.");
        if (active) {
          setMemberships([]);
          setHouseholdId(null);
          setHouseholdName(null);
          setInviteCode(null);
          setHouseholdLoading(false);
        }
        return;
      }
      if (!active || generation !== membershipLoadGenerationRef.current) return;
      const householdById = new Map((households ?? []).map((household) => [household.id, household]));
      const counts = new Map<string, number>();
      (memberRows ?? []).forEach((row) =>
        counts.set(row.household_id, (counts.get(row.household_id) ?? 0) + 1),
      );
      const nextMemberships: SweetMembership[] = membershipRows.flatMap((row) => {
        const sweet = householdById.get(row.household_id);
        if (!sweet) return [];
        return [{
          id: `${row.household_id}:${userId}`,
          sweetId: row.household_id,
          userId,
          name: sweet.name,
          role: row.role === "owner" ? "owner" : "member",
          status: "active",
          joinedAt: row.joined_at,
          memberCount: counts.get(row.household_id) ?? 1,
          inviteCode: sweet.invite_code,
        }];
      });
      const storedActiveSweetId = await AsyncStorage.getItem(activeSweetKey(userId));
      if (!active || generation !== membershipLoadGenerationRef.current) return;
      const selected =
        nextMemberships.find((membership) => membership.sweetId === storedActiveSweetId) ??
        nextMemberships[0];
      const selectedHousehold = selected ? householdById.get(selected.sweetId) : null;
      if (selected && selected.sweetId !== householdId) {
        setCloudReady(false);
        setRoommates([]);
        choresRef.current = [];
        setChores([]);
        setExpenses([]);
        setShoppingLists([]);
        setShoppingItems([]);
        setShoppingSyncMeta(EMPTY_SHOPPING_SYNC_META);
        setBorrowItems([]);
        setPrivateBorrowItems([]);
        setNudges([]);
        setNudgesReady(false);
        setEssentialsAssignees({});
        setEssentialOwnedState({});
        setEssentialShortlist({});
        setEssentialShortlistUpdatedBy(null);
        setRoommateStatusesState({});
        setSleepStartedAtState({});
        setHomeLocationState(null);
        setChoreChartState(null);
        setChoreChartStartedAtState(null);
        setHomeProfileState(null);
        setLiveChartState(null);
        setCustomTasks([]);
      }
      const cachedRaw = selected
        ? await AsyncStorage.getItem(sweetStateKey(userId, selected.sweetId))
        : null;
      if (!active || generation !== membershipLoadGenerationRef.current) return;
      if (selected && cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as SharedHouseholdState;
          sweetDataCacheRef.current[selected.sweetId] = cached;
          if (Array.isArray(cached.chores)) {
            choresRef.current = cached.chores;
            setChores(cached.chores);
          }
          if (Array.isArray(cached.expenses)) setExpenses(cached.expenses);
          if (Array.isArray(cached.shoppingLists)) setShoppingLists(cached.shoppingLists);
          if (Array.isArray(cached.shoppingItems)) setShoppingItems(cached.shoppingItems);
          if (cached.shoppingSyncMeta) setShoppingSyncMeta(cached.shoppingSyncMeta);
          if (Array.isArray(cached.borrowItems)) {
            setBorrowItems(normalizeSharedBorrowItems(cached.borrowItems));
          }
          if (cached.essentialsAssignees) {
            setEssentialsAssignees(
              migrateEssentialAssignments(
                migrateEssentialRecord(cached.essentialsAssignees),
              ),
            );
          }
          if (cached.essentialOwned) setEssentialOwnedState(migrateEssentialRecord(cached.essentialOwned));
          if (cached.essentialShortlist) setEssentialShortlist(migrateEssentialRecord(cached.essentialShortlist));
          setEssentialShortlistUpdatedBy(cached.essentialShortlistUpdatedBy ?? null);
          if (cached.roommateStatuses) setRoommateStatusesState(cached.roommateStatuses);
          if (cached.sleepStartedAt) setSleepStartedAtState(cached.sleepStartedAt);
          setHomeLocationState(cached.homeLocation ?? null);
          setChoreChartState(cached.choreChart ?? null);
          setChoreChartStartedAtState(cached.choreChartStartedAt ?? null);
          setHomeProfileState(cached.homeProfile ?? null);
          setLiveChartState(cached.liveChart ?? null);
          if (Array.isArray(cached.customTasks)) setCustomTasks(cached.customTasks);
        } catch (cacheError) {
          reportRuntimeError("parse cached Sweet state", cacheError, { sweetId: selected.sweetId });
        }
      }
      setCurrentUserIdState(userId);
      setHouseholdError(null);
      setMemberships(nextMemberships);
      setCurrentMemberRole(selected?.role ?? "member");
      setHouseholdId(selected?.sweetId ?? null);
      setHouseholdName(selected?.name ?? null);
      setInviteCode(selectedHousehold?.invite_code ?? null);
      setHouseholdLoading(false);
      if (selected && selected.sweetId !== storedActiveSweetId) {
        void AsyncStorage.setItem(activeSweetKey(userId), selected.sweetId);
      }
    })().catch((error) => {
      reportRuntimeError("load current household", error, { userId });
      if (active) {
        setHouseholdError("We couldn't load your households. Please try again.");
        setHouseholdId(null);
        setHouseholdName(null);
        setInviteCode(null);
        setHouseholdLoading(false);
      }
    });
    return () => { active = false; };
  }, [session?.user.id, membershipVersion]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const channel = supabase
      .channel(`my-sweet-memberships:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_members",
          filter: `user_id=eq.${userId}`,
        },
        () => setMembershipVersion((value) => value + 1),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const switchSweet = useCallback((sweetId: string) => {
    const membership = memberships.find((item) => item.sweetId === sweetId);
    const userId = session?.user.id;
    if (!membership || !userId || sweetId === householdId) return;
    track.sweetSwitched({ destination: "existing" });
    setCloudReady(false);
    setRoommates([]);
    setChores([]);
    setExpenses([]);
    setShoppingLists([]);
    setShoppingItems([]);
    setShoppingSyncMeta(EMPTY_SHOPPING_SYNC_META);
    setBorrowItems([]);
    setPrivateBorrowItems([]);
    setNudges([]);
    setNudgesReady(false);
    setEssentialsAssignees({});
    setEssentialOwnedState({});
    setEssentialShortlist({});
    setEssentialShortlistUpdatedBy(null);
    setRoommateStatusesState({});
    setSleepStartedAtState({});
    setHomeLocationState(null);
    setChoreChartState(null);
    setChoreChartStartedAtState(null);
    setHomeProfileState(null);
    setLiveChartState(null);
    setCustomTasks([]);
    setItemDifficulties([]);
    setMemberPreferences([]);
    setCurrentProposedChartState(null);
    setChartApprovals([]);
    setHouseholdPreferencesReady(false);
    const cached = sweetDataCacheRef.current[membership.sweetId];
    if (cached) {
      setChores(cached.chores);
      choresRef.current = cached.chores;
      setExpenses(cached.expenses);
      setShoppingLists(cached.shoppingLists);
      setShoppingItems(cached.shoppingItems);
      setShoppingSyncMeta(cached.shoppingSyncMeta);
      setBorrowItems(normalizeSharedBorrowItems(cached.borrowItems));
      setEssentialsAssignees(
        migrateEssentialAssignments(
          migrateEssentialRecord(cached.essentialsAssignees),
        ),
      );
      setEssentialOwnedState(migrateEssentialRecord(cached.essentialOwned));
      setEssentialShortlist(migrateEssentialRecord(cached.essentialShortlist));
      setEssentialShortlistUpdatedBy(cached.essentialShortlistUpdatedBy ?? null);
      setRoommateStatusesState(cached.roommateStatuses);
      setSleepStartedAtState(cached.sleepStartedAt);
      setHomeLocationState(cached.homeLocation);
      setChoreChartState(cached.choreChart);
      setChoreChartStartedAtState(cached.choreChartStartedAt);
      setHomeProfileState(cached.homeProfile);
      setLiveChartState(cached.liveChart);
      setCustomTasks(cached.customTasks);
    }
    setCurrentMemberRole(membership.role);
    setHouseholdId(membership.sweetId);
    setHouseholdName(membership.name);
    setInviteCode(membership.inviteCode ?? null);
    void AsyncStorage.setItem(activeSweetKey(userId), membership.sweetId);
  }, [householdId, memberships, session?.user.id]);

  const refreshMembers = useCallback(async () => {
    if (!householdId) {
      setRoommates([]);
      return;
    }
    setMembersLoading(true);
    try {
      const { data, error } = await supabase
        .from("household_members")
        .select("user_id, display_name, color, role")
        .eq("household_id", householdId)
        .eq("status", "active")
        .order("joined_at", { ascending: true });
      if (error) {
        reportSupabaseError("refresh household members", error, { householdId });
        return;
      }
      setRoommates((current) => {
        const existingById = new Map([
          ...memberMetadataRef.current,
          ...current.map((member) => [member.id, member] as const),
        ]);
        return (data ?? []).map((member) => {
          const existing = existingById.get(member.user_id);
          return {
            id: member.user_id,
            name: member.display_name,
            color: member.color,
            role: member.role === "owner" ? "owner" : "member",
            points: existing?.points ?? 0,
            weeklyPoints: existing?.weeklyPoints ?? 0,
            avatarUri: existing?.avatarUri,
          };
        });
      });
    } finally {
      setMembersLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    void refreshMembers();
    const channel = supabase
      .channel(`household-members:${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_members",
          filter: `household_id=eq.${householdId}`,
        },
        () => void refreshMembers(),
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportSupabaseError(
            "subscribe to household members",
            error ?? new Error(status),
            { householdId, status },
          );
        }
      });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMembers();
    });
    return () => {
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [householdId, refreshMembers]);

  const createHousehold = useCallback(async (
    name: string,
    displayName: string,
    color: string,
    code: string,
    options?: { deferOnboarding?: boolean },
  ) => {
    const { data, error } = await supabase.rpc("create_household", {
      household_name: name.trim(), member_name: displayName.trim(), member_color: color,
      requested_invite_code: code,
    });
    if (error) {
      reportSupabaseError("create household", error);
      throw error;
    }
    const userId = session?.user.id;
    const createdSweetId = Array.isArray(data) ? data[0]?.household_id : undefined;
    if (!createdSweetId) throw new Error("The new Sweet was created without an identifier.");
    const isFirstSweet = memberships.length === 0;
    if (userId) {
      await AsyncStorage.setItem(activeSweetKey(userId), createdSweetId);
      if (isFirstSweet) {
        await AsyncStorage.mergeItem(
          userPreferencesKey(userId),
          JSON.stringify({ onboardingPending: !options?.deferOnboarding }),
        );
      }
    }
    if (isFirstSweet) setPreferencesOnboardingPending(!options?.deferOnboarding);
    setHouseholdCompleteState(false);
    if (userId) {
      setRoommates([{ id: userId, name: displayName.trim(), color, points: 0, weeklyPoints: 0 }]);
      choresRef.current = [];
      setChores([]); setExpenses([]); setShoppingLists([]); setShoppingItems([]);
      setShoppingSyncMeta(EMPTY_SHOPPING_SYNC_META);
      setBorrowItems([]); setPrivateBorrowItems([]); setNudges([]); setCurrentUserIdState(userId);
      setHouseholdId(createdSweetId);
      setHouseholdName(name.trim());
      setInviteCode(code);
      setCurrentMemberRole("owner");
      setMemberships((current) => [
        ...current.filter((membership) => membership.sweetId !== createdSweetId),
        {
          id: `${createdSweetId}:${userId}`,
          sweetId: createdSweetId,
          userId,
          name: name.trim(),
          role: "owner",
          status: "active",
          joinedAt: new Date().toISOString(),
          memberCount: 1,
          inviteCode: code,
        },
      ]);
    }
    setMembershipVersion((value) => value + 1);
    track.sweetCreated({ source: "setup" });
    return createdSweetId;
  }, [memberships.length, session?.user.id]);

  const refreshHousehold = useCallback(() => {
    setMembershipVersion((value) => value + 1);
  }, []);

  const joinHousehold = useCallback(async (code: string, displayName: string, color: string) => {
    const { data, error } = await supabase.rpc("join_household", {
      code: code.trim(), member_name: displayName.trim(), member_color: color,
    });
    if (error) {
      reportSupabaseError("join household", error);
      throw error;
    }
    const isFirstSweet = memberships.length === 0;
    if (session?.user.id) {
      if (typeof data === "string") {
        await AsyncStorage.setItem(activeSweetKey(session.user.id), data);
      }
      if (isFirstSweet) {
        await AsyncStorage.mergeItem(
          userPreferencesKey(session.user.id),
          JSON.stringify({ onboardingPending: true }),
        );
      }
    }
    if (isFirstSweet) setPreferencesOnboardingPending(true);
    if (session?.user.id) setCurrentUserIdState(session.user.id);
    setMembershipVersion((value) => value + 1);
    track.sweetJoined({ source: "invite" });
  }, [memberships.length, session?.user.id]);

  const leaveSweet = useCallback(async (sweetId: string) => {
    const { error } = await supabase.rpc("leave_household", {
      target_household_id: sweetId,
    });
    if (error) {
      reportSupabaseError("leave Sweet", error, { sweetId });
      throw error;
    }
    const remaining = memberships.filter((membership) => membership.sweetId !== sweetId);
    if (session?.user.id) {
      const fallback = remaining[0]?.sweetId;
      if (fallback) await AsyncStorage.setItem(activeSweetKey(session.user.id), fallback);
      else await AsyncStorage.removeItem(activeSweetKey(session.user.id));
    }
    if (sweetId === householdId) {
      if (remaining[0]) switchSweet(remaining[0].sweetId);
      else {
        setMemberships([]);
        setHouseholdId(null);
        setHouseholdName(null);
        setInviteCode(null);
      }
    }
    setMembershipVersion((value) => value + 1);
  }, [householdId, memberships, session?.user.id, switchSweet]);

  const deleteHousehold = useCallback(async () => {
    if (!householdId) throw new Error("No household is selected.");
    if (!isHost) {
      throw new Error("Only the household host can delete this household.");
    }
    const deletedHouseholdId = householdId;
    const userId = session?.user.id;
    const { error } = await supabase.rpc("delete_household", {
      target_household_id: deletedHouseholdId,
    });
    if (error) {
      reportSupabaseError("delete household", error, {
        householdId: deletedHouseholdId,
      });
      throw new Error("The household could not be deleted. Please try again.");
    }

    const remainingMemberships = memberships.filter(
      (membership) => membership.sweetId !== deletedHouseholdId,
    );
    membershipLoadGenerationRef.current += 1;
    delete sweetDataCacheRef.current[deletedHouseholdId];
    if (userId) {
      await AsyncStorage.multiRemove([
        sweetStateKey(userId, deletedHouseholdId),
        privateBorrowStateKey(userId, deletedHouseholdId),
      ]);
    }
    if (remainingMemberships[0] && userId) {
      setMemberships(remainingMemberships);
      await AsyncStorage.setItem(
        activeSweetKey(userId),
        remainingMemberships[0].sweetId,
      );
      switchSweet(remainingMemberships[0].sweetId);
      setMembershipVersion((value) => value + 1);
      return;
    }

    await AsyncStorage.removeItem(STORAGE_KEY);
    if (userId) {
      await AsyncStorage.removeItem(activeSweetKey(userId));
      await AsyncStorage.mergeItem(
        userPreferencesKey(userId),
        JSON.stringify({ onboardingPending: false }),
      );
    }
    setMemberships([]);
    setHouseholdId(null);
    setHouseholdName(null);
    setInviteCode(null);
    setCurrentMemberRole("member");
    setCloudReady(false);
    setHouseholdPreferencesReady(false);
    setPreferencesOnboardingPending(false);
    setHouseholdSetupStepState(null);
    setHouseholdCompleteState(false);
    setRoommates([]);
    setChores([]);
    setExpenses([]);
    setShoppingLists([]);
    setShoppingItems([]);
    setShoppingSyncMeta(EMPTY_SHOPPING_SYNC_META);
    setBorrowItems([]);
    setPrivateBorrowItems([]);
    setNudges([]);
    setAppAlerts([]);
    setSuppressedAlerts({});
    setEssentialsAssignees({});
    setEssentialOwnedState({});
    setEssentialShortlist({});
    setEssentialShortlistUpdatedBy(null);
    setRoommateStatusesState({});
    setSleepStartedAtState({});
    setHomeLocationState(null);
    setChoreChartState(null);
    setChoreChartStartedAtState(null);
    setHomeProfileState(null);
    setLiveChartState(null);
    setCustomTasks([]);
    setItemDifficulties([]);
    setMemberPreferences([]);
    setCurrentProposedChartState(null);
    setChartApprovals([]);
    setPendingIouDraftState(null);
    setMembershipVersion((value) => value + 1);
  }, [householdId, isHost, memberships, session?.user.id, switchSweet]);

  const removeRoommate = useCallback(async (roommateId: string) => {
    if (!householdId) throw new Error("No household is selected.");
    if (!isHost) throw new Error("Only the household host can remove a roommate.");
    if (roommateId === currentUserId) throw new Error("You cannot remove yourself.");
    const { error } = await supabase.rpc("remove_household_member", {
      target_household_id: householdId,
      target_user_id: roommateId,
    });
    if (error) {
      reportSupabaseError("remove household member", error, {
        householdId,
        roommateId,
      });
      throw error;
    }
    setRoommates((current) => current.filter((roommate) => roommate.id !== roommateId));
    setChores((current) => {
      const remainingIds = roommates
        .filter((roommate) => roommate.id !== roommateId)
        .map((roommate) => roommate.id);
      const next = current.map((chore) => {
        if (chore.completed || chore.assignedTo !== roommateId) return chore;
        if (chore.assignmentMode === "round-robin") {
          const participants = resolveRoundRobinParticipants(chore, remainingIds);
          const nextCursor = participants.length
            ? (chore.roundRobinCursor ?? 0) % participants.length
            : 0;
          return {
            ...chore,
            assignedTo: participants[nextCursor] ?? "",
            roundRobinParticipantIds: participants,
            roundRobinCursor: nextCursor,
            updatedAt: new Date().toISOString(),
          };
        }
        return {
          ...chore,
          assignedTo: "",
          assignmentMode: "unassigned" as const,
          updatedAt: new Date().toISOString(),
        };
      });
      choresRef.current = next;
      return next;
    });
    setMemberPreferences((current) => current.filter((entry) => entry.memberId !== roommateId));
    setCurrentProposedChartState(null);
    setChartApprovals([]);
  }, [currentUserId, householdId, isHost, roommates]);

  const deleteOwnAccount = useCallback(async () => {
    const { error } = await supabase.rpc("delete_own_account");
    if (error) {
      reportSupabaseError("delete own account", error);
      throw error;
    }
    await AsyncStorage.removeItem(STORAGE_KEY);
    if (session?.user.id) {
      await AsyncStorage.removeItem(userPreferencesKey(session.user.id));
      await deleteLocalAnalyticsIdentity(session.user.id);
    }
    await supabase.auth.signOut({ scope: "local" });
    setHouseholdId(null);
    setHouseholdName(null);
    setInviteCode(null);
    setRoommates([]);
    setChores([]);
    setExpenses([]);
    setShoppingLists([]);
    setShoppingItems([]);
    setShoppingSyncMeta(EMPTY_SHOPPING_SYNC_META);
    setBorrowItems([]);
    setPrivateBorrowItems([]);
    setNudges([]);
    setLiveChartState(null);
    setCustomTasks([]);
    setItemDifficulties([]);
    setMemberPreferences([]);
    setCurrentProposedChartState(null);
    setChartApprovals([]);
  }, [session?.user.id]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    AsyncStorage.getItem(userStateKey(userId))
      .then((raw) => {
        if (raw) {
          try {
          const data = JSON.parse(raw);
          // The legacy record is now treated as personal-only. Shared domain
          // collections are never hydrated without an explicit Sweet key.
          if (Array.isArray(data.appAlerts)) setAppAlerts(data.appAlerts);
          if (data.suppressedAlerts) setSuppressedAlerts(data.suppressedAlerts);
          // Identity is never restored from app storage. The authenticated
          // Supabase session is the only authority for the current user.
          } catch (error) {
            reportRuntimeError("parse cached household state", error);
          }
        }
      })
      .catch((error) => {
        reportRuntimeError("hydrate cached household state", error);
      })
      .finally(() => setLoaded(true));
  }, [session?.user.id]);

  useEffect(() => {
    if (!loaded || !session?.user.id) return;
    // Coalesce rapid mutations and move the full-state serialization off the
    // interaction frame. This is especially important when a user completes
    // a chore and immediately switches tabs.
    let interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      interaction = InteractionManager.runAfterInteractions(() => {
        const userId = session.user.id;
        const writes = [
          AsyncStorage.setItem(
            userStateKey(userId),
            JSON.stringify({ appAlerts, suppressedAlerts }),
          ),
        ];
        if (householdId) {
          writes.push(
            AsyncStorage.setItem(
              sweetStateKey(userId, householdId),
              JSON.stringify({
                roommates,
                chores,
                expenses,
                shoppingLists,
                shoppingItems,
                shoppingSyncMeta,
                borrowItems,
                essentialsAssignees,
                essentialOwned,
                essentialShortlist,
                essentialShortlistUpdatedBy,
                roommateStatuses,
                sleepStartedAt,
                homeLocation,
                choreChart,
                choreChartStartedAt,
                homeProfile,
                liveChart,
                customTasks,
              } satisfies SharedHouseholdState),
            ),
          );
        }
        Promise.all(writes).catch((error) =>
          reportRuntimeError("cache Sweet state", error, { householdId }),
        );
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      interaction?.cancel();
    };
  }, [appAlerts, borrowItems, choreChart, choreChartStartedAt, chores, currentUserId, customTasks, essentialOwned, essentialShortlist, essentialShortlistUpdatedBy, essentialsAssignees, expenses, homeLocation, homeProfile, householdId, liveChart, loaded, roommateStatuses, roommates, session?.user.id, shoppingItems, shoppingLists, shoppingSyncMeta, sleepStartedAt, suppressedAlerts]);

  const upsertInformationalAlerts = useCallback((incoming: AppAlert[]) => {
    if (!incoming.length) return;
    setAppAlerts((current) => {
      const existingKeys = new Set(current.map((alert) => alert.deduplicationKey));
      const additions = incoming.filter((alert) => !existingKeys.has(alert.deduplicationKey));
      return additions.length ? [...additions, ...current] : current;
    });
  }, []);

  const markAlertRead = useCallback((alertId: string) => {
    setAppAlerts((current) =>
      current.map((alert) => alert.id === alertId && !alert.readAt
        ? { ...alert, readAt: new Date().toISOString() }
        : alert),
    );
  }, []);

  const markAllAlertsRead = useCallback(() => {
    const readAt = new Date().toISOString();
    setAppAlerts((current) => current.map((alert) => alert.readAt ? alert : { ...alert, readAt }));
  }, []);

  useEffect(() => {
    if (!nudgesReady || !householdId || !currentUserId) return;
    const receivedAlerts = nudges
      .filter((nudge) => nudge.toRoommateId === currentUserId)
      .map((nudge): AppAlert => {
        const chore = chores.find((candidate) => candidate.id === nudge.choreId);
        return {
          id: `nudge:${nudge.id}`,
          type: "nudge",
          title: "You received a nudge",
          message: chore
            ? `Someone in your Sweet sent you a reminder about “${chore.title}”.`
            : "Someone in your Sweet sent you a reminder.",
          createdAt: nudge.sentAt,
          relatedEntityId: nudge.choreId,
          relatedEntityType: "chore",
          deduplicationKey: `nudge:${householdId}:${currentUserId}:${nudge.id}`,
          recipientId: currentUserId,
          severity: "info",
        };
      });
    upsertInformationalAlerts(receivedAlerts);
  }, [
    chores,
    currentUserId,
    householdId,
    nudges,
    nudgesReady,
    upsertInformationalAlerts,
  ]);

  useEffect(() => {
    if (!loaded || !householdId || !currentUserId || currentUserId === CURRENT_USER_ID) return;
    const now = new Date();
    const createdAt = now.toISOString();
    const incoming: AppAlert[] = [];
    chores
      .filter((chore) => !chore.completed && chore.assignedTo === currentUserId && new Date(chore.dueDate).getTime() < now.getTime())
      .forEach((chore) => incoming.push({
        id: `overdue-chore:${chore.id}`,
        type: "overdue-chore",
        title: "Chore overdue",
        message: `“${chore.title}” is past its due date.`,
        createdAt,
        relatedEntityId: chore.id,
        relatedEntityType: "chore",
        deduplicationKey: `overdue-chore:${householdId}:${currentUserId}:${chore.id}:${chore.dueDate}`,
        severity: "attention",
      }));
    expenses
      .filter((expense) =>
        !expense.settled &&
        (expense.paidBy === currentUserId || (expense.splits[currentUserId] ?? 0) > 0),
      )
      .forEach((expense) => incoming.push({
        id: `expense:${expense.id}`,
        type: "expense",
        title: "IOU still unsettled",
        message: `“${expense.title}” still has an outstanding balance.`,
        createdAt,
        relatedEntityId: expense.id,
        relatedEntityType: "expense",
        deduplicationKey: `expense:${householdId}:${currentUserId}:${expense.id}`,
        severity: "attention",
      }));
    visibleBorrowItems
      .filter((item) =>
        !item.returned &&
        (item.borrowedBy === currentUserId || item.borrowedFrom === currentUserId) &&
        new Date(item.dueDate).getTime() <= now.getTime(),
      )
      .forEach((item) => incoming.push({
        id: `borrowing:${item.id}`,
        type: "borrowing",
        title: "Borrowed item due",
        message: `“${item.item}” is due to be returned.`,
        createdAt,
        relatedEntityId: item.id,
        relatedEntityType: "borrow-item",
        deduplicationKey: `borrowing:${householdId}:${currentUserId}:${item.id}:${item.dueDate}`,
        severity: "attention",
      }));
    visibleBorrowItems
      .filter((item) =>
        !item.returned &&
        Boolean(item.returnRequestedAt) &&
        item.borrowedFrom === currentUserId,
      )
      .forEach((item) => incoming.push({
        id: `borrowing-return:${item.id}`,
        type: "borrowing",
        title: "Confirm item return",
        message: `Confirm that “${item.item}” was returned.`,
        createdAt,
        relatedEntityId: item.id,
        relatedEntityType: "borrow-item",
        deduplicationKey: `borrowing-return:${householdId}:${currentUserId}:${item.id}:${item.returnRequestedAt}`,
        severity: "attention",
      }));
    const approvedChart = currentProposedChart?.status === "approved" ? currentProposedChart : null;
    if ((approvedChart?.payload.assignments.length ?? 0) >= 2 && (approvedChart?.payload.generatedTasks?.length ?? 0) >= 3) {
      findAssignedLoadDeviations(
        approvedChart!.payload.assignments,
        approvedChart!.payload.generatedTasks ?? [],
      ).filter((deviation) => deviation.direction === "above").forEach((deviation) => {
        const member = memberMetadataRef.current.get(deviation.memberId);
        incoming.push({
          id: `difficulty-imbalance:${approvedChart!.id}:${deviation.memberId}`,
          type: "difficulty-imbalance",
          title: "Chore workload may be uneven",
          message: `${member?.name ?? "A Sweetmate"} has been assigned more chore difficulty than the Sweet average. You may want to rebalance upcoming tasks.`,
          createdAt,
          relatedEntityId: approvedChart!.id,
          relatedEntityType: "chore-chart",
          deduplicationKey: `difficulty-imbalance:${householdId}:${approvedChart!.id}:${deviation.memberId}`,
          severity: "attention",
        });
      });
    }
    upsertInformationalAlerts(incoming);
  }, [chores, currentProposedChart, currentUserId, expenses, householdId, loaded, upsertInformationalAlerts, visibleBorrowItems]);

  const memberRosterKey = useMemo(
    () => roommates.map((member) => `${member.id}:${member.name}`).sort().join("|"),
    [roommates],
  );

  useEffect(() => {
    if (!loaded || !householdId || membersLoading || !roommates.length) return;
    const currentIds = new Set(roommates.map((member) => member.id));
    const previous = previousMemberIdsRef.current;
    if (previous.householdId !== householdId || previous.ids.size === 0) {
      previousMemberIdsRef.current = { householdId, ids: currentIds };
      return;
    }
    const createdAt = new Date().toISOString();
    const joined = roommates.filter(
      (member) => member.id !== currentUserId && !previous.ids.has(member.id),
    );
    previousMemberIdsRef.current = { householdId, ids: currentIds };
    upsertInformationalAlerts(joined.map((member) => ({
      id: `membership:${householdId}:${member.id}`,
      type: "membership",
      title: "New Sweetmate joined",
      message: `${member.name} joined ${householdName ?? "your Sweet"}.`,
      createdAt,
      relatedEntityId: member.id,
      relatedEntityType: "member",
      deduplicationKey: `membership:${householdId}:${member.id}`,
      severity: "info",
    })));
  }, [currentUserId, householdId, householdName, loaded, memberRosterKey, membersLoading, upsertInformationalAlerts]);

  const sharedState = useMemo<SharedHouseholdState>(() => ({
    // Kept only for score/avatar synchronization. Active membership identity
    // always comes from household_members and snapshot-only IDs are ignored.
    roommates,
    chores,
    expenses,
    shoppingLists,
    shoppingItems,
    shoppingSyncMeta,
    borrowItems,
    essentialOwned,
    essentialShortlistUpdatedBy,
    roommateStatuses,
    sleepStartedAt,
    homeLocation,
    choreChart,
    choreChartStartedAt,
    homeProfile,
    liveChart,
    customTasks,
  }), [roommates, chores, expenses, shoppingLists, shoppingItems, shoppingSyncMeta, borrowItems, essentialOwned, essentialShortlistUpdatedBy, roommateStatuses, sleepStartedAt, homeLocation, choreChart, choreChartStartedAt, homeProfile, liveChart, customTasks]);

  const latestSharedStateRef = useRef(sharedState);
  latestSharedStateRef.current = sharedState;
  const chorePersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!householdId || !cloudReady) return;
    sweetDataCacheRef.current[householdId] = sharedState;
  }, [cloudReady, householdId, sharedState]);

  const applySharedState = useCallback((next: Partial<SharedHouseholdState>) => {
    // currentUserId, suppressedAlerts, and pendingIouDraft remain private to
    // this device. Shared tab collections all come from the cloud snapshot.
    // Snapshot roommates carry scores/avatars only. They can update active
    // members but can never add or remove membership identities.
    const remoteChores = Array.isArray(next.chores) ? next.chores : null;
    const remoteChoresById = new Map(
      (remoteChores ?? []).map((chore) => [chore.id, chore]),
    );
    const localChoresById = new Map(
      choresRef.current.map((chore) => [chore.id, chore]),
    );
    const hasNewerLocalChoreChange = remoteChores
      ? choresRef.current.some((local) => {
          const remote = remoteChoresById.get(local.id);
          return (
            (remote && (local.updatedAt ?? "") > (remote.updatedAt ?? "")) ||
            (!remote && local.id.startsWith("occurrence:"))
          );
        })
      : false;
    if (Array.isArray(next.roommates) && !hasNewerLocalChoreChange) {
      const snapshotById = new Map(next.roommates.map((member) => [member.id, member]));
      memberMetadataRef.current = snapshotById;
      setRoommates((activeMembers) =>
        activeMembers.map((member) => {
          const snapshot = snapshotById.get(member.id);
          return snapshot
            ? {
                ...member,
                points: snapshot.points ?? member.points,
                weeklyPoints: snapshot.weeklyPoints ?? member.weeklyPoints,
                avatarUri: snapshot.avatarUri ?? member.avatarUri,
              }
            : member;
        }),
      );
    }
    if (remoteChores) {
      const mergedChores = remoteChores.map((remote) => {
        const local = localChoresById.get(remote.id);
        return local && (local.updatedAt ?? "") > (remote.updatedAt ?? "")
          ? local
          : remote;
      });
      const mergedIds = new Set(mergedChores.map((chore) => chore.id));
      choresRef.current.forEach((local) => {
        if (local.id.startsWith("occurrence:") && !mergedIds.has(local.id)) {
          mergedChores.push(local);
        }
      });
      choresRef.current = mergedChores;
      setChores(mergedChores);
    }
    if (Array.isArray(next.expenses)) {
      const mergedExpenses = mergeByUpdatedAt(expensesRef.current, next.expenses);
      expensesRef.current = mergedExpenses;
      setExpenses(mergedExpenses);
    }
    const remoteMeta = next.shoppingSyncMeta ?? EMPTY_SHOPPING_SYNC_META;
    const localMeta = shoppingSyncMetaRef.current;
    const hasNewerLocalShoppingChange = (
      [
        ["listVersions", "deletedLists"],
        ["itemVersions", "deletedItems"],
      ] as const
    ).some(([versionKey, deletedKey]) => {
      const ids = new Set([
        ...Object.keys(localMeta[versionKey]),
        ...Object.keys(localMeta[deletedKey]),
      ]);
      return [...ids].some((id) => {
        const localVersion = localMeta[versionKey][id] ?? localMeta[deletedKey][id] ?? "";
        const remoteVersion = [
          remoteMeta[versionKey][id] ?? "",
          remoteMeta[deletedKey][id] ?? "",
        ].sort().at(-1) ?? "";
        return localVersion > remoteVersion;
      });
    });
    // A remote snapshot normally suppresses the persistence echo. If it raced
    // with a newer local shopping mutation, however, the merged snapshot must
    // be written back so the other member receives the local addition too.
    applyingRemoteRef.current =
      !hasNewerLocalShoppingChange && !hasNewerLocalChoreChange;
    const maxVersions = (
      local: Record<string, string>,
      remote: Record<string, string>,
    ) => {
      const merged = { ...local };
      Object.entries(remote).forEach(([id, version]) => {
        if (!merged[id] || version > merged[id]) merged[id] = version;
      });
      return merged;
    };
    if (Array.isArray(next.shoppingLists)) {
      setShoppingLists((local) => mergeVersionedShopping(
        local,
        next.shoppingLists!,
        localMeta.listVersions,
        remoteMeta.listVersions,
        localMeta.deletedLists,
        remoteMeta.deletedLists,
      ));
    }
    if (Array.isArray(next.shoppingItems)) {
      setShoppingItems((local) => mergeVersionedShopping(
        local,
        next.shoppingItems!,
        localMeta.itemVersions,
        remoteMeta.itemVersions,
        localMeta.deletedItems,
        remoteMeta.deletedItems,
      ));
    }
    const mergedMeta: ShoppingSyncMeta = {
      listVersions: maxVersions(localMeta.listVersions, remoteMeta.listVersions),
      itemVersions: maxVersions(localMeta.itemVersions, remoteMeta.itemVersions),
      deletedLists: maxVersions(localMeta.deletedLists, remoteMeta.deletedLists),
      deletedItems: maxVersions(localMeta.deletedItems, remoteMeta.deletedItems),
    };
    shoppingSyncMetaRef.current = mergedMeta;
    setShoppingSyncMeta(mergedMeta);
    if (Array.isArray(next.borrowItems)) {
      setBorrowItems(normalizeSharedBorrowItems(next.borrowItems));
    }
    // Essential assignments use atomic rows in
    // sweet_essential_item_assignments. Never apply the legacy snapshot field:
    // doing so could replace assignments created concurrently by another user.
    if (next.essentialOwned) {
      setEssentialOwnedState(migrateEssentialRecord(next.essentialOwned));
    }
    // The saved shortlist uses sweet_essential_shortlist_items. Ignore the
    // legacy snapshot field to avoid stale whole-document replacement.
    if ("essentialShortlistUpdatedBy" in next) {
      setEssentialShortlistUpdatedBy(next.essentialShortlistUpdatedBy ?? null);
    }
    if (next.roommateStatuses) setRoommateStatusesState(next.roommateStatuses);
    if (next.sleepStartedAt) setSleepStartedAtState(next.sleepStartedAt);
    if ("homeLocation" in next) setHomeLocationState(next.homeLocation ?? null);
    if ("choreChart" in next) setChoreChartState(next.choreChart ?? null);
    if ("choreChartStartedAt" in next) setChoreChartStartedAtState(next.choreChartStartedAt ?? null);
    if ("homeProfile" in next) setHomeProfileState(next.homeProfile ?? null);
    if ("liveChart" in next) setLiveChartState(next.liveChart ?? null);
    if (Array.isArray(next.customTasks)) setCustomTasks(next.customTasks);
  }, []);

  // Private borrowing records live outside the household-readable snapshot.
  // RLS returns only rows owned by the authenticated user, even if another
  // household member guesses an entry ID and queries the table directly.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !householdId) {
      setPrivateBorrowItems([]);
      return;
    }
    let active = true;
    // The cache read and the network fetch race independently; without this
    // flag, a slow AsyncStorage read that resolves after the network fetch
    // would silently overwrite fresh data with a stale local snapshot.
    let networkLoaded = false;
    const cacheKey = privateBorrowStateKey(userId, householdId);
    const channel = supabase.channel(`private-borrows:${userId}:${householdId}`);
    const normalizeRow = (row: {
      id: string;
      household_id: string;
      owner_id: string;
      entry: unknown;
    }): BorrowItem | null => {
      if (!row.entry || typeof row.entry !== "object") return null;
      const entry = row.entry as Partial<BorrowItem>;
      if (
        typeof entry.item !== "string" ||
        typeof entry.borrowedFrom !== "string" ||
        typeof entry.dueDate !== "string"
      ) return null;
      return {
        ...entry,
        id: row.id,
        item: entry.item,
        borrowedFrom: entry.borrowedFrom,
        dueDate: entry.dueDate,
        householdId: row.household_id,
        creatorId: row.owner_id,
        ownerId: row.owner_id,
        visibility: "private",
        returned: Boolean(entry.returned),
        borrowedAt: entry.borrowedAt ?? new Date().toISOString(),
      };
    };

    void AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!active || !raw || networkLoaded) return;
        const cached = JSON.parse(raw) as BorrowItem[];
        setPrivateBorrowItems(
          cached.filter(
            (entry) =>
              entry.ownerId === userId &&
              entry.householdId === householdId &&
              entry.visibility === "private",
          ),
        );
      })
      .catch((error) =>
        reportRuntimeError("hydrate private borrowing cache", error, { householdId }),
      );

    void supabase
      .from("private_borrow_items")
      .select("id, household_id, owner_id, entry")
      .eq("household_id", householdId)
      .then(({ data, error }) => {
        if (!active) return;
        networkLoaded = true;
        if (error) {
          reportSupabaseError("load private borrowing entries", error, { householdId });
          return;
        }
        setPrivateBorrowItems(
          (data ?? [])
            .map((row) => normalizeRow(row))
            .filter((entry): entry is BorrowItem => entry !== null),
        );
      });

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "private_borrow_items",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return;
          if (payload.eventType === "DELETE") {
            const deleted = payload.old as { id?: string };
            if (deleted.id) {
              setPrivateBorrowItems((current) =>
                current.filter((entry) => entry.id !== deleted.id),
              );
            }
            return;
          }
          const normalized = normalizeRow(payload.new as {
            id: string;
            household_id: string;
            owner_id: string;
            entry: unknown;
          });
          if (!normalized || normalized.householdId !== householdId) return;
          setPrivateBorrowItems((current) => [
            ...current.filter((entry) => entry.id !== normalized.id),
            normalized,
          ]);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [householdId, session?.user.id]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !householdId) return;
    void AsyncStorage.setItem(
      privateBorrowStateKey(userId, householdId),
      JSON.stringify(privateBorrowItems),
    ).catch((error) =>
      reportRuntimeError("cache private borrowing entries", error, { householdId }),
    );
  }, [householdId, privateBorrowItems, session?.user.id]);

  // Sweet Essential assignments are atomic member/item relationships. Load
  // them in one query and apply realtime row changes so concurrent users never
  // replace one another through the shared JSON snapshot.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !householdId) {
      setEssentialsAssignees({});
      return;
    }
    let active = true;
    type AssignmentRow = {
      household_id: string;
      section_key: string;
      item_id: string;
      user_id: string;
    };
    const channel = supabase.channel(`essential-assignments:${householdId}`);

    void supabase
      .from("sweet_essential_item_assignments")
      .select("household_id, section_key, item_id, user_id")
      .eq("household_id", householdId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          reportSupabaseError("load Sweet Essential assignments", error, {
            householdId,
          });
          return;
        }
        setEssentialsAssignees(
          migrateEssentialRecord(
            assignmentsFromRows((data ?? []) as AssignmentRow[]),
          ),
        );
      });

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sweet_essential_item_assignments",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (!active) return;
          const row = (payload.eventType === "DELETE"
            ? payload.old
            : payload.new) as Partial<AssignmentRow>;
          if (
            row.household_id !== householdId ||
            !row.section_key ||
            !row.item_id ||
            !row.user_id
          ) return;
          setEssentialsAssignees((current) =>
            setSelfAssignment(
              current,
              row.section_key!,
              row.item_id!,
              row.user_id!,
              payload.eventType !== "DELETE",
            ),
          );
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportSupabaseError(
            "subscribe to Sweet Essential assignments",
            error ?? new Error(status),
            { householdId, status },
          );
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [householdId, session?.user.id]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !householdId) {
      setEssentialShortlist({});
      setEssentialShortlistUpdatedBy(null);
      return;
    }
    let active = true;
    type ShortlistRow = {
      household_id: string;
      section_key: string;
      item_id: string;
      added_by: string | null;
    };
    const channel = supabase.channel(`essential-shortlist:${householdId}`);

    void supabase
      .from("sweet_essential_shortlist_items")
      .select("household_id, section_key, item_id, added_by")
      .eq("household_id", householdId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          reportSupabaseError("load Sweet Essential shortlist", error, {
            householdId,
          });
          return;
        }
        const rows = (data ?? []) as ShortlistRow[];
        setEssentialShortlist(
          migrateEssentialRecord(shortlistFromRows(rows)),
        );
        setEssentialShortlistUpdatedBy(rows.at(-1)?.added_by ?? null);
      });

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sweet_essential_shortlist_items",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (!active) return;
          const row = (payload.eventType === "DELETE"
            ? payload.old
            : payload.new) as Partial<ShortlistRow>;
          if (
            row.household_id !== householdId ||
            !row.section_key ||
            !row.item_id
          ) return;
          setEssentialShortlist((current) => {
            const section = { ...(current[row.section_key!] ?? {}) };
            if (payload.eventType === "DELETE") delete section[row.item_id!];
            else section[row.item_id!] = true;
            return { ...current, [row.section_key!]: section };
          });
          if (payload.eventType !== "DELETE") {
            setEssentialShortlistUpdatedBy(row.added_by ?? null);
          }
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportSupabaseError(
            "subscribe to Sweet Essential shortlist",
            error ?? new Error(status),
            { householdId, status },
          );
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [householdId, session?.user.id]);

  // Load the shared household document and subscribe to other devices.
  useEffect(() => {
    const userId = session?.user.id;
    if (!loaded || !userId || !householdId) {
      setCloudReady(false);
      return;
    }

    let active = true;
    const channel = supabase.channel(`household:${householdId}`);

    async function connect() {
      const { data, error } = await supabase
        .from("household_states")
        .select("state")
        .eq("household_id", householdId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        reportSupabaseError("load shared household state", error, { householdId });
        console.warn("SweetMate cloud sync could not start:", error.message);
        return;
      }

      if (data?.state) {
        applyingRemoteRef.current = true;
        const remote = data.state as Partial<SharedHouseholdState>;
        applySharedState(remote);
      } else {
        const { error: createError } = await supabase.from("household_states").upsert({
          household_key: householdId,
          household_id: householdId,
          state: latestSharedStateRef.current,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
        if (createError) {
          reportSupabaseError("create shared household state", createError, { householdId });
          console.warn("SweetMate household could not be created:", createError.message);
          return;
        }
      }

      if (!active) return;
      setCloudReady(true);
      channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "household_states",
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            const row = payload.new as { state?: Partial<SharedHouseholdState>; updated_by?: string };
            if (!row.state || row.updated_by === userId) return;
            applyingRemoteRef.current = true;
            applySharedState(row.state);
          }
        )
        .subscribe((status, error) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reportSupabaseError(
              "subscribe to shared household state",
              error ?? new Error(status),
              { householdId, status },
            );
          }
        });
    }

    connect().catch((error) => {
      reportRuntimeError("connect shared household state", error, { householdId });
    });
    return () => {
      active = false;
      setCloudReady(false);
      supabase.removeChannel(channel);
    };
  }, [applySharedState, householdId, loaded, session?.user.id]);

  // Coalesce quick mutations into one update and ignore realtime echoes.
  useEffect(() => {
    const userId = session?.user.id;
    if (!loaded || !cloudReady || !userId || !householdId) return;
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }

    let interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      interaction = InteractionManager.runAfterInteractions(async () => {
        const { error } = await supabase.from("household_states").upsert({
          household_key: householdId,
          household_id: householdId,
          state: latestSharedStateRef.current,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
        if (error) {
          reportSupabaseError("save shared household state", error, { householdId });
          console.warn("SweetMate change could not sync:", error.message);
        }
      });
    }, 220);
    return () => {
      clearTimeout(timer);
      interaction?.cancel();
    };
  }, [cloudReady, householdId, loaded, session?.user.id, sharedState]);

  // Nudges live in their own table so acknowledgement is per row and updates
  // immediately on every signed-in device. Never select sent_by: received
  // reminders are deliberately anonymous in the client.
  useEffect(() => {
    if (!householdId || !session?.user.id) {
      setNudges([]);
      setNudgesReady(false);
      return;
    }
    let active = true;
    const channel = supabase.channel(`nudges:${householdId}`);

    const refreshNudges = async () => {
      const { data, error } = await supabase
        .from("nudges")
        .select("id, to_member_id, chore_id, sent_at, seen, seen_at, dismissed_at")
        .eq("household_id", householdId)
        .is("dismissed_at", null)
        .order("sent_at", { ascending: false });
      if (!active) return;
      if (error) {
        // Allow the app to remain usable while the additive `seen` migration
        // is being rolled out. The fallback can be removed after every
        // environment has 202607240001.
        if (error.code === "42703") {
          const legacyResult = await supabase
            .from("nudges")
            .select("id, to_member_id, chore_id, sent_at")
            .eq("household_id", householdId)
            .order("sent_at", { ascending: false });
          if (!active) return;
          if (legacyResult.error) {
            reportSupabaseError("load legacy household nudges", legacyResult.error, { householdId });
            return;
          }
          setNudges((legacyResult.data ?? []).map((row) => ({
            id: row.id,
            toRoommateId: row.to_member_id,
            choreId: row.chore_id,
            sentAt: row.sent_at,
            seen: false,
          })));
          setNudgesReady(true);
          return;
        }
        reportSupabaseError("load household nudges", error, { householdId });
        return;
      }
      setNudges((data ?? []).map((row) => ({
        id: row.id,
        toRoommateId: row.to_member_id,
        choreId: row.chore_id,
        sentAt: row.sent_at,
        seen: row.seen,
        seenAt: row.seen_at ?? undefined,
        dismissedAt: row.dismissed_at ?? undefined,
      })));
      setNudgesReady(true);
    };

    void refreshNudges();
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "nudges",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void refreshNudges();
        }
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reportSupabaseError(
            "subscribe to household nudges",
            error ?? new Error(status),
            { householdId, status },
          );
        }
      });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshNudges();
    });

    return () => {
      active = false;
      appStateSubscription.remove();
      setNudgesReady(false);
      void supabase.removeChannel(channel);
    };
  }, [householdId, session?.user.id]);

  // Load deterministic-chart configuration and keep it live across roommates.
  useEffect(() => {
    if (!householdId || !session?.user.id) {
      setItemDifficulties([]);
      setMemberPreferences([]);
      setCurrentProposedChartState(null);
      setChartApprovals([]);
      return;
    }
    let active = true;
    const channel = supabase.channel(`chore-foundation:${householdId}`);

    const refresh = async () => {
      const [difficultyResult, preferenceResult, chartResult] = await Promise.all([
        supabase.from("item_difficulty").select("id, household_id, category, item, difficulty").eq("household_id", householdId),
        supabase.from("member_task_preferences").select("id, household_id, member_id, key, value").eq("household_id", householdId),
        supabase.from("proposed_charts").select("id, household_id, created_by, status, payload, created_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!active) return;
      if (difficultyResult.error) {
        reportSupabaseError("load item difficulties", difficultyResult.error, { householdId });
      }
      if (preferenceResult.error) {
        reportSupabaseError("load member task preferences", preferenceResult.error, { householdId });
      }
      if (chartResult.error) {
        reportSupabaseError("load proposed chart", chartResult.error, { householdId });
      }
      setItemDifficulties((difficultyResult.data ?? []).map((row) => ({
        id: row.id,
        householdId: row.household_id,
        category: row.category as ItemCategory,
        item: row.item,
        difficulty: row.difficulty as Difficulty,
      })));
      setMemberPreferences((preferenceResult.data ?? []).map((row) => ({
        id: row.id,
        householdId: row.household_id,
        memberId: row.member_id,
        key: row.key,
        value: row.value,
      })));
      const row = chartResult.data;
      const chart = row ? {
        id: row.id,
        householdId: row.household_id,
        createdBy: row.created_by,
        status: row.status as ProposedChart["status"],
        payload: row.payload as ProposedChart["payload"],
        createdAt: row.created_at,
      } as ProposedChart : null;
      setCurrentProposedChartState(chart);
      if (chart) {
        const { data: approvalRows, error: approvalsError } = await supabase
          .from("proposed_chart_approvals")
          .select("id, proposed_chart_id, member_id, approved, approved_at")
          .eq("proposed_chart_id", chart.id);
        if (approvalsError) {
          reportSupabaseError("load proposed chart approvals", approvalsError, {
            householdId,
            chartId: chart.id,
          });
        }
        if (!active) return;
        setChartApprovals((approvalRows ?? []).map((approval) => ({
          id: approval.id,
          proposedChartId: approval.proposed_chart_id,
          memberId: approval.member_id,
          approved: approval.approved,
          approvedAt: approval.approved_at,
        })));
      } else {
        setChartApprovals([]);
      }

      if (chart?.status === "approved") {
        setLiveChartState(chart.payload.assignments);
        const generated = chart.payload.generatedTasks ?? [];
        const ownerByTask = new Map<string, string>();
        chart.payload.assignments.forEach((assignment) => {
          assignment.taskIds.forEach((taskId) => ownerByTask.set(taskId, assignment.memberId));
        });
        setChores((current) => {
          const existingIds = new Set(current.map((chore) => chore.id));
          const additions: Chore[] = generated.flatMap((task) => {
            const id = `chart:${chart.id}:${task.id}`;
            const assignedTo = ownerByTask.get(task.id);
            if (!assignedTo || existingIds.has(id)) return [];
            return [{
              id,
              title: task.title,
              assignedTo,
              dueDate: daysFromNow(7),
              completed: false,
              points: task.difficulty * 5,
              category: task.itemCategory === "living" ? "cleaning" : task.itemCategory === "other" ? "other" : task.itemCategory,
              recurring: task.frequency === "daily" ? "daily" : task.frequency === "monthly" ? "monthly" : "weekly",
            }];
          });
          return additions.length ? [...current, ...additions] : current;
        });
      }
    };

    refresh().catch((error) => {
      reportRuntimeError("refresh deterministic chart state", error, { householdId });
    });
    for (const table of ["item_difficulty", "member_task_preferences", "proposed_charts", "proposed_chart_approvals"] as const) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` },
        () => {
          refresh().catch((error) => {
            reportRuntimeError("refresh deterministic chart state", error, {
              householdId,
              table,
            });
          });
        },
      );
    }
    channel.subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reportSupabaseError("subscribe to deterministic chart state", error ?? new Error(status), {
          householdId,
          status,
        });
      }
    });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [householdId, session?.user.id]);

  const addChore = useCallback((chore: Omit<Chore, "id">) => {
    const activeMemberIds = new Set(roommates.map((roommate) => roommate.id));
    if (
      !chore.title.trim() ||
      !Number.isFinite(new Date(chore.dueDate).getTime()) ||
      (chore.assignedTo && !activeMemberIds.has(chore.assignedTo)) ||
      (chore.householdId && chore.householdId !== householdId)
    ) {
      return null;
    }
    if (
      chore.assignmentMode === "round-robin" &&
      !(chore.roundRobinParticipantIds ?? []).some((id) => activeMemberIds.has(id))
    ) {
      return null;
    }
    if (
      chore.sourceKey &&
      choresRef.current.some((item) => item.sourceKey === chore.sourceKey)
    ) {
      return null;
    }

    const id = makeId();
    const now = new Date().toISOString();
    const next: Chore = {
      ...chore,
      id,
      householdId: chore.householdId ?? householdId ?? undefined,
      creatorId: chore.creatorId ?? session?.user.id ?? currentUserId,
      assignmentMode: chore.assignmentMode ?? "specific-person",
      initialDueDate: chore.initialDueDate ?? chore.dueDate,
      nextDueDate: chore.nextDueDate ?? chore.dueDate,
      scheduledDate: chore.scheduledDate ?? choreLocalDateKey(chore.dueDate),
      initialScheduledDate:
        chore.initialScheduledDate ??
        choreLocalDateKey(chore.initialDueDate ?? chore.dueDate),
      monthlyAnchorDay:
        chore.monthlyAnchorDay ??
        Number(choreLocalDateKey(chore.initialDueDate ?? chore.dueDate).slice(-2)),
      roundRobinCursor: chore.roundRobinCursor ?? 0,
      occurrenceIndex: chore.occurrenceIndex ?? 0,
      recurrenceSeriesId: chore.recurring
        ? chore.recurrenceSeriesId ?? id
        : undefined,
      createdAt: chore.createdAt ?? now,
      updatedAt: now,
    };
    const updated = [...choresRef.current, next];
    choresRef.current = updated;
    setChores(updated);
    track.choreCreated({ recurring: Boolean(chore.recurring) });
    return id;
  }, [currentUserId, householdId, roommates, session?.user.id]);

  const activeSweet = useMemo(
    () => memberships.find((membership) => membership.sweetId === householdId) ?? null,
    [householdId, memberships],
  );

  const permissionsForChore = useCallback((chore: Chore) =>
    resolveChorePermissions({
      currentUserId: session?.user.id ?? "",
      isActiveMember: isActiveSweetMember(activeSweet, householdId, session?.user.id),
      isOwner: isHost,
      chore,
    }),
  [activeSweet, householdId, isHost, session?.user.id]);

  const canManageChore = useCallback((chore: Chore) =>
    permissionsForChore(chore).canEdit,
  [permissionsForChore]);

  const updateChore = useCallback((
    id: string,
    updates: Partial<Omit<Chore, "id">>,
  ): boolean => {
    const current = choresRef.current.find((chore) => chore.id === id);
    if (!current || current.completed || !canManageChore(current)) return false;
    const candidate: Chore = {
      ...current,
      ...updates,
      id: current.id,
      householdId: current.householdId ?? householdId ?? undefined,
      creatorId: current.creatorId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (updates.dueDate && updates.dueDate !== current.dueDate) {
      const previousScheduledDate = choreScheduledDate(current);
      candidate.scheduledDate = choreLocalDateKey(updates.dueDate);
      // Moving a recurring occurrence to a different calendar date orphans
      // it from the series' regular walk: the next materialization pass
      // would otherwise see the original slot as still empty and generate
      // a phantom duplicate there. Excluding the vacated date prevents that.
      if (candidate.recurring && candidate.scheduledDate !== previousScheduledDate) {
        candidate.excludedOccurrenceDates = [
          ...new Set([...(candidate.excludedOccurrenceDates ?? []), previousScheduledDate]),
        ];
      }
    }
    const activeMemberIds = new Set(roommates.map((roommate) => roommate.id));
    if (
      !candidate.title.trim() ||
      !Number.isFinite(new Date(candidate.dueDate).getTime()) ||
      (candidate.assignedTo && !activeMemberIds.has(candidate.assignedTo)) ||
      (candidate.householdId && candidate.householdId !== householdId) ||
      (candidate.assignmentMode === "round-robin" &&
        !(candidate.roundRobinParticipantIds ?? []).some((memberId) =>
          activeMemberIds.has(memberId),
        ))
    ) {
      return false;
    }
    const next = choresRef.current.map((chore) =>
      chore.id === id ? candidate : chore,
    );
    choresRef.current = next;
    setChores(next);
    return true;
  }, [canManageChore, householdId, roommates]);

  const addChores = useCallback((newChores: Omit<Chore, "id">[]): number => {
    const current = choresRef.current;
    const sourceKeys = new Set(current.flatMap((chore) => chore.sourceKey ? [chore.sourceKey] : []));
    const manualTitles = new Set(current.filter((chore) => !chore.sourceKey).map((chore) => chore.title.trim().toLowerCase()));
    const accepted: Chore[] = [];
    for (const chore of newChores) {
      const titleKey = chore.title.trim().toLowerCase();
      if ((chore.sourceKey && sourceKeys.has(chore.sourceKey)) || (!chore.sourceKey && manualTitles.has(titleKey))) continue;
      if (chore.sourceKey) sourceKeys.add(chore.sourceKey);
      else manualTitles.add(titleKey);
      const id = makeId();
      const now = new Date().toISOString();
      accepted.push({
        ...chore,
        id,
        householdId: chore.householdId ?? householdId ?? undefined,
        creatorId: chore.creatorId ?? session?.user.id ?? currentUserId,
        assignmentMode: chore.assignmentMode ?? "specific-person",
        initialDueDate: chore.initialDueDate ?? chore.dueDate,
        nextDueDate: chore.nextDueDate ?? chore.dueDate,
        scheduledDate: chore.scheduledDate ?? choreLocalDateKey(chore.dueDate),
        initialScheduledDate:
          chore.initialScheduledDate ??
          choreLocalDateKey(chore.initialDueDate ?? chore.dueDate),
        monthlyAnchorDay:
          chore.monthlyAnchorDay ??
          Number(choreLocalDateKey(chore.initialDueDate ?? chore.dueDate).slice(-2)),
        roundRobinCursor: chore.roundRobinCursor ?? 0,
        occurrenceIndex: chore.occurrenceIndex ?? 0,
        recurrenceSeriesId: chore.recurring
          ? chore.recurrenceSeriesId ?? id
          : undefined,
        createdAt: chore.createdAt ?? now,
        updatedAt: now,
      });
    }
    if (accepted.length) {
      const next = [...current, ...accepted];
      choresRef.current = next;
      setChores(next);
    }
    return accepted.length;
  }, [currentUserId, householdId, session?.user.id]);

  // Apply an explicit desired state. Repeated completion intents are no-ops,
  // preventing delayed presses/realtime rerenders from reversing the result or
  // awarding points twice.
  const setChoreCompleted = useCallback((id: string, completed: boolean) => {
    const chore = choresRef.current.find((c) => c.id === id);
    const allowed = Boolean(chore) && permissionsForChore(chore!).canComplete;
    logChorePermissionCheck("complete", {
      choreId: id,
      currentUserId: session?.user.id,
      householdId,
      isActiveMember: isActiveSweetMember(activeSweet, householdId, session?.user.id),
      isOwner: isHost,
      allowed,
    });
    if (!chore || !allowed) return;
    const transition = choreCompletionTransition(
      chore.completed,
      completed,
      chore.points,
    );
    if (!transition.changed) return;
    if (completed) {
      track.choreCompleted({ recurring: Boolean(chore.recurring) });
    }
    const wasCompleted = chore.completed;
    const delta = transition.pointsDelta;
    const completedAt = choreNow().toISOString();

    let nextChores: Chore[];
    if (wasCompleted) {
      const generated = chore.nextOccurrenceId
        ? choresRef.current.find((candidate) => candidate.id === chore.nextOccurrenceId)
        : undefined;
      nextChores = choresRef.current
        .filter((candidate) =>
          !generated || generated.completed || candidate.id !== generated.id,
        )
        .map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                completed: false,
                completedAt: undefined,
                completedByUserId: undefined,
                nextOccurrenceId: generated?.completed
                  ? candidate.nextOccurrenceId
                  : undefined,
                updatedAt: completedAt,
              }
            : candidate,
        );
    } else if (chore.recurring) {
      const monthlyAnchorDay =
        chore.monthlyAnchorDay ??
        Number(
          choreLocalDateKey(chore.initialDueDate ?? chore.dueDate).slice(-2),
        );
      let nextScheduledDate = advanceScheduledDate(
        choreScheduledDate(chore),
        chore.recurring,
        monthlyAnchorDay,
      );
      let nextDueDate = advanceChoreDueDate(
        chore.dueDate,
        chore.recurring,
        monthlyAnchorDay,
      );
      let recurrenceSteps = 1;
      const todayKey = choreLocalDateKey(choreNow());
      while (nextScheduledDate <= todayKey) {
        nextScheduledDate = advanceScheduledDate(
          nextScheduledDate,
          chore.recurring,
          monthlyAnchorDay,
        );
        nextDueDate = advanceChoreDueDate(
          nextDueDate,
          chore.recurring,
          monthlyAnchorDay,
        );
        recurrenceSteps += 1;
      }

      const recurrenceStopped =
        Boolean(chore.recurrenceEndsOn && nextScheduledDate >= chore.recurrenceEndsOn) ||
        (chore.excludedOccurrenceDates ?? []).includes(nextScheduledDate);
      if (recurrenceStopped) {
        nextChores = choresRef.current.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                completed: true,
                completedAt,
                completedByUserId: currentUserId,
                nextOccurrenceId: undefined,
                updatedAt: completedAt,
              }
            : candidate,
        );
      } else {
        const activeMemberIds = roommates.map((roommate) => roommate.id);
        const participants = resolveRoundRobinParticipants(chore, activeMemberIds);
        const currentCursor = chore.roundRobinCursor ?? Math.max(
          participants.indexOf(chore.assignedTo),
          0,
        );
        const nextCursor = participants.length
          ? (currentCursor + recurrenceSteps) % participants.length
          : 0;
        const existingNextOccurrence = choresRef.current.find((candidate) =>
          candidate.id !== chore.id &&
          (candidate.recurrenceSeriesId ?? candidate.id) ===
            (chore.recurrenceSeriesId ?? chore.id) &&
          choreScheduledDate(candidate) === nextScheduledDate
        );
        const seriesId = chore.recurrenceSeriesId ?? chore.id;
        const nextId = existingNextOccurrence?.id ?? recurringOccurrenceId(
          chore.householdId,
          seriesId,
          nextScheduledDate,
        );
        const nextOccurrence: Chore = {
          ...chore,
          id: nextId,
          assignedTo:
            chore.assignmentMode === "round-robin"
              ? participants[nextCursor] ?? chore.assignedTo
              : chore.assignedTo,
          roundRobinParticipantIds: participants.length
            ? participants
            : chore.roundRobinParticipantIds,
          roundRobinCursor: nextCursor,
          dueDate: nextDueDate,
          scheduledDate: nextScheduledDate,
          initialScheduledDate:
            chore.initialScheduledDate ??
            choreLocalDateKey(chore.initialDueDate ?? chore.dueDate),
          monthlyAnchorDay,
          nextDueDate,
          completed: false,
          completedAt: undefined,
          completedByUserId: undefined,
          occurrenceIndex: (chore.occurrenceIndex ?? 0) + recurrenceSteps,
          nextOccurrenceId: undefined,
          createdAt: completedAt,
          updatedAt: completedAt,
        };
        nextChores = choresRef.current.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                completed: true,
                completedAt,
                completedByUserId: currentUserId,
                nextOccurrenceId: nextId,
                updatedAt: completedAt,
              }
            : candidate,
        );
        if (!existingNextOccurrence) {
          nextChores.push(nextOccurrence);
          const userScope = session?.user.id;
          if (userScope) {
            void carryMappedReminderToNextOccurrence(userScope, id, {
              id: nextOccurrence.id,
              title: nextOccurrence.title,
              dueDate: nextOccurrence.dueDate,
              category: nextOccurrence.category,
              recurrence: nextOccurrence.recurring,
              assignedToName: roommatesRef.current.find(
                (roommate) => roommate.id === nextOccurrence.assignedTo,
              )?.name,
            }).catch((error) =>
              reportRuntimeError("carry reminder to next occurrence", error, {
                choreId: id,
                nextChoreId: nextOccurrence.id,
              }),
            );
          }
        }
      }
    } else {
      nextChores = choresRef.current.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              completed: true,
              completedAt,
              completedByUserId: currentUserId,
              updatedAt: completedAt,
            }
          : candidate,
      );
    }
    choresRef.current = nextChores;
    setChores(nextChores);
    const nextRoommates = roommatesRef.current.map((r) =>
        r.id === chore.assignedTo
          ? {
              ...r,
              points: r.points + delta,
              weeklyPoints: r.weeklyPoints + delta,
            }
          : r
    );
    roommatesRef.current = nextRoommates;
    setRoommates(nextRoommates);

    // Completion is a high-value interaction: update the canonical cloud
    // snapshot immediately instead of waiting for the generic deferred cache
    // writer. The queue keeps rapid completions ordered and always writes the
    // newest combined chore/score state.
    latestSharedStateRef.current = {
      ...latestSharedStateRef.current,
      chores: nextChores,
      roommates: nextRoommates,
    };
    if (cloudReady && householdId && session?.user.id) {
      chorePersistenceQueueRef.current = chorePersistenceQueueRef.current.then(
        async () => {
          const { error } = await supabase.from("household_states").upsert({
            household_key: householdId,
            household_id: householdId,
            state: latestSharedStateRef.current,
            updated_by: session.user.id,
            updated_at: new Date().toISOString(),
          });
          if (error) {
            reportSupabaseError("save completed chore state", error, {
              householdId,
              choreId: id,
            });
          }
        },
      );
    }
  }, [activeSweet, cloudReady, currentUserId, householdId, isHost, permissionsForChore, roommates, session?.user.id]);

  const completeChore = useCallback((id: string) => {
    const chore = choresRef.current.find((candidate) => candidate.id === id);
    if (chore) setChoreCompleted(id, !chore.completed);
  }, [setChoreCompleted]);

  const PICKUP_BONUS = 25;

  const pickUpChore = useCallback((choreId: string, completedById: string) => {
    const chore = choresRef.current.find((candidate) => candidate.id === choreId);
    if (!chore || chore.completed) return;
    completeChore(choreId);
    setRoommates((prev) =>
      prev.map((r) => {
        if (r.id === completedById) {
          const earned =
            r.id === chore.assignedTo ? PICKUP_BONUS : chore.points + PICKUP_BONUS;
          return {
            ...r,
            points: r.points + earned,
            weeklyPoints: r.weeklyPoints + earned,
          };
        }
        if (r.id === chore.assignedTo) {
          return {
            ...r,
            points: r.points - chore.points,
            weeklyPoints: r.weeklyPoints - chore.points,
          };
        }
        return r;
      })
    );
  }, [completeChore]);

  const deleteChore = useCallback((
    id: string,
    scope: RecurringChoreDeleteScope = "occurrence",
  ): boolean => {
    const target = choresRef.current.find((chore) => chore.id === id);
    if (!target || !permissionsForChore(target).canDelete) return false;
    const changedAt = choreNow().toISOString();
    const next = deleteRecurringChore(
      choresRef.current,
      target,
      scope,
      changedAt,
    );
    choresRef.current = next;
    setChores(next);
    track.choreDeleted({ recurring: Boolean(target.recurring) });
    return true;
  }, [permissionsForChore]);

  const addExpense = useCallback((expense: Omit<Expense, "id">) => {
    const activeMemberIds = new Set(roommates.map((roommate) => roommate.id));
    if (
      !activeMemberIds.has(expense.paidBy) ||
      expense.sharedWith.some((id) => !activeMemberIds.has(id)) ||
      (expense.shoppingSource && expense.shoppingSource.householdId !== householdId) ||
      (expense.allocations &&
        !storedExpenseAllocationIsValid(
          expense.amountCents ?? Math.round(expense.amount * 100),
          expense.sharedWith,
          expense.allocations,
          activeMemberIds,
        ))
    ) {
      throw new Error("Expense participants and allocations must belong to the active household.");
    }
    const id = makeId();
    const now = new Date().toISOString();
    setExpenses((prev) => [...prev, {
      ...expense,
      id,
      creatorId: currentUserId,
      createdAt: expense.createdAt ?? now,
      updatedAt: now,
      resolvedAt: expense.settled ? expense.resolvedAt ?? now : undefined,
    }]);
    track.expenseCreated({ recurring: Boolean(expense.recurring) });
    return id;
  }, [currentUserId, householdId, roommates]);

  const canManageExpense = useCallback(
    (expense: Expense) =>
      isHost ||
      (expense.creatorId
        ? expense.creatorId === currentUserId
        : expense.paidBy === currentUserId),
    [currentUserId, isHost],
  );

  const canEditExpense = useCallback(
    (expense: Expense) =>
      expense.creatorId
        ? expense.creatorId === currentUserId
        : expense.paidBy === currentUserId,
    [currentUserId],
  );

  const updateExpense = useCallback(
    (id: string, updates: Partial<Omit<Expense, "id">>) => {
      const current = expenses.find((expense) => expense.id === id);
      if (!current || !canEditExpense(current)) return false;
      const candidate = { ...current, ...updates };
      const activeMemberIds = new Set(roommates.map((roommate) => roommate.id));
      if (
        !activeMemberIds.has(candidate.paidBy) ||
        (candidate.shoppingSource &&
          candidate.shoppingSource.householdId !== householdId) ||
        candidate.sharedWith.some((memberId) => !activeMemberIds.has(memberId)) ||
        (candidate.allocations &&
          !storedExpenseAllocationIsValid(
            candidate.amountCents ?? Math.round(candidate.amount * 100),
            candidate.sharedWith,
            candidate.allocations,
            activeMemberIds,
          ))
      ) return false;
      setExpenses((prev) => prev.map((expense) =>
        expense.id === id
          ? { ...expense, ...updates, creatorId: expense.creatorId ?? currentUserId, updatedAt: new Date().toISOString() }
          : expense,
      ));
      return true;
    },
    [canEditExpense, currentUserId, expenses, householdId, roommates],
  );

  const settleExpense = useCallback((id: string) => {
    const current = expenses.find((expense) => expense.id === id);
    if (!current || !canManageExpense(current)) return false;
    const now = new Date().toISOString();
    setExpenses((prev) => prev.map((expense) =>
      expense.id === id
        ? { ...expense, settled: true, resolvedAt: expense.resolvedAt ?? now, updatedAt: now }
        : expense,
    ));
    track.iouSettled();
    return true;
  }, [canManageExpense, expenses]);

  const deleteExpense = useCallback((id: string) => {
    const current = expenses.find((expense) => expense.id === id);
    if (!current || !canManageExpense(current)) return false;
    setExpenses((prev) => prev.filter((expense) => expense.id !== id));
    return true;
  }, [canManageExpense, expenses]);

  const markPersonPaid = useCallback((expenseId: string, personId: string) => {
    setExpenses((prev) =>
      prev.map((e) => {
        if (e.id !== expenseId) return e;
        const paidBack = { ...(e.paidBack ?? {}), [personId]: true };
        const allPaid = Object.keys(e.splits ?? {}).every(
          (id) => id === e.paidBy || paidBack[id]
        );
        const resolvedAt = allPaid ? e.resolvedAt ?? new Date().toISOString() : e.resolvedAt;
        return { ...e, paidBack, settled: allPaid ? true : e.settled, resolvedAt };
      })
    );
  }, []);

  const recordShoppingVersions = useCallback((
    kind: "list" | "item",
    ids: string[],
    deleted = false,
  ) => {
    if (!ids.length) return;
    const actor = session?.user.id ?? "local";
    const version = `${Date.now().toString().padStart(13, "0")}:${actor}:${Math.random()
      .toString(36)
      .slice(2, 9)}`;
    const current = shoppingSyncMetaRef.current;
    const versionKey = kind === "list" ? "listVersions" : "itemVersions";
    const deletedKey = kind === "list" ? "deletedLists" : "deletedItems";
    const next: ShoppingSyncMeta = {
      ...current,
      [versionKey]: { ...current[versionKey] },
      [deletedKey]: { ...current[deletedKey] },
    };
    ids.forEach((id) => {
      if (deleted) {
        next[deletedKey][id] = version;
        delete next[versionKey][id];
      } else {
        next[versionKey][id] = version;
        delete next[deletedKey][id];
      }
    });
    shoppingSyncMetaRef.current = next;
    setShoppingSyncMeta(next);
  }, [session?.user.id]);

  const addShoppingList = useCallback((name: string, plannedDate?: string) => {
    const id = makeId();
    recordShoppingVersions("list", [id]);
    setShoppingLists((prev) => {
      // Insert at the TOP of the unpinned partition.
      const newList: ShoppingList = { id, name, plannedDate };
      const pinned = prev.filter((l) => l.pinned);
      const unpinned = prev.filter((l) => !l.pinned);
      return [...pinned, newList, ...unpinned];
    });
    track.shoppingListCreated();
    return id;
  }, [recordShoppingVersions]);

  // Accept whatever id order the DraggableFlatList emits, then re-partition
  // pinned-first / unpinned-second while preserving the user's relative order
  // within each group. `shoppingLists` is the ONLY source of truth for the
  // rendered order — consumers pass it directly to DraggableFlatList (no
  // per-render re-sort).
  const reorderShoppingLists = useCallback((newIds: string[]) => {
    recordShoppingVersions("list", newIds);
    setShoppingLists((prev) => {
      const byId = new Map(prev.map((l) => [l.id, l]));
      // Rebuild in the exact order the drag emitted, keeping every list.
      const reordered: ShoppingList[] = [];
      newIds.forEach((id) => {
        const l = byId.get(id);
        if (l) {
          reordered.push(l);
          byId.delete(id);
        }
      });
      // Defensive: append any list that wasn't in newIds (shouldn't happen).
      byId.forEach((l) => reordered.push(l));
      // Enforce the pinned-first partition after the drag.
      const pinnedArr = reordered.filter((l) => l.pinned);
      const unpinnedArr = reordered.filter((l) => !l.pinned);
      return [...pinnedArr, ...unpinnedArr];
    });
  }, [recordShoppingVersions]);

  const pinShoppingList = useCallback((id: string, pinned: boolean) => {
    recordShoppingVersions("list", [id]);
    setShoppingLists((prev) => {
      const target = prev.find((l) => l.id === id);
      if (!target) return prev;
      const updated: ShoppingList = { ...target, pinned };
      const others = prev.filter((l) => l.id !== id);
      const pinnedArr = others.filter((l) => l.pinned);
      const unpinnedArr = others.filter((l) => !l.pinned);
      // Pin: move to the TOP of the pinned partition.
      // Unpin: move to the TOP of the unpinned partition.
      return pinned
        ? [updated, ...pinnedArr, ...unpinnedArr]
        : [...pinnedArr, updated, ...unpinnedArr];
    });
  }, [recordShoppingVersions]);

  const deleteShoppingList = useCallback((id: string) => {
    recordShoppingVersions("list", [id], true);
    recordShoppingVersions(
      "item",
      shoppingItemsRef.current.filter((item) => item.listId === id).map((item) => item.id),
      true,
    );
    setShoppingLists((prev) => prev.filter((l) => l.id !== id));
    setShoppingItems((prev) => prev.filter((s) => s.listId !== id));
  }, [recordShoppingVersions]);

  const addShoppingItem = useCallback((item: Omit<ShoppingItem, "id">) => {
    const id = makeId();
    recordShoppingVersions("item", [id]);
    setShoppingItems((prev) => [...prev, { ...item, id }]);
    track.shoppingItemAdded();
  }, [recordShoppingVersions]);

  const addSelectedEssentialsToShopping = useCallback(
    (selection: EssentialShortlist): EssentialShoppingTransferResult => {
      const transfer = transferEssentialsToShopping({
        selection,
        catalog: ESSENTIAL_CATALOG,
        lists: shoppingListsRef.current,
        items: shoppingItemsRef.current,
        addedBy: currentUserId,
        makeId,
      });
      if (transfer.createdListIds.length) {
        recordShoppingVersions("list", transfer.createdListIds);
      }
      if (transfer.createdItemIds.length) {
        recordShoppingVersions("item", transfer.createdItemIds);
      }
      if (
        transfer.createdListIds.length ||
        transfer.createdItemIds.length
      ) {
        shoppingListsRef.current = transfer.lists;
        shoppingItemsRef.current = transfer.items;
        setShoppingLists(transfer.lists);
        setShoppingItems(transfer.items);
      }
      return transfer.result;
    },
    [currentUserId, recordShoppingVersions],
  );

  const toggleShoppingItem = useCallback((id: string) => {
    recordShoppingVersions("item", [id]);
    setShoppingItems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
    );
  }, [recordShoppingVersions]);

  const deleteShoppingItem = useCallback((id: string) => {
    recordShoppingVersions("item", [id], true);
    setShoppingItems((prev) => prev.filter((s) => s.id !== id));
  }, [recordShoppingVersions]);

  // Accept the visible order emitted by NestableDraggableFlatList and rewrite
  // the items belonging to `listId` in that order, then enforce the unchecked-
  // first / checked-last partition so users can drag freely within either
  // partition without the sort snapping items back on the next render.
  const reorderShoppingItems = useCallback((listId: string, newIds: string[]) => {
    recordShoppingVersions("item", newIds);
    setShoppingItems((prev) => {
      const inList = prev.filter((s) => s.listId === listId);
      const byId = new Map(inList.map((s) => [s.id, s]));
      const reordered: ShoppingItem[] = [];
      newIds.forEach((id) => {
        const s = byId.get(id);
        if (s) {
          reordered.push(s);
          byId.delete(id);
        }
      });
      byId.forEach((s) => reordered.push(s));
      const unchecked = reordered.filter((s) => !s.completed);
      const checked = reordered.filter((s) => s.completed);
      const finalListItems = [...unchecked, ...checked];
      // Splice the reordered items back into the flat array at the position of
      // this list's first item so other lists' relative ordering is preserved.
      const firstIdx = prev.findIndex((s) => s.listId === listId);
      const others = prev.filter((s) => s.listId !== listId);
      if (firstIdx === -1) return prev;
      return [
        ...others.slice(0, firstIdx),
        ...finalListItems,
        ...others.slice(firstIdx),
      ];
    });
  }, [recordShoppingVersions]);

  const assignShoppingList = useCallback((id: string, roommateId: string | null) => {
    recordShoppingVersions("list", [id]);
    setShoppingLists((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, assignedTo: roommateId ?? undefined }
          : l
      )
    );
  }, [recordShoppingVersions]);

  const assignShoppingItem = useCallback((id: string, roommateIds: string[]) => {
    recordShoppingVersions("item", [id]);
    setShoppingItems((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, assignedTo: roommateIds.length > 0 ? roommateIds : undefined } : s
      )
    );
  }, [recordShoppingVersions]);

  const updateShoppingItemPrice = useCallback((id: string, price: number | null) => {
    recordShoppingVersions("item", [id]);
    setShoppingItems((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, price: price ?? undefined } : s
      )
    );
  }, [recordShoppingVersions]);

  const linkShoppingItemsToExpense = useCallback((itemIds: string[], expenseId: string) => {
    recordShoppingVersions("item", itemIds);
    const ids = new Set(itemIds);
    setShoppingItems((current) =>
      current.map((item) =>
        ids.has(item.id)
          ? { ...item, convertedExpenseId: expenseId }
          : item,
      ),
    );
  }, [recordShoppingVersions]);

  const persistPrivateBorrowItem = useCallback((
    entry: BorrowItem,
    rollback?: BorrowItem,
  ) => {
    const userId = session?.user.id;
    if (
      !userId ||
      !householdId ||
      entry.ownerId !== userId ||
      entry.visibility !== "private"
    ) return;
    void supabase.from("private_borrow_items").upsert({
      id: entry.id,
      household_id: householdId,
      owner_id: userId,
      entry,
      updated_at: entry.updatedAt ?? new Date().toISOString(),
    }).then(({ error }) => {
      if (error) {
        reportSupabaseError("save private borrowing entry", error, { householdId });
        setPrivateBorrowItems((current) => rollback
          ? [
              ...current.filter((candidate) => candidate.id !== entry.id),
              rollback,
            ]
          : current.filter((candidate) => candidate.id !== entry.id),
        );
      }
    });
  }, [householdId, session?.user.id]);

  const addBorrowItem = useCallback((item: Omit<BorrowItem, "id">) => {
    const owner = roommates.find((member) => member.id === item.borrowedFrom);
    const borrower = roommates.find((member) => member.id === item.borrowedBy);
    const userId = session?.user.id;
    if (
      !userId ||
      !owner ||
      !borrower ||
      !hasValidBorrowParticipants(
        owner.id,
        borrower.id,
        roommates.map((member) => member.id),
      ) ||
      !item.item.trim() ||
      !Number.isFinite(new Date(item.borrowedAt).getTime()) ||
      !Number.isFinite(new Date(item.dueDate).getTime()) ||
      (item.householdId && item.householdId !== householdId)
    ) {
      return null;
    }
    const id = makeId();
    const now = new Date().toISOString();
    const entry: BorrowItem = {
      ...item,
      id,
      householdId: householdId ?? undefined,
      creatorId: userId,
      ownerId: userId,
      visibility: item.visibility === "private" ? "private" : "shared",
      ownerName: owner.name,
      borrowerName: borrower.name,
      createdAt: now,
      updatedAt: now,
    };
    if (entry.visibility === "private") {
      setPrivateBorrowItems((prev) => [...prev, entry]);
      persistPrivateBorrowItem(entry);
    } else {
      setBorrowItems((prev) => [...prev, entry]);
    }
    track.borrowingItemAdded();
    return id;
  }, [householdId, persistPrivateBorrowItem, roommates, session?.user.id]);

  const updateBorrowItem = useCallback(
    (id: string, updates: Partial<Omit<BorrowItem, "id">>): boolean => {
      const current = visibleBorrowItems.find((item) => item.id === id);
      if (
        !current ||
        !canManageBorrowItem(current, currentUserId, isHost)
      ) return false;
      const isPrivate = current.visibility === "private";
      const ownerId = updates.borrowedFrom ?? current.borrowedFrom;
      const borrowerId = updates.borrowedBy ?? current.borrowedBy;
      const owner = roommates.find((member) => member.id === ownerId);
      const borrower = roommates.find((member) => member.id === borrowerId);
      const nextItem = updates.item ?? current.item;
      const borrowedAt = updates.borrowedAt ?? current.borrowedAt;
      const dueDate = updates.dueDate ?? current.dueDate;
      if (
        !owner ||
        !borrower ||
        !hasValidBorrowParticipants(
          owner.id,
          borrower.id,
          roommates.map((member) => member.id),
        ) ||
        !nextItem.trim() ||
        !Number.isFinite(new Date(borrowedAt).getTime()) ||
        !Number.isFinite(new Date(dueDate).getTime())
      ) return false;
      const updated: BorrowItem = {
        ...current,
        ...updates,
        id,
        ownerName: owner.name,
        borrowerName: borrower.name,
        creatorId: current.creatorId ?? currentUserId,
        ownerId: current.ownerId ?? currentUserId,
        householdId: current.householdId ?? householdId ?? undefined,
        visibility: isPrivate ? "private" : "shared",
        updatedAt: new Date().toISOString(),
      };
      if (isPrivate) {
        setPrivateBorrowItems((prev) =>
          prev.map((item) => item.id === id ? updated : item),
        );
        persistPrivateBorrowItem(updated, current);
      } else {
        setBorrowItems((prev) =>
          prev.map((item) => item.id === id ? updated : item),
        );
      }
      return true;
    },
    [currentUserId, householdId, isHost, persistPrivateBorrowItem, roommates, visibleBorrowItems],
  );

  const returnBorrowItem = useCallback((id: string) => {
    const current = visibleBorrowItems.find((item) => item.id === id);
    if (!current) return false;
    const isPrivate = current.visibility === "private";
    if (isPrivate && current.ownerId !== currentUserId) return false;
    const isOwner = current.borrowedFrom === currentUserId;
    const isBorrower = current.borrowedBy === currentUserId;
    if (!isPrivate && !isOwner && !isBorrower && !isHost) return false;
    if (current.returned && !isPrivate && !isOwner && !isHost) return false;
    track.borrowingItemReturned();
    const now = new Date().toISOString();
    const identity = {
      creatorId: current.creatorId ?? currentUserId,
      ownerId: current.ownerId ?? currentUserId,
      householdId: current.householdId ?? householdId ?? undefined,
      ownerName: current.ownerName ?? roommates.find((member) => member.id === current.borrowedFrom)?.name,
      borrowerName: current.borrowerName ?? roommates.find((member) => member.id === current.borrowedBy)?.name,
    };
    const updated: BorrowItem = current.returned
      ? {
          ...current,
          ...identity,
          returned: false,
          returnedAt: undefined,
          returnRequestedAt: undefined,
          returnConfirmedBy: undefined,
          updatedAt: now,
        }
      : isPrivate || isOwner || isHost
        ? {
            ...current,
            ...identity,
            returned: true,
            returnedAt: now,
            returnRequestedAt: current.returnRequestedAt ?? now,
            returnConfirmedBy: currentUserId,
            updatedAt: now,
          }
        : { ...current, ...identity, returnRequestedAt: now, updatedAt: now };
    if (isPrivate) {
      setPrivateBorrowItems((prev) =>
        prev.map((entry) => entry.id === id ? updated : entry),
      );
      persistPrivateBorrowItem(updated, current);
    } else {
      setBorrowItems((prev) =>
        prev.map((entry) => entry.id === id ? updated : entry),
      );
    }
    return true;
  }, [currentUserId, householdId, isHost, persistPrivateBorrowItem, roommates, visibleBorrowItems]);

  const deleteBorrowItem = useCallback(async (id: string) => {
    const current = visibleBorrowItems.find((item) => item.id === id);
    if (
      !current ||
      !canManageBorrowItem(current, currentUserId, isHost)
    ) return false;
    const isPrivate = current.visibility === "private";
    if (isPrivate) {
      setPrivateBorrowItems((prev) => prev.filter((entry) => entry.id !== id));
      const { error } = await supabase
        .from("private_borrow_items")
        .delete()
        .eq("id", id);
      if (error) {
        reportSupabaseError("delete private borrowing entry", error, { householdId });
        setPrivateBorrowItems((prev) => [
          ...prev.filter((entry) => entry.id !== current.id),
          current,
        ]);
        return false;
      }
    } else {
      setBorrowItems((prev) => prev.filter((entry) => entry.id !== id));
    }
    return true;
  }, [currentUserId, householdId, isHost, visibleBorrowItems]);

  const setEssentialSelfAssignment = useCallback(async (
    sectionKey: string,
    itemId: string,
    assigned: boolean,
  ) => {
    const userId = session?.user.id;
    if (!userId || !householdId) return false;
    if (!isActiveSweetMember(activeSweet, householdId, userId)) return false;
    setEssentialsAssignees((current) =>
      setSelfAssignment(current, sectionKey, itemId, userId, assigned),
    );
    const query = assigned
      ? supabase.from("sweet_essential_item_assignments").upsert(
          {
            household_id: householdId,
            section_key: sectionKey,
            item_id: itemId,
            user_id: userId,
          },
          { onConflict: "household_id,section_key,item_id,user_id" },
        )
      : supabase
          .from("sweet_essential_item_assignments")
          .delete()
          .eq("household_id", householdId)
          .eq("section_key", sectionKey)
          .eq("item_id", itemId)
          .eq("user_id", userId);
    const { error } = await query;
    if (error) {
      reportSupabaseError(
        assigned ? "assign Sweet Essential" : "unassign Sweet Essential",
        error,
        { householdId, sectionKey, itemId },
      );
      setEssentialsAssignees((current) =>
        setSelfAssignment(current, sectionKey, itemId, userId, !assigned),
      );
      return false;
    }
    return true;
  }, [activeSweet, householdId, session?.user.id]);

  const setEssentialOwned = useCallback((sectionKey: string, itemId: string, owned: boolean) => {
    setEssentialOwnedState((current) => ({
      ...current,
      [sectionKey]: { ...(current[sectionKey] ?? {}), [itemId]: owned },
    }));
  }, []);

  const saveEssentialShortlist = useCallback(async (
    next: EssentialShortlist,
    baseline: EssentialShortlist = essentialShortlist,
  ) => {
    const userId = session?.user.id;
    if (!userId || !householdId) return false;
    const previous = essentialShortlist;
    setEssentialShortlist(next);
    setEssentialShortlistUpdatedBy(userId);
    const { data, error } = await supabase.rpc("save_sweet_essential_shortlist", {
      target_household_id: householdId,
      selected_items: shortlistSelectionRows(next),
      removed_items: removedShortlistRows(baseline, next),
    });
    if (error) {
      reportSupabaseError("save Sweet Essential shortlist", error, { householdId });
      setEssentialShortlist(previous);
      return false;
    }
    if (Array.isArray(data)) {
      setEssentialShortlist(
        migrateEssentialRecord(
          shortlistFromRows(data as Array<{ section_key: string; item_id: string }>),
        ),
      );
    }
    return true;
  }, [essentialShortlist, householdId, session?.user.id]);

  const sendNudge = useCallback(async (toRoommateId: string, choreId: string) => {
    if (!householdId || !session?.user.id) {
      throw new Error("Your household is still loading.");
    }
    const { error } = await supabase.from("nudges").insert({
      household_id: householdId,
      to_member_id: toRoommateId,
      chore_id: choreId,
      sent_by: session.user.id,
    });
    if (error) {
      reportSupabaseError("send anonymous nudge", error, {
        householdId,
        choreId,
        recipientId: toRoommateId,
      });
      throw error;
    }
    track.nudgeSent({ channel: "in_app" });
  }, [householdId, session?.user.id]);

  const suppressAlert = useCallback((id: string) => {
    setSuppressedAlerts((prev) => ({ ...prev, [id]: true }));
  }, []);

  const setRoommateStatus = useCallback((id: string, status: RoommateStatus) => {
    setRoommateStatusesState((prev) => ({ ...prev, [id]: status }));
    setSleepStartedAtState((prev) => {
      if (status === "asleep") {
        return { ...prev, [id]: Date.now() };
      }
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Auto-revert "asleep" → "home" after 9 hours; schedules the next-due timer
  // and runs an immediate sweep on load (covers app being closed past expiry).
  useEffect(() => {
    if (!loaded) return;
    const now = Date.now();
    const expired: string[] = [];
    let nextExpiry = Infinity;
    for (const [id, startedAt] of Object.entries(sleepStartedAt)) {
      if (roommateStatuses[id] !== "asleep") continue;
      const expiresAt = startedAt + ASLEEP_AUTO_REVERT_MS;
      if (expiresAt <= now) expired.push(id);
      else if (expiresAt < nextExpiry) nextExpiry = expiresAt;
    }
    if (expired.length > 0) {
      setRoommateStatusesState((prev) => {
        const next = { ...prev };
        for (const id of expired) if (next[id] === "asleep") next[id] = "home";
        return next;
      });
      setSleepStartedAtState((prev) => {
        const next = { ...prev };
        for (const id of expired) delete next[id];
        return next;
      });
      return;
    }
    if (nextExpiry === Infinity) return;
    const t = setTimeout(() => {
      setSleepStartedAtState((prev) => ({ ...prev }));
    }, nextExpiry - now);
    return () => clearTimeout(t);
  }, [loaded, sleepStartedAt, roommateStatuses]);

  const setHomeLocation = useCallback((loc: HomeLocation | null) => {
    setHomeLocationState(loc);
  }, []);

  const setChoreChart = useCallback(
    (data: ChoreChartData | null, startedAt: string | null) => {
      setChoreChartState(data);
      setChoreChartStartedAtState(startedAt);
    },
    []
  );

  const setLiveChart = useCallback((assignments: Assignment[] | null) => {
    setLiveChartState(assignments);
  }, []);

  const addCustomTask = useCallback((task: Omit<CustomTask, "id">) => {
    setCustomTasks((current) => [...current, { ...task, id: makeId() }]);
  }, []);

  const deleteCustomTask = useCallback((id: string) => {
    setCustomTasks((current) => current.filter((task) => task.id !== id));
  }, []);

  const setHouseholdComplete = useCallback((complete: boolean) => {
    setHouseholdCompleteState(complete);
  }, []);

  useEffect(() => {
    if (!householdComplete || !householdId) return;
    Promise.resolve(
      supabase.rpc("seed_item_difficulty", { target_household_id: householdId }),
    ).then(
      ({ error }) => {
        if (error) {
          reportSupabaseError("seed item difficulties", error, { householdId });
          console.warn("Item difficulties could not be seeded:", error.message);
        }
      },
    ).catch((error) => {
      reportRuntimeError("seed item difficulties", error, { householdId });
    });
  }, [householdComplete, householdId]);

  const setItemDifficulty = useCallback(async (
    category: ItemCategory,
    item: string,
    difficulty: Difficulty,
  ) => {
    if (!householdId) throw new Error("No household is selected.");
    const { error } = await supabase.from("item_difficulty").upsert(
      { household_id: householdId, category, item, difficulty },
      { onConflict: "household_id,category,item" },
    );
    if (error) {
      reportSupabaseError("save item difficulty", error, { householdId, category, item });
      throw error;
    }
    setItemDifficulties((current) => {
      const next = current.filter((entry) => !(entry.category === category && entry.item === item));
      return [...next, { householdId, category, item, difficulty }];
    });
  }, [householdId]);

  const resetItemDifficulties = useCallback(async () => {
    if (!householdId) throw new Error("No household is selected.");
    const { error: deleteError } = await supabase
      .from("item_difficulty")
      .delete()
      .eq("household_id", householdId);
    if (deleteError) {
      reportSupabaseError("clear item difficulties", deleteError, { householdId });
      throw deleteError;
    }
    const { error: seedError } = await supabase.rpc("seed_item_difficulty", {
      target_household_id: householdId,
    });
    if (seedError) {
      reportSupabaseError("reset item difficulties", seedError, { householdId });
      throw seedError;
    }
  }, [householdId]);

  const setMemberPreference = useCallback(async (key: string, value: number) => {
    const memberId = session?.user.id;
    if (!householdId || !memberId) throw new Error("No household member is selected.");
    const normalizedValue = Math.max(0, Math.min(100, Math.round(value)));
    const { error } = await supabase.from("member_task_preferences").upsert(
      {
        household_id: householdId,
        member_id: memberId,
        key,
        value: normalizedValue,
      },
      { onConflict: "household_id,member_id,key" },
    );
    if (error) {
      reportSupabaseError("save member task preference", error, {
        householdId,
        memberId,
        key,
      });
      throw error;
    }
    setMemberPreferences((current) => [
      ...current.filter((entry) => !(entry.memberId === memberId && entry.key === key)),
      { householdId, memberId, key, value: normalizedValue },
    ]);
  }, [householdId, session?.user.id]);

  const setCurrentProposedChart = useCallback(async (chart: ProposedChart | null) => {
    if (!householdId) throw new Error("No household is selected.");
    if (!chart) {
      if (currentProposedChart) {
        const { error } = await supabase
          .from("proposed_charts")
          .update({ status: "cancelled" })
          .eq("id", currentProposedChart.id);
        if (error) {
          reportSupabaseError("cancel proposed chart", error, {
            householdId,
            chartId: currentProposedChart.id,
          });
          throw error;
        }
      }
      setCurrentProposedChartState(null);
      return;
    }
    const { error } = await supabase.from("proposed_charts").upsert({
      id: chart.id,
      household_id: householdId,
      created_by: chart.createdBy,
      status: chart.status,
      payload: chart.payload,
      created_at: chart.createdAt,
    });
    if (error) {
      reportSupabaseError("save proposed chart", error, {
        householdId,
        chartId: chart.id,
      });
      throw error;
    }
    setCurrentProposedChartState(chart);
  }, [currentProposedChart, householdId]);

  const proposeChart = useCallback(async (payload: ProposedChart["payload"]) => {
    if (!householdId) throw new Error("No household is selected.");
    const { error } = await supabase.rpc("replace_proposed_chart", {
      target_household_id: householdId,
      chart_payload: payload,
    });
    if (error) {
      reportSupabaseError("replace proposed chart", error, { householdId });
      throw error;
    }
  }, [householdId]);

  const approveProposedChart = useCallback(async () => {
    if (!currentProposedChart || currentProposedChart.status !== "pending") return;
    const { error } = await supabase.rpc("approve_proposed_chart", {
      target_chart_id: currentProposedChart.id,
    });
    if (error) {
      reportSupabaseError("approve proposed chart", error, {
        chartId: currentProposedChart.id,
      });
      throw error;
    }
  }, [currentProposedChart]);

  const forceApproveProposedChart = useCallback(async () => {
    if (!currentProposedChart || currentProposedChart.status !== "pending") return;
    const { error } = await supabase.rpc("force_approve_proposed_chart", {
      target_chart_id: currentProposedChart.id,
    });
    if (error) {
      reportSupabaseError("force approve proposed chart", error, {
        chartId: currentProposedChart.id,
      });
      throw error;
    }
  }, [currentProposedChart]);

  const restartChartProcess = useCallback(async () => {
    if (!householdId) return;
    const { error } = await supabase.rpc("cancel_proposed_charts", {
      target_household_id: householdId,
    });
    if (error) {
      reportSupabaseError("restart chart process", error, { householdId });
      throw error;
    }
    setCurrentProposedChartState(null);
    setChartApprovals([]);
  }, [householdId]);

  const setCurrentUser = useCallback((id: string) => {
    // Legacy callers may refresh the signed-in profile, but must never
    // impersonate another household member inside this authenticated session.
    if (id === session?.user.id) setCurrentUserIdState(id);
  }, [session?.user.id]);

  const setPendingIouDraft = useCallback((draft: PendingIouDraft | null) => {
    setPendingIouDraftState(draft);
  }, []);

  const removeNudge = useCallback(async (toRoommateId: string, choreId: string) => {
    if (!householdId) throw new Error("Your household is still loading.");
    const { error } = await supabase
      .from("nudges")
      .delete()
      .eq("household_id", householdId)
      .eq("to_member_id", toRoommateId)
      .eq("chore_id", choreId)
      .eq("seen", false);
    if (error) {
      reportSupabaseError("remove anonymous nudge", error, {
        householdId,
        choreId,
        recipientId: toRoommateId,
      });
      throw error;
    }
    setNudges((current) =>
      current.filter((nudge) => !(nudge.toRoommateId === toRoommateId && nudge.choreId === choreId))
    );
  }, [householdId]);

  const acknowledgeNudge = useCallback(async (nudgeId: string) => {
    if (!householdId || !session?.user.id) {
      throw new Error("Your household is still loading.");
    }
    const { error } = await supabase
      .from("nudges")
      .update({ seen: true, seen_at: new Date().toISOString() })
      .eq("id", nudgeId)
      .eq("household_id", householdId)
      .eq("to_member_id", session.user.id);
    if (error) {
      reportSupabaseError("acknowledge received nudge", error, {
        householdId,
        nudgeId,
      });
      throw error;
    }
    setNudges((current) =>
      current.map((nudge) =>
        nudge.id === nudgeId
          ? { ...nudge, seen: true, seenAt: new Date().toISOString() }
          : nudge,
      )
    );
  }, [householdId, session?.user.id]);

  const dismissNudge = useCallback(async (nudgeId: string) => {
    if (!householdId || !session?.user.id) {
      throw new Error("Your household is still loading.");
    }
    const dismissedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("nudges")
      .update({ dismissed_at: dismissedAt })
      .eq("id", nudgeId)
      .eq("household_id", householdId)
      .eq("to_member_id", session.user.id)
      .select("id")
      .maybeSingle();
    if (error) {
      reportSupabaseError("dismiss received nudge", error, {
        householdId,
        nudgeId,
      });
      throw error;
    }
    if (!data) {
      throw new Error("Only the recipient can dismiss this nudge.");
    }
    setNudges((current) =>
      current.filter((nudge) => nudge.id !== nudgeId),
    );
  }, [householdId, session?.user.id]);

  const getRoommateById = useCallback(
    (id: string) => roommates.find((r) => r.id === id),
    [roommates]
  );

  const updateRoommate = useCallback(
    async (id: string, patch: Partial<Pick<Roommate, "name" | "color" | "avatarUri">>) => {
      if (id !== session?.user.id || !householdId) {
        throw new Error("You can only update your own active Sweetmate profile.");
      }
      const membershipPatch: { display_name?: string; color?: string } = {};
      if (patch.name !== undefined) membershipPatch.display_name = patch.name.trim();
      if (patch.color !== undefined) membershipPatch.color = patch.color;
      if (Object.keys(membershipPatch).length > 0) {
        const { error } = await supabase
          .from("household_members")
          .update(membershipPatch)
          .eq("household_id", householdId)
          .eq("user_id", id);
        if (error) {
          reportSupabaseError("update household member profile", error, { householdId });
          throw error;
        }
      }
      setRoommates((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      );
    },
    [householdId, session?.user.id]
  );

  const getChoresByRoommate = useCallback(
    (id: string) => chores.filter((c) => c.assignedTo === id),
    [chores]
  );

  const getBalances = useCallback((): Record<string, number> => {
    const balanceCents: Record<string, number> = {};
    roommates.forEach((r) => (balanceCents[r.id] = 0));
    expenses
      .filter((e) => !e.settled)
      .forEach((e) => {
        Object.entries(e.splits ?? {}).forEach(([personId, amount]) => {
          if (personId !== e.paidBy && !(e.paidBack ?? {})[personId]) {
            const cents = Math.round((amount as number) * 100);
            balanceCents[personId] = (balanceCents[personId] ?? 0) - cents;
            balanceCents[e.paidBy] = (balanceCents[e.paidBy] ?? 0) + cents;
          }
        });
      });
    return Object.fromEntries(
      Object.entries(balanceCents).map(([memberId, cents]) => [memberId, cents / 100]),
    );
  }, [expenses, roommates]);

  // AppProvider also owns synchronization-only state (hydration flags,
  // realtime readiness, auth token refreshes). Those updates should not
  // broadcast a brand-new context object to every mounted tab when none of
  // the values that screens consume changed.
  const visibleAppAlerts = useMemo(
    () => householdId
      ? appAlerts.filter((alert) => alert.deduplicationKey.includes(`:${householdId}:`))
      : [],
    [appAlerts, householdId],
  );

  const contextValue = useMemo<AppContextType>(() => ({
    itemDifficulties,
    setItemDifficulty,
    resetItemDifficulties,
    memberPreferences,
    setMemberPreference,
    currentProposedChart,
    setCurrentProposedChart,
    liveChart,
    setLiveChart,
    customTasks,
    addCustomTask,
    deleteCustomTask,
    chartApprovals,
    proposeChart,
    approveProposedChart,
    forceApproveProposedChart,
    restartChartProcess,
    isHost,
    preferencesLoaded,
    preferencesOnboardingPending,
    finishPreferencesOnboarding,
    householdSetupStep,
    setHouseholdSetupStep,
    completeHouseholdSetup,
    quickGuideOpen,
    openQuickGuide,
    dismissQuickGuide,
    appAlerts: visibleAppAlerts,
    markAlertRead,
    markAllAlertsRead,
    householdComplete,
    setHouseholdComplete,
    colorScheme,
    setColorScheme,
    pointsEnabled,
    setPointsEnabled,
    plantEnabled,
    setPlantEnabled,
    roommateActivityEnabled,
    setRoommateActivityEnabled,
    leaderboardPeriod,
    setLeaderboardPeriod,
    householdId,
    memberships,
    activeSweetId: householdId,
    activeSweet,
    householdName,
    inviteCode,
    householdLoading,
    householdError,
    membersLoading,
    currentMemberRole,
    refreshMembers,
    refreshHousehold,
    createHousehold,
    joinHousehold,
    switchSweet,
    leaveSweet,
    deleteHousehold,
    removeRoommate,
    deleteOwnAccount,
    currentUserId,
    setCurrentUser,
    roommates,
    chores,
    expenses,
    shoppingLists,
    shoppingItems,
    borrowItems: visibleBorrowItems,
    nudges,
    nudgesReady,
    addChore,
    updateChore,
    addChores,
    setChoreCompleted,
    completeChore,
    pickUpChore,
    deleteChore,
    addExpense,
    updateExpense,
    settleExpense,
    deleteExpense,
    canEditExpense,
    canManageExpense,
    markPersonPaid,
    addShoppingList,
    reorderShoppingLists,
    pinShoppingList,
    deleteShoppingList,
    addShoppingItem,
    addSelectedEssentialsToShopping,
    toggleShoppingItem,
    deleteShoppingItem,
    reorderShoppingItems,
    assignShoppingList,
    assignShoppingItem,
    updateShoppingItemPrice,
    linkShoppingItemsToExpense,
    pendingIouDraft,
    setPendingIouDraft,
    addBorrowItem,
    updateBorrowItem,
    returnBorrowItem,
    deleteBorrowItem,
    sendNudge,
    removeNudge,
    acknowledgeNudge,
    dismissNudge,
    getRoommateById,
    updateRoommate,
    getChoresByRoommate,
    getBalances,
    essentialsAssignees,
    setEssentialSelfAssignment,
    essentialOwned,
    essentialShortlist,
    essentialShortlistUpdatedBy,
    setEssentialOwned,
    saveEssentialShortlist,
    suppressedAlerts,
    suppressAlert,
    roommateStatuses,
    setRoommateStatus,
    sleepStartedAt,
    homeLocation,
    setHomeLocation,
    choreChart,
    choreChartStartedAt,
    setChoreChart,
    homeProfile,
    setHomeProfile: setHomeProfileState,
  }), [
    itemDifficulties, setItemDifficulty, resetItemDifficulties,
    memberPreferences, setMemberPreference, currentProposedChart,
    setCurrentProposedChart, liveChart, setLiveChart, customTasks,
    addCustomTask, deleteCustomTask, chartApprovals, proposeChart,
    approveProposedChart, forceApproveProposedChart, restartChartProcess,
    isHost, preferencesLoaded, preferencesOnboardingPending,
    finishPreferencesOnboarding, householdSetupStep, setHouseholdSetupStep,
    completeHouseholdSetup, quickGuideOpen, openQuickGuide,
    dismissQuickGuide, visibleAppAlerts, markAlertRead, markAllAlertsRead,
    householdComplete, setHouseholdComplete,
    colorScheme, pointsEnabled, plantEnabled, roommateActivityEnabled, leaderboardPeriod, householdId, memberships, activeSweet, householdName,
    inviteCode, householdLoading, householdError, membersLoading, currentMemberRole,
    refreshMembers, refreshHousehold, createHousehold, joinHousehold, switchSweet, leaveSweet,
    deleteHousehold, removeRoommate, deleteOwnAccount, currentUserId,
    setCurrentUser, roommates, chores, expenses, shoppingLists, shoppingItems,
    visibleBorrowItems, nudges, nudgesReady, addChore, updateChore, addChores, setChoreCompleted, completeChore, pickUpChore, deleteChore,
    addExpense, updateExpense, settleExpense, deleteExpense, canEditExpense, canManageExpense, markPersonPaid,
    addShoppingList, reorderShoppingLists, pinShoppingList, deleteShoppingList,
    addShoppingItem, addSelectedEssentialsToShopping, toggleShoppingItem, deleteShoppingItem,
    reorderShoppingItems, assignShoppingList, assignShoppingItem,
    updateShoppingItemPrice, linkShoppingItemsToExpense, pendingIouDraft, setPendingIouDraft, addBorrowItem,
    updateBorrowItem, returnBorrowItem, deleteBorrowItem, sendNudge,
    removeNudge, acknowledgeNudge, dismissNudge, getRoommateById, updateRoommate,
    getChoresByRoommate, getBalances, essentialsAssignees, essentialOwned,
    essentialShortlist, essentialShortlistUpdatedBy, setEssentialOwned, saveEssentialShortlist,
    setEssentialSelfAssignment, suppressedAlerts, suppressAlert, roommateStatuses,
    setRoommateStatus, sleepStartedAt, homeLocation, setHomeLocation,
    choreChart, choreChartStartedAt, setChoreChart, homeProfile,
  ]);

  const selectorStoreRef = useRef<AppContextStore | null>(null);
  if (!selectorStoreRef.current) {
    selectorStoreRef.current = createAppContextStore(contextValue);
  }
  const selectorStore = selectorStoreRef.current;
  useLayoutEffect(() => {
    selectorStore.setSnapshot(contextValue);
  }, [contextValue, selectorStore]);

  return (
    <AppContextStoreContext.Provider value={selectorStore}>
      <AppContext.Provider value={contextValue}>
        {children}
      </AppContext.Provider>
    </AppContextStoreContext.Provider>
  );
}

export function useAppContext(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

/**
 * Subscribe to only the context fields a component actually consumes.
 * This keeps an expense edit from rerendering Shopping/Borrowing, and keeps
 * theme-only changes from rebuilding domain selectors. AppContext remains the
 * single state owner; this is a selective subscription layer, not a new store.
 */
export function useAppContextSelector<T>(
  selector: (context: AppContextType) => T,
): T {
  const store = useContext(AppContextStoreContext);
  if (!store) {
    throw new Error("useAppContextSelector must be used within AppProvider");
  }
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const hasSelectionRef = useRef(false);
  const selectionRef = useRef<T>(undefined);
  const getSelection = useCallback(() => {
    const next = selectorRef.current(store.getSnapshot());
    if (
      hasSelectionRef.current &&
      shallowEqualSelection(selectionRef.current, next)
    ) {
      return selectionRef.current as T;
    }
    hasSelectionRef.current = true;
    selectionRef.current = next;
    return next;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
