/** Write-ahead journal. Contains app data, never authorization headers or auth credentials. */
export type OperationRequest = {
  name: string;
  method: string;
  rpc: boolean;
  edge?: boolean;
  body: unknown;
  query: [string, string][];
  prefer: string;
  accept: string;
};
export type OperationResponse = { status: number; data: unknown };
export type PendingOperation = {
  id: string;
  request: OperationRequest;
  scope: string;
  fingerprint: string;
  rejected?: boolean;
};
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
export const operationStorageKey = (userId: string) =>
  `sweetmate:operations:v1:${userId}`;
export class PendingOperationError extends Error {
  constructor() {
    super(
      "Saved on this device, but not synced. Use Retry when connected. Do not enter it again.",
    );
  }
}
function resource(request: OperationRequest) {
  const body = request.body as Record<string, unknown> | null;
  const rows = Array.isArray(body) ? body : [body];
  const ids = rows.flatMap((row) =>
    typeof row?.id === "string" ? [row.id] : [],
  );
  if (!ids.length)
    for (const [key, value] of request.query)
      if (key === "id") {
        if (value.startsWith("eq.")) ids.push(value.slice(3));
        if (value.startsWith("in.("))
          ids.push(
            ...value
              .slice(4, -1)
              .split(",")
              .map((id) => id.replace(/^"|"$/g, "")),
          );
      }
  if (ids.length) return request.name + ":" + ids.sort().join("|");
  return (
    request.name +
    ":" +
    JSON.stringify(
      body &&
        Object.fromEntries(
          [
            "target_household_id",
            "target_chart_id",
            "task_id",
            "household_id",
            "member_id",
            "user_id",
            "section_key",
            "item_id",
            "category",
            "item",
            "key",
          ]
            .filter((key) => key in body)
            .map((key) => [key, body[key]]),
        ),
    )
  );
}
const fingerprint = (request: OperationRequest) =>
  JSON.stringify(request, (key, value) =>
    key === "updated_at" || key === "updatedAt" ? undefined : value,
  );
export class DurableOperations {
  private tail: Promise<unknown> = Promise.resolve();
  private entries: PendingOperation[] = [];
  private loaded = false;
  private active = true;
  private options: {
    userId: string;
    storageKey?: string;
    storage: Storage;
    makeId(): string;
    send(operation: PendingOperation): Promise<OperationResponse>;
    changed(operations: readonly PendingOperation[], saving: boolean): void;
  };
  constructor(options: DurableOperations["options"]) {
    this.options = options;
  }
  private serial<T>(work: () => Promise<T>) {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => {});
    return result;
  }
  private async load() {
    if (this.loaded) return;
    const raw = await this.options.storage.getItem(
      this.options.storageKey ?? operationStorageKey(this.options.userId),
    );
    if (raw) {
      const value = JSON.parse(raw);
      if (
        value.version !== 1 ||
        !Array.isArray(value.operations) ||
        value.operations.some(
          (op: PendingOperation) =>
            !op ||
            typeof op.id !== "string" ||
            typeof op.scope !== "string" ||
            !op.scope.startsWith(`${this.options.userId}:`) ||
            typeof op.fingerprint !== "string" ||
            !op.request ||
            !Array.isArray(op.request.query) ||
            typeof op.request.name !== "string" ||
            !["POST", "PATCH", "DELETE"].includes(op.request.method),
        )
      )
        throw new Error(
          "Saved changes could not be read. They remain on this device.",
        );
      this.entries = value.operations;
    }
    this.loaded = true;
    this.publish();
  }
  private publish() {
    if (this.active) this.options.changed(this.entries, this.saving);
  }
  private async persist(next: PendingOperation[]) {
    // Never send before storage confirms, and never discard before its removal is durable.
    await this.options.storage.setItem(
      this.options.storageKey ?? operationStorageKey(this.options.userId),
      JSON.stringify({ version: 1, operations: next }),
    );
    this.entries = next;
    this.publish();
  }
  private saving = false;
  private async drain(
    retryRejected: boolean,
    outcomes = new Map<string, OperationResponse>(),
  ) {
    for (const operation of [...this.entries]) {
      if (!this.active) return outcomes;
      if (operation.rejected && !retryRejected) continue;
      let response: OperationResponse;
      try {
        response = await this.options.send(operation);
      } catch {
        this.publish();
        return outcomes;
      }
      if (!this.active) return outcomes;
      if (response.status >= 200 && response.status < 300) {
        // If this storage write fails, keep the same ID. The server receipt makes a replay harmless.
        await this.serial(() =>
          this.persist(
            this.entries.filter((entry) => entry.id !== operation.id),
          ),
        );
        outcomes.set(operation.id, response);
        this.results.set(operation.id, response);
      } else if (
        response.status >= 400 &&
        response.status < 500 &&
        ![401, 408, 409, 429].includes(response.status)
      ) {
        await this.serial(() =>
          this.persist(
            this.entries.map((entry) =>
              entry.id === operation.id ? { ...entry, rejected: true } : entry,
            ),
          ),
        );
        outcomes.set(operation.id, response);
        this.results.set(operation.id, response);
      } else {
        this.publish();
        return outcomes;
      }
    }
    return outcomes;
  }
  prepare(
    request: OperationRequest,
    scope: string,
  ): Promise<{ send: () => Promise<OperationResponse> }> {
    // Append separately from network draining: a second tap must reach disk even while an earlier request is stalled.
    const appended = this.serial(async () => {
      await this.load();
      if (!scope.startsWith(`${this.options.userId}:`))
        throw new Error("Your account changed before this action was saved.");
      if (!this.active) throw new PendingOperationError();
      const signature = fingerprint(request);
      const last = this.entries.at(-1);
      const existing =
        last?.scope === scope && last.fingerprint === signature
          ? last
          : undefined;
      if (existing) {
        if (existing.rejected)
          await this.persist(
            this.entries.map((entry) =>
              entry.id === existing.id ? { ...entry, rejected: false } : entry,
            ),
          );
        return existing.id;
      }
      const entry = {
        id: this.options.makeId(),
        request,
        scope,
        fingerprint: signature,
      };
      await this.persist([
        ...this.entries.filter(
          (old) =>
            !(
              old.rejected &&
              old.scope === scope &&
              resource(old.request) === resource(request)
            ),
        ),
        entry,
      ]);
      return entry.id;
    });
    return appended.then((id) => ({ send: () => this.flush(id) }));
  }
  submit(request: OperationRequest, scope: string): Promise<OperationResponse> {
    return this.prepare(request, scope).then((operation) => operation.send());
  }
  private network: Promise<unknown> = Promise.resolve();
  private flush(
    id?: string,
    retryRejected = false,
  ): Promise<OperationResponse> {
    const work = async () => {
      // Include all append jobs accepted before this send begins.
      await this.tail;
      this.saving = true;
      this.publish();
      let outcomes: Map<string, OperationResponse>;
      try {
        outcomes = await this.drain(retryRejected);
      } finally {
        this.saving = false;
        this.publish();
      }
      if (!id) return { status: 200, data: null };
      const outcome = outcomes.get(id);
      if (outcome) return outcome;
      // Another flush may already have acknowledged this operation. Its caller needs the original result,
      // so re-read the server receipt using the captured request rather than inventing a success result.
      const result = this.results.get(id);
      if (result) return result;
      throw new PendingOperationError();
    };
    const result = this.network.then(work, work);
    this.network = result.catch(() => {});
    return result;
  }
  private results = new Map<string, OperationResponse>();
  async initialize() {
    await this.serial(() => this.load());
    await this.flush();
  }
  async retry(retryRejected = false) {
    await this.serial(() => this.load());
    await this.flush(undefined, retryRejected);
  }
  dispose() {
    this.active = false;
  }
  get pending() {
    return this.entries;
  }
}
