import { isLeaderboardVisible } from "../constants/featureAvailability.ts";

export const APP_TABS = [
  { id: "index", label: "My Sweet" },
  { id: "group", label: "Group" },
  { id: "expenses", label: "Expenses" },
  { id: "shopping", label: "Shopping" },
  { id: "borrow", label: "Borrow" },
  { id: "leaderboard", label: "Ranks" },
] as const;
export type AppTabId = (typeof APP_TABS)[number]["id"];

export function isAppTabId(value: string): value is AppTabId {
  return APP_TABS.some((tab) => tab.id === value);
}

export function availableAppTabs(pointsEnabled = false) {
  return APP_TABS.filter((tab) => tab.id !== "leaderboard" || isLeaderboardVisible(pointsEnabled));
}

/** Keep saved choices ordered and safe even after a tab or feature is retired. */
export function normalizeHiddenTabs(value: unknown, pointsEnabled = false): AppTabId[] {
  const saved = new Set(Array.isArray(value) ? value : []);
  const hidden = APP_TABS.filter((tab) => saved.has(tab.id)).map((tab) => tab.id);
  const available = availableAppTabs(pointsEnabled);
  if (available.every((tab) => hidden.includes(tab.id))) {
    return hidden.filter((id) => id !== available[0].id);
  }
  return hidden;
}

/** null means the requested change would hide the last available tab. */
export function changeHiddenTab(
  current: readonly AppTabId[], id: AppTabId, hidden: boolean, pointsEnabled = false,
): AppTabId[] | null {
  const next = new Set(normalizeHiddenTabs(current, pointsEnabled));
  if (hidden) next.add(id);
  else next.delete(id);
  if (availableAppTabs(pointsEnabled).every((tab) => next.has(tab.id))) return null;
  return APP_TABS.filter((tab) => next.has(tab.id)).map((tab) => tab.id);
}

/** Prefer the next tab, then the previous one, when the active tab is hidden. */
export function tabAfterHiding<T extends { name: string }>(routes: readonly T[], name: string): T | undefined {
  const index = routes.findIndex((route) => route.name === name);
  return routes[index + 1] ?? routes[index - 1];
}
