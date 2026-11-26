import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { supabase } from "@/lib/supabase";
import { reportRuntimeError, reportSupabaseError } from "@/lib/runtimeDiagnostics";
import { applyNormalizedEvent, planNormalizedSync, type NormalizedRow } from "@/lib/normalizedCollection";

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
  const [retry, setRetry] = useState(0);
  const readyRef = useRef(false);
  const persistedRef = useRef(new Map<string, R>());
  const deletedRef = useRef(new Set<string>());
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
    deletedRef.current = new Set(deletedSourceRef.current?.() ?? []);
    queueRef.current = Promise.resolve();
    if (!scope || !householdId || !userId) return;
    let active = true;
    const isActive = () => active && scopeRef.current === scope && generationRef.current === generation;
    const channel = supabase.channel(`${table}:${householdId}`);
    const connect = async () => {
      const initialIds = new Set(entitiesRef.current.map(entity => entity.id));
      const { data, error } = await supabase.from(table).select("*").eq("household_id", householdId);
      if (!isActive()) return;
      if (error) { reportSupabaseError(`load normalized ${table}`, error, { householdId }); return; }
      for (const id of deletedSourceRef.current?.() ?? []) deletedRef.current.add(id);
      let rows = ((data ?? []) as R[]).sort(compareRows ?? ((left, right) =>
        ((left as R & { sort_order?: number }).sort_order ?? 0) - ((right as R & { sort_order?: number }).sort_order ?? 0)));
      if (!rows.length) {
        // A server legacy document can be migrated, but an old device cache
        // must never refill an intentionally empty canonical shopping table.
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
      persistedRef.current = new Map(rows.map(row => [row.id, row]));
      const normalized = rows.filter(row => !deletedRef.current.has(row.id)).map(fromRow);
      const serverIds = new Set(normalized.map(entity => entity.id));
      // Keep additions made while SELECT was in flight, without retaining cache-only rows.
      const addedDuringRead = entitiesRef.current.filter(entity => !initialIds.has(entity.id) && !serverIds.has(entity.id) && !deletedRef.current.has(entity.id));
      entitiesRef.current = [...normalized, ...addedDuringRead];
      setEntities(entitiesRef.current);
      loadedScopeRef.current = scope;
      readyRef.current = true;
      setReady(true);
      const receive = (payload: { eventType: string; old: unknown; new: unknown }) => {
        if (!isActive()) return;
        const type = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = (type === "DELETE" ? payload.old : payload.new) as R;
        if (!row?.id || (row.household_id && row.household_id !== householdId)) return;
        // RLS-protected DELETE events carry only the primary key. Ignore IDs
        // never loaded in this household; no deleted household content is read.
        if (type === "DELETE" && !persistedRef.current.has(row.id) && !entitiesRef.current.some(entity => entity.id === row.id)) return;
        const before = entitiesRef.current;
        const pending = planNormalizedSync(before, persistedRef.current, entity => toRow(entity, householdId, before.indexOf(entity)), canonicalize);
        for (const id of pending.deleteIds) deletedRef.current.add(id);
        for (const id of deletedSourceRef.current?.() ?? []) deletedRef.current.add(id);
        if (type === "DELETE") { persistedRef.current.delete(row.id); deletedRef.current.add(row.id); }
        else persistedRef.current.set(row.id, row);
        let next = applyNormalizedEvent(before, type, row, fromRow, {
          deletedIds: deletedRef.current, upsertIds: new Set(pending.upserts.map(entry => entry.id)),
        });
        if (next !== before) {
          // A transaction can deliver each row separately. Keep each received rank
          // instead of deriving a new rank from the temporarily incomplete array.
          const rank = (entity: T) => (toRow(entity, householdId) as R & { sort_order?: number }).sort_order ?? 0;
          next = [...next].sort((left, right) => compareRows
            ? compareRows(toRow(left, householdId), toRow(right, householdId)) : rank(left) - rank(right));
          entitiesRef.current = next; setEntities(next);
        }
        // A late update for a deleted row still needs its server copy removed.
        if (type !== "DELETE" && deletedRef.current.has(row.id)) setRetry(value => value + 1);
      };
      // A household filter cannot match a primary-key-only DELETE payload.
      // Keep INSERT/UPDATE filtered and accept only known IDs for DELETE.
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table, filter: `household_id=eq.${householdId}` }, receive)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `household_id=eq.${householdId}` }, receive)
        .on("postgres_changes", { event: "DELETE", schema: "public", table }, receive)
        .subscribe((status, subscriptionError) => {
          if (!isActive()) return;
          if (status === "SUBSCRIBED") setRetry(value => value + 1);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reportSupabaseError(`subscribe to normalized ${table}`, subscriptionError ?? new Error(status), { householdId, status });
        });
    };
    void connect().catch(error => { if (isActive()) reportRuntimeError(`connect normalized ${table}`, error, { householdId }); });
    return () => { active = false; readyRef.current = false; ++generationRef.current; void supabase.removeChannel(channel); };
  }, [scope, fromRow, toRow, householdId, userId, table, setEntities, entitiesRef, bootstrapEntitiesRef, compareRows]);

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
      await beforePersistRef.current?.();
      assertActive();
      const current = entitiesRef.current.filter(entity => !deletedRef.current.has(entity.id));
      const baseline = new Map(persistedRef.current);
      const plan = planNormalizedSync(current, baseline, entity => toRow(entity, householdId, current.indexOf(entity)), canonicalize);
      if (plan.upserts.length) {
        const { error } = await supabase.from(table).upsert(plan.upserts, { onConflict: "id" });
        assertActive();
        if (error) { reportSupabaseError(`persist normalized ${table}`, error, { householdId, count: plan.upserts.length }); throw new Error("This change could not be saved. Check your connection and try again."); }
        for (const row of plan.upserts) {
          const latest = persistedRef.current.get(row.id);
          if (!latest || latest === baseline.get(row.id)) persistedRef.current.set(row.id, row);
        }
      }
      assertActive();
      const remaining = entitiesRef.current.filter(entity => !deletedRef.current.has(entity.id));
      const deleteIds = planNormalizedSync(remaining, persistedRef.current, entity => toRow(entity, householdId, remaining.indexOf(entity)), canonicalize).deleteIds;
      if (deleteIds.length) {
        const { error } = await supabase.from(table).delete().eq("household_id", householdId).in("id", deleteIds);
        assertActive();
        if (error) { reportSupabaseError(`delete normalized ${table}`, error, { householdId, count: deleteIds.length }); throw new Error("This deletion could not be saved. Please try again."); }
        for (const id of deleteIds) { persistedRef.current.delete(id); deletedRef.current.add(id); }
      }
    };
    const operation = queueRef.current.then(persist, persist);
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
