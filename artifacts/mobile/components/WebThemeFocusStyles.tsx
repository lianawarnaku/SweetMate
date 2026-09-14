import { useEffect } from "react";
import { Platform } from "react-native";

import { useTheme } from "@/constants/colors";

const STYLE_ID = "sweetmate-theme-focus-styles";

/** Replaces browser-default focus colors with the active SweetMate theme. */
export function WebThemeFocusStyles() {
  const colors = useTheme();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      :where(button, input, textarea, select, [role="button"], [role="checkbox"], [role="radio"], [role="tab"]):focus {
        outline: none;
      }
      :where(button, input, textarea, select, [role="button"], [role="checkbox"], [role="radio"], [role="tab"]):focus-visible {
        outline: 2px solid ${colors.primary};
        outline-offset: 2px;
      }
    `;
  }, [colors.primary]);

  return null;
}
