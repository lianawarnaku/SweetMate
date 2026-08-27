import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RoommateAvatar } from "@/components/RoommateAvatar";
import { EmptyState } from "@/components/EmptyState";
import { HeaderActions } from "@/components/HeaderActions";
import { Surface } from "@/components/Surface";
import { useAppContextSelector } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";

const CANDY = {
  strawberry: "#D85D7A",
  strawberrySoft: "#FBE8ED",
  caramel: "#A96C3F",
  caramelSoft: "#F4E8DD",
  lavender: "#765A9B",
  lavenderSoft: "#EEE8F6",
  mint: "#3D806C",
  mintSoft: "#E3F3ED",
} as const;
const MEDALS = [CANDY.strawberry, CANDY.lavender, CANDY.caramel] as const;
const MEDAL_LABELS = ["1st", "2nd", "3rd"] as const;

const SWEET_ICONS: (keyof typeof Feather.glyphMap)[] = [
  "heart",
  "star",
  "award",
  "coffee",
  "circle",
  "gift",
  "smile",
];

export default function LeaderboardScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { roommates, chores, currentUserId, pointsEnabled, leaderboardPeriod, setLeaderboardPeriod } =
    useAppContextSelector((context) => ({
      roommates: context.roommates,
      chores: context.chores,
      currentUserId: context.currentUserId,
      pointsEnabled: context.pointsEnabled,
      leaderboardPeriod: context.leaderboardPeriod,
      setLeaderboardPeriod: context.setLeaderboardPeriod,
    }));

  const period = leaderboardPeriod;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : 0;

  const { sorted, completedByUser, extraCompletedByUser, totalCompleted } =
    useMemo(() => {
      const completed = new Map<string, number>();
      const extraCompleted = new Map<string, number>();
      let total = 0;
      chores.forEach((chore) => {
        if (!chore.completed) return;
        total += 1;
        completed.set(
          chore.assignedTo,
          (completed.get(chore.assignedTo) ?? 0) + 1,
        );
        const completedByExtra = (
          chore as typeof chore & { completedByExtra?: string }
        ).completedByExtra;
        if (completedByExtra && completedByExtra !== chore.assignedTo) {
          extraCompleted.set(
            completedByExtra,
            (extraCompleted.get(completedByExtra) ?? 0) + 1,
          );
        }
      });
      return {
        sorted: [...roommates].sort((a, b) =>
          period === "weekly"
            ? b.weeklyPoints - a.weeklyPoints
            : b.points - a.points,
        ),
        completedByUser: (id: string) => completed.get(id) ?? 0,
        extraCompletedByUser: (id: string) => extraCompleted.get(id) ?? 0,
        totalCompleted: total,
      };
    }, [chores, period, roommates]);

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  if (!pointsEnabled) return <Redirect href="/(tabs)" />;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 90 + botPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <View pointerEvents="none" style={styles.candyConfetti} accessibilityElementsHidden>
          <View style={[styles.candyDot, styles.candyDotLarge, { backgroundColor: CANDY.strawberrySoft }]} />
          <View style={[styles.candyDot, { backgroundColor: CANDY.mintSoft }]} />
          <View style={[styles.candyDot, styles.candyDotSmall, { backgroundColor: CANDY.lavenderSoft }]} />
        </View>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={[styles.kicker, { color: CANDY.strawberry }]}>SWEET STANDINGS</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Leaderboard</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>A little treat for every chore completed</Text>
          </View>
          <HeaderActions />
        </View>
        <View style={[styles.periodToggle, { backgroundColor: colors.muted }]}>
          {(["weekly", "alltime"] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.periodBtn,
                {
                  backgroundColor:
                    period === p ? CANDY.strawberry : "transparent",
                },
              ]}
              onPress={() => setLeaderboardPeriod(p)}
            >
              <Text
                style={[
                  styles.periodText,
                  {
                    color: period === p ? "#fff" : colors.mutedForeground,
                    fontFamily:
                      period === p ? "Inter_700Bold" : "Inter_400Regular",
                  },
                ]}
              >
                {p === "weekly" ? "This Week" : "All Time"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Surface
        style={[
          styles.statRow,
          { borderColor: colors.border },
        ]}
      >
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: CANDY.strawberrySoft }]}>
            <Feather name="check" size={14} color={CANDY.strawberry} />
          </View>
          <Text style={[styles.statNum, { color: CANDY.strawberry }]}>
            {totalCompleted}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Chores Done
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: CANDY.mintSoft }]}>
            <Feather name="star" size={14} color={CANDY.mint} />
          </View>
          <Text style={[styles.statNum, { color: CANDY.mint }]}>
            {roommates.reduce((s, r) => s + r.points, 0)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Total Points
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <View style={[styles.statIcon, { backgroundColor: CANDY.lavenderSoft }]}>
            <Feather name="users" size={14} color={CANDY.lavender} />
          </View>
          <Text style={[styles.statNum, { color: CANDY.lavender }]}>
            {roommates.length}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Roommates
          </Text>
        </View>
      </Surface>

      {top3.length > 0 ? (
        <View style={styles.podiumSection}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Top Performers
          </Text>
          <View style={styles.podium}>
            {top3.length > 1 ? (
              <View style={[styles.podiumSlot, styles.podiumSecond]}>
                <View
                  style={[
                    styles.crownWrapper,
                    { backgroundColor: MEDALS[1] + "22" },
                  ]}
                >
                  <Feather name="star" size={18} color={MEDALS[1]} accessibilityLabel="Second place sweet star" />
                </View>
                <RoommateAvatar
                  name={top3[1].name}
                  color={top3[1].color}
                  size={52}
                  imageUri={top3[1].avatarUri}
                />
                <View
                  style={[
                    styles.medalBadge,
                    { backgroundColor: MEDALS[1] + "22", borderColor: MEDALS[1] },
                  ]}
                >
                  <Text style={[styles.medalLabel, { color: MEDALS[1] }]}>
                    {MEDAL_LABELS[1]}
                  </Text>
                </View>
                <Text
                  style={[styles.podiumName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {top3[1].name}
                </Text>
                <Text style={[styles.podiumPoints, { color: colors.mutedForeground }]}>
                  {period === "weekly" ? top3[1].weeklyPoints : top3[1].points} pts
                </Text>
                <View
                  style={[
                    styles.podiumBar,
                    {
                      backgroundColor: MEDALS[1],
                      height: 60,
                    },
                  ]}
                />
              </View>
            ) : null}

            <View style={[styles.podiumSlot, styles.podiumFirst]}>
              <View
                style={[
                  styles.crownWrapper,
                  { backgroundColor: MEDALS[0] + "22" },
                ]}
              >
                <Feather name="heart" size={20} color={MEDALS[0]} accessibilityLabel="First place sweet heart" />
              </View>
              <RoommateAvatar
                name={top3[0].name}
                color={top3[0].color}
                size={62}
                imageUri={top3[0].avatarUri}
              />
              <View
                style={[
                  styles.medalBadge,
                  { backgroundColor: MEDALS[0] + "22", borderColor: MEDALS[0] },
                ]}
              >
                <Text style={[styles.medalLabel, { color: MEDALS[0] }]}>
                  {MEDAL_LABELS[0]}
                </Text>
              </View>
              <Text
                style={[styles.podiumName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {top3[0].name}{" "}
                {top3[0].id === currentUserId ? "(You)" : ""}
              </Text>
              <Text
                style={[styles.podiumPoints, { color: colors.mutedForeground }]}
              >
                {period === "weekly" ? top3[0].weeklyPoints : top3[0].points} pts
              </Text>
              <View
                style={[
                  styles.podiumBar,
                  { backgroundColor: MEDALS[0], height: 80 },
                ]}
              />
            </View>

            {top3.length > 2 ? (
              <View style={[styles.podiumSlot, styles.podiumThird]}>
                <View
                  style={[
                    styles.crownWrapper,
                    { backgroundColor: MEDALS[2] + "22" },
                  ]}
                >
                  <Feather name="award" size={18} color={MEDALS[2]} accessibilityLabel="Third place sweet award" />
                </View>
                <RoommateAvatar
                  name={top3[2].name}
                  color={top3[2].color}
                  size={44}
                  imageUri={top3[2].avatarUri}
                />
                <View
                  style={[
                    styles.medalBadge,
                    { backgroundColor: MEDALS[2] + "22", borderColor: MEDALS[2] },
                  ]}
                >
                  <Text style={[styles.medalLabel, { color: MEDALS[2] }]}>
                    {MEDAL_LABELS[2]}
                  </Text>
                </View>
                <Text
                  style={[styles.podiumName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {top3[2].name}
                </Text>
                <Text
                  style={[
                    styles.podiumPoints,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {period === "weekly" ? top3[2].weeklyPoints : top3[2].points} pts
                </Text>
                <View
                  style={[
                    styles.podiumBar,
                    { backgroundColor: MEDALS[2], height: 44 },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.rankingsHeader}>
        <View style={[styles.rankingsIcon, { backgroundColor: CANDY.caramelSoft }]}>
          <Feather name="gift" size={15} color={CANDY.caramel} />
        </View>
        <Text style={[styles.sectionTitle, styles.rankingsTitle, { color: colors.foreground }]}>
          Full Rankings
        </Text>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="award"
            title="The candy counter is empty"
            subtitle="Complete a chore to start the household’s sweet streak"
          />
        </View>
      ) : sorted.map((r, idx) => {
        const isMe = r.id === currentUserId;
        const completed = completedByUser(r.id);
        const pts = period === "weekly" ? r.weeklyPoints : r.points;
        const maxPts = period === "weekly"
          ? sorted[0].weeklyPoints
          : sorted[0].points;
        const pct = maxPts > 0 ? pts / maxPts : 0;

        const candyColor = [CANDY.strawberry, CANDY.lavender, CANDY.caramel, CANDY.mint][idx % 4];
        const candySoft = [CANDY.strawberrySoft, CANDY.lavenderSoft, CANDY.caramelSoft, CANDY.mintSoft][idx % 4];
        return (
          <View
            key={r.id}
            style={[
              styles.rankRow,
              {
                backgroundColor: isMe
                  ? CANDY.strawberrySoft
                  : colors.card,
                borderColor: isMe ? CANDY.strawberry + "66" : colors.border,
              },
            ]}
          >
            <View style={styles.rankIconCol}>
              <Text style={[styles.rank, { color: colors.mutedForeground }]}>
                {idx + 1}
              </Text>
              <Feather
                name={SWEET_ICONS[Math.min(idx, SWEET_ICONS.length - 1)]}
                size={11}
                color={candyColor}
              />
            </View>
            <RoommateAvatar name={r.name} color={r.color} size={40} imageUri={r.avatarUri} />
            <View style={styles.rankInfo}>
              <View style={styles.rankNameRow}>
                <Text style={[styles.rankName, { color: colors.foreground }]}>
                  {r.name} {isMe ? "(You)" : ""}
                </Text>
                {completed >= 5 ? (
                  <View style={[styles.fairyBadge, { backgroundColor: CANDY.mintSoft }]}>
                    <Feather name="star" size={10} color={CANDY.mint} />
                    <Text
                      style={[styles.fairyText, { color: CANDY.mint }]}
                    >
                      Sweet streak
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.rankMeta}>
                <Text style={[styles.rankCompleted, { color: colors.mutedForeground }]}>
                  {completed} chores
                </Text>
                <View style={[styles.miniBar, { backgroundColor: colors.muted }]}>
                  <View
                    style={[
                      styles.miniBarFill,
                      {
                        backgroundColor: candyColor,
                        width: `${pct * 100}%` as `${number}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>
            <View
              style={[
                styles.rankPoints,
                { backgroundColor: candySoft },
              ]}
            >
              <Text style={[styles.rankPtsNum, { color: candyColor }]} numberOfLines={1} adjustsFontSizeToFit>
                {pts}
              </Text>
              <Text style={[styles.rankPtsLabel, { color: candyColor }]}>
                pts
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
    overflow: "hidden",
  },
  candyConfetti: {
    position: "absolute",
    right: 30,
    top: 70,
    width: 74,
    height: 42,
  },
  candyDot: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    right: 2,
    top: 2,
  },
  candyDotLarge: { width: 30, height: 30, borderRadius: 15, right: 30, top: 10 },
  candyDotSmall: { width: 12, height: 12, borderRadius: 6, right: 13, top: 30 },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 36 },
  kicker: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  periodToggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderRadius: 22,
    backgroundColor: "rgba(123, 86, 59, 0.10)",
    padding: 3,
    gap: 2,
  },
  periodBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  periodText: { fontSize: 13 },
  statRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  statItem: { flex: 1, alignItems: "center" },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statNum: { fontFamily: "Inter_700Bold", fontSize: 22 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  statDivider: { width: 1, marginHorizontal: 8 },
  podiumSection: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  podium: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 8,
  },
  podiumSlot: { alignItems: "center", gap: 6, flex: 1 },
  podiumFirst: {},
  podiumSecond: {},
  podiumThird: {},
  crownWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rankIconCol: {
    width: 24,
    alignItems: "center",
    gap: 2,
  },
  medalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  medalLabel: { fontFamily: "Inter_700Bold", fontSize: 11 },
  podiumName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textAlign: "center",
    width: "100%",
  },
  podiumPoints: { fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" },
  podiumBar: {
    width: "100%",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    opacity: 0.82,
  },
  rankingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  rankingsIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rankingsTitle: { paddingHorizontal: 0, marginBottom: 0 },
  emptyWrap: { paddingHorizontal: 16, paddingVertical: 30 },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  rank: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    width: 24,
    textAlign: "center",
  },
  rankInfo: { flex: 1, gap: 4 },
  rankNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rankName: {
    flexShrink: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  fairyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  fairyText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  rankMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  rankCompleted: { fontFamily: "Inter_400Regular", fontSize: 12 },
  miniBar: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  miniBarFill: { height: 4, borderRadius: 2 },
  rankPoints: {
    alignItems: "center",
    padding: 8,
    borderRadius: 10,
    minWidth: 58,
    maxWidth: 76,
  },
  rankPtsNum: { fontFamily: "Inter_700Bold", fontSize: 18 },
  rankPtsLabel: { fontFamily: "Inter_400Regular", fontSize: 10 },
});
