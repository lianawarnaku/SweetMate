import React from "react";
import {
  type FlatListProps,
  Platform,
  ScrollView,
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
  if (Platform.OS === "web") {
    return (
      <Animated.FlatList
        {...props}
        itemLayoutAnimation={itemLayoutAnimation}
        data={data}
        keyExtractor={keyExtractor}
        scrollEnabled={false}
        renderItem={({ item, index }) =>
          renderItem({
            item,
            drag: () => undefined,
            isActive: false,
            getIndex: () => index,
          })
        }
      />
    );
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
