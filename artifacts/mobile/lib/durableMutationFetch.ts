import {
  DurableOperations,
  type OperationRequest,
  type PendingOperation,
} from "./durableOperations";
import { saveFeedback, saveRequest } from "./saveFeedback";

export const MUTATION_TABLES = [
  "chores",
  "household_states",
  "household_preferences",
  "shopping_lists",
  "shopping_items",
  "shared_borrow_items",
  "private_borrow_items",
  "sweet_essential_item_assignments",
  "nudges",
  "item_difficulty",
  "member_task_preferences",
  "household_members",
  "recurring_chore_occurrence_keys",
  "chore_chart_restart_notifications",
] as const;
export const MUTATION_RPCS = [
  "finish_household_setup",
  "update_generated_task_settings",
  "create_household",
  "join_household",
  "leave_household",
  "delete_household",
  "remove_household_member",
  "save_sweet_essential_shortlist",
  "seed_item_difficulty",
  "replace_proposed_chart",
  "cancel_proposed_charts",
  "submit_chore_chart_review",
  "approve_proposed_chart",
  "force_approve_proposed_chart",
  "restart_chore_chart_review",
  "apply_approved_chore_chart",
  "create_household_random_task",
  "claim_household_random_task",
  "configure_household_schedule",
  "set_schedule_busy_sharing",
  "update_personal_schedule_task",
  "redeem_household_invite",
  "manage_household_invites",
  "create_household_reinvitation",
  "revoke_household_reinvitation",
] as const;
const EDGE_MUTATIONS = [
  "submit-feedback",
  "calendar/add-chore",
  "calendar/disconnect",
];
const BYPASS_RPCS = [
  "mutate_expense",
  "register_push_device",
  "unregister_push_device",
  "get_household_chart_review",
  "get_household_random_tasks",
  "get_household_chart_completion",
  "get_household_schedule_activity",
  "get_household_invitations",
];
const supportedRequest = (request: OperationRequest): boolean => {
  if (request.edge)
    return request.method === "POST" && EDGE_MUTATIONS.includes(request.name);
  if (request.name === "batch")
    return (
      request.rpc &&
      request.method === "POST" &&
      Array.isArray(request.body) &&
      request.body.length <= 20 &&
      request.body.every(
        (step) =>
          !(["batch", "join_household", "redeem_household_invite"].includes(step?.name)) && !step?.edge && supportedRequest(step),
      )
    );
  return request.rpc
    ? request.method === "POST" &&
        MUTATION_RPCS.includes(request.name as (typeof MUTATION_RPCS)[number])
    : ["POST", "PATCH", "DELETE"].includes(request.method) &&
        MUTATION_TABLES.includes(
          request.name as (typeof MUTATION_TABLES)[number],
        );
};
type Session = { userId: string; accessToken: string };
const errorResponse = (message: string, status = 503) =>
  new Response(JSON.stringify({ code: "SM_PENDING", message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export function createDurableMutationFetch(options: {
  baseUrl: string;
  anonKey: string;
  fetcher: typeof fetch;
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
  makeId(): string;
}) {
  const functionsRoot = `${options.baseUrl.replace(/\/$/, "")}/functions/v1/`;
  const root = `${options.baseUrl.replace(/\/$/, "")}/rest/v1/`;
  let session: Session | null = null,
    engine: DurableOperations | null = null;
  let generation = 0,
    initialized: Promise<void> | null = null;
  let operations: readonly PendingOperation[] = [],
    saving = false;
  let firstLoad = true,
    coldIds = new Set<string>(),
    loadError = false;
  const recoveryListeners = new Set<() => void>();
  const tickets = new Map<string, ReturnType<typeof saveFeedback.begin>>();
  let lastFeedbackScope = "";
  const show = () => {
    const scope = saveFeedback.getSnapshot().scope;
    const groups = new Map<
      string,
      { label: string; operations: PendingOperation[] }
    >();
    for (const op of operations.filter((op) => op.scope === scope)) {
      const req = op.request;
      let key = req.name,
        label = "Household";
      if (req.name === "household_states") key = "household-state";
      if (req.name === "chores") label = "Chores";
      if (req.name.startsWith("shopping_")) label = "Shopping";
      if (req.name.includes("borrow")) {
        label = "Borrowing";
        if (req.name === "private_borrow_items")
          key = `private-borrow:${(req.body as { id?: string })?.id ?? "records"}`;
      }
      if (req.edge)
        label = req.name === "submit-feedback" ? "Feedback" : "Google Calendar";
      if (req.name === "update_personal_schedule_task") {
        label = "Google schedule";
        key = `schedule:${(req.body as { task_id?: string })?.task_id}`;
      }
      const group = groups.get(key) ?? { label, operations: [] };
      group.operations.push(op);
      groups.set(key, group);
    }
    if (loadError && scope.startsWith(`${session?.userId}:`))
      groups.set("operation-storage", {
        label: "Saved changes",
        operations: [],
      });
    for (const [key, ticket] of tickets)
      if (!groups.has(key)) {
        saveFeedback.finish(ticket);
        tickets.delete(key);
      }
    for (const [key, group] of groups) {
      const rejected =
        group.operations.some((op) => op.rejected) ||
        key === "operation-storage";
      const ticket = saveFeedback.begin(
        scope,
        key,
        group.label,
        () => retry(true),
        key === "operation-storage"
          ? "Saved changes could not be read. They remain on this device. Retry to check again."
          : rejected
            ? "This change was rejected. Retry after checking your access and settings."
            : "Saved on this device. Retry to sync your changes.",
      );
      tickets.set(key, ticket);
      if (!saving || rejected) saveFeedback.finish(ticket, true);
    }
  };
  saveFeedback.subscribe(() => {
    const scope = saveFeedback.getSnapshot().scope;
    if (lastFeedbackScope === scope) return;
    lastFeedbackScope = scope;
    tickets.clear();
    show();
  });
  const setSession = (next: Session | null) => {
    if (next?.userId === session?.userId) {
      session = next;
      return;
    }
    session = next;
    ++generation;
    engine?.dispose();
    engine = null;
    initialized = null;
    operations = [];
    saving = false;
    tickets.clear();
    firstLoad = true;
    coldIds = new Set();
    loadError = false;
  };
  const getEngine = () => {
    if (!session)
      throw new Error("Sign in again before syncing saved changes.");
    if (engine) return engine;
    const userId = session.userId,
      ownGeneration = generation;
    engine = new DurableOperations({
      userId,
      storage: options.storage,
      makeId: options.makeId,
      changed: (next, active) => {
        if (ownGeneration !== generation) return;
        if (firstLoad) {
          firstLoad = false;
          coldIds = new Set(next.map((op) => op.id));
        }
        operations = next;
        saving = active;
        show();
      },
      send: async (operation) => {
        if (!supportedRequest(operation.request))
          return {
            status: 400,
            data: {
              message:
                "This saved operation is unsupported. Its record has been kept for review.",
            },
          };
        if (generation !== ownGeneration || session?.userId !== userId)
          throw new Error("Account changed.");
        const response = await saveRequest((signal) =>
          options.fetcher(
            operation.request.edge
              ? `${functionsRoot}${operation.request.name}`
              : `${root}rpc/execute_app_operation`,
            {
              method: "POST",
              headers: {
                apikey: options.anonKey,
                Authorization: `Bearer ${session!.accessToken}`,
                "Content-Type": "application/json",
                "x-sweetmate-chore-policy": "single-obligation-v1",
              },
              body: JSON.stringify(
                operation.request.edge
                  ? operation.request.body
                  : {
                      operation_id: operation.id,
                      operation_request: operation.request,
                    },
              ),
              signal,
            },
          ),
        );
        const data = await response.json().catch(() => null);
        if (!response.ok)
          return {
            status: data?.code === "PGRST202" ? 503 : response.status,
            data,
          };
        if (operation.request.edge) return { status: response.status, data };
        if (!data || typeof data.status !== "number" || !("data" in data))
          throw new Error("Save receipt was not returned.");
        return data;
      },
    });
    return engine;
  };
  const initialize = () => {
    if (!session) return Promise.resolve();
    if (!initialized)
      initialized = getEngine()
        .initialize()
        .then(() => {
          loadError = false;
          show();
        })
        .catch(() => {
          loadError = true;
          show();
        });
    return initialized;
  };
  const retry = async (retryRejected = false) => {
    if (!session) return;
    await initialize();
    const hadPending = operations.length > 0;
    try {
      await getEngine().retry(retryRejected);
      loadError = false;
      show();
    } catch {
      loadError = true;
      show();
      return;
    }
    if (hadPending && !operations.some((op) => !op.rejected))
      for (const listener of recoveryListeners) listener();
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const edge =
      url.href.startsWith(functionsRoot) &&
      EDGE_MUTATIONS.includes(
        url.pathname.slice(new URL(functionsRoot).pathname.length),
      );
    if (!url.href.startsWith(root) && !edge)
      return options.fetcher(input, init);
    const original =
      typeof input === "object" && "method" in input ? input : undefined;
    const method = (init?.method ?? original?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice(
        new URL(edge ? functionsRoot : root).pathname.length,
      ),
      rpc = !edge && path.startsWith("rpc/"),
      name = rpc ? path.slice(4) : path;
    if (
      ["GET", "HEAD"].includes(method) ||
      (rpc && BYPASS_RPCS.includes(name))
    ) {
      await initialize();
      // A cold server snapshot must not erase unsynced local intent and then write it back as a new change.
      // Writes remain on disk; reconnect and Retry will re-open these reads after acknowledgement.
      if (
        (loadError ||
          operations.some((op) => coldIds.has(op.id) && !op.rejected)) &&
        !["GET", "HEAD"].includes(method)
      )
        return options.fetcher(input, init);
      if (
        loadError ||
        operations.some((op) => coldIds.has(op.id) && !op.rejected)
      )
        return errorResponse(
          "Saved changes are waiting to sync. Use Retry to refresh this household.",
        );
      return options.fetcher(input, init);
    }
    if (
      (!edge &&
        (rpc
          ? !MUTATION_RPCS.includes(name as (typeof MUTATION_RPCS)[number])
          : !MUTATION_TABLES.includes(
              name as (typeof MUTATION_TABLES)[number],
            ))) ||
      !["POST", "PATCH", "DELETE"].includes(method)
    )
      return errorResponse(
        "This save is not supported by the pending-operation journal.",
        400,
      );
    if (!session) return errorResponse("Sign in again before saving.", 401);
    const headers = new Headers(init?.headers ?? original?.headers);
    const body =
      init?.body ?? (original ? await original.clone().text() : undefined);
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(String(body)) : null;
    } catch {
      return errorResponse("The save request could not be read.", 400);
    }
    const requestToken = headers.get("authorization")?.replace(/^Bearer /i, "");
    if (requestToken !== session.accessToken) {
      try {
        const subject = JSON.parse(
          atob(
            (requestToken ?? "")
              .split(".")[1]
              .replace(/-/g, "+")
              .replace(/_/g, "/"),
          ),
        ).sub;
        if (subject !== session.userId)
          return errorResponse(
            "Your account changed. Reopen this page before saving.",
            401,
          );
      } catch {
        return errorResponse(
          "Your account changed. Reopen this page before saving.",
          401,
        );
      }
    }
    const payload = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<
      string,
      unknown
    > | null;
    const household = payload?.household_id ?? payload?.target_household_id;
    const feedbackScope = saveFeedback.getSnapshot().scope;
    const scope =
      typeof household === "string"
        ? `${session.userId}:${household}`
        : feedbackScope.startsWith(`${session.userId}:`)
          ? feedbackScope
          : `${session.userId}:account`;
    const request: OperationRequest = {
      name,
      rpc,
      ...(edge ? { edge: true } : {}),
      method,
      body: parsed,
      query: [...url.searchParams],
      prefer: headers.get("prefer") ?? "",
      accept: headers.get("accept") ?? "",
    };
    try {
      const pending = getEngine().submit(request, scope);
      const signal = init?.signal ?? original?.signal;
      let result;
      if (!signal) result = await pending;
      else {
        let onAbort: () => void = () => {};
        try {
          result = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              onAbort = () =>
                reject(
                  new Error("Saved on this device. Retry to confirm the save."),
                );
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            }),
          ]);
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      }
      return new Response(
        result.data === null ? null : JSON.stringify(result.data),
        {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Saved on this device. Retry to sync.",
      );
    }
  };
  const assertScope = (scope: string) => {
    if (!session || !scope.startsWith(`${session.userId}:`))
      throw new Error("Your account changed. Reopen this page before saving.");
  };
  const prepareRpc = (name: string, body: unknown, scope: string) => {
    assertScope(scope);
    if (!MUTATION_RPCS.includes(name as (typeof MUTATION_RPCS)[number]))
      return Promise.reject(new Error("Unsupported saved action."));
    return getEngine().prepare(
      {
        name,
        rpc: true,
        method: "POST",
        body,
        query: [],
        prefer: "",
        accept: "",
      },
      scope,
    );
  };
  const submitBatch = (steps: OperationRequest[], scope: string) => {
    assertScope(scope);
    return getEngine().submit(
      {
        name: "batch",
        rpc: true,
        method: "POST",
        body: steps,
        query: [],
        prefer: "",
        accept: "",
      },
      scope,
    );
  };
  return {
    fetch: fetcher,
    setSession,
    initialize,
    retry,
    prepareRpc,
    submitBatch,
    subscribeRecovery(listener: () => void) {
      recoveryListeners.add(listener);
      return () => {
        recoveryListeners.delete(listener);
      };
    },
    get pending() {
      return operations;
    },
  };
}
