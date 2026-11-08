import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  getHouseMonitorUnseenCount,
  houseMonitorSeenStorageKey,
  parseStoredHouseMonitorSeen,
} from "@/lib/houseMonitorSeen";
import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

export interface HouseMonitorReplay {
  nonce: number;
  fromCompletedChores: number;
  newCompletions: number;
  totalChores: number;
  completedChores: number;
}

interface HouseMonitorReplayOptions {
  userId?: string;
  householdId?: string;
  completionTokens?: readonly string[];
  totalChores: number;
  completedChores: number;
  isFocused: boolean;
  ready?: boolean;
}

type ReplayState = {
  key: string | null;
  loaded: boolean;
  replay: HouseMonitorReplay | null;
};

type SeenScope = {
  key: string | null;
  loaded: boolean;
  seen: Set<string>;
};

// A remount or a second observer must not claim a presentation that's already
// begun while its storage write is still in flight. Keys separate users/homes.
const presentedByKey = new Map<string, Set<string>>();
const writesByKey = new Map<string, Promise<void>>();

function persistPresented(key: string, presented: ReadonlySet<string>) {
  const snapshot = [...presented];
  const previous = writesByKey.get(key) ?? Promise.resolve();
  const write = previous
    .then(async () => {
      // Merge rather than replace: even if hydration failed temporarily, an
      // unread older baseline must never be erased by a newer presentation.
      const stored = parseStoredHouseMonitorSeen(await AsyncStorage.getItem(key));
      const merged = new Set([
        ...(stored ?? []),
        ...(presentedByKey.get(key) ?? []),
        ...snapshot,
      ]);
      presentedByKey.set(key, merged);
      await AsyncStorage.setItem(key, JSON.stringify([...merged].sort()));
    })
    .catch((error) => reportRuntimeError("save House Monitor viewing progress", error));
  writesByKey.set(key, write);
  void write.then(() => {
    if (writesByKey.get(key) === write) writesByKey.delete(key);
  });
}

function normalizedCount(value: number) {
  return Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0;
}

/** Replays each completion identity once, when this person actually views it. */
export function useHouseMonitorReplay({
  userId,
  householdId,
  completionTokens,
  totalChores,
  completedChores,
  isFocused,
  ready = true,
}: HouseMonitorReplayOptions): { replay: HouseMonitorReplay | null; loaded: boolean } {
  const key = userId && householdId && completionTokens !== undefined
    ? houseMonitorSeenStorageKey(userId, householdId)
    : null;
  const currentTokens = useMemo(
    () => [...new Set(completionTokens ?? [])].sort(),
    [completionTokens],
  );
  const total = normalizedCount(totalChores);
  const completed = Math.min(total, normalizedCount(completedChores));
  const [state, setState] = useState<ReplayState>({ key: null, loaded: !key, replay: null });
  const scope = useRef<SeenScope>({ key: null, loaded: false, seen: new Set() });
  const nextNonce = useRef(0);

  useEffect(() => {
    let active = true;
    const restoring: SeenScope = { key, loaded: !key, seen: new Set() };
    scope.current = restoring;
    setState({ key, loaded: !key, replay: null });
    if (!key) return () => { active = false; };

    const restore = async () => {
      let stored: string[] | null = null;
      try {
        // A previous mount may still be saving the same home's seen union.
        await writesByKey.get(key);
        stored = parseStoredHouseMonitorSeen(await AsyncStorage.getItem(key));
      } catch (error) {
        reportRuntimeError("restore House Monitor viewing progress", error);
      }
      if (!active || scope.current !== restoring) return;
      const restored = new Set([
        ...(stored ?? []),
        ...(presentedByKey.get(key) ?? []),
      ]);
      restoring.seen = restored;
      restoring.loaded = true;
      presentedByKey.set(key, restored);
      setState({ key, loaded: true, replay: null });
    };
    void restore();
    return () => { active = false; };
  }, [key]);

  useLayoutEffect(() => {
    if (!key || !isFocused || !ready) {
      setState((current) => current.replay === null
        ? current
        : { ...current, replay: null });
      return;
    }
    const current = scope.current;
    if (current.key !== key || !current.loaded || state.key !== key || !state.loaded) return;

    // Reading the shared union here also prevents two focused instances from
    // presenting the same identity during one commit.
    const seen = new Set([
      ...current.seen,
      ...(presentedByKey.get(key) ?? []),
    ]);
    const newCompletions = Math.min(
      completed,
      getHouseMonitorUnseenCount(currentTokens, [...seen]),
    );
    if (newCompletions === 0) {
      // A replay belongs to one layout/count snapshot. Do not reuse its nonce
      // if adding chores mounts new grid cells, or if counts later return.
      setState((value) => value.replay &&
        (value.replay.totalChores !== total || value.replay.completedChores !== completed)
        ? { ...value, replay: null }
        : value);
      return;
    }

    // Claim only at presentation start, never while blurred or before counts
    // are ready. Undo/deletion does not remove old identities from this union.
    for (const token of currentTokens) seen.add(token);
    current.seen = seen;
    presentedByKey.set(key, seen);
    const replay = {
      nonce: ++nextNonce.current,
      fromCompletedChores: completed - newCompletions,
      newCompletions,
      totalChores: total,
      completedChores: completed,
    };
    setState({ key, loaded: true, replay });
    persistPresented(key, seen);
  }, [completed, currentTokens, isFocused, key, ready, state.key, state.loaded, total]);

  return {
    replay: key && state.key === key && isFocused && ready &&
      state.replay?.totalChores === total && state.replay.completedChores === completed
      ? state.replay : null,
    loaded: !key || (state.key === key && state.loaded),
  };
}
