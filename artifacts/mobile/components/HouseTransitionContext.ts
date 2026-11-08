import { createContext } from "react";

type HouseTarget = { x: number; y: number; size: number };
export const HouseTransitionContext = createContext<((target: HouseTarget) => void) | null>(null);
