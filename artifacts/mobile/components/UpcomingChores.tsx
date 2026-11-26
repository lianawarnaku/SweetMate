import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { RoommateAvatar } from "@/components/RoommateAvatar";
import { useTheme } from "@/constants/colors";
import type { Chore, Roommate } from "@/context/AppContext";
import { upcomingChoreDueLabel } from "@/lib/upcomingChores";

export function UpcomingChores({ chores, roommates, timezone, showAssignee = true }: {
  chores: Chore[];
  roommates: Roommate[];
  timezone: string;
  showAssignee?: boolean;
}) {
  const colors = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(8);
  if (!chores.length) return null;
  return <View style={styles.section}>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} Upcoming`}
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      onPress={() => setExpanded((current) => !current)}
      activeOpacity={0.7}
      style={styles.header}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>Upcoming</Text>
      <Feather name={expanded ? "chevron-down" : "chevron-right"} size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
    {expanded && <>
      {chores.slice(0, visibleLimit).map((chore) => {
        const member = roommates.find((roommate) => roommate.id === chore.assignedTo);
        const owner = member?.name ?? "Needs assignment";
        const due = upcomingChoreDueLabel(chore.dueDate, timezone);
        return <View key={chore.id} accessible accessibilityRole="text" accessibilityLabel={`${chore.title}. Assigned to ${owner}. Due ${due.date} at ${due.time}, household time.`} style={[styles.row, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{chore.title}</Text>
          <View style={[styles.details, !showAssignee && { justifyContent: "flex-end" }]}>
            {showAssignee && <View style={styles.owner}>
              {member ? <RoommateAvatar name={member.name} color={member.color} imageUri={member.avatarUri} size={24} /> : <Feather name="user" size={20} color={colors.mutedForeground} />}
              <Text style={[styles.ownerName, { color: colors.mutedForeground }]}>{owner}</Text>
            </View>}
            <View style={styles.due}>
              <Text style={[styles.date, { color: colors.foreground }]}>{due.date}</Text>
              <Text style={[styles.time, { color: colors.mutedForeground }]}>{due.time}</Text>
            </View>
          </View>
        </View>;
      })}
      {visibleLimit < chores.length && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Show more upcoming chores, ${chores.length - visibleLimit} remaining`} onPress={() => setVisibleLimit((current) => current + 20)} style={styles.showMore}>
        <Text style={[styles.moreText, { color: colors.mutedForeground }]}>Show more ({chores.length - visibleLimit} remaining)</Text>
      </TouchableOpacity>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  header: { minHeight: 44, marginTop: 18, marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heading: { fontFamily: "Inter_700Bold", includeFontPadding: false, fontSize: 15, flexShrink: 1 },
  row: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 },
  details: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  owner: { flexDirection: "row", flexShrink: 1, alignItems: "center", gap: 7, maxWidth: "100%" },
  ownerName: { flexShrink: 1, fontFamily: "Inter_500Medium", fontSize: 13 },
  due: { alignItems: "flex-end", maxWidth: "100%", gap: 2 },
  date: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18 },
  time: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  showMore: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  moreText: { fontFamily: "Inter_500Medium", fontSize: 13, textDecorationLine: "underline" },
});
