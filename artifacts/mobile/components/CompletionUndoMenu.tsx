import { ActionMenuModal } from "@/components/ActionMenuModal";

export type CompletionUndoItem = { id: string; title: string };

type Props = {
  visible: boolean;
  title: string;
  items: CompletionUndoItem[];
  onUndo: (id: string) => void;
  onClose: () => void;
  successMessage?: string;
};

export function CompletionUndoMenu({ visible, title, items, onUndo, onClose, successMessage = "Completion undone" }: Props) {
  return (
    <ActionMenuModal
      visible={visible}
      title={title}
      subtitle={items.length ? "Choose a checked-off item to undo." : "No checked-off items to undo."}
      onClose={onClose}
      actions={items.map((item) => ({
        key: item.id,
        label: `Undo: ${item.title}`,
        icon: "rotate-ccw",
        successMessage,
        onPress: () => onUndo(item.id),
      }))}
    />
  );
}
