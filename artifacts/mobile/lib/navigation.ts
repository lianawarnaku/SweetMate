import type { Href, router as ExpoRouter } from "expo-router";

/** Direct links and restored screens may have no previous navigation entry. */
export function backWithFallback(router: Pick<typeof ExpoRouter, "canGoBack" | "back" | "replace">, fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
