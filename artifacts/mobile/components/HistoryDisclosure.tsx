import React, { ReactNode } from "react";
import { View } from "react-native";

import { SectionDivider } from "@/components/SectionDivider";

export function HistoryDisclosure({
  count,
  expanded,
  onToggle,
  children,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <View>
      <SectionDivider
        title="History"
        iconOnly
        icon="archive"
        count={count}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded ? children : null}
    </View>
  );
}
