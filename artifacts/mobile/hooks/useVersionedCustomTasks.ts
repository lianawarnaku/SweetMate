import { useCallback, useRef, useState } from "react";
import type { CustomTask } from "@/context/AppContext";

export type CustomTaskSyncMeta = { versions: Record<string, string>; deleted: Record<string, string> };
const emptyMeta = (): CustomTaskSyncMeta => ({ versions: {}, deleted: {} });
const mergeMap = (left: Record<string, string>, right: Record<string, string>) => {
  const merged = { ...left };
  for (const [id, version] of Object.entries(right)) if (!merged[id] || version > merged[id]) merged[id] = version;
  return merged;
};
const newest = (meta: CustomTaskSyncMeta, id: string) => [meta.versions[id] ?? "", meta.deleted[id] ?? ""].sort().at(-1) ?? "";

/** Preserve explicit additions/deletions when an older household snapshot arrives. */
export function useVersionedCustomTasks() {
  const [state, setState] = useState<{ items: CustomTask[]; meta: CustomTaskSyncMeta }>({ items: [], meta: emptyMeta() });
  const current = useRef(state);
  const publish = useCallback((next: typeof state) => { current.current = next; setState(next); }, []);
  const restore = useCallback((items: CustomTask[], meta?: CustomTaskSyncMeta) => {
    publish({ items: Array.isArray(items) ? items : [], meta: meta ?? emptyMeta() });
  }, [publish]);
  const applyRemote = useCallback((remoteItems?: CustomTask[], incomingMeta?: CustomTaskSyncMeta) => {
    const local = current.current;
    const remoteMeta = incomingMeta ?? emptyMeta();
    const meta = { versions: mergeMap(local.meta.versions, remoteMeta.versions), deleted: mergeMap(local.meta.deleted, remoteMeta.deleted) };
    const remote = new Map((remoteItems ?? local.items).map(item => [item.id, item]));
    const items = new Map(local.items.map(item => [item.id, item]));
    let needsWriteback = false;
    for (const id of new Set([...items.keys(), ...remote.keys(), ...Object.keys(local.meta.deleted)])) {
      const localVersion = newest(local.meta, id), remoteVersion = newest(remoteMeta, id);
      if (localVersion > remoteVersion) needsWriteback = true;
      if (remote.has(id) && (remoteVersion >= localVersion || !items.has(id))) items.set(id, remote.get(id)!);
      else if (!remote.has(id) && !localVersion) items.delete(id); // authoritative legacy baseline
      if (meta.deleted[id] && meta.deleted[id] >= (meta.versions[id] ?? "")) items.delete(id);
    }
    publish({ items: [...items.values()], meta });
    return needsWriteback;
  }, [publish]);
  const mutate = useCallback((id: string, item?: CustomTask) => {
    const local = current.current;
    // Monotonic per-record versions also tolerate a device clock moving backward.
    const previous = Date.parse(newest(local.meta, id));
    const version = new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
    const meta = { versions: { ...local.meta.versions }, deleted: { ...local.meta.deleted } };
    if (item) meta.versions[id] = version; else meta.deleted[id] = version;
    publish({ items: [...local.items.filter(entry => entry.id !== id), ...(item ? [item] : [])], meta });
  }, [publish]);
  return { items: state.items, meta: state.meta, restore, applyRemote, mutate };
}
