export type SaveIssue = {
  key: string;
  label: string;
  phase: "pending" | "failed";
  failureMessage?: string;
};
type Entry = SaveIssue & { token: number; retry: () => Promise<unknown> };
export type SaveFeedbackSnapshot = {
  scope: string;
  issues: readonly SaveIssue[];
  inlineKeys: readonly string[];
};

/** Ephemeral save feedback, isolated to the signed-in account and household. */
export class SaveFeedbackStore {
  private snapshot: SaveFeedbackSnapshot = {
    scope: "",
    issues: [],
    inlineKeys: [],
  };
  private entries = new Map<string, Entry>();
  private inlineKeys = new Set<string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  setScope(scope: string) {
    if (scope === this.snapshot.scope) return;
    this.entries.clear();
    this.inlineKeys.clear();
    this.snapshot = { scope, issues: [], inlineKeys: [] };
    this.emit();
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private publish() {
    this.snapshot = {
      scope: this.snapshot.scope,
      inlineKeys: [...this.inlineKeys],
      issues: [...this.entries.values()].map(
        ({ key, label, phase, failureMessage }) => ({
          key,
          label,
          phase,
          failureMessage,
        }),
      ),
    };
    this.emit();
  }
  showInline(scope: string, key: string, visible: boolean) {
    if (scope !== this.snapshot.scope || this.inlineKeys.has(key) === visible)
      return;
    if (visible) this.inlineKeys.add(key);
    else this.inlineKeys.delete(key);
    this.publish();
  }
  begin(
    scope: string,
    key: string,
    label: string,
    retry: () => Promise<unknown>,
    failureMessage?: string,
  ) {
    if (!scope || this.snapshot.scope !== scope) return null;
    const token = ++this.revision;
    this.entries.set(key, {
      key,
      label,
      phase: "pending",
      token,
      retry,
      failureMessage,
    });
    this.publish();
    return { scope, key, token };
  }
  finish(ticket: ReturnType<SaveFeedbackStore["begin"]>, failed = false) {
    if (!ticket || ticket.scope !== this.snapshot.scope) return;
    const entry = this.entries.get(ticket.key);
    if (!entry || entry.token !== ticket.token) return;
    if (failed) entry.phase = "failed";
    else this.entries.delete(ticket.key);
    this.publish();
  }
  discard(scope: string, key: string) {
    if (scope !== this.snapshot.scope || !this.entries.delete(key)) return;
    this.publish();
  }
  async run<T>(
    scope: string,
    key: string,
    label: string,
    retry: () => Promise<unknown>,
    work: () => Promise<T>,
    failureMessage?: string,
  ): Promise<T> {
    const ticket = this.begin(scope, key, label, retry, failureMessage);
    try {
      const result = await work();
      this.finish(ticket);
      return result;
    } catch (error) {
      this.finish(ticket, true);
      throw error;
    }
  }
  async retry(scope: string, key?: string) {
    if (!scope || scope !== this.snapshot.scope) return;
    const failed = [...this.entries.values()].filter(
      (entry) => entry.phase === "failed" && (!key || entry.key === key),
    );
    await Promise.allSettled(
      failed.map((entry) => {
        // Callbacks begin a new ticket synchronously, so another Retry tap cannot
        // submit this same failed operation a second time.
        if (
          scope !== this.snapshot.scope ||
          this.entries.get(entry.key) !== entry ||
          entry.phase !== "failed"
        )
          return Promise.resolve();
        return entry.retry();
      }),
    );
  }
}
export const saveFeedback = new SaveFeedbackStore();

/** A stalled request must become retryable, never leave “Saving” indefinitely. */
export async function saveRequest<T>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Error("Saving timed out. Check your connection and retry."),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
