export function clampTabIndicatorX(
  x: number,
  tabWidth: number,
  tabCount: number,
): number {
  if (tabWidth <= 0 || tabCount <= 1) return 0;
  return Math.min(Math.max(x, 0), tabWidth * (tabCount - 1));
}

export function resolveDraggedTabIndex(
  indicatorX: number,
  tabWidth: number,
  tabCount: number,
): number {
  if (tabWidth <= 0 || tabCount <= 1) return 0;
  return Math.min(
    Math.max(Math.round(indicatorX / tabWidth), 0),
    tabCount - 1,
  );
}
