type ErrorLike = {
  message?: string;
  stack?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};
import { captureDiagnosticException, track } from "@/lib/analytics";
import { workflowFailureProperties } from "@/lib/workflowAnalytics";

type RejectionEventLike = {
  reason?: unknown;
  preventDefault?: () => void;
};

type GlobalWithRuntimeHandlers = typeof globalThis & {
  ErrorUtils?: {
    getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
    setGlobalHandler?: (
      handler: (error: Error, isFatal?: boolean) => void,
    ) => void;
  };
  addEventListener?: (
    type: string,
    listener: (event: RejectionEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: RejectionEventLike) => void,
  ) => void;
};

let activeAction = "unscoped";
let handlersInstalled = false;
let originalConsoleError: typeof console.error | null = null;

function normalizeError(value: unknown): ErrorLike {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  if (value && typeof value === "object") {
    return value as ErrorLike;
  }
  return { message: String(value) };
}

function diagnosticPayload(error: unknown, action = activeAction) {
  const normalized = normalizeError(error);
  return {
    action,
    errorType: error instanceof Error ? error.name : "RuntimeError",
    code: normalized.code,
    status: normalized.status,
    stack: (normalized.stack ?? new Error().stack)
      ?.split("\n")
      .slice(1)
      .join("\n"),
  };
}

export function reportRuntimeError(
  action: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  const logger = originalConsoleError ?? console.error;
  const payload = {
    ...diagnosticPayload(error, action),
    contextKeys: Object.keys(context ?? {}),
  };
  logger("[SweetMate runtime error]", JSON.stringify(payload, null, 2));
  // Product error counts follow product consent independently of crash consent.
  // This counts reported runtime failures; it is not a backend failure ledger.
  try {
    track.workflowFailed(workflowFailureProperties(action, error));
  } catch {
    // Optional analytics must never interrupt the original error handling.
  }
  captureDiagnosticException(error, action, context);
}

export function reportSupabaseError(
  action: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  reportRuntimeError(`Supabase: ${action}`, error, context);
}

export async function withRuntimeAction<T>(
  action: string,
  work: () => Promise<T>,
): Promise<T> {
  const previousAction = activeAction;
  activeAction = action;
  try {
    return await work();
  } catch (error) {
    reportRuntimeError(action, error);
    throw error;
  } finally {
    activeAction = previousAction;
  }
}

export function installGlobalRuntimeDiagnostics() {
  if (handlersInstalled) return () => {};
  handlersInstalled = true;
  originalConsoleError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    const firstError = args.find(
      (value) =>
        value instanceof Error ||
        (value && typeof value === "object" && "message" in value),
    );
    originalConsoleError?.("[SweetMate console.error]", JSON.stringify({
      ...diagnosticPayload(firstError ?? args.map(String).join(" ")),
      arguments: args.map((value) =>
        value instanceof Error
          ? { errorType: value.name }
          : typeof value,
      ),
    }, null, 2));
  };

  const runtimeGlobal = globalThis as GlobalWithRuntimeHandlers;
  const rejectionHandler = (event: RejectionEventLike) => {
    reportRuntimeError("Unhandled promise rejection", event.reason);
  };
  runtimeGlobal.addEventListener?.("unhandledrejection", rejectionHandler);

  const previousGlobalHandler =
    runtimeGlobal.ErrorUtils?.getGlobalHandler?.();
  runtimeGlobal.ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportRuntimeError(
      isFatal ? "Unhandled fatal error" : "Unhandled global error",
      error,
    );
    previousGlobalHandler?.(error, isFatal);
  });

  return () => {
    console.error = originalConsoleError ?? console.error;
    runtimeGlobal.removeEventListener?.(
      "unhandledrejection",
      rejectionHandler,
    );
    if (previousGlobalHandler) {
      runtimeGlobal.ErrorUtils?.setGlobalHandler?.(previousGlobalHandler);
    }
    handlersInstalled = false;
  };
}
