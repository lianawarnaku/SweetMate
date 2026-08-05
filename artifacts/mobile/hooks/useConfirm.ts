import { useAppContextSelector } from "@/context/AppContext";
import { useAppPopup } from "@/components/AppPopupProvider";

type ConfirmOpts = {
  confirmText?: string;
  destructive?: boolean;
};

export function useConfirm() {
  const { showPopup } = useAppPopup();
  const { suppressedAlerts, suppressAlert } = useAppContextSelector(
    (context) => ({
      suppressedAlerts: context.suppressedAlerts,
      suppressAlert: context.suppressAlert,
    }),
  );

  function confirm(
    id: string,
    title: string,
    message: string,
    onConfirm: () => void,
    opts: ConfirmOpts = {}
  ) {
    if (suppressedAlerts[id]) {
      onConfirm();
      return;
    }
    const { confirmText = "OK", destructive = false } = opts;
    showPopup({ title, message, icon: destructive ? "alert-triangle" : "help-circle", actions: [
      { label: "Cancel" },
      { label: confirmText, destructive, primary: !destructive, onPress: onConfirm },
      { label: "Don't show again", onPress: () => { suppressAlert(id); onConfirm(); } },
    ] });
  }

  function info(id: string, title: string, message: string) {
    if (suppressedAlerts[id]) return;
    showPopup({ title, message, actions: [
      { label: "Got it", primary: true },
      { label: "Don't show again", onPress: () => suppressAlert(id) },
    ] });
  }

  return { confirm, info };
}
