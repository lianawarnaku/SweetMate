export interface HouseMonitorProgress {
  totalChores: number;
  completedChores: number;
  gridSquares: number;
  filledSquares: number;
  incompleteSquares: number;
  unusedSquares: number;
  overflowChores: number;
  completedOverflowChores: number;
  roofCompletionRatio: number;
  completionRatio: number;
  completionPercentage: number;
}

function normalizedCount(value: number): number {
  return Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;
}

/** Preserve the existing square-grid sizes and 25-square cap. */
export function houseMonitorGridSquares(totalChores: number): number {
  const total = normalizedCount(totalChores);
  if (total >= 25) return 25;
  if (total >= 16) return 16;
  if (total >= 9) return 9;
  return 4;
}

/**
 * Each completed chore fills one body square until the grid is full. Extra
 * chores fill the roof. When there are no extra chores, the roof becomes solid
 * only when all real chores are complete; unused capacity never implies work.
 */
export function getHouseMonitorProgress(
  totalChores: number,
  completedChores: number,
): HouseMonitorProgress {
  const total = normalizedCount(totalChores);
  const completed = Math.min(total, normalizedCount(completedChores));
  const gridSquares = houseMonitorGridSquares(total);
  const representedSquares = Math.min(total, gridSquares);
  const filledSquares = Math.min(completed, representedSquares);
  const overflowChores = Math.max(0, total - gridSquares);
  const completedOverflowChores = Math.max(0, completed - gridSquares);
  const roofCompletionRatio =
    overflowChores > 0
      ? completedOverflowChores / overflowChores
      : total > 0 && completed === total
        ? 1
        : 0;

  return {
    totalChores: total,
    completedChores: completed,
    gridSquares,
    filledSquares,
    incompleteSquares: representedSquares - filledSquares,
    unusedSquares: gridSquares - representedSquares,
    overflowChores,
    completedOverflowChores,
    roofCompletionRatio,
    completionRatio: total > 0 ? completed / total : 0,
    completionPercentage:
      total > 0 && completed === total
        ? 100
        : total > 0
          ? Math.min(99, Math.round((completed / total) * 100))
          : 0,
  };
}

/**
 * Bottom-up fill height for an upright triangle. Its filled area is 2h - h²,
 * so a linear height would overstate progress (half height fills 75% of area).
 */
export function roofFillHeightFraction(areaFraction: number): number {
  "worklet";
  const fraction = Number.isFinite(areaFraction)
    ? Math.min(1, Math.max(0, areaFraction))
    : 0;
  return 1 - Math.sqrt(1 - fraction);
}
