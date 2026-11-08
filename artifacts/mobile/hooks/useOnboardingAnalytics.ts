import { useEffect } from "react";
import { useAnalyticsPreferences } from "@/components/AnalyticsConsentManager";
import { track } from "@/lib/analytics";
import {
  createOnboardingAnalyticsTracker,
  type OnboardingContext,
  type OnboardingFlow,
  type OnboardingOutcome,
  type OnboardingStep,
} from "@/lib/onboardingAnalytics";

const tracker = createOnboardingAnalyticsTracker({
  started: (properties) => track.onboardingStarted(properties),
  viewed: (properties) => track.onboardingStepViewed(properties),
  stepCompleted: (properties) => track.onboardingStepCompleted(properties),
  completed: (properties) => track.onboardingCompleted(properties),
  cancelled: (properties) => track.onboardingCancelled(properties),
});

export function useOnboardingAnalytics({
  userId, flow, context, step, resumed = false,
}: {
  userId: string | null;
  flow: OnboardingFlow;
  context: OnboardingContext;
  step: OnboardingStep;
  resumed?: boolean;
}) {
  const { loaded, ready, preferences } = useAnalyticsPreferences(userId);
  const enabled = Boolean(userId && loaded && ready && preferences.productAnalyticsEnabled);
  useEffect(() => {
    if (enabled && userId) tracker.view(userId, flow, context, step, resumed);
  }, [context, enabled, flow, resumed, step, userId]);

  return {
    completeStep: (completedStep: OnboardingStep = step, outcome: OnboardingOutcome = "continued") => {
      if (enabled && userId) tracker.completeStep(userId, flow, completedStep, outcome);
    },
    complete: () => { if (enabled && userId) tracker.complete(userId, flow); },
    cancel: () => { if (enabled && userId) tracker.cancel(userId, flow, step); },
  };
}
