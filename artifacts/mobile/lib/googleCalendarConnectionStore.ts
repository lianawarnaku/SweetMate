export interface CalendarConnectionSnapshot {
  connected: boolean | null;
  checking: boolean;
  busy: boolean;
  error: string | null;
}

interface ConnectionActions {
  check(userId: string): Promise<boolean>;
  connect(userId: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
}

const INITIAL: CalendarConnectionSnapshot = { connected: null, checking: false, busy: false, error: null };
type Entry = {
  snapshot: CalendarConnectionSnapshot;
  listeners: Set<() => void>;
  version: number;
  check: Promise<boolean> | null;
  action: Promise<void> | null;
};

/** One server-verified state per signed-in person, shared by both entry points. */
export function createCalendarConnectionStore(actions: ConnectionActions) {
  const entries = new Map<string, Entry>();
  let activeOwner: string | null = null;
  function entry(userId: string): Entry {
    let value = entries.get(userId);
    if (!value) {
      value = { snapshot: INITIAL, listeners: new Set(), version: 0, check: null, action: null };
      entries.set(userId, value);
    }
    return value;
  }
  function update(value: Entry, patch: Partial<CalendarConnectionSnapshot>) {
    const next = { ...value.snapshot, ...patch };
    if ((Object.keys(next) as (keyof CalendarConnectionSnapshot)[]).every(key => next[key] === value.snapshot[key])) return;
    value.snapshot = next;
    value.listeners.forEach(listener => listener());
  }
  const message = (failure: unknown) => failure && typeof failure === "object" && "message" in failure
    ? String(failure.message) : "Your Google Calendar connection could not update. Please try again.";

  function refresh(userId: string): Promise<boolean> {
    const value = entry(userId);
    if (value.action) return value.action.then(() => value.snapshot.connected === true);
    if (value.check) return value.check;
    const version = ++value.version;
    update(value, { checking: true, error: null });
    const request = Promise.resolve().then(() => actions.check(userId)).then(connected => {
      if (value.version === version) update(value, { connected, checking: false, error: null });
      return connected;
    }).catch(failure => {
      if (value.version === version) update(value, { checking: false, error: message(failure) });
      throw failure;
    }).finally(() => { if (value.check === request) value.check = null; });
    value.check = request;
    return request;
  }

  function run(userId: string, operation: "connect" | "disconnect"): Promise<void> {
    const value = entry(userId);
    if (value.action) return value.action;
    if (activeOwner && activeOwner !== userId) return Promise.reject(new Error("Finish the current Google connection before starting another."));
    activeOwner = userId;
    // A slower status request from before OAuth cannot undo a successful save.
    const version = ++value.version;
    value.check = null;
    update(value, { busy: true, checking: false, error: null });
    const request = Promise.resolve().then(() => actions[operation](userId)).then(async () => {
      const connected = await actions.check(userId);
      if (connected !== (operation === "connect")) throw new Error(operation === "connect"
        ? "Google returned to SweetMate, but your calendar connection was not saved. Please try connecting again."
        : "Google Calendar is still connected. Please try disconnecting again.");
      if (value.version === version) update(value, { connected, error: null });
    }).catch(failure => {
      if (value.version === version) update(value, { error: message(failure) });
      throw failure;
    }).finally(() => {
      if (value.action === request) value.action = null;
      if (activeOwner === userId) activeOwner = null;
      if (value.version === version) update(value, { busy: false });
    });
    value.action = request;
    return request;
  }

  return {
    getSnapshot: (userId: string | null) => userId ? entry(userId).snapshot : INITIAL,
    subscribe(userId: string | null, listener: () => void) {
      if (!userId) return () => {};
      const value = entry(userId);
      value.listeners.add(listener);
      return () => { value.listeners.delete(listener); };
    },
    refresh,
    connect: (userId: string) => run(userId, "connect"),
    disconnect: (userId: string) => run(userId, "disconnect"),
  };
}
