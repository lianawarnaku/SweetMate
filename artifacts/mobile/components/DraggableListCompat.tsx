import React, { useRef, useState } from "react";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/constants/colors";
import {
  type FlatListProps,
  Platform,
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
} from "react-native";
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  ScaleDecorator,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import Animated, { type ILayoutAnimationBuilder } from "react-native-reanimated";

type DraggableListCompatProps<T> = Omit<FlatListProps<T>, "data" | "keyExtractor" | "renderItem" | "CellRendererComponent"> & {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (params: RenderItemParams<T>) => React.ReactElement | null;
  onDragBegin?: (index: number) => void;
  onDragEnd?: (params: { data: T[]; from: number; to: number }) => void;
  activationDistance?: number;
  /** Web cell transitions; native dragging keeps its own position animation. */
  itemLayoutAnimation?: ILayoutAnimationBuilder;
};

export function DraggableListCompat<T>({
  renderItem,
  data,
  keyExtractor,
  onDragBegin,
  onDragEnd,
  activationDistance,
  itemLayoutAnimation,
  ...props
}: DraggableListCompatProps<T>) {
  const colors = useTheme();
  const [movingIndex, setMovingIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  if (Platform.OS === "web") {
    const labelFor = (item: T, index: number) => {
      const value = item as Record<string, unknown> | null;
      return typeof value?.name === "string" ? value.name : typeof value?.title === "string" ? value.title : `item ${index + 1}`;
    };
    const move = (from: number, to: number, started = false) => {
      if (from < 0 || to < 0 || from >= data.length || to >= data.length) return;
      if (!started) onDragBegin?.(from);
      const reordered = [...data];
      const [item] = reordered.splice(from, 1);
      reordered.splice(to, 0, item);
      setMovingIndex(null);
      onDragEnd?.({ data: reordered, from, to });
    };
    return <Animated.FlatList
      {...props}
      itemLayoutAnimation={itemLayoutAnimation}
      data={data}
      keyExtractor={keyExtractor}
      scrollEnabled={false}
      renderItem={({ item, index }) => <div
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          dragFrom.current = index;
          onDragBegin?.(index);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", keyExtractor(item, index));
        }}
        onDragOver={(event) => { if (dragFrom.current !== null) { event.preventDefault(); event.stopPropagation(); } }}
        onDrop={(event) => {
          if (dragFrom.current === null) return;
          event.preventDefault(); event.stopPropagation();
          const from = dragFrom.current;
          dragFrom.current = null;
          move(from, index, true);
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
          if (dragFrom.current !== null) {
            const from = dragFrom.current;
            dragFrom.current = null;
            onDragEnd?.({ data: [...data], from, to: from });
          }
        }}
        style={{ display: "flex", flexDirection: "column" }}
      >
        {renderItem({ item, drag: () => setMovingIndex(index), isActive: false, getIndex: () => index })}
        {movingIndex === index && <View style={{ flexDirection: "row", gap: 8, paddingVertical: 8 }}>
          <GlassButton tone="neutral" disabled={index === 0} accessibilityLabel={`Move ${labelFor(item, index)} up`} onPress={() => move(index, index - 1)} style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground }}>Move up</Text>
          </GlassButton>
          <GlassButton tone="neutral" disabled={index === data.length - 1} accessibilityLabel={`Move ${labelFor(item, index)} down`} onPress={() => move(index, index + 1)} style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground }}>Move down</Text>
          </GlassButton>
          <GlassButton tone="neutral" accessibilityLabel="Done reordering" onPress={() => setMovingIndex(null)}><Text style={{ color: colors.foreground }}>Done</Text></GlassButton>
        </View>}
      </div>}
    />;
  }

  return (
    <NestableDraggableFlatList
      {...props}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onDragBegin={onDragBegin}
      onDragEnd={onDragEnd}
      activationDistance={activationDistance}
    />
  );
}

export function DraggableScrollContainerCompat(props: ScrollViewProps) {
  if (Platform.OS === "web") {
    return <ScrollView {...props} />;
  }
  return <NestableScrollContainer {...props} />;
}

export function ScaleDecoratorCompat({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "web") return <>{children}</>;
  return <ScaleDecorator>{children}</ScaleDecorator>;
}
