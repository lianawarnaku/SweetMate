import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

interface RoommateAvatarProps {
  name: string;
  color: string;
  size?: number;
  imageUri?: string;
}

export function RoommateAvatar({
  name,
  color,
  size = 36,
  imageUri,
}: RoommateAvatarProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const fontSize = size * 0.38;

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color + "55",
        }}
      />
    );
  }

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color + "22",
          borderColor: color + "55",
        },
      ]}
    >
      <Text style={[styles.initials, { color, fontSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  initials: {
    fontFamily: "Inter_700Bold", includeFontPadding: false,
    letterSpacing: 0.5,
  },
});
