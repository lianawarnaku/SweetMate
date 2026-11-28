import { saveFeedback, saveRequest } from "@/lib/saveFeedback";
import { fetchAllRows } from "@/lib/pagination";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { supabase, pendingOperations } from "@/lib/supabase";
import { reportRuntimeError, reportSupabaseError } from "@/lib/runtimeDiagnostics";
import { applyNormalizedEvent, normalizedRowFingerprint, planNormalizedSync, type NormalizedRow } from "@/lib/normalizedCollection";

/** Synchronize current intent, never a queued render's stale collection. */
export function useNormalizedCollection<T extends { id: string; updatedAt?: string }, R extends NormalizedRow>({
  table, householdId, userId, cloudReady, entities, entitiesRef, setEntities, toRow, fromRow,
  bootstrapEntitiesRef, deletedIds, beforePersist, compareRows,
}: {
  table: string; householdId: string | null; userId?: string; cloudReady: boolean;
  entities: T[]; entitiesRef: MutableRefObject<T[]>; setEntities: Dispatch<SetStateAction<T[]>>;
  toRow: (entity: T, householdId: string, index?: number) => R; fromRow: (row: R) => T;
  bootstrapEntitiesRef?: MutableRefObject<T[]>;
  deletedIds?: () => string[];
  beforePersist?: () => Promise<void>;
  compareRows?: (left: R, right: R) => number;
}) {
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(0);
  useEffect(() => pendingOperations?.subscribeRecovery(() => setRecovery(value => value + 1)), []);
  const [retry, setRetry] = useState(0);
  const readyRef = useRef(false);
  const persistedRef = useRef(new Map<string, R>());
  const deletedRef = useRef(new Set<string>());
  const uncertainIdsRef = useRef(new Set<string>());
  const deletedSourceRef = useRef(deletedIds);
  deletedSourceRef.current = deletedIds;
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const beforePersistRef = useRef(beforePersist);
  beforePersistRef.current = beforePersist;
  const generationRef = useRef(0);
  const scope = cloudReady && householdId && userId ? `${userId}:${householdId}:${table}` : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const loadedScopeRef = useRef("");
  readyRef.current = Boolean(scope && ready && loadedScopeRef.current === scope);
  const canonicalize = (row: R) => toRow(fromRow(row), row.household_id, (row as R & { sort_order?: number }).sort_order ?? 0);

  if (scope && loadedScopeRef.current === scope) {
    for (const id of deletedIds?.() ?? []) deletedRef.current.add(id);
    const currentIds = new Set(entities.map(entity => entity.id));
    for (const id of persistedRef.current.keys()) if (!currentIds.has(id)) deletedRef.current.add(id);
  }

  useEffect(() => {
    const generation = ++generationRef.current;
    readyRef.current = false;
    setReady(false);
    loadedScopeRef.current = "";
    persistedRef.current = new Map();
    uncertainIdsRef.current = new Set();
    deletedRef.current = new Set(deletedSourceRef.current?.() ?? []);
    queueRef.current = Promise.resolve();
    if (!scope || !householdId || !userId) return;
    let active = true;
    const isActive = () => active && scopeRef.current === scope && generationRef.current === generation;
    const channel = supabase.channel(`${table}:${householdId}`);
    const initialRows = new Map(entitiesRef.current.map((entity, index) => [entity.id, toRow(entity, householdId, index)]));
    let reading = false;
    let readAgain = false;
    let eventVersion = 0;
    const refresh = async () => {
      if (!isActive()) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      const version = eventVersion;
      try {
        const { data, error } = await fetchAllRows(() => supabase.from(table).select("*").eq("household_id", householdId), undefined, { isCurrent: isActive });
        if (!isActive()) return;
        if (error) { reportSupabaseError(`load normalized ${table}`, error, { householdId }); return; }
        // A realtime change received after SELECT started is newer than its snapshot.
        if (version !== eventVersion) { readAgain = true; return; }
        for (const id of deletedSourceRef.current?.() ?? []) deletedRef.current.add(id);
        const wasLoaded = loadedScopeRef.current === scope;
        const before = entitiesRef.current;
        const pending = planNormalizedSync(before, wasLoaded ? persistedRef.current : initialRows,
          entity => toRow(entity, householdId, before.indexOf(entity)), canonicalize, uncertainIdsRef.current);
        for (const id of pending.deleteIds) deletedRef.current.add(id);
        let rows = ((data ?? []) as R[]).sort((left, right) => (compareRows ? compareRows(left, right) :
          ((left as R & { sort_order?: number }).sort_order ?? 0) - ((right as R & { sort_order?: number }).sort_order ?? 0)) || left.id.localeCompare(right.id));
        if (!wasLoaded && !rows.length) {
          // Only a freshly loaded legacy server document may bootstrap Shopping.
          const source = bootstrapEntitiesRef?.current ?? entitiesRef.current;
          const bootstrap = source.filter(entity => !deletedRef.current.has(entity.id)).map((entity, index) => toRow(entity, householdId, index));
          if (bootstrap.length) {
            await beforePersistRef.current?.();
            if (!isActive()) return;
            const { error: bootstrapError } = await supabase.from(table).upsert(bootstrap, { onConflict: "id" });
            if (!isActive()) return;
            if (bootstrapError) { reportSupabaseError(`bootstrap normalized ${table}`, bootstrapError, { householdId }); return; }
            rows = bootstrap;
          }
        }
        if (!isActive()) return;
        for (const id of deletedSourceRef.current?.() ?? []) deletedRef.current.add(id);
        const serverIds = new Set(rows.map(row => row.id));
        // A known row absent after reconnect was deleted by a peer, even when
        // its DELETE event was lost. Never upsert an offline edit over that deletion.
        if (wasLoaded) for (const id of persistedRef.current.keys()) {
          if (!serverIds.has(id)) { deletedRef.current.add(id); uncertainIdsRef.current.delete(id); }
        }
        const pendingIds = new Set(pending.upserts.map(row => row.id));
        const local = entitiesRef.current.filter(entity => !deletedRef.current.has(entity.id) && (
          pendingIds.has(entity.id) && (wasLoaded || !initialRows.has(entity.id) || serverIds.has(entity.id))
        ));
        const localIds = new Set(local.map(entity => entity.id));
        const normalized = rows.filter(row => !deletedRef.current.has(row.id) && !localIds.has(row.id)).map(fromRow);
        persistedRef.current = new Map(rows.map(row => [row.id, row]));
        entitiesRef.current = [...normalized, ...local];
        setEntities(entitiesRef.current);
        loadedScopeRef.current = scope;
        readyRef.current = true;
        setReady(true);
        setRetry(value => value + 1);
      } catch (error) {
        if (isActive()) reportRuntimeError(`connect normalized ${table}`, error, { householdId });
      } finally {
        reading = false;
        if (readAgain && isActive()) { readAgain = false; void refresh(); }
      }
    };
    const receive = (payload: { eventType: string; old: unknown; new: unknown }) => {
      if (!isActive()) return;
      const type = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
      const row = (type === "DELETE" ? payload.old : payload.new) as R;
      if (!row?.id || (row.household_id && row.household_id !== householdId)) return;
      if (type === "DELETE" && !persistedRef.current.has(row.id) && !entitiesRef.current.some(entity => entity.id === row.id)) return;
      eventVersion++;
      // The initial snapshot remains authoritative over stale device cache.
      if (loadedScopeRef.current !== scope) return;
      const before = entitiesRef.current;
      const pending = planNormalizedSync(before, persistedRef.current, entity => toRow(entity, householdId, before.indexOf(entity)), canonicalize, uncertainIdsRef.current);
      for (const id of pending.deleteIds) deletedRef.current.add(id);
      for (const id of deletedSourceRef.current?.() ?? []) deletedRef.current.add(id);
      if (type === "DELETE") { persistedRef.current.delete(row.id); deletedRef.current.add(row.id); uncertainIdsRef.current.delete(row.id); }
      else persistedRef.current.set(row.id, row);
      let next = applyNormalizedEvent(before, type, row, fromRow, {
        deletedIds: deletedRef.current, upsertIds: new Set(pending.upserts.map(entry => entry.id)),
      });
      if (next !== before) {
        const rank = (entity: T) => (toRow(entity, householdId) as R & { sort_order?: number }).sort_order ?? 0;
        next = [...next].sort((left, right) => compareRows
          ? compareRows(toRow(left, householdId), toRow(right, householdId)) || left.id.localeCompare(right.id) : rank(left) - rank(right) || left.id.localeCompare(right.id));
        entitiesRef.current = next; setEntities(next);
      }
      if (type !== "DELETE" && deletedRef.current.has(row.id)) setRetry(value => value + 1);
    };
    // Subscribe even if the first SELECT fails. Each successful connection also
    // reconciles changes missed while offline, preserving unsaved local additions.
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table, filter: `household_id=eq.${householdId}` }, receive)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `household_id=eq.${householdId}` }, receive)
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, receive)
      .subscribe((status, subscriptionError) => {
        if (!isActive()) return;
        if (status === "SUBSCRIBED") void refresh();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reportSupabaseError(`subscribe to normalized ${table}`, subscriptionError ?? new Error(status), { householdId, status });
      });
    void refresh();
    return () => { active = false; readyRef.current = false; ++generationRef.current; void supabase.removeChannel(channel); };
  }, [scope, fromRow, toRow, householdId, userId, table, setEntities, entitiesRef, bootstrapEntitiesRef, compareRows, recovery]);

  const enqueuePersist = (): Promise<void> => {
    if (!readyRef.current || !householdId || !userId || loadedScopeRef.current !== scope)
      return Promise.reject(new Error("Shopping is still loading. Please try again."));
    const generation = generationRef.current;
    const isActive = () => readyRef.current && generationRef.current === generation && scopeRef.current === scope;
    const assertActive = () => { if (!isActive()) throw new Error("Your household changed before saving finished."); };
    const persist = async () => {
      assertActive();
      // Items cannot be inserted before their newly created parent lists exist.
      // Read current intent after the barrier: a list may have been deleted meanwhile.
      if (pendingOperations) void beforePersistRef.current?.().catch(() => {});
      else await beforePersistRef.current?.();
      assertActive();
      const current = entitiesRef.current.filter(entity => !deletedRef.current.has(entity.id));
      const baseline = new Map(persistedRef.current);
      const plan = planNormalizedSync(current, baseline, entity => toRow(entity, householdId, current.indexOf(entity)), canonicalize, uncertainIdsRef.current);
      if (plan.upserts.length) {
        for (const row of plan.upserts) uncertainIdsRef.current.add(row.id);
        const { error } = await saveRequest(signal => supabase.from(table).upsert(plan.upserts, { onConflict: "id" }).abortSignal(signal));
        assertActive();
        if (error) { reportSupabaseError(`persist normalized ${table}`, error, { householdId, count: plan.upserts.length }); throw new Error("This change could not be saved. Check your connection and try again."); }
        let acknowledged = entitiesRef.current;
        for (const row of plan.upserts) {
          uncertainIdsRef.current.delete(row.id);
          const latest = persistedRef.current.get(row.id);
          if (!latest || latest === baseline.get(row.id)) persistedRef.current.set(row.id, row);
          const local = acknowledged.find(entity => entity.id === row.id);
          const sent = current.find(entity => entity.id === row.id);
          const server = persistedRef.current.get(row.id);
          // After acknowledgement, accept a peer's later committed edit unless
          // this device has made another choice since the request began.
          if (local && local === sent && server && normalizedRowFingerprint(canonicalize(toRow(local, householdId, acknowledged.indexOf(local)))) !== normalizedRowFingerprint(canonicalize(server))) {
            acknowledged = acknowledged.map(entity => entity.id === row.id ? fromRow(server) : entity);
          }
        }
        if (acknowledged !== entitiesRef.current) { entitiesRef.current = acknowledged; setEntities(acknowledged); }
      }
      assertActive();
      const remaining = entitiesRef.current.filter(entity => !deletedRef.current.has(entity.id));
      const deleteIds = planNormalizedSync(remaining, persistedRef.current, entity => toRow(entity, householdId, remaining.indexOf(entity)), canonicalize, uncertainIdsRef.current).deleteIds;
      if (deleteIds.length) {
        const { error } = await saveRequest(signal => supabase.from(table).delete().eq("household_id", householdId).in("id", deleteIds).abortSignal(signal));
        assertActive();
        if (error) { reportSupabaseError(`delete normalized ${table}`, error, { householdId, count: deleteIds.length }); throw new Error("This deletion could not be saved. Please try again."); }
        for (const id of deleteIds) { persistedRef.current.delete(id); deletedRef.current.add(id); uncertainIdsRef.current.delete(id); }
      }
    };
    const operation = saveFeedback.run(`${userId}:${householdId}`, table,
      table === "shared_borrow_items" ? "Borrowing" : "Shopping", () => enqueuePersist(),
      () => pendingOperations ? persist() : queueRef.current.then(persist, persist));
    // Keep the queue usable after failure, while flush callers receive the rejection.
    queueRef.current = operation.catch(() => {});
    return operation;
  };

  useEffect(() => {
    if (!ready || !readyRef.current || !householdId || !userId || loadedScopeRef.current !== scope) return;
    void enqueuePersist().catch(error => {
      if (scopeRef.current === scope) reportRuntimeError(`sync normalized ${table}`, error, { householdId });
    });
  }, [entities, householdId, userId, ready, retry, scope, table, toRow, entitiesRef]);

  return Object.assign(readyRef, { flush: enqueuePersist });
}
