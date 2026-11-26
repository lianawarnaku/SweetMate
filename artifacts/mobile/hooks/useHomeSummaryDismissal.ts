import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

/** Dismissing the summary also chooses the attached calendar for this day. */
export function useHomeSummaryDismissal({ householdId, userId, day }: {
  householdId: string | null; userId: string; day: string;
}) {
  const key = householdId && userId ? `sweetmate:home-summary-dismissed:v1:${householdId}:${userId}` : null;
  const scope = JSON.stringify([key, day]);
  const [state, setState] = useState({ scope, dismissed: false });
  const revision = useRef(0);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    const requestRevision = revision.current;
    if (key) void AsyncStorage.getItem(key).then((saved) => {
      if (active && requestRevision === revision.current) setState({ scope, dismissed: saved === day });
    }).catch((error) => reportRuntimeError("restore summary dismissal", error));
    return () => { active = false; };
  }, [key, day, scope]);

  const dismiss = () => {
    revision.current++;
    // Storage/session readiness must not veto an already-pressed X.
    setState({ scope, dismissed: true });
    if (!key) return;
    writes.current = writes.current.then(() => AsyncStorage.setItem(key, day))
      .catch((error) => reportRuntimeError("save summary dismissal", error));
  };
  return { dismissed: state.scope === scope && state.dismissed, dismiss };
}
