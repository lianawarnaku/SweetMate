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
      :where(button, a, input, textarea, select, [tabindex], [role="button"], [role="checkbox"], [role="radio"], [role="tab"]) {
        -webkit-tap-highlight-color: transparent;
      }
      :where(button, a, input, textarea, select, [tabindex], [role="button"], [role="checkbox"], [role="radio"], [role="tab"]):focus:not(:focus-visible) {
        outline: none;
      }
      :where(button, a, input, textarea, select, [tabindex], [role="button"], [role="checkbox"], [role="radio"], [role="tab"]):focus-visible {
        outline: 2px solid ${colors.focusRing};
        outline-offset: 2px;
      }
    `;
  }, [colors.focusRing]);

  return null;
}
