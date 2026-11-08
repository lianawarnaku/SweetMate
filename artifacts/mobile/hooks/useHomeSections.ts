import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";

import { reportRuntimeError } from "@/lib/runtimeDiagnostics";

export type HomeSectionId = "my-chores" | "schedule" | "shopping";
type HomeSections = Record<HomeSectionId, boolean>;
const DEFAULT_SECTIONS: HomeSections = {
  "my-chores": true,
  schedule: true,
  shopping: true,
};

export function useHomeSections(userId: string) {
  const key = userId ? `sweetmate:home-sections:v1:${userId}` : null;
  const [state, setState] = useState<{ key: string | null; loaded: boolean; sections: HomeSections }>({
    key, loaded: false, sections: { ...DEFAULT_SECTIONS },
  });
  const pendingToggles = useRef<Partial<HomeSections>>({});
  const writeQueue = useRef(Promise.resolve());
  const sections = state.key === key ? state.sections : DEFAULT_SECTIONS;

  useEffect(() => {
    let active = true;
    pendingToggles.current = {};
    setState({ key, loaded: false, sections: { ...DEFAULT_SECTIONS } });
    if (!key) return;
    AsyncStorage.getItem(key)
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : null;
        const restored = { ...DEFAULT_SECTIONS };
        for (const section of Object.keys(restored) as HomeSectionId[]) {
          if (typeof saved?.[section] === "boolean") restored[section] = saved[section];
        }
        if (active) setState({ key, loaded: true, sections: { ...restored, ...pendingToggles.current } });
      })
      .catch((error) => {
        reportRuntimeError("restore home section preferences", error);
        if (active) setState((current) => ({ ...current, loaded: true }));
      });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (!key || state.key !== key || !state.loaded) return;
    // Serialize writes so rapid toggles cannot leave an older choice on disk.
    const value = JSON.stringify(state.sections);
    writeQueue.current = writeQueue.current
      .then(() => AsyncStorage.setItem(key, value))
      .catch((error) => reportRuntimeError("save home section preferences", error));
  }, [key, state]);

  const toggleSection = (section: HomeSectionId) => {
    const nextValue = !sections[section];
    pendingToggles.current[section] = nextValue;
    setState((current) => ({
      ...current,
      key,
      sections: { ...(current.key === key ? current.sections : DEFAULT_SECTIONS), [section]: nextValue },
    }));
  };

  return { expandedHomeSections: sections, toggleSection };
}
