import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/constants/colors";

type CheckCircleState = "idle" | "checked" | "warning";

export function GlassCheckCircle({
  state = "idle",
  size = 24,
}: {
  state?: CheckCircleState;
  size?: number;
}) {
  const colors = useTheme();
  const activeColor = state === "warning" ? colors.warning : colors.success;
  const active = state !== "idle";

  return (
    <View
      pointerEvents="none"
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: active ? activeColor : colors.mutedForeground,
        },
      ]}
    >
      <BlurView
        intensity={42}
        tint="dark"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, overflow: "hidden" },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            overflow: "hidden",
            backgroundColor: active
              ? activeColor + "26"
              : "rgba(255,255,255,0.035)",
          },
        ]}
      />
      {active ? (
        <Feather
          name={state === "warning" ? "alert-circle" : "check"}
          size={Math.max(11, size * 0.5)}
          color={activeColor}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1.7,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
