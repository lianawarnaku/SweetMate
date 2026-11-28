import type { PersonalScheduleItem } from "./personalSchedule";

type PendingCompletion = {
  id: string;
  saved: string | null;
  desired: string | null;
  revision: number;
  uncertain: boolean;
  prepared: Map<number, Promise<{ send: () => Promise<void> }>>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Immediate local checks, with ordered/coalesced background writes per item. */
export class ScheduleCompletionQueue {
  private pending = new Map<string, PendingCompletion>();
  private disposed = false;
  private uncertainIds = new Set<string>();

  private options: {
    save: (id: string, completed: boolean) => Promise<void>;
    prepare?: (id: string, completed: boolean) => Promise<{ send: () => Promise<void> }>;
    change: (id: string, completedAt: string | null) => void;
    settled: () => void;
    now?: () => string;
  };

  constructor(options: ScheduleCompletionQueue["options"]) { this.options = options; }

  update(item: PersonalScheduleItem, completed: boolean): Promise<void> {
    if (this.disposed) return Promise.reject(this.cancellation());
    let entry = this.pending.get(item.id);
    if (entry && Boolean(entry.desired) === completed) return entry.promise;
    if (!entry && Boolean(item.app_completed_at) === completed && !this.uncertainIds.has(item.id)) return Promise.resolve();
    const start = !entry;
    if (!entry) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      entry = { id: item.id, saved: item.app_completed_at, desired: item.app_completed_at, revision: 0, prepared: new Map(), uncertain: this.uncertainIds.has(item.id), promise, resolve, reject };
      this.pending.set(item.id, entry);
    }
    entry.desired = completed ? (this.options.now?.() ?? new Date().toISOString()) : null;
    entry.revision++;
    this.options.change(item.id, entry.desired);
    if (this.options.prepare) {
      const staged = this.options.prepare(item.id, completed);
      entry.prepared.set(entry.revision, staged);
      void staged.catch(() => {});
    }
    if (start) void this.drain(entry);
    return entry.promise;
  }

  /** A background refresh must not flash an older value over a pending tap. */
  overlay(items: PersonalScheduleItem[]): PersonalScheduleItem[] {
    return items.map(item => {
      const pending = this.pending.get(item.id);
      return pending ? { ...item, app_completed_at: pending.desired } : item;
    });
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.pending.values()) entry.reject(this.cancellation());
    this.pending.clear();
    this.uncertainIds.clear();
  }

  private cancellation() {
    return Object.assign(new Error("The schedule account changed."), { name: "AbortError" });
  }

  private async drain(entry: PendingCompletion) {
    while (this.pending.get(entry.id) === entry) {
      if (Boolean(entry.saved) === Boolean(entry.desired) && !entry.uncertain) {
        this.pending.delete(entry.id);
        this.options.settled();
        entry.resolve();
        return;
      }
      const desired = entry.desired, revision = entry.revision;
      try {
        const staged = entry.prepared.get(revision);
        if (staged) await (await staged).send();
        else await this.options.save(entry.id, Boolean(desired));
      }
      catch (error) {
        if (this.pending.get(entry.id) !== entry) return;
        // A lost acknowledgement may have committed. Even a newer choice
        // matching the old baseline needs an explicit corrective write.
        entry.uncertain = true;
        this.uncertainIds.add(entry.id);
        // A newer tap still gets its own attempt; a stale failure cannot undo it.
        if (revision !== entry.revision) continue;
        this.pending.delete(entry.id);
        this.options.change(entry.id, entry.saved);
        this.options.settled();
        entry.reject(error);
        return;
      }
      if (this.pending.get(entry.id) !== entry) return;
      entry.saved = desired;
      entry.uncertain = false;
      this.uncertainIds.delete(entry.id);
      // Invalidate reads that started before this acknowledgement.
      this.options.settled();
    }
  }
}
