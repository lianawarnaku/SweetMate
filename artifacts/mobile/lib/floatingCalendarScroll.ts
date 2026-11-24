export interface CalendarScrollIntent {
  offset: number;
  direction: -1 | 0 | 1;
  travel: number;
  hidden: boolean;
}

export function initialCalendarScrollIntent(offset = 0): CalendarScrollIntent {
  "worklet";
  return { offset: Math.max(0, offset), direction: 0, travel: 0, hidden: false };
}

export function boundedCalendarScrollOffset(offset: number, contentHeight: number, viewportHeight: number): number {
  "worklet";
  return Math.max(0, Math.min(offset, Math.max(0, contentHeight - viewportHeight)));
}

/** Ignore small reversals and elastic overscroll; reveal as soon as upward intent is clear. */
export function nextCalendarScrollIntent(previous: CalendarScrollIntent, offset: number, pinOffset: number): CalendarScrollIntent {
  "worklet";
  const nextOffset = Math.max(0, offset);
  if (nextOffset <= Math.max(0, pinOffset)) return initialCalendarScrollIntent(nextOffset);
  const delta = nextOffset - previous.offset;
  if (Math.abs(delta) < 0.1) return { ...previous, offset: nextOffset };
  const direction: -1 | 1 = delta > 0 ? 1 : -1;
  const travel = Math.min(8, (previous.direction === direction ? previous.travel : 0) + Math.abs(delta));
  return { offset: nextOffset, direction, travel, hidden: travel >= 8 ? direction === 1 : previous.hidden };
}
